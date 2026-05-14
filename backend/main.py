"""
backend/main.py
Amber's Angels — FastAPI entry point.
"""
import sys
import os
import uuid
import asyncio
import logging
import tempfile
from contextlib import asynccontextmanager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from sqlalchemy import text
from typing import Optional

# Ensure the backend directory is on the path regardless of working directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load .env from the backend dir (and fall back to repo root .env) so all
# secrets are available regardless of which directory the server is started from.
try:
    from dotenv import load_dotenv
    _here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_here, ".env"), override=False)
    load_dotenv(os.path.join(_here, "..", ".env"), override=False)
except ImportError:
    pass  # python-dotenv not installed — rely on env vars being set externally

# --- Core imports ---
import database
import schemas
from services.detection_models import EventStatus, EventClassification
from services.event_service import EventService
from services.aggregation_service import AggregationService, DetectionInput as AggDetectionInput, SINGLE_FRAME_HIGH_CONFIDENCE
from event_repository import EventRepository
from services.alert_dispatcher import AlertDispatcher
from services.fema_connector import fema_background_loop, poll_fema_ipaws, check_vehicle_targets
from services.amber_alert_poller import amber_background_loop
from services.ncmec_poller import ncmec_background_loop
from services.vehicle_classifier import classify as classify_vehicles
from services.plate_recognizer import recognize_async as pr_recognize
from services.frame_preprocessor import apply_clahe, enhance_alpr_results
from routers.read_api import router as read_router
from routers.auth import router as auth_router
from routers.alerts import router as alerts_router
from routers.autonomous import router as autonomous_router

# Module-level singleton — must persist across requests to maintain the
# 5-second aggregation window and active group state
_aggregation_service = AggregationService()

GOLDEN_DIR = os.getenv(
    "GOLDEN_DIR",
    "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/golden_frames",
)

# The alert dispatcher singleton — reads ALERT_WEBHOOK_URL from env
_alert_dispatcher = AlertDispatcher(
    repository=None,  # repository is injected per-request below
    webhook_url=os.getenv("ALERT_WEBHOOK_URL", ""),
)

# ---------------------------------------------------------------------------
# Lifespan — background tasks that run for the life of the server
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _webhook = os.getenv("ALERT_WEBHOOK_URL", "")
    fema_task = asyncio.create_task(
        fema_background_loop(
            session_factory=database.AsyncSessionLocal,
            webhook_url=_webhook,
        )
    )
    amber_task = asyncio.create_task(
        amber_background_loop(
            session_factory=database.AsyncSessionLocal,
            webhook_url=_webhook,
        )
    )
    ncmec_task = asyncio.create_task(
        ncmec_background_loop(
            session_factory=database.AsyncSessionLocal,
            webhook_url=_webhook,
        )
    )
    yield
    fema_task.cancel()
    amber_task.cancel()
    ncmec_task.cancel()
    for t in (fema_task, amber_task, ncmec_task):
        try:
            await t
        except asyncio.CancelledError:
            pass

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Amber's Angels API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.include_router(read_router)
app.include_router(auth_router)
app.include_router(alerts_router)
app.include_router(autonomous_router)

# Serve golden_frames as static files — thumbnails for alert detections
os.makedirs(GOLDEN_DIR, exist_ok=True)
app.mount("/frames", StaticFiles(directory=GOLDEN_DIR), name="frames")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {"status": "Amber's Angels Pipeline Active", "version": "2.1"}


@app.post("/fema/test")
async def fema_test():
    """Manually trigger a FEMA IPAWS poll — useful when no live alerts are active."""
    await poll_fema_ipaws(
        session_factory=database.AsyncSessionLocal,
        webhook_url=os.getenv("ALERT_WEBHOOK_URL", ""),
    )
    return {"status": "poll_complete"}


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    import subprocess, socket
    from datetime import timedelta

    # ── database ──────────────────────────────────────────────────────────────
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    # ── worker process ────────────────────────────────────────────────────────
    try:
        r = subprocess.run(["pgrep", "-f", "unified_worker.py"], capture_output=True)
        worker_ok = r.returncode == 0
    except Exception:
        worker_ok = False

    # ── ffmpeg / rtmp feed harvesters ─────────────────────────────────────────
    try:
        r = subprocess.run(["pgrep", "-f", "rtmp://127.0.0.1/live/"], capture_output=True)
        feed_pids = [p for p in r.stdout.decode().strip().split("\n") if p]
        active_feeds = len(feed_pids)
    except Exception:
        active_feeds = 0

    # ── nginx ─────────────────────────────────────────────────────────────────
    try:
        with socket.create_connection(("127.0.0.1", 80), timeout=1):
            nginx_ok = True
    except Exception:
        nginx_ok = False

    # ── watchlist & recent detections ─────────────────────────────────────────
    watchlist_count = 0
    detections_1h = 0
    last_detection_at = None
    if db_ok:
        try:
            watchlist_count = db.execute(text("SELECT COUNT(*) FROM watchlist")).scalar() or 0
            cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
            detections_1h = db.execute(
                text("SELECT COUNT(*) FROM detection_events WHERE first_seen >= :c"),
                {"c": cutoff},
            ).scalar() or 0
            row = db.execute(
                text("SELECT MAX(first_seen) FROM detection_events")
            ).scalar()
            if row:
                last_detection_at = row.isoformat() if hasattr(row, "isoformat") else str(row)
        except Exception:
            pass

    overall = "healthy" if (db_ok and worker_ok) else "degraded"

    return {
        "status": overall,
        "database": "connected" if db_ok else "error",
        "worker": "running" if worker_ok else "stopped",
        "nginx": "running" if nginx_ok else "stopped",
        "rtmp_feeds": {"active": active_feeds, "configured": 3},
        "watchlist_entries": watchlist_count,
        "detections_last_1h": detections_1h,
        "last_detection_at": last_detection_at,
    }


