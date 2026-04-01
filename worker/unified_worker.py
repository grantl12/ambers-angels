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

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from services.vehicle_classifier import classify as classify_vehicles
from services.plate_recognizer import recognize_sync as pr_recognize
from services.aggregation_service import SINGLE_FRAME_HIGH_CONFIDENCE

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

def process_frame(frame_path: str) -> bool:
    """Process a single frame. Returns True if fully handled (success or no plates found),
    False if the API was unreachable so the frame should be retried."""
    try:
        results = alpr.recognize_file(frame_path)
    except Exception as e:
        print(f"[Worker] ❌ ALPR error on {frame_path}: {e}")
        return True  # ALPR error is permanent — don't retry

    if not results or not results.get("results"):
        return True  # no plates found — mark done

    # --- Vehicle classification (local, runs on every frame with plates) ---
    yolo_vehicles = classify_vehicles(frame_path)
    yolo_primary  = yolo_vehicles[0] if yolo_vehicles else None

    # --- Plate Recognizer (cloud, only on high-confidence frames) ---
    max_conf = max((r.get("confidence", 0.0) for r in results["results"]), default=0.0)
    pr_by_plate: dict[str, object] = {}
    if max_conf >= SINGLE_FRAME_HIGH_CONFIDENCE:
        pr_list = pr_recognize(frame_path, regions=["us"])
        for pr in pr_list:
            if pr.plate:
                pr_by_plate[pr.plate.upper()] = pr

    api_ok = True
    for plate_result in results["results"]:
        plate_text  = plate_result.get("plate", "")
        confidence  = plate_result.get("confidence", 0.0)
        frame_name  = os.path.basename(frame_path)

        if not plate_text:
            continue

        pr = pr_by_plate.get(plate_text.upper())
        payload = {
            "plate_text":    plate_text,
            "confidence":    confidence,
            "drone_id":      DRONE_ID,
            "best_frame_id": frame_name,
            "vehicle_color": (pr.color     if pr else None) or (yolo_primary.color     if yolo_primary else None),
            "vehicle_type":  (pr.body_type if pr else None) or (yolo_primary.body_type if yolo_primary else None),
            "vehicle_make":  pr.make  if pr else None,
            "vehicle_model": pr.model if pr else None,
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
            api_ok = False  # transient — let watch loop retry this frame

    return api_ok


# ---------------------------------------------------------------------------
# Watch loop
# ---------------------------------------------------------------------------

def wait_for_backend(timeout: int = 60) -> None:
    """Block until the backend API is reachable, or exit if timeout exceeded."""
    health_url = os.getenv("API_BASE", "http://127.0.0.1:8000") + "/health"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(health_url, timeout=2)
            if r.status_code == 200:
                print("[Worker] ✅ Backend is up.")
                return
        except requests.exceptions.RequestException:
            pass
        print("[Worker] ⏳ Waiting for backend...")
        time.sleep(2)
    print(f"[Worker] ❌ Backend not reachable after {timeout}s. Exiting.")
    sys.exit(1)


def watch_frames() -> None:
    wait_for_backend()
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
                ok = process_frame(full_path)
                if ok:
                    processed.add(full_path)  # only skip on success; retry if API was down

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
