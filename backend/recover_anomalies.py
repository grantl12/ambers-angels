"""
backend/recover_anomalies.py

Re-ingests saved anomaly frames through OpenALPR and POSTs any detected
plates to the backend API — same pipeline as the live worker.

Loads ALPR once and reuses the engine across all frames (avoids the OOM
issue that killed the old shell script which spawned a new process per frame).

Usage:
    python3 backend/recover_anomalies.py
    ANOMALY_DIR=/some/other/path python3 backend/recover_anomalies.py
"""

import os
import sys
import shutil
import requests
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from openalpr import Alpr

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ANOMALY_DIR = os.getenv(
    "ANOMALY_DIR",
    "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/anomalies",
)
API_URL          = os.getenv("API_BASE", "http://127.0.0.1:8000") + "/detections/"  # trailing slash required
DRONE_ID         = os.getenv("DRONE_ID", "recovery_bot")
GOLDEN_DIR       = os.getenv(
    "GOLDEN_DIR",
    "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/golden_frames",
)
ALPR_COUNTRY     = os.getenv("ALPR_COUNTRY", "us")
ALPR_CONFIG      = os.getenv("ALPR_CONFIG_FILE", "/etc/openalpr/openalpr.conf")
ALPR_RUNTIME_DIR = os.getenv("ALPR_RUNTIME_DIR", "/usr/share/openalpr/runtime_data")

# ---------------------------------------------------------------------------
# Init ALPR once
# ---------------------------------------------------------------------------
alpr = Alpr(ALPR_COUNTRY, ALPR_CONFIG, ALPR_RUNTIME_DIR)
if not alpr.is_loaded():
    print("[Recovery] ❌ OpenALPR failed to load. Check config paths.")
    sys.exit(1)

alpr.set_top_n(5)

ALPR_TIMEOUT = int(os.getenv("ALPR_TIMEOUT", "10"))  # seconds per frame before skip
_executor = ThreadPoolExecutor(max_workers=1)

# ---------------------------------------------------------------------------
# Golden frame archival
# ---------------------------------------------------------------------------

def _save_to_golden(frame_path: str, plate_text: str) -> None:
    """Copy a hit frame into golden_frames with the plate text in the filename."""
    try:
        os.makedirs(GOLDEN_DIR, exist_ok=True)
        frame_name = os.path.basename(frame_path)
        dest = os.path.join(GOLDEN_DIR, f"alert_{plate_text}_{frame_name}")
        shutil.copy2(frame_path, dest)
        print(f"[Recovery] 💾 Saved to golden_frames: {os.path.basename(dest)}")
    except Exception as e:
        print(f"[Recovery] ⚠️  Could not save golden frame: {e}")


# ---------------------------------------------------------------------------
# Process a single frame
# ---------------------------------------------------------------------------

def _run_alpr(frame_path: str):
    return alpr.recognize_file(frame_path)

def process_frame(frame_path: str) -> bool:
    """Returns True if at least one plate was found and posted."""
    try:
        future = _executor.submit(_run_alpr, frame_path)
        results = future.result(timeout=ALPR_TIMEOUT)
    except FuturesTimeout:
        print(f"[Recovery] ⏱️  ALPR timed out on {os.path.basename(frame_path)} — skipping.")
        return False
    except Exception as e:
        print(f"[Recovery] ❌ ALPR error on {frame_path}: {e}")
        return False

    if not results or not results.get("results"):
        return False

    found_any = False
    for plate_result in results["results"]:
        plate_text = plate_result.get("plate", "")
        confidence = plate_result.get("confidence", 0.0)
        frame_name = os.path.basename(frame_path)

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
                print(f"[Recovery] {alert_flag} {plate_text} ({confidence:.1f}%) "
                      f"← {frame_name} → {data.get('status')}")
                found_any = True

                if alert_triggered:
                    _save_to_golden(frame_path, plate_text)
            else:
                print(f"[Recovery] ⚠️  API returned {resp.status_code} for {plate_text}")
        except requests.exceptions.RequestException as e:
            print(f"[Recovery] ❌ API post failed for {plate_text}: {e}")

    return found_any

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not os.path.isdir(ANOMALY_DIR):
        print(f"[Recovery] ❌ Directory not found: {ANOMALY_DIR}")
        sys.exit(1)

    frames = sorted(
        f for f in os.listdir(ANOMALY_DIR)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    )

    total   = len(frames)
    hits    = 0
    errors  = 0

    print(f"[Recovery] 🔎 Scanning {total} frames in {ANOMALY_DIR}...")
    print(f"[Recovery] 🛰️  Drone ID: {DRONE_ID}  |  API: {API_URL}")
    print("─" * 60)

    for i, filename in enumerate(frames, 1):
        full_path = os.path.join(ANOMALY_DIR, filename)
        try:
            if process_frame(full_path):
                hits += 1
        except Exception as e:
            print(f"[Recovery] ❌ Unhandled error on {filename}: {e}")
            errors += 1

        # Progress every 50 frames
        if i % 50 == 0:
            print(f"[Recovery] ⏳ {i}/{total} frames processed ({hits} hits so far)...")

    print("─" * 60)
    print(f"[Recovery] ✅ Done. {total} frames scanned | {hits} plates found | {errors} errors")

if __name__ == "__main__":
    try:
        main()
    finally:
        _executor.shutdown(wait=False)
        alpr.unload()
        print("[Recovery] OpenALPR unloaded.")
