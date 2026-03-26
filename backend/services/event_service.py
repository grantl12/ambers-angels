from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol
from uuid import UUID

from services.aggregation_service import EventSnapshot
from services.detection_models import (
    DetectionEvent,
    DetectionEventCreate,
    EventClassification,
    EventStatus,
)


# -----------------------------------------------------------------------------
# Tunable defaults
# -----------------------------------------------------------------------------


ALERT_COOLDOWN_SECONDS = 120
REOPEN_WINDOW_SECONDS = 300


# -----------------------------------------------------------------------------
# Repository protocol
# -----------------------------------------------------------------------------


class EventRepository(Protocol):
    def get_active_event_by_group_key(self, group_key: str) -> DetectionEvent | None:
        ...

    def get_recent_event_by_plate(
        self,
        *,
        drone_id: str,
        plate_normalized: str,
        since: datetime,
    ) -> DetectionEvent | None:
        ...

    def create_event(self, payload: DetectionEventCreate) -> DetectionEvent:
        ...

    def update_event(self, event: DetectionEvent, fields: dict) -> DetectionEvent:
        ...

    def attach_detection_to_event(self, detection_id: UUID | str, event_id: UUID) -> None:
        ...


# -----------------------------------------------------------------------------
# Output container
# -----------------------------------------------------------------------------


@dataclass(slots=True)
class EventDecision:
    event: DetectionEvent
    created: bool
    updated: bool
    should_dispatch_alert: bool
    suppression_reason: str | None
    cooldown_expires_at: datetime | None


# -----------------------------------------------------------------------------
# Event service
# -----------------------------------------------------------------------------


