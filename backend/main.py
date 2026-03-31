"""
backend/main.py
Amber's Angels — FastAPI entry point.
"""
import sys
import os
import uuid
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from sqlalchemy import text

# Ensure the backend directory is on the path regardless of working directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# --- Core imports ---
import database
import schemas
from services.detection_models import EventStatus, EventClassification
from services.event_service import EventService
from services.aggregation_service import AggregationService, DetectionInput as AggDetectionInput
from event_repository import EventRepository
from services.alert_dispatcher import AlertDispatcher
from services.fema_connector import fema_background_loop, poll_fema_ipaws
from routers.read_api import router as read_router

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
    task = asyncio.create_task(
        fema_background_loop(
            session_factory=database.AsyncSessionLocal,
            webhook_url=os.getenv("ALERT_WEBHOOK_URL", ""),
        )
    )
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Amber's Angels API", lifespan=lifespan)
app.include_router(read_router)

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
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")


@app.post("/detections/")
async def create_detection(
    detection: schemas.DetectionCreate,
    db: Session = Depends(get_db),
):
    """
    Accepts a raw detection from the worker, runs it through the full pipeline:
      AggregationService (buffer + score) → EventService (DB upsert + alert dispatch)

    The aggregation service is a process-level singleton so it can maintain the
    5-second grouping window across successive frames of the same plate.
    """
    det_input = AggDetectionInput(
        detection_id=str(uuid.uuid4()),
        frame_id=detection.best_frame_id or str(uuid.uuid4()),
        drone_id=detection.drone_id,
        detected_at=detection.detected_at or datetime.now(timezone.utc),
        plate_raw=detection.plate_text,
        confidence=detection.confidence,
        quality_flags=[],
        telemetry=None,
        bbox=None,
        alpr_payload=detection.raw_payload,
    )

    snapshot = _aggregation_service.ingest(det_input)

    if not snapshot or not snapshot.should_open_event:
        # Detection is buffered or filtered (low confidence / too short)
        return {"status": "buffering", "plate": detection.plate_text, "alert_triggered": False}

    repo = EventRepository(database.AsyncSessionLocal)
    dispatcher = AlertDispatcher(
        repository=repo,
        webhook_url=os.getenv("ALERT_WEBHOOK_URL", ""),
    )
    service = EventService(repository=repo, dispatcher=dispatcher)

    decision = await service.upsert_from_snapshot(snapshot)

    if not decision:
        return {"status": "ignored", "reason": "snapshot_rejected"}

    event = decision.event
    plate = event.get("plate_best") if isinstance(event, dict) else event.plate_best

    return {
        "status": "processed",
        "plate": plate,
        "alert_triggered": decision.should_dispatch_alert,
    }
