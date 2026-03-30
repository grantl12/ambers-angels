"""
backend/services/detection_models.py
"""
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Any, Dict
from enum import Enum
from uuid import UUID


# --- Enums ---

class EventStatus(str, Enum):
    NEW = "new"                     # ← restored (used by main.py)
    ACTIVE = "active"
    CLOSED = "closed"
    CANDIDATE = "candidate"
    DETECTION = "detection"
    TARGET_MATCH = "target_match"
    ANOMALY = "anomaly"
    QUEUED_REVIEW = "queued_review"
    ALERTED = "alerted"


class EventClassification(str, Enum):
    WEAK = "weak"
    PROBABLE = "probable"
    HIGH_CONFIDENCE = "high_confidence"


class AlertChannel(str, Enum):
    DISCORD = "discord"
    SLACK = "slack"
    WEBHOOK = "webhook"
    INTERNAL = "internal"
    EMAIL = "email"


class AlertDeliveryStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


# --- Input / Pipeline Models ---

class DetectionInput(BaseModel):
    plate: str
    plate_normalized: Optional[str] = None
    confidence: float
    drone_id: str
    latitude: float
    longitude: float
    timestamp: datetime


class EventSnapshot(BaseModel):
    plate_best: str
    drone_id: str
    occurrence_count: int = 1
    best_confidence: float = 0.0
    average_confidence: float = 0.0
    last_latitude: float = 0.0
    last_longitude: float = 0.0
    timestamp: Optional[datetime] = None
    should_open_event: bool = False


# --- DB-facing Models ---

class DetectionEvent(BaseModel):
    id: Optional[str] = None
    plate_best: str
    drone_id: str
    status: EventStatus = EventStatus.ACTIVE
    classification: EventClassification = EventClassification.WEAK
    occurrence_count: int = 1
    average_confidence: float = 0.0
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    # Extended fields (populated by event_service)
    plate_normalized: Optional[str] = None
    best_frame_id: Optional[str] = None
    detection_count: Optional[int] = None
    distinct_frame_count: Optional[int] = None
    location_centroid: Optional[Dict[str, Any]] = None
    raw_summary: Optional[Dict[str, Any]] = None
    dedupe_key: Optional[str] = None
    updated_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None


class DetectionEventCreate(BaseModel):
    """Full payload used by event_service._build_create_payload()."""
    plate_best: str
    drone_id: str
    status: str = "new"
    classification: str = "weak"
    occurrence_count: int = 1
    average_confidence: float = 0.0
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    # Extended fields that event_service passes through
    plate_normalized: Optional[str] = None
    best_frame_id: Optional[str] = None
    detection_count: Optional[int] = None
    distinct_frame_count: Optional[int] = None
    location_centroid: Optional[Dict[str, Any]] = None
    raw_summary: Optional[Dict[str, Any]] = None
    dedupe_key: Optional[str] = None
    review_recommended: Optional[bool] = None


class DetectionEventUpdate(BaseModel):
    status: Optional[str] = None
    classification: Optional[str] = None
    occurrence_count: Optional[int] = None
    average_confidence: Optional[float] = None
    last_seen: Optional[datetime] = None


# --- Alert Models ---

class Alert(BaseModel):
    event_id: str
    plate: str
    plate_normalized: Optional[str] = None
    drone_id: str
    confidence: float = 0.0
    timestamp: Optional[datetime] = None
    location: Optional[dict] = None
    message: str = ""
    # Used by the old dispatcher
    destination: Optional[str] = None
    payload: Optional[dict] = None
    delivery_status: Optional[str] = None


class AlertCreate(BaseModel):
    alert_type: str
    severity: str
    message: str
    metadata: Optional[dict] = None
    event_id: Optional[str] = None
    # Additional fields used by alert_dispatcher.py
    plate_text: Optional[str] = None
    drone_id: Optional[str] = None
    sent_at: Optional[datetime] = None
    channel: Optional[str] = None
    destination: Optional[str] = None
    payload: Optional[dict] = None


class AlertPayload(BaseModel):
    channel: AlertChannel
    target_url: Optional[str] = None
    data: dict


def build_alert_event_payload(event: Any, classification: str) -> dict:
    """Helper to format the event data for the Alert Dispatcher."""
    return {
        "event_id": str(getattr(event, 'id', 'unknown')),
        "plate": getattr(event, 'plate_best', 'unknown'),
        "drone_id": getattr(event, 'drone_id', 'unknown'),
        "confidence": getattr(event, 'average_confidence', 0.0),
        "classification": classification,
        "timestamp": datetime.utcnow().isoformat(),
        "metadata": {
            "occurrence_count": getattr(event, 'occurrence_count', 1),
            "last_seen": str(getattr(event, 'last_seen', ''))
        }
    }