class EventService:
    def __init__(
        self,
        repository: EventRepository,
        *,
        alert_cooldown_seconds: int = ALERT_COOLDOWN_SECONDS,
        reopen_window_seconds: int = REOPEN_WINDOW_SECONDS,
    ) -> None:
        self.repository = repository
        self.alert_cooldown_seconds = alert_cooldown_seconds
        self.reopen_window_seconds = reopen_window_seconds

    def upsert_from_snapshot(self, snapshot: EventSnapshot) -> EventDecision | None:
        if not snapshot.should_open_event:
            return None

        existing = self.repository.get_active_event_by_group_key(snapshot.group_key)
        if existing is None:
            existing = self._find_recent_reopen_candidate(snapshot)

        if existing is None:
            event = self.repository.create_event(self._build_create_payload(snapshot))
            created = True
            updated = False
        else:
            event = self.repository.update_event(existing, self._build_update_fields(existing, snapshot))
            created = False
            updated = True

        if snapshot.best_detection_id is not None:
            self.repository.attach_detection_to_event(snapshot.best_detection_id, event.id)

        should_dispatch_alert, suppression_reason, cooldown_expires_at = self._evaluate_alert_dispatch(
            event=event,
            snapshot=snapshot,
            created=created,
        )

        if should_dispatch_alert and event.status != EventStatus.ALERTED.value:
            event = self.repository.update_event(
                event,
                {
                    "status": EventStatus.ALERTED.value,
                    "updated_at": datetime.now(timezone.utc),
                },
            )

        return EventDecision(
            event=event,
            created=created,
            updated=updated,
            should_dispatch_alert=should_dispatch_alert,
            suppression_reason=suppression_reason,
            cooldown_expires_at=cooldown_expires_at,
        )

    # ------------------------------------------------------------------
    # Create/update helpers
    # ------------------------------------------------------------------

    def _build_create_payload(self, snapshot: EventSnapshot) -> DetectionEventCreate:
        return DetectionEventCreate(
            drone_id=snapshot.drone_id,
            status=snapshot.status,
            classification=snapshot.classification,
            plate_best=snapshot.plate_best,
            plate_normalized=snapshot.plate_normalized,
            aggregate_confidence=snapshot.aggregate_confidence,
            first_seen_at=snapshot.first_seen_at,
            last_seen_at=snapshot.last_seen_at,
            best_frame_id=snapshot.best_frame_id,
            detection_count=snapshot.detection_count,
            distinct_frame_count=snapshot.distinct_frame_count,
            location_centroid=snapshot.location_centroid,
            raw_summary=snapshot.raw_summary,
            dedupe_key=snapshot.group_key,
            review_recommended=snapshot.classification in {
                EventClassification.PROBABLE,
                EventClassification.HIGH_CONFIDENCE,
            },
        )

    def _build_update_fields(self, event: DetectionEvent, snapshot: EventSnapshot) -> dict:
        next_classification = self._max_classification(event.classification, snapshot.classification)
        next_status = self._derive_status(event.status, snapshot, next_classification)
        next_confidence = self._max_nullable_float(event.aggregate_confidence, snapshot.aggregate_confidence)

        merged_raw_summary = dict(event.raw_summary or {})
        merged_raw_summary.update(snapshot.raw_summary)

        fields = {
            "status": next_status.value,
            "classification": next_classification.value,
            "plate_best": snapshot.plate_best or event.plate_best,
            "plate_normalized": snapshot.plate_normalized or event.plate_normalized,
            "aggregate_confidence": next_confidence,
            "last_seen_at": max(event.last_seen_at, snapshot.last_seen_at),
            "best_frame_id": snapshot.best_frame_id or event.best_frame_id,
            "detection_count": max(event.detection_count, snapshot.detection_count),
            "distinct_frame_count": max(event.distinct_frame_count, snapshot.distinct_frame_count),
            "location_centroid": snapshot.location_centroid or event.location_centroid,
            "raw_summary": merged_raw_summary,
            "dedupe_key": event.dedupe_key or snapshot.group_key,
            "review_recommended": event.review_recommended
            or snapshot.classification in {EventClassification.PROBABLE, EventClassification.HIGH_CONFIDENCE},
            "updated_at": datetime.now(timezone.utc),
        }
        return fields

    def _find_recent_reopen_candidate(self, snapshot: EventSnapshot) -> DetectionEvent | None:
        since = snapshot.first_seen_at - timedelta(seconds=self.reopen_window_seconds)
        return self.repository.get_recent_event_by_plate(
            drone_id=snapshot.drone_id,
            plate_normalized=snapshot.plate_normalized,
            since=since,
        )

    # ------------------------------------------------------------------
    # Alert decision logic
    # ------------------------------------------------------------------

    def _evaluate_alert_dispatch(
        self,
        *,
        event: DetectionEvent,
        snapshot: EventSnapshot,
        created: bool,
    ) -> tuple[bool, str | None, datetime | None]:
        if not snapshot.should_alert:
            return False, "snapshot_not_alert_eligible", None

        now = datetime.now(timezone.utc)
        cooldown_expires_at = None

        if event.status == EventStatus.ALERTED.value:
            base_time = event.updated_at or event.last_seen_at or now
            cooldown_expires_at = base_time + timedelta(seconds=self.alert_cooldown_seconds)

            if now < cooldown_expires_at:
                upgraded = self._classification_rank(snapshot.classification) > self._classification_rank(event.classification)
                stronger = snapshot.aggregate_confidence > float(event.aggregate_confidence or 0)

                if not upgraded and not stronger:
                    return False, "cooldown_active", cooldown_expires_at

        return True, None, cooldown_expires_at

    # ------------------------------------------------------------------
    # State helpers
    # ------------------------------------------------------------------

    def _derive_status(
        self,
        current_status: str,
        snapshot: EventSnapshot,
        classification: EventClassification,
    ) -> EventStatus:
        if current_status == EventStatus.ALERTED.value:
            return EventStatus.ALERTED
        if classification in {EventClassification.PROBABLE, EventClassification.HIGH_CONFIDENCE}:
            return EventStatus.QUEUED_REVIEW
        if snapshot.should_open_event:
            return EventStatus.CANDIDATE
        return EventStatus(current_status)

    def _max_classification(
        self,
        current: str | EventClassification,
        incoming: EventClassification,
    ) -> EventClassification:
        current_enum = current if isinstance(current, EventClassification) else EventClassification(current)
        if self._classification_rank(incoming) >= self._classification_rank(current_enum):
            return incoming
        return current_enum

    @staticmethod
    def _classification_rank(value: str | EventClassification) -> int:
        enum_value = value if isinstance(value, EventClassification) else EventClassification(value)
        ranks = {
            EventClassification.WEAK: 0,
            EventClassification.PROBABLE: 1,
            EventClassification.HIGH_CONFIDENCE: 2,
        }
        return ranks[enum_value]

    @staticmethod
    def _max_nullable_float(left: float | None, right: float | None) -> float | None:
        if left is None:
            return right
        if right is None:
            return float(left)
        return max(float(left), float(right))