@app.post("/ingest/frame")
async def ingest_frame(
    file: UploadFile = File(...),
    drone_id: str = Form(...),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    altitude: Optional[float] = Form(None),
    heading: Optional[float] = Form(None),
    speed: Optional[float] = Form(None),
    accuracy: Optional[float] = Form(None),
    pilot_id: Optional[str] = Form(None),
    source: Optional[str] = Form(None),
    detected_at: Optional[str] = Form(None),
):
    """
    Raw JPEG frame ingestion from native app (DJI SDK or phone camera).
    Runs OpenALPR server-side, then feeds each result into the same
    AggregationService → EventService pipeline as the RTMP worker.
    """
    from services.frame_preprocessor import run_alpr as _run_alpr

    ts = datetime.now(timezone.utc)
    if detected_at:
        try:
            from datetime import datetime as _dt
            ts = _dt.fromisoformat(detected_at.replace("Z", "+00:00"))
        except ValueError:
            pass

    # Read frame bytes once — needed for both OpenALPR (file) and Plate Recognizer (bytes)
    frame_bytes = await file.read()
    suffix = os.path.splitext(file.filename or "frame.jpg")[1] or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(frame_bytes)
        tmp_path = tmp.name

    enhanced_path: str | None = None
    try:
        # Pass 1: try ALPR on the original frame first.
        results = _run_alpr(tmp_path)
        enhanced_path, clahe_is_temp = tmp_path, False
        if not results.get("results"):
            enhanced_path, clahe_is_temp = apply_clahe(tmp_path)
            results = _run_alpr(enhanced_path)

        # Pass 2: perspective deskew + re-read for each detected plate
        results = enhance_alpr_results(None, enhanced_path, results)

        # --- Vehicle classification (always local, never blocking) ---
        # CASCADE: Now returns CDC fine-grained attributes in primary_vehicle
        yolo_vehicles = classify_vehicles(tmp_path)
        primary_vehicle = yolo_vehicles[0] if yolo_vehicles else None

        # --- Vehicle target matching against active FEMA alerts ---
        await check_vehicle_targets(
            database.AsyncSessionLocal,
            drone_id,
            yolo_vehicles,
            os.getenv("ALERT_WEBHOOK_URL", ""),
        )

        # --- Plate Recognizer (cloud, only on high-confidence frames) ---
        max_conf = max((r.get("confidence", 0.0) for r in (results or {}).get("results", [])), default=0.0)
        pr_by_plate: dict[str, object] = {}
        if max_conf >= SINGLE_FRAME_HIGH_CONFIDENCE:
            pr_list = await pr_recognize(frame_bytes, regions=["us"])
            for pr in pr_list:
                if pr.plate:
                    pr_by_plate[pr.plate.upper()] = pr
    finally:
        os.unlink(tmp_path)
        if enhanced_path and clahe_is_temp and enhanced_path != tmp_path:
            try:
                os.unlink(enhanced_path)
            except OSError:
                pass

    if not results or not results.get("results"):
        # No plates — slow down unless primary vehicle seen
        interval_ms = 1200 if primary_vehicle else 2500
        return {"status": "no_plates", "plates": [], "capture_interval_ms": interval_ms}

    telemetry = None
    if lat is not None and lng is not None:
        telemetry = {"lat": lat, "lon": lng, "alt": altitude, "heading": heading, "speed": speed}
        try:
            async with database.AsyncSessionLocal() as session:
                await session.execute(text("""
                    INSERT INTO telemetry_points
                        (drone_id, pilot_id, ts, lat, lon, altitude_m, heading_deg, speed_mps, accuracy_m, source)
                    VALUES
                        (:drone_id, :pilot_id, :ts, :lat, :lon, :alt, :heading, :speed, :accuracy, :source)
                """), {
                    "drone_id": drone_id, "pilot_id": pilot_id, "ts": ts,
                    "lat": lat, "lon": lng, "alt": altitude,
                    "heading": heading, "speed": speed, "accuracy": accuracy,
                    "source": source or "dji_app",
                })
                await session.commit()
        except Exception as e:
            logger.warning("telemetry_point write failed: %s", e)

    frame_id = str(uuid.uuid4())

    # Persist the frame so Discord alerts can attach it as a thumbnail.
    # Only save when plates were actually detected (confidence floor enforced below).
    if results and results.get("results"):
        try:
            os.makedirs(GOLDEN_DIR, exist_ok=True)
            with open(os.path.join(GOLDEN_DIR, f"{frame_id}.jpg"), "wb") as _f:
                _f.write(frame_bytes)
        except Exception as _e:
            logger.warning("frame persist failed: %s", _e)

    outcomes = []

    # Process each plate result into the aggregation service
    for plate_res in results.get("results", []):
        plate_text = plate_res.get("plate", "").upper()
        if not plate_text:
            continue
            
        pr = pr_by_plate.get(plate_text)
        
        # Build the detection input for the 5-second aggregator
        det = AggDetectionInput(
            detection_id=str(uuid.uuid4()),
            frame_id=frame_id,
            drone_id=drone_id,
            detected_at=ts,
            plate_raw=plate_text,
            confidence=plate_res.get("confidence", 0.0),
            quality_flags=[f.get("type") for f in plate_res.get("quality_flags", []) if f.get("type")],
            telemetry=telemetry,
            bbox=plate_res.get("coordinates"),
            alpr_payload=plate_res,
            # Broad classification (YOLO)
            vehicle_color=primary_vehicle.color if primary_vehicle else None,
            vehicle_type=primary_vehicle.body_type if primary_vehicle else None,
            yolo_conf=primary_vehicle.yolo_conf if primary_vehicle else 0.0,
            # Fine-grained classification (CDC)
            cdc_label=primary_vehicle.cdc_label if primary_vehicle else None,
            cdc_conf=primary_vehicle.cdc_conf if primary_vehicle else 0.0,
            # Make/Model (Cloud API enrichment if high confidence)
            vehicle_make=getattr(pr, 'make', None) if pr else None,
            vehicle_model=getattr(pr, 'model', None) if pr else None,
        )

        snapshot = _aggregation_service.ingest(det)
        if snapshot:
            # 1. Update the EventService with the new group state
            service = EventService(
                repository=EventRepository(database.AsyncSessionLocal),
                dispatcher=_alert_dispatcher,
            )
            decision = await service.upsert_from_snapshot(snapshot)
            if decision:
                outcomes.append({
                    "plate": snapshot.plate_best,
                    "confidence": snapshot.aggregate_confidence,
                    "status": decision.event.status if hasattr(decision.event, "status") else decision.event.get("status"),
                    "alert_sent": decision.should_dispatch_alert
                })

    # Return the next capture interval. If we saw plates, we speed up.
    interval_ms = 800 if outcomes else 1500
    return {"status": "ok", "outcomes": outcomes, "capture_interval_ms": interval_ms}


