"""
backend/main.py
Amber's Angels — FastAPI entry point.
"""
import sys
import os
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
from event_repository import EventRepository
from services.alert_dispatcher import AlertDispatcher

# The alert dispatcher singleton — reads ALERT_WEBHOOK_URL from env
_alert_dispatcher = AlertDispatcher(
    repository=None,  # repository is injected per-request below
    webhook_url=os.getenv("ALERT_WEBHOOK_URL", ""),
)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Amber's Angels API")

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
    Accepts a raw detection from the worker or bridge, runs it through
    the event service (which handles deduplication, watchlist checking,
    and alert dispatch).
    """
    # Build the repo with the async session factory for this request
    repo = EventRepository(database.AsyncSessionLocal)

    # Wire the dispatcher to the repo so DB alert logging works
    dispatcher = AlertDispatcher(
        repository=repo,
        webhook_url=os.getenv("ALERT_WEBHOOK_URL", ""),
    )

    service = EventService(repository=repo, dispatcher=dispatcher)

    # Build an EventSnapshot directly from the incoming detection
    # (bypasses the aggregation layer for single-detection ingress)
    from services.aggregation_service import EventSnapshot as AggSnapshot

    snapshot = AggSnapshot(
        drone_id=detection.drone_id,
        group_key=f"{detection.drone_id}_{detection.plate_text.upper().replace(' ', '')}",
        plate_best=detection.plate_text.upper().replace(" ", ""),
        plate_normalized=detection.plate_text.upper().replace(" ", ""),
        first_seen_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
        aggregate_confidence=detection.confidence,
        classification=EventClassification.PROBABLE,
        status=EventStatus.CANDIDATE,
        detection_count=1,
        distinct_frame_count=1,
        best_frame_id=detection.best_frame_id or "unknown.jpg",
        best_detection_id=None,
        should_open_event=True,
        should_alert=False,   # event_service will evaluate this via watchlist
        dominant_ratio=1.0,
        top_hypotheses=[],
        quality_flags=[],
        raw_summary={},
        location_centroid=None,
    )

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
