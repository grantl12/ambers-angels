"""
worker/unified_worker.py

Watches a frame directory for new JPEG files, runs OpenALPR on each,
and POSTs detections to the backend API.

Telemetry is not yet implemented — that path is intentionally removed.
"""
import os
import sys
import time
import shutil
import requests
from openalpr import Alpr
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
FRAME_DIR  = os.getenv("FRAMES_DIR", "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates")
DRONE_ID   = os.getenv("DRONE_ID", "drone1")
API_URL    = os.getenv("API_BASE", "http://127.0.0.1:8000") + "/detections/"

ALPR_COUNTRY     = os.getenv("ALPR_COUNTRY", "us")
ALPR_CONFIG      = os.getenv("ALPR_CONFIG_FILE", "/etc/openalpr/openalpr.conf")
ALPR_RUNTIME_DIR = os.getenv("ALPR_RUNTIME_DIR", "/usr/share/openalpr/runtime_data")
GOLDEN_DIR       = os.getenv(
    "GOLDEN_DIR",
    "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/golden_frames",
)

# ---------------------------------------------------------------------------
# Initialize OpenALPR once (reuse across frames to save startup cost)
# ---------------------------------------------------------------------------
alpr = Alpr(ALPR_COUNTRY, ALPR_CONFIG, ALPR_RUNTIME_DIR)
if not alpr.is_loaded():
    print("[Worker] ❌ OpenALPR failed to load. Check config paths.")
    sys.exit(1)

alpr.set_top_n(5)


# ---------------------------------------------------------------------------
# Golden frame archival
# ---------------------------------------------------------------------------

def _save_to_golden(frame_path: str, plate_text: str) -> None:
    """Copy a watchlist-hit frame into golden_frames for audit and manual re-ingestion."""
    try:
        os.makedirs(GOLDEN_DIR, exist_ok=True)
        frame_name = os.path.basename(frame_path)
        dest = os.path.join(GOLDEN_DIR, f"alert_{plate_text}_{frame_name}")
        shutil.copy2(frame_path, dest)
        print(f"[Worker] 💾 Saved to golden_frames: {os.path.basename(dest)}")
    except Exception as e:
        print(f"[Worker] ⚠️  Could not save golden frame: {e}")


# ---------------------------------------------------------------------------
# Frame processing
# ---------------------------------------------------------------------------

def process_frame(frame_path: str) -> None:
    try:
        results = alpr.recognize_file(frame_path)
    except Exception as e:
        print(f"[Worker] ❌ ALPR error on {frame_path}: {e}")
        return

    if not results or not results.get("results"):
        return

    for plate_result in results["results"]:
        plate_text  = plate_result.get("plate", "")
        confidence  = plate_result.get("confidence", 0.0)
        frame_name  = os.path.basename(frame_path)

        if not plate_text:
            continue

        payload = {
            "plate_text":    plate_text,
            "confidence":    confidence,
            "drone_id":      DRONE_ID,
            "best_frame_id": frame_name,
        }

        try:
            resp = requests.post(API_URL, json=payload, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                alert_triggered = data.get("alert_triggered", False)
                alert_flag = "🚨" if alert_triggered else "✅"
                print(f"[Worker] {alert_flag} {plate_text} ({confidence:.1f}%) → {data.get('status')}")
                if alert_triggered:
                    _save_to_golden(frame_path, plate_text)
            else:
                print(f"[Worker] ⚠️  API returned {resp.status_code} for {plate_text}")
        except requests.exceptions.RequestException as e:
            print(f"[Worker] ❌ API post failed for {plate_text}: {e}")


# ---------------------------------------------------------------------------
# Watch loop
# ---------------------------------------------------------------------------

def watch_frames() -> None:
    print(f"[Worker] 👁  Monitoring {FRAME_DIR} for new frames (drone: {DRONE_ID})...")
    processed: set[str] = set()

    while True:
        try:
            files = [
                f for f in os.listdir(FRAME_DIR)
                if f.lower().endswith((".jpg", ".jpeg", ".png"))
            ]
        except FileNotFoundError:
            print(f"[Worker] ⚠️  Frame directory not found: {FRAME_DIR}. Retrying...")
            time.sleep(5)
            continue

        for filename in files:
            full_path = os.path.join(FRAME_DIR, filename)
            if full_path not in processed:
                # Small delay to ensure FFmpeg has finished writing the file
                time.sleep(0.1)
                process_frame(full_path)
                processed.add(full_path)

        time.sleep(0.5)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    try:
        watch_frames()
    finally:
        alpr.unload()
        print("[Worker] OpenALPR unloaded. Exiting.")
