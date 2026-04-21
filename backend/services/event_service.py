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
                    c = snapshot.location_centroid
                    lat = c.get("lat") or c.get("latitude")
                    lng = c.get("lon") or c.get("lng") or c.get("longitude")
                    if lat is not None and lng is not None:
                        location = {
                            "lat":      lat,
                            "lng":      lng,
                            "altitude": c.get("alt") or c.get("altitude"),
                            "accuracy": c.get("accuracy"),
                        }
                await self.dispatcher.dispatch(event, vehicle_context=vehicle_context, location=location)
                logger.info("Discord dispatch successful for %s", snapshot.plate_best)
            except Exception as e:
                logger.error("Discord dispatch failed: %s", e)
        else:
            logger.debug("Alert suppressed: %s", suppression_reason)

        # 4. TRACE RECORD
        try:
            async with self.repository.session_factory() as session:
                sql = text("INSERT INTO detections (drone_id, plate_text, confidence, detected_at) VALUES (:d, :p, :c, :t)")
                await session.execute(sql, {"d": snapshot.drone_id, "p": snapshot.plate_best, "c": snapshot.aggregate_confidence, "t": datetime.now(timezone.utc)})
                await session.commit()
        except Exception as e:
            logger.warning("Trace record failed: %s", e)

        return EventDecision(event, created, updated, should_dispatch_alert, suppression_reason, cooldown_expires_at)

    async def _evaluate_alert_dispatch(self, *, event: DetectionEvent, snapshot: EventSnapshot) -> tuple[bool, str | None, datetime | None, dict | None]:
        def get_similarity(a, b):
            return SequenceMatcher(None, a, b).ratio()

        plate = snapshot.plate_best.upper()
        async with self.repository.session_factory() as session:
            res = await session.execute(text(
                "SELECT plate_text, vehicle_color, vehicle_type, vehicle_make FROM watchlist"
            ))
            rows = res.fetchall()

        match_found = None
        matched_row = None
        for row in rows:
            target = row[0]
            target_up = target.upper()
            similarity = get_similarity(plate, target_up)
            if similarity >= 0.7 or target_up in plate or plate in target_up:
                match_found = target
                matched_row = row
                logger.info("Fuzzy match: %s matches %s (similarity: %.2f)", plate, target, similarity)
                break

        if not match_found:
            return False, "not_on_watchlist", None, None

        # Build vehicle profile comparison context
        vehicle_context = _build_vehicle_context(
            detected_color=snapshot.vehicle_color,
            detected_type=snapshot.vehicle_type,
            expected_color=matched_row[1] if matched_row else None,
            expected_type=matched_row[2] if matched_row else None,
            expected_make=matched_row[3] if matched_row else None,
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


def _build_vehicle_context(
    *,
    detected_color: str | None,
    detected_type: str | None,
    expected_color: str | None,
    expected_type: str | None,
    expected_make: str | None,
) -> dict:
    """
    Compares YOLO-detected vehicle attributes against the watchlist profile.

    match values:
      True  → attributes present on both sides and agree
      False → attributes present on both sides and disagree
      None  → watchlist has no expectation for this attribute (can't compare)
    """
    def _match(detected: str | None, expected: str | None) -> bool | None:
        if not expected:
            return None  # no expectation → nothing to flag
        if not detected:
            return None  # YOLO didn't detect this → can't compare
        return detected.lower() == expected.lower()

    color_match = _match(detected_color, expected_color)
    type_match  = _match(detected_type,  expected_type)

    any_mismatch = (color_match is False) or (type_match is False)
    any_confirmed = (color_match is True) or (type_match is True)

    return {
        "detected_color":  detected_color,
        "detected_type":   detected_type,
        "expected_color":  expected_color,
        "expected_type":   expected_type,
        "expected_make":   expected_make,
        "color_match":     color_match,
        "type_match":      type_match,
        "any_mismatch":    any_mismatch,
        "any_confirmed":   any_confirmed,
    }
