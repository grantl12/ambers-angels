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

    Telemetry fields are all optional — the RTMP worker omits them and
    continues working unchanged. Native app (DJI SDK) sends them per frame.
    """
    plate_text: str
    confidence: float
    drone_id:   str
    detected_at: Optional[datetime] = None

    # Optional — worker may pass this if it has it
    best_frame_id: Optional[str]  = None
    raw_payload:   Optional[dict] = None

    # Native app telemetry — omit to preserve RTMP worker behaviour
    lat:      Optional[float] = None
    lng:      Optional[float] = None
    altitude: Optional[float] = None   # metres AGL
    heading:  Optional[float] = None   # degrees 0-360
    speed:    Optional[float] = None   # m/s
    accuracy: Optional[float] = None   # GPS accuracy radius, metres
    source:   Optional[str]  = None    # "rtmp_drone" | "dji_app" | "phone_gps"

    # Vehicle attributes — populated by YOLOv8 locally and/or Plate Recognizer
    vehicle_color: Optional[str] = None   # e.g. "blue", "silver"
    vehicle_type:  Optional[str] = None   # car | truck | motorcycle | bus
    vehicle_make:  Optional[str] = None   # e.g. "honda"
    vehicle_model: Optional[str] = None   # e.g. "civic"


class TelemetryCreate(BaseModel):
    """
    Payload for POST /telemetry — position-only updates from the native app.
    Sent frequently (e.g. every second) independently of detections.
    """
    drone_id:  str
    lat:       float
    lng:       float
    altitude:  Optional[float]   = None
    heading:   Optional[float]   = None
    speed:     Optional[float]   = None
    accuracy:  Optional[float]   = None
    pilot_id:  Optional[str]    = None
    source:    Optional[str]    = None   # "dji_telemetry" | "phone_gps"
    ts:        Optional[datetime] = None


class DetectionResponse(BaseModel):
    """Response returned from POST /detections/"""
    status: str
    plate: Optional[str] = None
    alert_triggered: Optional[bool] = None
    reason: Optional[str] = None
