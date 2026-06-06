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
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
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
from services.autonomous_mission_service import mission_timeout_loop
from services.vehicle_classifier import classify as classify_vehicles
from services.plate_recognizer import recognize_async as pr_recognize
from services.frame_preprocessor import apply_clahe, enhance_alpr_results
from routers.read_api import router as read_router, detection_purge_loop, telemetry_purge_loop
from routers.auth import router as auth_router, get_current_pilot, require_admin
from routers.alerts import router as alerts_router
from routers.autonomous import router as autonomous_router
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request
from services.discord_logger import DiscordErrorHandler

# Attach Discord error handler to the root logger so every ERROR+ log
# from any module (fema_connector, ncmec_poller, uvicorn, etc.) fires an alert.
# DISCORD_ERROR_WEBHOOK_URL is optional — falls back to ALERT_WEBHOOK_URL.
# If neither is set the handler is not installed (no-op).
_error_webhook = (
    os.getenv("DISCORD_ERROR_WEBHOOK_URL")
    or os.getenv("ALERT_WEBHOOK_URL", "")
)
if _error_webhook:
    logging.getLogger().addHandler(DiscordErrorHandler(_error_webhook))
    logger.info("Discord error handler registered")

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
    timeout_task = asyncio.create_task(
        mission_timeout_loop(session_factory=database.AsyncSessionLocal)
    )
    purge_task = asyncio.create_task(
        detection_purge_loop(session_factory=database.AsyncSessionLocal)
    )
    telemetry_task = asyncio.create_task(
        telemetry_purge_loop(session_factory=database.AsyncSessionLocal)
    )
    yield
    fema_task.cancel()
    amber_task.cancel()
    ncmec_task.cancel()
    timeout_task.cancel()
    purge_task.cancel()
    telemetry_task.cancel()
    for t in (fema_task, amber_task, ncmec_task, timeout_task, purge_task, telemetry_task):
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


@app.middleware("http")
async def _log_unhandled_errors(request: Request, call_next):
    """Log unhandled exceptions at ERROR level so Discord picks them up."""
    try:
        return await call_next(request)
    except Exception as exc:
        logger.error(
            "Unhandled exception: %s %s",
            request.method,
            request.url.path,
            exc_info=exc,
        )
        raise


app.include_router(read_router)
app.include_router(auth_router)
app.include_router(alerts_router)
app.include_router(autonomous_router)

# Serve golden_frames as static files — thumbnails for alert detections
os.makedirs(GOLDEN_DIR, exist_ok=True)
app.mount("/frames", StaticFiles(directory=GOLDEN_DIR), name="frames")

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
_bearer_optional = HTTPBearer(auto_error=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://amberangels.org",
        "https://www.amberangels.org",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:19006",
    ],
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
async def fema_test(_: dict = Depends(require_admin)):
    """Manually trigger a FEMA IPAWS poll — admin only."""
    await poll_fema_ipaws(
        session_factory=database.AsyncSessionLocal,
        webhook_url=os.getenv("ALERT_WEBHOOK_URL", ""),
    )
    return {"status": "poll_complete"}


class InjectAlertRequest(schemas.BaseModel if hasattr(schemas, "BaseModel") else object):
    pass


from pydantic import BaseModel as _BaseModel

class InjectAlertRequest(_BaseModel):
    plate: str
    headline: str
    area: str
    vehicle_color: Optional[str] = None
    vehicle_type: Optional[str] = None   # yolo body type: car|truck|motorcycle|bus
    vehicle_make: Optional[str] = None
    alert_type: str = "amber"            # amber|silver|blue|matties|purple|mipa|ema
    source_program: str = "Manual Inject"


