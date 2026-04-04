"""
worker/unified_worker.py

Single worker process that drains frames from ALL drone subdirectories under
FRAMES_ROOT (e.g. test_plates/drone1/, test_plates/drone2/, …).

Models are loaded once at startup and shared across all drones — adding a
second or third drone costs zero additional RAM.

Frame lifecycle:
  1. ffmpeg (via nginx exec_push) writes  test_plates/<drone_id>/frame_NNNN.jpg
  2. Worker scans all subdirs, picks up new files
  3. OpenALPR + vehicle classifier run on the frame
  4. Detection POSTed to API
  5. Frame deleted — no accumulation, no stale-set growth
"""
import glob
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
from services.frame_preprocessor import apply_clahe, enhance_alpr_results

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# Root directory that contains one subdir per drone (drone1/, drone2/, …)
FRAMES_ROOT = os.getenv(
    "FRAMES_ROOT",
    "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates",
)
API_URL = os.getenv("API_BASE", "http://127.0.0.1:8000") + "/detections/"

ALPR_COUNTRY     = os.getenv("ALPR_COUNTRY", "us")
ALPR_CONFIG      = os.getenv("ALPR_CONFIG_FILE", "/etc/openalpr/openalpr.conf")
ALPR_RUNTIME_DIR = os.getenv("ALPR_RUNTIME_DIR", "/usr/share/openalpr/runtime_data")
GOLDEN_DIR       = os.getenv(
    "GOLDEN_DIR",
    os.path.join(FRAMES_ROOT, "golden_frames"),
)

# Subdirectory names to skip when scanning FRAMES_ROOT
_SKIP_DIRS = {"golden_frames", "anomalies", "recovery_bot"}

# ---------------------------------------------------------------------------
# Load models once — shared across all drone streams
# ---------------------------------------------------------------------------
print("[Worker] Loading OpenALPR…")
alpr = Alpr(ALPR_COUNTRY, ALPR_CONFIG, ALPR_RUNTIME_DIR)
if not alpr.is_loaded():
    print("[Worker] ❌ OpenALPR failed to load. Check config paths.")
    sys.exit(1)
alpr.set_top_n(5)
print("[Worker] ✅ OpenALPR ready.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _save_to_golden(frame_path: str, plate_text: str) -> None:
    try:
        os.makedirs(GOLDEN_DIR, exist_ok=True)
        dest = os.path.join(GOLDEN_DIR, f"alert_{plate_text}_{os.path.basename(frame_path)}")
        shutil.copy2(frame_path, dest)
        print(f"[Worker] 💾 golden_frames: {os.path.basename(dest)}")
    except Exception as e:
        print(f"[Worker] ⚠️  golden save failed: {e}")


def _iter_pending() -> list[tuple[str, str]]:
    """Yield (frame_path, drone_id) for every image in every drone subdir."""
    frames = []
    try:
        with os.scandir(FRAMES_ROOT) as it:
            for entry in it:
                if not entry.is_dir() or entry.name in _SKIP_DIRS or entry.name.startswith("."):
                    continue
                drone_id = entry.name
                with os.scandir(entry.path) as fit:
                    for f in fit:
                        if f.name.lower().endswith((".jpg", ".jpeg", ".png")) and f.is_file():
                            frames.append((f.path, drone_id))
    except FileNotFoundError:
        pass
    return frames


# ---------------------------------------------------------------------------
# Frame processing
# ---------------------------------------------------------------------------

def process_frame(frame_path: str, drone_id: str) -> bool:
    """
    Run the full detection pipeline on one frame.
    Returns True  → frame handled (delete it).
    Returns False → API was down, keep the file and retry next cycle.
    """
    enhanced_path: str | None = None
    clahe_is_temp = False
    try:
        # Pass 1: CLAHE contrast enhancement
        enhanced_path, clahe_is_temp = apply_clahe(frame_path)

        try:
            results = alpr.recognize_file(enhanced_path)
        except Exception as e:
            print(f"[Worker] ❌ ALPR error ({drone_id}): {e}")
            return True  # permanent failure — don't retry

        if not results or not results.get("results"):
            return True  # no plates — done

        # Pass 2: perspective deskew + re-read
        results = enhance_alpr_results(alpr, enhanced_path, results)
    finally:
        if clahe_is_temp and enhanced_path and enhanced_path != frame_path:
            try:
                os.unlink(enhanced_path)
            except OSError:
                pass

    yolo_vehicles = classify_vehicles(frame_path)
    yolo_primary  = yolo_vehicles[0] if yolo_vehicles else None

    max_conf = max((r.get("confidence", 0.0) for r in results["results"]), default=0.0)
    pr_by_plate: dict = {}
    if max_conf >= SINGLE_FRAME_HIGH_CONFIDENCE:
        pr_list = pr_recognize(frame_path, regions=["us"])
        for pr in pr_list:
            if pr.plate:
                pr_by_plate[pr.plate.upper()] = pr

    api_ok = True
    for plate_result in results["results"]:
        plate_text = plate_result.get("plate", "")
        confidence = plate_result.get("confidence", 0.0)
        if not plate_text:
            continue

        pr = pr_by_plate.get(plate_text.upper())
        payload = {
            "plate_text":    plate_text,
            "confidence":    confidence,
            "drone_id":      drone_id,
            "best_frame_id": os.path.basename(frame_path),
            "vehicle_color": (pr.color     if pr else None) or (yolo_primary.color     if yolo_primary else None),
            "vehicle_type":  (pr.body_type if pr else None) or (yolo_primary.body_type if yolo_primary else None),
            "vehicle_make":  pr.make  if pr else None,
            "vehicle_model": pr.model if pr else None,
        }

        try:
            resp = requests.post(API_URL, json=payload, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                flag = "🚨" if data.get("alert_triggered") else "✅"
                print(f"[Worker] {flag} [{drone_id}] {plate_text} ({confidence:.1f}%) → {data.get('status')}")
                if data.get("alert_triggered"):
                    _save_to_golden(frame_path, plate_text)
            else:
                print(f"[Worker] ⚠️  API {resp.status_code} for {plate_text} [{drone_id}]")
        except requests.exceptions.RequestException as e:
            print(f"[Worker] ❌ API post failed [{drone_id}] {plate_text}: {e}")
            api_ok = False

    return api_ok


# ---------------------------------------------------------------------------
# Watch loop
# ---------------------------------------------------------------------------

def wait_for_backend(timeout: int = 60) -> None:
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
        print("[Worker] ⏳ Waiting for backend…")
        time.sleep(2)
    print(f"[Worker] ❌ Backend not reachable after {timeout}s. Exiting.")
    sys.exit(1)


def watch_frames() -> None:
    wait_for_backend()
    print(f"[Worker] 👁  Watching {FRAMES_ROOT}/*/ for frames from any drone…")

    # Tracks paths currently being retried due to API downtime.
    # Cleared on success so memory stays bounded.
    retry: set[str] = set()

    while True:
        pending = _iter_pending()

        for frame_path, drone_id in pending:
            # Brief wait to let ffmpeg finish writing before we read
            age = time.time() - os.path.getmtime(frame_path)
            if age < 0.3:
                continue

            ok = process_frame(frame_path, drone_id)
            if ok:
                retry.discard(frame_path)
                try:
                    os.remove(frame_path)
                except OSError:
                    pass
            else:
                retry.add(frame_path)

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
