from __future__ import annotations
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol, Any
from uuid import UUID
from sqlalchemy import text

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
        print(f"\n[LOUD DEBUG] 📥 Processing Snapshot: {snapshot.plate_best} (Confidence: {snapshot.aggregate_confidence})")
        
        if not snapshot.should_open_event:
            print("[LOUD DEBUG] 🛑 Snapshot rejected: 'should_open_event' is False.")
            return None

        # 1. Database Lookup
        existing = await self.repository.get_active_event_by_group_key(snapshot.group_key)
        if existing is None:
            existing = await self._find_recent_reopen_candidate(snapshot)

        if existing is None:
            print(f"[LOUD DEBUG] ✨ Creating NEW event for {snapshot.plate_best}")
            event = await self.repository.create_event(self._build_create_payload(snapshot))
            created, updated = True, False
        else:
            print(f"[LOUD DEBUG] 🔄 Updating EXISTING event ID: {existing.get('id') if isinstance(existing, dict) else existing.id}")
            event = await self.repository.update_event(existing, self._build_update_fields(existing, snapshot))
            created, updated = False, True

        # 2. EVALUATE ALERT (The Logic Gate)
        should_dispatch_alert, suppression_reason, cooldown_expires_at = await self._evaluate_alert_dispatch(
            event=event,
            snapshot=snapshot
        )

        # 3. DISPATCH TO DISCORD
        if should_dispatch_alert:
            print(f"[LOUD DEBUG] 🚨 ALERT TRIGGERED for {snapshot.plate_best}!")
            
            # Update status to ALERTED in DB
            event = await self.repository.update_event(
                event,
                {"status": EventStatus.ALERTED.value, "updated_at": datetime.now(timezone.utc)}
            )

            try:
                print(f"[LOUD DEBUG] 📡 Pinging Discord Dispatcher...")
                await self.dispatcher.dispatch(event)
                print(f"[LOUD DEBUG] ✅ Discord Dispatch Successful.")
            except Exception as e:
                print(f"[LOUD DEBUG] ❌ Discord Dispatch FAILED: {e}")
        else:
            print(f"[LOUD DEBUG] ℹ️ Alert Suppressed. Reason: {suppression_reason}")

        # 4. TRACE RECORD (The Sequence Keeper)
        try:
            async with self.repository.session_factory() as session:
                # Removed the "Sequence 18" hardcoded text for clarity
                sql = text("INSERT INTO detections (drone_id, plate_text, confidence, detected_at) VALUES (:d, :p, :c, :t)")
                await session.execute(sql, {"d": snapshot.drone_id, "p": snapshot.plate_best, "c": snapshot.aggregate_confidence, "t": datetime.now(timezone.utc)})
                await session.commit()
                print(f"[LOUD DEBUG] 📊 Trace record saved to 'detections' table.")
        except Exception as e:
            print(f"[LOUD DEBUG] ⚠️ Trace record failed: {e}")

        return EventDecision(event, created, updated, should_dispatch_alert, suppression_reason, cooldown_expires_at)

    async def _evaluate_alert_dispatch(self, *, event: DetectionEvent, snapshot: EventSnapshot) -> tuple[bool, str | None, datetime | None]:
        # --- FUZZY WATCHLIST LOGIC ---
        # We manually check the watchlist here to bypass any Aggregator misses
        plate = snapshot.plate_best.upper()
        async with self.repository.session_factory() as session:
            # Check if our detected plate is part of a watchlist plate OR vice versa
            res = await session.execute(
                text("SELECT plate_text FROM watchlist WHERE :p LIKE '%' || plate_text || '%' OR plate_text LIKE '%' || :p || '%'"),
                {"p": plate}
            )
            match = res.fetchone()
            
        if not match:
            return False, "not_on_watchlist", None

        print(f"[LOUD DEBUG] 🎯 Watchlist Match Confirmed: {plate} matches {match[0]}")

        # Check Cooldown
        current_status = event.get('status') if isinstance(event, dict) else event.status
        if current_status == EventStatus.ALERTED.value:
            updated_at = event.get('updated_at') if isinstance(event, dict) else event.updated_at
            base_time = updated_at or datetime.now(timezone.utc)
            cooldown_expires_at = base_time + timedelta(seconds=self.alert_cooldown_seconds)
            
            if datetime.now(timezone.utc) < cooldown_expires_at:
                return False, "cooldown_active", cooldown_expires_at

        return True, None, None

    # --- Helper methods remain largely the same but updated for dict safety ---
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

    @staticmethod
    def _classification_rank(value: Any) -> int:
        ranks = {EventClassification.WEAK: 0, EventClassification.PROBABLE: 1, EventClassification.HIGH_CONFIDENCE: 2}
        return ranks.get(value if isinstance(value, EventClassification) else EventClassification(value), 0)
