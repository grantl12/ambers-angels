from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Any
from enum import Enum

# --- Enums ---
class EventStatus(str, Enum):
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

# --- Data Models ---
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
    occurrence_count: int
    best_confidence: float
    average_confidence: float
    last_latitude: float
    last_longitude: float
    timestamp: datetime
    should_open_event: bool = False

class DetectionEvent(BaseModel):
    id: Optional[str] = None
    plate_best: str
    drone_id: str
    status: EventStatus = EventStatus.ACTIVE
    classification: EventClassification = EventClassification.WEAK
    occurrence_count: int = 1
    average_confidence: float
    first_seen: datetime
    last_seen: datetime

class DetectionEventCreate(BaseModel):
    plate_best: str
    drone_id: str
    status: str = "active"
    classification: str = "weak"
    occurrence_count: int = 1
    average_confidence: float
    first_seen: datetime
    last_seen: datetime

class DetectionEventUpdate(BaseModel):
    status: Optional[str] = None
    classification: Optional[str] = None
    occurrence_count: Optional[int] = None
    average_confidence: Optional[float] = None
    last_seen: Optional[datetime] = None

class Alert(BaseModel):
    event_id: str
    plate: str
    plate_normalized: Optional[str] = None
    drone_id: str
    confidence: float
    timestamp: datetime
    location: dict
    message: str

class AlertCreate(BaseModel):
    alert_type: str
    severity: str
    message: str
    metadata: Optional[dict] = None
    event_id: Optional[str] = None

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
