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
    frame_id: int,
    plate_text: Optional[str],
    confidence: Optional[float],
    detected_at: datetime,
    raw_payload: Dict[str, Any],
) -> Dict[str, Any]:
    payload = {
        "frame_id": frame_id,
        "drone_id": DRONE_ID,
        "plate_text": plate_text,
        "confidence": confidence,
        "detected_at": detected_at.isoformat(),
        "raw_payload": raw_payload,
    }

    resp = requests.post(f"{API_BASE}/detections", json=payload, timeout=10)
    resp.raise_for_status()
    return resp.json()


def process_one_frame(frame_path: str) -> None:
    print(f"[INFO] Processing frame: {frame_path}")

    frame_result = register_frame(frame_path)
    frame_id = frame_result["frame_id"]

    alpr_json = run_openalpr(frame_path)
    plate_text, confidence = extract_best_plate(alpr_json)

    detected_at = parse_frame_ts_from_filename(frame_path)

    detection_result = post_detection(
        frame_id=frame_id,
        plate_text=plate_text,
        confidence=confidence,
        detected_at=detected_at,
        raw_payload=alpr_json,
    )

    print(
        json.dumps(
            {
                "frame_id": frame_id,
                "plate_text": plate_text,
                "confidence": confidence,
                "detection_id": detection_result["detection_id"],
                "lat": detection_result.get("lat"),
                "lon": detection_result.get("lon"),
            }
        )
    )


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