@app.post("/detections/")
async def create_detection(det: schemas.DetectionCreate):
    """
    Standard detection endpoint (used by RTMP worker).
    """
    # Convert schema to internal AggDetectionInput
    internal_det = AggDetectionInput(
        detection_id=str(uuid.uuid4()),
        frame_id=det.frame_id or str(uuid.uuid4()),
        drone_id=det.drone_id,
        detected_at=det.detected_at or datetime.now(timezone.utc),
        plate_raw=det.plate_text,
        confidence=det.confidence,
        quality_flags=[], # RTMP worker doesn't yet provide quality flags
        telemetry={"lat": det.latitude, "lon": det.longitude},
        # We don't have CDC label in the old schema yet — RTMP worker needs update too
        vehicle_color=det.vehicle_color,
        vehicle_type=det.vehicle_type,
        vehicle_make=det.vehicle_make,
        vehicle_model=det.vehicle_model,
        yolo_conf=det.yolo_conf or 0.0,
        cdc_label=det.cdc_label,
        cdc_conf=det.cdc_conf or 0.0,
    )

    snapshot = _aggregation_service.ingest(internal_det)
    if snapshot:
        service = EventService(
            repository=EventRepository(database.AsyncSessionLocal),
            dispatcher=_alert_dispatcher,
        )
        await service.upsert_from_snapshot(snapshot)
    
    return {"status": "ingested"}
