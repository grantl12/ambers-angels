import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel  # <--- THIS WAS MISSING
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

# Ensure local paths are recognized
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.detection_models import DetectionInput as ModelInput
from services.aggregation_service import AggregationService, DetectionInput as AggInput
from services.event_service import EventService
from services.alert_dispatcher import AlertDispatcher
from event_repository import EventRepository
from services.detection_pipeline import DetectionPipeline

app = FastAPI(title="Amber's Angels - Unified Mission Control")

# ... (All previous imports and setup from the last block) ...

class WatchlistAdd(BaseModel):
    plate_text: str
    description: Optional[str] = "Target of Interest"

@app.post("/watchlist")
async def add_to_watchlist(item: WatchlistAdd):
    async with AsyncSessionLocal() as session:
        try:
            clean_plate = item.plate_text.replace("-", "").replace(" ", "").upper()
            
            # Use the text() wrapper we discussed
            await session.execute(
                text("INSERT INTO watchlist (plate_text, description) VALUES (:p, :d) ON CONFLICT (plate_text) DO NOTHING"),
                {"p": clean_plate, "d": item.description}
            )
            await session.commit()
            return {"status": "added", "plate": clean_plate}
        except Exception as e:
            await session.rollback()
            raise HTTPException(status_code=500, detail=str(e))

# ... (Rest of the file) ...

# --- Database & Session Setup ---
# Using the verified credentials from your Droplet
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels"
)

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

def get_session_factory():
    return AsyncSessionLocal

# --- Singleton Service Initialization ---
# Initialized once to maintain the 'Active Groups' state in memory
aggregation_service = AggregationService()
repo = EventRepository(session_factory=get_session_factory())
event_service = EventService(repo)

# Alert Dispatcher with your Webhook URL
WEBHOOK_URL = os.getenv("ALERT_WEBHOOK_URL")
alert_dispatcher = AlertDispatcher(repository=repo, webhook_url=WEBHOOK_URL)

# The Master Pipeline
pipeline = DetectionPipeline(
    aggregation=aggregation_service,
    events=event_service,
    alerts=alert_dispatcher
)

# --- API Routes ---

@app.post("/frames")
async def register_frame(payload: dict):
    """
    Registers the raw image frame from the drone.
    Matches the schema expected by register_frame.py
    """
    async with AsyncSessionLocal() as session:
        try:
            # Logic to save the frame path and timestamp to your 'frames' table
            # repo.save_frame(...) 
            # For now, we'll return a success to keep the worker happy
            frame_id = str(uuid.uuid4())
            return {"status": "registered", "frame_id": frame_id}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Frame Reg Error: {str(e)}")

@app.post("/process_detection")
@app.post("/detections")
async def handle_detection(payload: dict, background_tasks: BackgroundTasks):
    """
    Primary ALPR endpoint. 
    Accepts raw JSON, transforms to DetectionInput, and feeds the Pipeline.
    """
    try:
        # Transform flat JSON into your Aggregation Dataclass
        detection_data = AggInput(
            detection_id=str(uuid.uuid4()),
            frame_id=payload.get("frame_id", "unknown"),
            drone_id=payload.get("drone_id", "drone1"),
            detected_at=datetime.fromisoformat(payload["timestamp"]) if "timestamp" in payload else datetime.now(timezone.utc),
            plate_raw=payload.get("plate") or payload.get("plate_text", "UNKNOWN"),
            confidence=float(payload.get("confidence", 0.0)),
            quality_flags=payload.get("quality_flags", []),
            telemetry={
                "lat": payload.get("latitude", 33.7490),
                "lon": payload.get("longitude", -84.3880)
            }
        )

        # Offload heavy aggregation/alerting logic to a background task
        # This keeps the [CPU Usage](https://cloud.digitalocean.com/droplets/559904925/graphs?i=b249b2&period=hour) spikes manageable
        background_tasks.add_task(pipeline.process_detection, detection_data)

        return {"status": "accepted", "plate": detection_data.plate_raw}

    except Exception as e:
        print(f"❌ Ingest Error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/telemetry")
async def ingest_telemetry(t: dict):
    """Placeholder for future GPS/Drone telemetry data."""
    return {"status": "received", "ts": datetime.now(timezone.utc).isoformat()}

@app.get("/health")
async def health():
    """Monitor system vitals."""
    return {
        "status": "online",
        "active_aggregation_groups": aggregation_service.active_group_count(),
        "database": "connected",
        "webhook_enabled": WEBHOOK_URL is not None
    }
