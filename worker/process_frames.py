import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from register_frame import register_frame, parse_frame_ts_from_filename


API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8000")
DRONE_ID = os.getenv("DRONE_ID", "drone1")
FRAMES_DIR = os.getenv("FRAMES_DIR", f"/root/frames/{DRONE_ID}")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "1.0"))
ALPR_COUNTRY = os.getenv("ALPR_COUNTRY", "us")
OPENALPR_IMAGE = os.getenv("OPENALPR_IMAGE", "openalpr/openalpr")
STATE_FILE = os.getenv("STATE_FILE", f"/tmp/ambers_angels_{DRONE_ID}_processed.json")


def load_processed() -> set[str]:
    if not os.path.exists(STATE_FILE):
        return set()
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return set(data)
    except Exception:
        return set()


def save_processed(processed: set[str]) -> None:
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sorted(processed), f)
    os.replace(tmp, STATE_FILE)


def run_openalpr(frame_path: str) -> Dict[str, Any]:
    frames_dir = os.path.abspath(FRAMES_DIR)
    frame_abs = os.path.abspath(frame_path)

    if not frame_abs.startswith(frames_dir):
        raise ValueError(f"Frame path {frame_abs} is not inside mounted FRAMES_DIR {frames_dir}")

    rel_path = os.path.relpath(frame_abs, frames_dir)
    container_path = f"/data/{rel_path}"

    cmd = [
        "docker", "run", "--rm",
        "-v", f"{frames_dir}:/data",
        OPENALPR_IMAGE,
        "-j",
        "-c", ALPR_COUNTRY,
        container_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, check=False)

    if result.returncode != 0:
        raise RuntimeError(
            f"OpenALPR failed for {frame_path}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    return json.loads(result.stdout)


def extract_best_plate(alpr_json: Dict[str, Any]) -> tuple[Optional[str], Optional[float]]:
    results = alpr_json.get("results", [])
    if not results:
        return None, None

    best_plate = None
    best_conf = None

    for item in results:
        plate = item.get("plate")
        conf = item.get("confidence")
        if not plate:
            continue
        if best_conf is None or (conf is not None and conf > best_conf):
            best_plate = plate
            best_conf = conf

    return best_plate, best_conf


def post_detection(
    plate_text: Optional[str],
    confidence: Optional[float],
    detected_at: datetime,
) -> Dict[str, Any]:
    # Aligning with your new Postgres Schema keys
    payload = {
        "plate": plate_text if plate_text else "UNKNOWN",
        "plate_normalized": plate_text.replace("-", "").replace(" ", "").upper() if plate_text else "UNKNOWN",
        "confidence": confidence if confidence else 0.0,
        "drone_id": DRONE_ID,
        "latitude": 33.7490, # Placeholder - hook into your GPS logic if available
        "longitude": -84.3880,
        "timestamp": detected_at.isoformat()
    }

    # Added /api/ prefix if not in API_BASE, and pointed to process_detection
    target_url = f"{API_BASE.rstrip('/')}/process_detection"
    resp = requests.post(target_url, json=payload, timeout=10)
    resp.raise_for_status()
    return resp.json()

def process_one_frame(frame_path: str) -> None:
    # Colors
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

    start_time = time.time()
    
    # 1. Register the Frame
    try:
        frame_result = register_frame(frame_path)
        frame_id = frame_result["frame_id"]
    except Exception as e:
        print(f"❌ {YELLOW}Frame Registration Failed:{RESET} {e}")
        return

    # 2. Run ALPR
    alpr_json = run_openalpr(frame_path)
    plate_text, confidence = extract_best_plate(alpr_json)
    detected_at = parse_frame_ts_from_filename(frame_path)

    # 3. Handle Detection
    if plate_text:
        detection_result = post_detection(
            frame_id=frame_id,
            plate_text=plate_text,
            confidence=confidence,
            detected_at=detected_at,
            raw_payload=alpr_json,
        )
        
        proc_time = time.time() - start_time
        conf_color = GREEN if confidence > 85 else YELLOW
        
        # --- THE PRETTY LOG LINE ---
        print(f"{CYAN}[{datetime.now().strftime('%H:%M:%S')}] {RESET}"
              f"{BOLD}HIT:{RESET} {conf_color}{plate_text.ljust(10)}{RESET} | "
              f"Conf: {conf_color}{confidence:>5.1f}%{RESET} | "
              f"ID: {detection_result.get('detection_id', 'N/A')} | "
              f"Proc: {proc_time:.2f}s")
    else:
        print(f"{CYAN}[{datetime.now().strftime('%H:%M:%S')}] {RESET}SCAN: No plate found in {os.path.basename(frame_path)}")
def list_candidate_frames() -> List[str]:
    path = Path(FRAMES_DIR)
    if not path.exists():
        return []

    candidates = []
    for ext in ("*.jpg", "*.jpeg", "*.png"):
        candidates.extend(path.glob(ext))

    return sorted(str(p.resolve()) for p in candidates)


def main() -> None:
    print(f"[INFO] Watching {FRAMES_DIR}")
    processed = load_processed()

    while True:
        try:
            frames = list_candidate_frames()
            for frame_path in frames:
                if frame_path in processed:
                    continue

                try:
                    process_one_frame(frame_path)
                    processed.add(frame_path)
                    save_processed(processed)
                except Exception as exc:
                    print(f"[ERROR] Failed processing {frame_path}: {exc}")

            time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            print("[INFO] Worker stopped")
            break
        except Exception as exc:
            print(f"[ERROR] Worker loop failure: {exc}")
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
