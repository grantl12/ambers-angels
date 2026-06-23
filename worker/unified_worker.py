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
API_URL          = os.getenv("API_BASE", "http://127.0.0.1:8000") + "/detections/"
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")

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

_water_search_cache: dict[str, tuple[bool, float]] = {}
_WATER_SEARCH_CACHE_TTL = 30.0


def _is_water_search_active(drone_id: str) -> bool:
    """Check if the drone's active mission is water_search. Cached 30s."""
    now = time.time()
    cached = _water_search_cache.get(drone_id)
    if cached and now - cached[1] < _WATER_SEARCH_CACHE_TTL:
        return cached[0]
    try:
        resp = requests.get(
            os.getenv("API_BASE", "http://127.0.0.1:8000") + "/autonomous/missions",
            params={"status": "executing", "limit": "10"},
            headers={"X-Internal-Key": INTERNAL_API_KEY} if INTERNAL_API_KEY else {},
            timeout=3,
        )
        if resp.status_code == 200:
            missions = resp.json()
            is_ws = any(
                m.get("mission_type") == "water_search"
                and str(m.get("drone_id")) == drone_id
                for m in missions
            )
            _water_search_cache[drone_id] = (is_ws, now)
            return is_ws
    except Exception:
        pass
    return False


def process_frame(frame_path: str, drone_id: str) -> bool:
    """
    OpenALPR + YOLO + Plate Recognizer cascade.
    Sends one POST to the API per plate found.
    Returns True if API was reachable.
    """
    if _is_water_search_active(drone_id):
        return True

    # 1. Broad classification (YOLO) + Fine-grained (CDC)
    # The classifier now handles the cascade internally.
    yolo_vehicles = classify_vehicles(frame_path)
    yolo_primary  = yolo_vehicles[0] if yolo_vehicles else None

    # 2. Plate Recognition (OpenALPR)
    results = alpr.recognize_file(frame_path)
    
    # Check if we need enhancement (low confidence or dark frame)
    max_conf = max((r.get("confidence", 0.0) for r in results.get("results", [])), default=0.0)
    if not results.get("results") or max_conf < 70.0:
        enhanced_path, is_temp = apply_clahe(frame_path)
        if enhanced_path != frame_path:
            results = alpr.recognize_file(enhanced_path)
            if is_temp:
                os.unlink(enhanced_path)

    # 3. Plate Recognizer (Cloud API, optional for make/model enrichment)
    pr_by_plate = {}
    if max_conf >= SINGLE_FRAME_HIGH_CONFIDENCE:
        try:
            with open(frame_path, "rb") as f:
                pr_list = pr_recognize(f.read(), regions=["us"])
                for pr in pr_list:
                    if pr.plate:
                        pr_by_plate[pr.plate.upper()] = pr
        except Exception as e:
            print(f"[Worker] ⚠️ Plate Recognizer failed: {e}")

    # Fetch active watchlist plates once for candidate selection.
    # ALPR top candidate is often a partial mis-read (e.g. "YVJ02" vs "YVJ024").
    # We prefer a lower-ranked candidate when it exactly matches the watchlist.
    _active_plates: set[str] = set()
    try:
        resp = requests.get(
            os.getenv("API_BASE", "http://127.0.0.1:8000") + "/fema/alerts",
            headers={"X-Internal-Key": INTERNAL_API_KEY} if INTERNAL_API_KEY else {},
            timeout=3,
        )
        if resp.status_code == 200:
            for entry in resp.json():
                if entry.get("plateText"):
                    _active_plates.add(entry["plateText"].upper().replace(" ", "").replace("-", ""))
    except Exception:
        pass

    def _pick_plate(res: dict) -> tuple[str, float]:
        top = res.get("plate", "").upper().replace(" ", "").replace("-", "")
        top_conf = float(res.get("confidence", 0.0))
        for cand in res.get("candidates", []):
            pt = (cand.get("plate") or "").upper().replace(" ", "").replace("-", "")
            conf = float(cand.get("confidence", 0.0))
            if pt and conf >= 55 and pt in _active_plates:
                return pt, conf
        return top, top_conf

    api_ok = True
    for res in results.get("results", []):
        plate_text, confidence = _pick_plate(res)
        if not plate_text:
            continue

        pr = pr_by_plate.get(plate_text)
        payload = {
            "plate_text":    plate_text,
            "confidence":    confidence,
            "drone_id":      drone_id,
            "best_frame_id": os.path.basename(frame_path),
            "vehicle_color": (pr.color     if pr else None) or (yolo_primary.color     if yolo_primary else None),
            "vehicle_type":  (pr.body_type if pr else None) or (yolo_primary.body_type if yolo_primary else None),
            "vehicle_make":  pr.make  if pr else None,
            "vehicle_model": pr.model if pr else None,
            # YOLO confidence
            "yolo_conf":     yolo_primary.yolo_conf if yolo_primary else 0.0,
            # Cascade Stage 2: CDC
            "cdc_label":     yolo_primary.cdc_label if yolo_primary else None,
            "cdc_conf":      yolo_primary.cdc_conf  if yolo_primary else 0.0,
        }

        # Save golden frame BEFORE the API call so Discord dispatch can attach it.
        # The API triggers Discord synchronously during the POST; if we save after,
        # _load_frame always misses it (race condition).
        if plate_text in _active_plates:
            _save_to_golden(frame_path, plate_text)

        try:
            headers = {"X-Internal-Key": INTERNAL_API_KEY} if INTERNAL_API_KEY else {}
            resp = requests.post(API_URL, json=payload, timeout=5, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                flag = "🚨" if data.get("alert_triggered") else "✅"
                print(f"[Worker] {flag} [{drone_id}] {plate_text} ({confidence:.1f}%) → {data.get('status')}")
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


def main():
    print(f"[Worker] Scanning {FRAMES_ROOT}…")
    wait_for_backend()
    
    while True:
        pending = _iter_pending()
        if not pending:
            time.sleep(2)
            continue
            
        for frame_path, drone_id in pending:
            try:
                # Give it a moment to finish writing
                time.sleep(0.05)
                if not os.path.exists(frame_path):
                    continue
                    
                success = process_frame(frame_path, drone_id)
                
                # Delete processed frame
                if success:
                    try:
                        os.remove(frame_path)
                    except OSError:
                        pass
            except Exception as e:
                print(f"[Worker] 💥 Critical error processing {frame_path}: {e}")
                time.sleep(1)


if __name__ == "__main__":
    main()
