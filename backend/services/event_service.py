from __future__ import annotations
import logging
import uuid
from dataclasses import dataclass

logger = logging.getLogger(__name__)
from datetime import datetime, timedelta, timezone
from typing import Protocol, Any
from uuid import UUID
from sqlalchemy import text
from difflib import SequenceMatcher

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

class EventRepository(Protocol):
    session_factory: Any
    async def get_active_event_by_group_key(self, group_key: str) -> DetectionEvent | None: ...
    async def get_recent_event_by_plate(self, *, drone_id: str, plate_normalized: str, since: datetime) -> DetectionEvent | None: ...
    async def create_event(self, payload: DetectionEventCreate) -> DetectionEvent: ...
    async def update_event(self, event: DetectionEvent, fields: dict) -> DetectionEvent: ...
    async def attach_detection_to_event(self, detection_id: UUID | str, event_id: UUID) -> None: ...

@dataclass(slots=True)
class EventDecision:
    event: DetectionEvent
    created: bool
    updated: bool
    should_dispatch_alert: bool
    suppression_reason: str | None
    cooldown_expires_at: datetime | None

class EventService:
    def __init__(
        self,
        repository: EventRepository,
        dispatcher: Any,
        *,
        alert_cooldown_seconds: int = ALERT_COOLDOWN_SECONDS,
        reopen_window_seconds: int = REOPEN_WINDOW_SECONDS,
    ) -> None:
        self.repository = repository
        self.dispatcher = dispatcher
        self.alert_cooldown_seconds = alert_cooldown_seconds
        self.reopen_window_seconds = reopen_window_seconds

    async def upsert_from_snapshot(self, snapshot: EventSnapshot) -> EventDecision | None:
        logger.debug("Processing snapshot: %s (confidence: %s)", snapshot.plate_best, snapshot.aggregate_confidence)

        if not snapshot.should_open_event:
            logger.debug("Snapshot rejected: should_open_event is False")
            return None

        # 1. Database Lookup
        existing = await self.repository.get_active_event_by_group_key(snapshot.group_key)
        if existing is None:
            existing = await self._find_recent_reopen_candidate(snapshot)

        if existing is None:
            logger.debug("Creating new event for %s", snapshot.plate_best)
            event = await self.repository.create_event(self._build_create_payload(snapshot))
            created, updated = True, False
        else:
            logger.debug("Updating existing event ID: %s", existing.get('id') if isinstance(existing, dict) else existing.id)
            event = await self.repository.update_event(existing, self._build_update_fields(existing, snapshot))
            created, updated = False, True

        # 2. EVALUATE ALERT (Fuzzy Logic Applied Here)
        should_dispatch_alert, suppression_reason, cooldown_expires_at, vehicle_context = await self._evaluate_alert_dispatch(
            event=event,
            snapshot=snapshot
        )

        # 3. DISPATCH TO DISCORD
        if should_dispatch_alert:
            logger.info("Alert triggered for %s", snapshot.plate_best)
            # Store frame_url so the frontend can show the thumbnail
            frame_url = f"/frames/{snapshot.best_frame_id}" if snapshot.best_frame_id else None
            event = await self.repository.update_event(
                event,
                {
                    "status": EventStatus.ALERTED.value,
                    "updated_at": datetime.now(timezone.utc),
                    "frame_url": frame_url,
                }
            )
            try:
                location = None
                if snapshot.location_centroid:
                    location = {"lat": snapshot.location_centroid[0], "lng": snapshot.location_centroid[1]}

                effective_conf = (
                    vehicle_context.get("effective_confidence", snapshot.aggregate_confidence)
                    if vehicle_context else snapshot.aggregate_confidence
                )
                await self.dispatcher.dispatch_alert(
                    plate=snapshot.plate_best,
                    drone_id=snapshot.drone_id,
                    confidence=effective_conf,
                    timestamp=snapshot.last_seen_at,
                    location=location,
                    frame_id=snapshot.best_frame_id,
                    raw_summary=snapshot.raw_summary,
                    vehicle_context=vehicle_context
                )
            except Exception as e:
                logger.error("Alert dispatch failed: %s", e)

        return EventDecision(
            event=event,
            created=created,
            updated=updated,
            should_dispatch_alert=should_dispatch_alert,
            suppression_reason=suppression_reason,
            cooldown_expires_at=cooldown_expires_at
        )

    async def _evaluate_alert_dispatch(self, event: DetectionEvent, snapshot: EventSnapshot) -> tuple[bool, str | None, datetime | None, dict | None]:
        """
        Determines if a Discord alert should be fired.
        Logic:
          - MUST be on watchlist (fuzzy match)
          - MUST NOT be in cooldown
        """
        async with self.repository.session_factory() as session:
            rows = await session.execute(text("SELECT plate, vehicle_color, vehicle_type, vehicle_make FROM watchlist"))
            watchlist = rows.fetchall()

        match_found = False
        matched_row = None
        p_norm = snapshot.plate_normalized
        
        for row in watchlist:
            w_plate = row[0].upper().replace(" ", "")
            # Fuzzy match: same length, at most 1 char difference
            if len(p_norm) == len(w_plate):
                mismatches = sum(1 for c1, c2 in zip(p_norm, w_plate) if c1 != c2)
                if mismatches <= 1:
                    match_found = True
                    matched_row = row
                    break

        if not match_found:
            return False, "not_on_watchlist", None, None

        # Build vehicle profile comparison context
        vehicle_context = _build_vehicle_context(
            detected_color=snapshot.vehicle_color,
            detected_type=snapshot.vehicle_type,
            cdc_label=snapshot.cdc_label,
            expected_color=matched_row[1] if matched_row else None,
            expected_type=matched_row[2] if matched_row else None,
            expected_make=matched_row[3] if matched_row else None,
        )

        # Reduce reported confidence when detected vehicle doesn't match watchlist profile
        penalty = vehicle_context.get("mismatch_penalty", 0.0)
        vehicle_context["effective_confidence"] = round(
            max(0.0, snapshot.aggregate_confidence - penalty), 2
        )

        # Check Cooldown
        current_status = event.get('status') if isinstance(event, dict) else event.status
        if current_status == EventStatus.ALERTED.value:
            updated_at = event.get('updated_at') if isinstance(event, dict) else event.updated_at
            base_time = updated_at or datetime.now(timezone.utc)
            cooldown_expires_at = base_time + timedelta(seconds=self.alert_cooldown_seconds)
            if datetime.now(timezone.utc) < cooldown_expires_at:
                return False, "cooldown_active", cooldown_expires_at, vehicle_context

        return True, None, None, vehicle_context

    def _build_create_payload(self, snapshot: EventSnapshot) -> DetectionEventCreate:
        return DetectionEventCreate(
            drone_id=snapshot.drone_id, status=snapshot.status, classification=snapshot.classification,
            plate_best=snapshot.plate_best, plate_normalized=snapshot.plate_normalized,
            average_confidence=snapshot.aggregate_confidence, first_seen=snapshot.first_seen_at,
            last_seen=snapshot.last_seen_at, best_frame_id=snapshot.best_frame_id,
            detection_count=snapshot.detection_count, distinct_frame_count=snapshot.distinct_frame_count,
            location_centroid=snapshot.location_centroid, raw_summary=snapshot.raw_summary,
            dedupe_key=snapshot.group_key, review_recommended=True
        )

    def _build_update_fields(self, event: DetectionEvent, snapshot: EventSnapshot) -> dict:
        curr_last = event.get('last_seen_at') if isinstance(event, dict) else event.last_seen_at
        return {
            "plate_best": snapshot.plate_best,
            "aggregate_confidence": snapshot.aggregate_confidence,
            "last_seen_at": max(curr_last, snapshot.last_seen_at),
            "updated_at": datetime.now(timezone.utc)
        }

    async def _find_recent_reopen_candidate(self, snapshot: EventSnapshot) -> DetectionEvent | None:
        since = snapshot.first_seen_at - timedelta(seconds=self.reopen_window_seconds)
        return await self.repository.get_recent_event_by_plate(drone_id=snapshot.drone_id, plate_normalized=snapshot.plate_normalized, since=since)


