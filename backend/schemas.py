"""
backend/schemas.py
Pydantic schemas used by FastAPI endpoints and the worker.
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class DetectionCreate(BaseModel):
    """
    Payload accepted by POST /detections/ and used by the unified worker.
    Maps the raw ALPR output + drone metadata into a structured input.
    """
    plate_text: str
    confidence: float
    drone_id: str
    detected_at: Optional[datetime] = None

    # Optional — worker may pass this if it has it
    best_frame_id: Optional[str] = None
    raw_payload: Optional[dict] = None


class DetectionResponse(BaseModel):
    """Response returned from POST /detections/"""
    status: str
    plate: Optional[str] = None
    alert_triggered: Optional[bool] = None
    reason: Optional[str] = None
