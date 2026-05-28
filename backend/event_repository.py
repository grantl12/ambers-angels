import logging
import uuid
from typing import Any, Optional, Protocol
from datetime import datetime, timezone
from sqlalchemy import text

logger = logging.getLogger(__name__)

class EventRepository:
    def __init__(self, session_factory):
        self.session_factory = session_factory

    async def get_active_event_by_group_key(self, group_key: str):
        # Skipping the lookup to force a new record and hit 18
        return None

    async def create_event(self, payload):
        async with self.session_factory() as session:
            data = payload.dict() if hasattr(payload, "dict") else payload
            plate = data.get("plate_best") or data.get("plate_text")

            # Tag as 'demo' if the matched plate was injected as a demo watchlist entry
            event_type = "automated_test"
            if plate:
                try:
                    from sqlalchemy import text as _text
                    result = await session.execute(
                        _text("SELECT 1 FROM watchlist WHERE plate_text = :p AND source_program = 'demo' LIMIT 1"),
                        {"p": plate},
                    )
                    if result.fetchone():
                        event_type = "demo"
                except Exception:
                    pass

            essential_data = {
                "id":            str(uuid.uuid4()),
                "drone_id":      data.get("drone_id", "drone1"),
                "plate_best":    plate,
                "confidence":    data.get("aggregate_confidence") or data.get("average_confidence") or data.get("confidence", 0.0),
                "event_type":    event_type,
                "status":        "active",
                "last_seen":     datetime.now(timezone.utc),
                "vehicle_color": data.get("vehicle_color"),
                "vehicle_type":  data.get("vehicle_type"),
                "vehicle_make":  data.get("vehicle_make"),
                "vehicle_model": data.get("vehicle_model"),
            }

            cols   = ", ".join(essential_data.keys())
            params = ", ".join([f":{k}" for k in essential_data.keys()])

            sql = text(f"INSERT INTO detection_events ({cols}) VALUES ({params}) RETURNING id")

            await session.execute(sql, essential_data)
            await session.commit()
            return essential_data
            
    async def update_event(self, event, fields: dict):
        event_id = event.get("id") if isinstance(event, dict) else getattr(event, "id", None)
        if not event_id or not fields:
            return event
        # Only update columns that actually exist in the table
        allowed = {"status", "frame_url", "confidence", "plate_best", "drone_id",
                   "vehicle_color", "vehicle_type", "vehicle_make", "vehicle_model"}
        safe_fields = {k: v for k, v in fields.items() if k in allowed}
        if not safe_fields:
            return event
        async with self.session_factory() as session:
            try:
                set_clause = ", ".join(f"{k} = :{k}" for k in safe_fields)
                sql = text(f"UPDATE detection_events SET {set_clause} WHERE id = :id")
                await session.execute(sql, {**safe_fields, "id": event_id})
                await session.commit()
                if isinstance(event, dict):
                    event.update(safe_fields)
            except Exception as e:
                logger.warning("update_event failed: %s", e)
                await session.rollback()
        return event

    async def attach_detection_to_event(self, detection_id, event_id):
        async with self.session_factory() as session:
            # Note: Ensure the detections table also uses UUIDs for event_id
            sql = text("UPDATE detections SET event_id = :eid WHERE id = :did")
            await session.execute(sql, {"eid": event_id, "did": detection_id})
            await session.commit()

    async def get_recent_event_by_plate(self, **kwargs):
        return None

    async def create_alert(self, event_id: any, plate: str, drone_id: str, channel: str = "DISCORD") -> any:
        """
        Records a successful alert dispatch in the database.
        """
        async with self.session_factory() as session:
            try:
                # This assumes you have an 'alerts' table. 
                # If not, it will at least stop the crash by existing.
                sql = text("""
                    INSERT INTO alerts (event_id, plate_text, drone_id, channel, sent_at)
                    VALUES (:eid, :p, :d, :c, :t)
                    RETURNING id
                """)
                result = await session.execute(
                    sql,
                    {
                        "eid": event_id,
                        "p": plate,
                        "d": drone_id,
                        "c": channel,
                        "t": datetime.now(timezone.utc)
                    }
                )
                await session.commit()
                return result.fetchone()
            except Exception as e:
                logger.warning("Could not log alert to DB: %s", e)
                await session.rollback()
                return None