@app.post("/admin/inject-alert")
async def inject_alert(
    req: InjectAlertRequest,
    payload: dict = Depends(require_admin),
):
    """
    Admin: manually inject a watchlist entry for an alert that wasn't caught
    by automated polling (e.g. WEA-only alerts that bypass FEMA CMAS).
    Fires the same Discord + push notification pipeline as a real alert.
    """
    from services.fema_connector import (
        _add_to_watchlist, _add_vehicle_target, _notify_watching_pilots,
        _notify_plates, ALERT_REGISTRY,
    )
    import hashlib

    atype = next((e for e in ALERT_REGISTRY if e["key"] == req.alert_type), ALERT_REGISTRY[0])
    sent  = datetime.now(timezone.utc).isoformat()
    ident = hashlib.sha256(f"inject:{req.plate}:{req.area}:{sent}".encode()).hexdigest()[:32]

    alert = {
        "msg_type":        "alert",
        "identifier":      ident,
        "sent":            sent,
        "headline":        req.headline,
        "description":     req.headline,
        "area":            req.area,
        "polygon":         None,
        "references":      [],
        "plates":          [req.plate.upper().strip()],
        "vehicle_profile": {
            "color":          req.vehicle_color,
            "body_type":      req.vehicle_type,
            "yolo_body_type": req.vehicle_type,
            "make":           req.vehicle_make,
        },
        "alert_type":      atype,
        "source_program":  req.source_program,
    }

    webhook_url = os.getenv("ALERT_WEBHOOK_URL", "")
    desc = (
        f"{req.source_program} | {req.headline} | "
        f"Area: {req.area} | Issued: {sent} | ID: {ident}"
    )
    inserted = await _add_to_watchlist(
        database.AsyncSessionLocal,
        req.plate.upper().strip(),
        desc,
        alert_type=atype["key"],
        source_program=req.source_program,
        vehicle_color=req.vehicle_color,
        vehicle_type=req.vehicle_type,
        vehicle_make=req.vehicle_make,
    )
    await _add_vehicle_target(database.AsyncSessionLocal, alert)
    await _notify_watching_pilots(database.AsyncSessionLocal, alert)
    if webhook_url:
        await _notify_plates(webhook_url, alert, [req.plate.upper().strip()])

    logger.info(
        "Admin inject by %s: plate=%s area=%s inserted=%s",
        payload.get("sub"), req.plate, req.area, inserted,
    )
    return {"ok": True, "plate": req.plate.upper().strip(), "inserted": inserted, "identifier": ident}


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
    from services.health_tracker import get_iso as _poll_ts
    last_fema_poll  = _poll_ts("fema")
    last_ncmec_poll = _poll_ts("ncmec")
    if db_ok:
        try:
            watchlist_count = db.execute(text("SELECT COUNT(*) FROM watchlist WHERE active = TRUE")).scalar() or 0
            cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
            detections_1h = db.execute(
                text("SELECT COUNT(*) FROM detection_events WHERE created_at >= :c"),
                {"c": cutoff},
            ).scalar() or 0
            row = db.execute(text("SELECT MAX(created_at) FROM detection_events")).scalar()
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
        "last_fema_poll":    last_fema_poll,
        "last_ncmec_poll":   last_ncmec_poll,
    }