_COLOR_MISMATCH_PENALTY = 12.0
_TYPE_MISMATCH_PENALTY  = 8.0


def _build_vehicle_context(
    *,
    detected_color: str | None,
    detected_type: str | None,
    cdc_label: str | None,
    expected_color: str | None,
    expected_type: str | None,
    expected_make: str | None,
) -> dict:
    """
    Compares YOLO + CDC detected vehicle attributes against the watchlist profile.
    Also computes mismatch_penalty (pts to subtract from aggregate_confidence).
    """
    def _match(detected: str | None, expected: str | None) -> bool | None:
        if not expected:
            return None
        if not detected:
            return None
        return detected.lower() == expected.lower()

    color_match = _match(detected_color, expected_color)
    type_match  = _match(detected_type,  expected_type)

    # CDC Match — check if expected make appears in the CDC generational label
    cdc_match = None
    if expected_make and cdc_label:
        cdc_match = expected_make.lower() in cdc_label.lower()

    any_mismatch = (color_match is False) or (type_match is False) or (cdc_match is False)
    any_confirmed = (color_match is True) or (type_match is True) or (cdc_match is True)

    mismatch_penalty = 0.0
    if color_match is False:
        mismatch_penalty += _COLOR_MISMATCH_PENALTY
    if type_match is False:
        mismatch_penalty += _TYPE_MISMATCH_PENALTY

    return {
        "detected_color":  detected_color,
        "detected_type":   detected_type,
        "cdc_label":       cdc_label,
        "expected_color":  expected_color,
        "expected_type":   expected_type,
        "expected_make":   expected_make,
        "color_match":     color_match,
        "type_match":      type_match,
        "cdc_match":       cdc_match,
        "any_mismatch":    any_mismatch,
        "any_confirmed":   any_confirmed,
        "mismatch_penalty": mismatch_penalty,
    }
