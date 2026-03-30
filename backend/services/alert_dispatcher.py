"""
backend/services/alert_dispatcher.py

Dispatches watchlist-hit alerts to Discord (and optionally logs to DB).
Handles both dict-style and object-style event inputs.
"""
import os
import httpx
from datetime import datetime, timezone
from typing import Any, Optional

from services.detection_models import AlertCreate


class AlertDispatcher:
    def __init__(self, repository, webhook_url: Optional[str] = None):
        """
        Args:
            repository: An EventRepository instance for DB logging, or None
                        to skip DB logging (useful for the singleton in alert_service.py).
            webhook_url: Discord (or other) webhook URL. Falls back to
                         ALERT_WEBHOOK_URL env var if not provided here.
        """
        self.repository = repository
        self.webhook_url = webhook_url or os.getenv("ALERT_WEBHOOK_URL", "")

    async def dispatch(self, event: Any) -> None:
        """
        Fan-out: log to DB (if repository available) and send Discord webhook.
        Accepts both dict and Pydantic/dataclass event objects.
        """
        is_dict = isinstance(event, dict)
        plate    = event.get('plate_best') if is_dict else getattr(event, 'plate_best', 'UNKNOWN')
        drone_id = event.get('drone_id')   if is_dict else getattr(event, 'drone_id',   'UNKNOWN')
        event_id = event.get('id')         if is_dict else getattr(event, 'id',          None)

        print(f"[AlertDispatcher] 🚨 Dispatching alert — Plate: {plate} | Drone: {drone_id}")

        # 1. Optional DB logging
        if self.repository is not None and hasattr(self.repository, 'create_alert'):
            try:
                await self.repository.create_alert(
                    event_id=event_id,
                    plate=plate,
                    drone_id=drone_id,
                    channel="DISCORD"
                )
            except Exception as e:
                print(f"[AlertDispatcher] ⚠️  DB alert log failed: {e}")

        # 2. Discord webhook
        if not self.webhook_url:
            print("[AlertDispatcher] ⚠️  No webhook URL configured — skipping Discord dispatch.")
            return

        payload = {
            "content": (
                f"🚨 **AMBER ALERT: TARGET MATCH** 🚨\n"
                f"**Plate:** `{plate}`\n"
                f"**Drone:** {drone_id}\n"
                f"**Time:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"
            )
        }

        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                resp = await client.post(self.webhook_url, json=payload)
                if resp.status_code in (200, 204):
                    print(f"[AlertDispatcher] ✅ Discord dispatch successful for {plate}")
                else:
                    print(f"[AlertDispatcher] ❌ Discord returned {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                print(f"[AlertDispatcher] ❌ Network error sending to Discord: {e}")