_MAX_FRAME_BYTES = 25 * 1024 * 1024  # 25 MB
_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


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
    _pilot: dict = Depends(get_current_pilot),
):
    """
    Raw JPEG frame ingestion from native app (DJI SDK or phone camera).
    Runs OpenALPR server-side, then feeds each result into the same
    AggregationService → EventService pipeline as the RTMP worker.
    """
    from services.frame_preprocessor import run_alpr as _run_alpr

    if file.content_type and file.content_type.lower() not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, or WebP frames are accepted.")

    ts = datetime.now(timezone.utc)
    if detected_at:
        try:
            from datetime import datetime as _dt
            ts = _dt.fromisoformat(detected_at.replace("Z", "+00:00"))
        except ValueError:
            pass

    frame_bytes = await file.read()
    if len(frame_bytes) > _MAX_FRAME_BYTES:
        raise HTTPException(status_code=413, detail="Frame exceeds 25 MB limit.")

    suffix = os.path.splitext(file.filename or "frame.jpg")[1].lower() or ".jpg"
    if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
        suffix = ".jpg"
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
        return {"status": "no_plates", "plates": [], "watchlist_hit": False, "capture_interval_ms": interval_ms}

    # Fast-path watchlist check: tell the client immediately if any detected plate
    # is on the active watchlist, before waiting for aggregation pipeline.
    _frame_watchlist_hit = False
    _frame_hit_plate: str | None = None
    for _pr in results.get("results", []):
        _pt = (_pr.get("plate") or "").upper().replace(" ", "").replace("-", "")
        if not _pt or _pr.get("confidence", 0) < 55:
            continue
        try:
            async with database.AsyncSessionLocal() as _wl_sess:
                _wl = await _wl_sess.execute(
                    text("SELECT 1 FROM watchlist WHERE UPPER(REPLACE(REPLACE(plate_text,' ',''),'-','')) = :p AND active = TRUE LIMIT 1"),
                    {"p": _pt},
                )
                if _wl.fetchone():
                    _frame_watchlist_hit = True
                    _frame_hit_plate = _pt
                    break
        except Exception:
            pass

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

    # Compute Bayesian vehicle prior once per frame (vehicle attributes are shared)
    _vcolor   = primary_vehicle.color     if primary_vehicle else None
    _vtype    = primary_vehicle.body_type if primary_vehicle else None
    _vmake    = getattr(primary_vehicle, 'make', None) if primary_vehicle else None
    _prior_w  = 1.0
    try:
        from services.vehicle_priors import get_prior_weight as _get_prior
        # Derive alert_type from active watchlist entries for the detected plate(s)
        # For now use 'amber' as the dominant type if any amber alert is active
        _sync_db_local = database.SessionLocal()
        try:
            _at_row = _sync_db_local.execute(text(
                "SELECT alert_type FROM watchlist WHERE active = TRUE ORDER BY "
                "CASE alert_type WHEN 'amber' THEN 0 WHEN 'matties' THEN 1 "
                "WHEN 'silver' THEN 2 ELSE 3 END LIMIT 1"
            )).fetchone()
            _active_type = _at_row[0] if _at_row else "all"
        finally:
            _sync_db_local.close()
        _prior_w = _get_prior(_active_type, _vcolor, _vtype, _vmake)
    except Exception:
        pass  # Prior is optional — never block inference on it

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
            vehicle_color=_vcolor,
            vehicle_type=_vtype,
            yolo_conf=primary_vehicle.yolo_conf if primary_vehicle else 0.0,
            # Fine-grained classification (CDC)
            cdc_label=primary_vehicle.cdc_label if primary_vehicle else None,
            cdc_conf=primary_vehicle.cdc_conf if primary_vehicle else 0.0,
            # Make/Model (Cloud API enrichment if high confidence)
            vehicle_make=getattr(pr, 'make', None) if pr else _vmake,
            vehicle_model=getattr(pr, 'model', None) if pr else None,
            # Bayesian vehicle prior
            prior_weight=_prior_w,
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
    return {"status": "ok", "outcomes": outcomes, "watchlist_hit": _frame_watchlist_hit, "capture_interval_ms": interval_ms}


