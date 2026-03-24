#Ambers Angels Detection Models
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


# -----------------------------------------------------------------------------
# SQLAlchemy base
# -----------------------------------------------------------------------------


class Base(DeclarativeBase):
    pass


# -----------------------------------------------------------------------------
# Enums
# -----------------------------------------------------------------------------


class EventType(str, Enum):
    PLATE_DETECTION = "plate_detection"


class EventStatus(str, Enum):
    CANDIDATE = "candidate"
    QUEUED_REVIEW = "queued_review"
    ALERTED = "alerted"
    DISMISSED = "dismissed"
    RESOLVED = "resolved"


class EventClassification(str, Enum):
    WEAK = "weak"
    PROBABLE = "probable"
    HIGH_CONFIDENCE = "high_confidence"


class AlertChannel(str, Enum):
    INTERNAL = "internal"
    WEBHOOK = "webhook"
    EMAIL = "email"
    SMS = "sms"
    QUEUE = "queue"


class AlertDeliveryStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    ACKED = "acked"


# -----------------------------------------------------------------------------
# SQLAlchemy ORM models
# -----------------------------------------------------------------------------


class DetectionEvent(Base):
    __tablename__ = "detection_events"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_type: Mapped[str] = mapped_column(String(64), default=EventType.PLATE_DETECTION.value, nullable=False)
    drone_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), default=EventStatus.CANDIDATE.value, nullable=False, index=True)
    plate_best: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    plate_normalized: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    classification: Mapped[str] = mapped_column(String(32), default=EventClassification.WEAK.value, nullable=False, index=True)
    aggregate_confidence: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    best_frame_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("frames.id"), nullable=True)
    detection_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    distinct_frame_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    telemetry_start_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("telemetry_points.id"), nullable=True)
    telemetry_end_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("telemetry_points.id"), nullable=True)
    location_centroid: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    raw_summary: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    review_recommended: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    alerts: Mapped[list[Alert]] = relationship(back_populates="event", cascade="all, delete-orphan")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("detection_events.id"), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    destination: Mapped[str | None] = mapped_column(String(512), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(32), default=AlertDeliveryStatus.PENDING.value, nullable=False, index=True)
    provider_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event: Mapped[DetectionEvent] = relationship(back_populates="alerts")


# -----------------------------------------------------------------------------
# Pydantic API schemas
# -----------------------------------------------------------------------------


class DetectionHypothesis(BaseModel):
    plate: str
    score: float
    count: int = 1


class EventLocation(BaseModel):
    lat: float | None = None
    lon: float | None = None
    alt: float | None = None
    heading: float | None = None
    source: str | None = None


class DedupeMetadata(BaseModel):
    suppressed_prior_alert: bool = False
    group_key: str | None = None
    cooldown_expires_at: datetime | None = None


class DetectionEventBase(BaseModel):
    drone_id: str
    plate_best: str | None = None
    plate_normalized: str | None = None
    classification: EventClassification = EventClassification.WEAK
    aggregate_confidence: float | None = None
    first_seen_at: datetime
    last_seen_at: datetime
    best_frame_id: UUID | None = None
    detection_count: int = 0
    distinct_frame_count: int = 0
    location_centroid: dict[str, Any] | None = None
    raw_summary: dict[str, Any] = Field(default_factory=dict)
    dedupe_key: str | None = None
    review_recommended: bool = True


class DetectionEventCreate(DetectionEventBase):
    event_type: EventType = EventType.PLATE_DETECTION
    status: EventStatus = EventStatus.CANDIDATE


class DetectionEventUpdate(BaseModel):
    status: EventStatus | None = None
    classification: EventClassification | None = None
    aggregate_confidence: float | None = None
    plate_best: str | None = None
    plate_normalized: str | None = None
    last_seen_at: datetime | None = None
    best_frame_id: UUID | None = None
    detection_count: int | None = None
    distinct_frame_count: int | None = None
    location_centroid: dict[str, Any] | None = None
    raw_summary: dict[str, Any] | None = None
    dedupe_key: str | None = None
    review_recommended: bool | None = None


class DetectionEventRead(DetectionEventBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_type: EventType
    status: EventStatus
    created_at: datetime
    updated_at: datetime


class AlertBase(BaseModel):
    channel: AlertChannel
    destination: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class AlertCreate(AlertBase):
    event_id: UUID
    delivery_status: AlertDeliveryStatus = AlertDeliveryStatus.PENDING


class AlertUpdate(BaseModel):
    delivery_status: AlertDeliveryStatus | None = None
    provider_response: dict[str, Any] | None = None
    sent_at: datetime | None = None


class AlertRead(AlertBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    delivery_status: AlertDeliveryStatus
    provider_response: dict[str, Any] | None = None
    created_at: datetime
    sent_at: datetime | None = None


class AlertEventPayload(BaseModel):
    event_id: UUID
    event_type: EventType = EventType.PLATE_DETECTION
    status: EventStatus
    classification: EventClassification
    plate_text: str
    plate_normalized: str
    aggregate_confidence: float
    first_seen_at: datetime
    last_seen_at: datetime
    drone_id: str
    best_frame_id: UUID | None = None
    frame_image_url: str | None = None
    location: EventLocation | None = None
    detection_count: int
    top_hypotheses: list[DetectionHypothesis] = Field(default_factory=list)
    quality_flags: list[str] = Field(default_factory=list)
    raw_detection_payloads: list[dict[str, Any]] = Field(default_factory=list)
    dedupe: DedupeMetadata = Field(default_factory=DedupeMetadata)


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def build_alert_event_payload(
    event: DetectionEvent,
    *,
    frame_image_url: str | None = None,
    location: EventLocation | None = None,
    top_hypotheses: list[DetectionHypothesis] | None = None,
    quality_flags: list[str] | None = None,
    raw_detection_payloads: list[dict[str, Any]] | None = None,
    dedupe: DedupeMetadata | None = None,
) -> AlertEventPayload:
    return AlertEventPayload(
        event_id=event.id,
        status=EventStatus(event.status),
        classification=EventClassification(event.classification),
        plate_text=event.plate_best or "",
        plate_normalized=event.plate_normalized or "",
        aggregate_confidence=float(event.aggregate_confidence or 0.0),
        first_seen_at=event.first_seen_at,
        last_seen_at=event.last_seen_at,
        drone_id=event.drone_id,
        best_frame_id=event.best_frame_id,
        frame_image_url=frame_image_url,
        location=location,
        detection_count=event.detection_count,
        top_hypotheses=top_hypotheses or [],
        quality_flags=quality_flags or [],
        raw_detection_payloads=raw_detection_payloads or [],
        dedupe=dedupe or DedupeMetadata(group_key=event.dedupe_key),
    )
