import os
import httpx
from datetime import datetime, timezone
from typing import Any
from services.detection_models import DetectionEvent, AlertCreate

class AlertDispatcher:
    def __init__(self, repository, webhook_url: str):
        self.repository = repository
        self.webhook_url = webhook_url

    async def dispatch(self, event: Any):
        # Handle both dict and object types for the event
        is_dict = isinstance(event, dict)
        plate = event.get('plate_best') if is_dict else event.plate_best
        drone_id = event.get('drone_id') if is_dict else event.drone_id
        event_id = event.get('id') if is_dict else event.id

        print(f"[LOUD DEBUG] 🚀 Dispatching alert for Plate: {plate}")

        # 1. Create the Alert Record for the Database
        try:
            alert_data = AlertCreate(
                alert_type='WATCHLIST_MATCH',
                severity='CRITICAL',
                message=f"Target Plate {plate} Detected",
                event_id=event_id,
                plate_text=plate,
                drone_id=drone_id,
                sent_at=datetime.now(timezone.utc)
            )
            
            # Log to DB
            if hasattr(self.repository, 'create_alert'):
                await self.repository.create_alert(
                    event_id=event_id,
                    plate=plate,
                    drone_id=drone_id,
                    channel="DISCORD"
                )
        except Exception as e:
            print(f"[LOUD DEBUG] ⚠️ Alert Record Creation Failed: {e}")

        # 2. Send to Discord
        async with httpx.AsyncClient() as client:
            payload = {
                "content": f"🚨 **AMBER ALERT: TARGET MATCH** 🚨\n**Plate:** {plate}\n**Drone:** {drone_id}\n**Time:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            }
            try:
                resp = await client.post(self.webhook_url, json=payload)
                if resp.status_code == 204 or resp.status_code == 200:
                    print(f"[LOUD DEBUG] ✅ Discord Dispatch Successful for {plate}")
                else:
                    print(f"[LOUD DEBUG] ❌ Discord returned error {resp.status_code}: {resp.text}")
            except Exception as e:
                print(f"[LOUD DEBUG] ❌ Network Error sending to Discord: {e}")