@app.post("/ingest/detection")
async def ingest_detection(
    drone_id:         str            = Form(...),
    plate_text:       str            = Form(...),
    plate_confidence: float          = Form(0.70),
    lat:              Optional[float] = Form(None),
    lng:              Optional[float] = Form(None),
    altitude:         Optional[float] = Form(None),
    heading:          Optional[float] = Form(None),
    speed:            Optional[float] = Form(None),
    pilot_id:         Optional[str]   = Form(None),
    source:           str             = Form("phone_mlkit"),
    _pilot: dict = Depends(get_current_pilot),
):
    """
    On-device detection result from ML Kit OCR.
    No image transmitted — plate text + confidence only.
    Privacy-preserving: raw frames never leave the device.
    Feeds into the same AggregationService pipeline as frame-based detections.
    """
    plate = plate_text.strip().upper().replace(" ", "").replace("-", "")
    if not plate or not (2 <= len(plate) <= 10):
        return {"status": "skipped", "reason": "invalid_plate", "watchlist_hit": False}

    ts = datetime.now(timezone.utc)

    # Quick watchlist check before aggregation — gives the pilot immediate feedback
    # even when a single scan hasn't accumulated enough confidence to reach "probable"
    on_watchlist = False
    if plate_confidence * 100 >= 55.0:
        try:
            async with database.AsyncSessionLocal() as _wl_sess:
                _wl = await _wl_sess.execute(
                    text(
                        "SELECT 1 FROM watchlist "
                        "WHERE UPPER(REPLACE(REPLACE(plate_text,' ',''),'-','')) = :p "
                        "AND active = TRUE LIMIT 1"
                    ),
                    {"p": plate},
                )
                on_watchlist = _wl.fetchone() is not None
        except Exception:
            pass

    det = AggDetectionInput(
        detection_id = str(uuid.uuid4()),
        frame_id     = str(uuid.uuid4()),
        drone_id     = drone_id,
        detected_at  = ts,
        plate_raw    = plate,
        confidence   = plate_confidence * 100,  # normalize to 0-100 scale
        quality_flags= [],
        telemetry    = {"lat": lat, "lon": lng},
        vehicle_color= None,
        vehicle_type = None,
        vehicle_make = None,
        vehicle_model= None,
        yolo_conf    = 0.0,
        cdc_label    = None,
        cdc_conf     = 0.0,
    )

    snapshot = _aggregation_service.ingest(det)
    watchlist_hit = False
    if snapshot:
        service = EventService(
            repository=EventRepository(database.AsyncSessionLocal),
            dispatcher=_alert_dispatcher,
        )
        decision = await service.upsert_from_snapshot(snapshot)
        if decision:
            status = decision.event.status if hasattr(decision.event, "status") else decision.event.get("status", "")
            watchlist_hit = status in ("alerted", "probable")

    return {"status": "ingested", "watchlist_hit": watchlist_hit or on_watchlist}


def _require_worker_or_pilot(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_optional),
) -> dict:
    """Allow the local RTMP worker (X-Internal-Key) or any authenticated pilot."""
    key = request.headers.get("X-Internal-Key", "")
    if INTERNAL_API_KEY and key == INTERNAL_API_KEY:
        return {"role": "internal", "sub": "worker"}
    if creds:
        try:
            from routers.auth import _decode_token
            return _decode_token(creds.credentials)
        except Exception:
            pass
    raise HTTPException(status_code=401, detail="Not authenticated")


@app.post("/telemetry")
async def post_telemetry(
    payload: schemas.TelemetryCreate,
    auth: dict = Depends(get_current_pilot),
):
    """Position update from mobile app (phone GPS or DJI telemetry)."""
    ts = payload.ts or datetime.now(timezone.utc)
    async with database.AsyncSessionLocal() as session:
        await session.execute(text("""
            INSERT INTO telemetry_points
                (drone_id, pilot_id, ts, lat, lon, altitude_m,
                 heading_deg, speed_mps, accuracy_m, source, volunteer_mode)
            VALUES
                (:drone_id, :pilot_id, :ts, :lat, :lon, :alt,
                 :heading, :speed, :accuracy, :source, :volunteer_mode)
        """), {
            "drone_id":      payload.drone_id,
            "pilot_id":      payload.pilot_id or auth.get("sub"),
            "ts":            ts,
            "lat":           payload.lat,
            "lon":           payload.lng,
            "alt":           payload.altitude,
            "heading":       payload.heading,
            "speed":         payload.speed,
            "accuracy":      payload.accuracy,
            "source":        payload.source or "phone_gps",
            "volunteer_mode": payload.volunteer_mode,
        })
        await session.commit()
    return {"status": "ok"}


@app.post("/detections/")
async def create_detection(
    det: schemas.DetectionCreate,
    _auth: dict = Depends(_require_worker_or_pilot),
):
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
