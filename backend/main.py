import os
import sys
import uuid
import base64
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel  
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

# Ensure local paths are recognized
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.aggregation_service import AggregationService, DetectionInput as AggInput
from services.event_service import EventService
from services.alert_dispatcher import AlertDispatcher
from event_repository import EventRepository
from services.detection_pipeline import DetectionPipeline

app = FastAPI(title="Amber's Angels - Unified Mission Control")

# --- Database & Session Setup ---
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels"
)

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

def get_session_factory():
    return AsyncSessionLocal

# --- Watchlist ---
class WatchlistAdd(BaseModel):
    plate_text: str
    description: Optional[str] = "Target of Interest"

@app.post("/watchlist")
async def add_to_watchlist(item: WatchlistAdd):
    async with AsyncSessionLocal() as session:
        try:
            clean_plate = item.plate_text.replace("-", "").replace(" ", "").upper()
            await session.execute(
                text("INSERT INTO watchlist (plate_text, description) VALUES (:p, :d) ON CONFLICT (plate_text) DO NOTHING"),
                {"p": clean_plate, "d": item.description}
            )
            await session.commit()
            return {"status": "added", "plate": clean_plate}
        except Exception as e:
            await session.rollback()
            raise HTTPException(status_code=500, detail=str(e))

# --- Service Initialization ---
# CRITICAL FIX: Robust Webhook Fallback
RAW_WEBHOOK = os.getenv("ALERT_WEBHOOK_URL", "")
# Replace the string below with your ACTUAL Discord URL if the environment variable fails
FALLBACK_URL = "https://discord.com/api/webhooks/1487118233978015809/x4vC4bi56xCJmWzAZIORinokhE6q9Utc5kKAIraaqcj0ubRd3ZDRi91tSV3QEGbh84ic"

if not RAW_WEBHOOK or "your_discord_webhook_here" in RAW_WEBHOOK:
    WEBHOOK_URL = FALLBACK_URL
else:
    WEBHOOK_URL = RAW_WEBHOOK

aggregation_service = AggregationService()
repo = EventRepository(session_factory=get_session_factory())
alert_dispatcher = AlertDispatcher(repository=repo, webhook_url=WEBHOOK_URL)
event_service = EventService(repository=repo, dispatcher=alert_dispatcher)

pipeline = DetectionPipeline(
    aggregation=aggregation_service,
    events=event_service,
    alerts=alert_dispatcher
)

# --- The Image-Saving & Detection Logic ---
@app.post("/detections")
@app.post("/process_detection")
async def handle_detection(payload: dict, background_tasks: BackgroundTasks):
    print(f"\n[LOUD DEBUG] 📦 FULL PAYLOAD RECEIVED: {payload}")
    print(f"[LOUD DEBUG] 🔑 KEYS PRESENT: {list(payload.keys())}")
    try:
        # 1. Identify Drone and Frame
        drone_id = payload.get("drone_id", "drone1")
        frame_id = payload.get("frame_id") or str(uuid.uuid4())
        
        # 2. Dynamic Image Persistence (Supports Multi-Drone Folders)
        save_dir = f"/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/{drone_id}"
        os.makedirs(save_dir, exist_ok=True)
        
        img_b64 = payload.get("image") or payload.get("image_b64")
        if img_b64:
            file_path = os.path.join(save_dir, f"{frame_id}.jpg")
            # Remove data URI header if present
            if "," in img_b64:
                img_b64 = img_b64.split(",")[1]
            
            with open(file_path, "wb") as f:
                f.write(base64.b64decode(img_b64))
            print(f"📸 Saved: {file_path}")

        # 3. Extract Plate (Fuzzy keys for different drone softwares)
        plate_raw = (
            payload.get("plate_best") or payload.get("plate") or 
            payload.get("plate_text") or 
            payload.get("plate_best") or 
            "UNKNOWN"
        )

        # 4. Pipeline Ingest
        detection_data = AggInput(
            detection_id=None,  # BigInt handled by DB
            frame_id=frame_id,
            drone_id=drone_id,
            detected_at=datetime.now(timezone.utc),
            plate_raw=plate_raw,
            confidence=float(payload.get("confidence", 0.0)),
            telemetry={
                "lat": payload.get("latitude", 33.7490),
                "lon": payload.get("longitude", -84.3880)
            }
        )

        # Trigger background processing
        background_tasks.add_task(pipeline.process_detection, detection_data)
        
        return {"status": "accepted", "plate": plate_raw, "frame_id": frame_id}

    except Exception as e:
        print(f"❌ Ingest Error: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/health")
async def health():
    return {"status": "online", "webhook_configured": bool("discord" in WEBHOOK_URL)}
