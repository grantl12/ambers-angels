"""
backend/services/alert_dispatcher.py

Dispatches watchlist-hit alerts to Discord (and optionally logs to DB).

When a saved frame is available it is attached to the Discord message as an
image embed so operators can see the triggering photo inline.
"""
import json
import logging
import os
import urllib.parse
import httpx

logger = logging.getLogger(__name__)
from datetime import datetime, timezone
from typing import Any, Optional

from services.detection_models import AlertCreate

SMS_CONFIDENCE_THRESHOLD = float(os.getenv("SMS_CONFIDENCE_THRESHOLD", "90"))

# Tier → Discord embed color (decimal)
_ALERT_COLORS = {
    "amber":   0xF59E0B,
    "silver":  0x94A3B8,
    "matties": 0xEF4444,
    "blue":    0x3B82F6,
    "purple":  0x7C3AED,
    "mipa":    0xEAB308,
    "ema":     0xD97706,
}
_DEFAULT_COLOR = 0xF59E0B

# Max file size Discord accepts on a free webhook (8 MB)
_MAX_BYTES = 8 * 1024 * 1024


class AlertDispatcher:
    def __init__(
        self,
        repository,
        webhook_url: Optional[str] = None,
        golden_dir: Optional[str] = None,
    ):
        self.repository  = repository
        self.webhook_url = webhook_url or os.getenv("ALERT_WEBHOOK_URL", "")
        self.golden_dir  = golden_dir  or os.getenv(
            "GOLDEN_DIR",
            os.path.join(os.path.dirname(__file__), "..", "test_plates", "golden_frames"),
        )

    async def dispatch_alert(
        self,
        *,
        plate: str,
        drone_id: str,
        confidence: float,
        timestamp: Any = None,
        location: Optional[dict] = None,
        frame_id: Any = None,
        raw_summary: Any = None,
        vehicle_context: Optional[dict] = None,
    ) -> None:
        """Keyword-arg entry point used by EventService."""
        event_dict = {
            "plate_best": plate,
            "drone_id": drone_id,
            "confidence": confidence,
            "frame_url": f"/frames/{frame_id}" if frame_id else None,
            "alert_type": None,
        }
        await self.dispatch(event_dict, vehicle_context=vehicle_context, location=location)

    async def dispatch(self, event: Any, *, vehicle_context: Optional[dict] = None, location: Optional[dict] = None) -> None:
        """
        Fan-out: log to DB (if repository available) and send Discord webhook.
        Accepts both dict and Pydantic/dataclass event objects.
        """
        is_dict    = isinstance(event, dict)
        plate      = event.get("plate_best")  if is_dict else getattr(event, "plate_best",  "UNKNOWN")
        drone_id   = event.get("drone_id")    if is_dict else getattr(event, "drone_id",    "UNKNOWN")
        event_id   = event.get("id")          if is_dict else getattr(event, "id",           None)
        frame_url  = event.get("frame_url")   if is_dict else getattr(event, "frame_url",   None)
        alert_type = event.get("alert_type")  if is_dict else getattr(event, "alert_type",  None)
        confidence = event.get("confidence")  if is_dict else getattr(event, "confidence",  None)

        logger.info("Dispatching alert — Plate: %s | Drone: %s", plate, drone_id)

        # 1. Optional DB logging
        if self.repository is not None and hasattr(self.repository, "create_alert"):
            try:
                await self.repository.create_alert(
                    event_id=event_id,
                    plate=plate,
                    drone_id=drone_id,
                    channel="DISCORD",
                )
            except Exception as e:
                logger.warning("DB alert log failed: %s", e)

        # 2. Discord webhook
        if not self.webhook_url:
            logger.warning("No webhook URL configured — skipping Discord dispatch.")
            return

        frame_bytes = self._load_frame(frame_url)
        color       = _ALERT_COLORS.get((alert_type or "").lower(), _DEFAULT_COLOR)
        conf_str    = f"{confidence:.0f}%" if confidence else "—"
        ts_str      = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

        embed = {
            "title":       "🚨 WATCHLIST MATCH",
            "color":       color,
            "fields": [
                {"name": "Plate",      "value": f"`{plate}`",  "inline": True},
                {"name": "Drone",      "value": drone_id,      "inline": True},
                {"name": "Confidence", "value": conf_str,      "inline": True},
            ],
            "footer": {"text": ts_str},
        }

        if alert_type:
            embed["fields"].insert(0, {"name": "Alert type", "value": alert_type.upper(), "inline": True})

        if location:
            lat  = location.get("lat")
            lng  = location.get("lng")
            alt  = location.get("altitude")
            acc  = location.get("accuracy")
            maps_url = f"https://www.google.com/maps?q={lat},{lng}"
            loc_parts = [f"[{lat:.5f}, {lng:.5f}]({maps_url})"]
            if alt is not None and alt > 0:
                loc_parts.append(f"{alt:.0f}m MSL")
            if acc is not None and acc > 0:
                loc_parts.append(f"±{acc:.0f}m")
            embed["fields"].append({
                "name":   "Location",
                "value":  "  ".join(loc_parts),
                "inline": False,
            })

        if vehicle_context:
            embed["fields"].append(_vehicle_context_field(vehicle_context))

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                if frame_bytes:
                    # Attach image and reference it in the embed
                    embed["image"] = {"url": "attachment://frame.jpg"}
                    resp = await client.post(
                        self.webhook_url,
                        data={"payload_json": json.dumps({"embeds": [embed]})},
                        files={"file": ("frame.jpg", frame_bytes, "image/jpeg")},
                    )
                else:
                    resp = await client.post(self.webhook_url, json={"embeds": [embed]})

                if resp.status_code in (200, 204):
                    attached = "with frame" if frame_bytes else "text-only"
                    logger.info("Discord dispatch successful for %s (%s)", plate, attached)
                else:
                    logger.error("Discord returned %s: %s", resp.status_code, resp.text[:200])
            except Exception as e:
                logger.error("Network error sending to Discord: %s", e)

        # 3. SMS — fires when confidence meets threshold and Twilio is configured
        if confidence and confidence >= SMS_CONFIDENCE_THRESHOLD:
            await self._send_sms(plate, confidence, drone_id, location, alert_type)

    # -------------------------------------------------------------------------

    async def _send_sms(
        self,
        plate: str,
        confidence: float,
        drone_id: str,
        location: Optional[dict],
        alert_type: Optional[str],
    ) -> None:
        """Send SMS via Twilio when a plate is confirmed at high confidence."""
        sid    = os.getenv("TWILIO_ACCOUNT_SID", "")
        token  = os.getenv("TWILIO_AUTH_TOKEN", "")
        from_  = os.getenv("TWILIO_FROM", "")
        nums   = [n.strip() for n in os.getenv("SMS_ALERT_NUMBERS", "").split(",") if n.strip()]
        if not all([sid, token, from_, nums]):
            return

        lat = location.get("lat") if location else None
        lon = location.get("lon") or (location.get("lng") if location else None)
        maps_line = f"https://maps.google.com/maps?q={lat},{lon}\n" if lat and lon else ""

        body = (
            f"WATCHLIST HIT — {(alert_type or 'AMBER').upper()}\n"
            f"Plate: {plate}\n"
            f"Confidence: {confidence:.0f}%\n"
            f"Drone: {drone_id}\n"
            f"{maps_line}"
            f"— Amber's Angels"
        )

        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
        import base64
        auth = base64.b64encode(f"{sid}:{token}".encode()).decode()

        async with httpx.AsyncClient(timeout=10.0) as client:
            for to in nums:
                try:
                    resp = await client.post(
                        url,
                        headers={
                            "Authorization": f"Basic {auth}",
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                        content=urllib.parse.urlencode({"From": from_, "To": to, "Body": body}).encode(),
                    )
                    if resp.status_code in (200, 201):
                        logger.info("SMS sent to %s for plate %s", to, plate)
                    else:
                        logger.warning("Twilio SMS to %s returned %s", to, resp.status_code)
                except Exception as e:
                    logger.error("SMS send error: %s", e)

    # -------------------------------------------------------------------------

    def _load_frame(self, frame_url: Optional[str]) -> Optional[bytes]:
        """
        Resolve /frames/{uuid}.jpg → GOLDEN_DIR/{uuid}.jpg and read bytes.
        Returns None if not found or too large for Discord.
        """
        if not frame_url:
            return None
        # frame_url is "/frames/<uuid>" or "/frames/<uuid>.jpg"
        filename = os.path.basename(frame_url)
        if not os.path.splitext(filename)[1]:
            filename += ".jpg"
        path = os.path.join(self.golden_dir, filename)
        if not os.path.isfile(path):
            # Worker saves as alert_<plate>_<filename> — try glob fallback
            import glob as _glob
            matches = _glob.glob(os.path.join(self.golden_dir, f"*_{filename}"))
            if not matches:
                return None
            path = max(matches, key=os.path.getmtime)
        size = os.path.getsize(path)
        if size > _MAX_BYTES:
            logger.warning("Frame %s is %dKB — too large for Discord, skipping.", filename, size // 1024)
            return None
        try:
            with open(path, "rb") as f:
                return f.read()
        except Exception as e:
            logger.warning("Could not read frame %s: %s", path, e)
            return None


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def _vehicle_context_field(ctx: dict) -> dict:
    """
    Builds a Discord embed field summarising YOLO + CDC vehicle attributes.
    """
    detected_color = ctx.get("detected_color")
    detected_type  = ctx.get("detected_type")
    cdc_label      = ctx.get("cdc_label")

    # Format CDC label (e.g. "Toyota_Camry_XV70" -> "Toyota Camry XV70")
    cdc_fmt = cdc_label.replace("_", " ") if cdc_label else None
    
    detected_str = f"{detected_color or ''} {detected_type or ''}".strip() or "unknown"
    if cdc_fmt:
        detected_str = f"{detected_str} ({cdc_fmt})"

    color_match = ctx.get("color_match")
    type_match  = ctx.get("type_match")
    cdc_match   = ctx.get("cdc_match")
    
    any_mismatch   = ctx.get("any_mismatch", False)
    any_confirmed  = ctx.get("any_confirmed", False)

    expected_parts = [p for p in [ctx.get("expected_color"), ctx.get("expected_type"), ctx.get("expected_make")] if p]

    if not expected_parts:
        verdict = "(no profile on file)"
    elif any_mismatch:
        expected_str = " ".join(expected_parts)
        verdict = f"⚠️ profile expects **{expected_str}**"
    elif any_confirmed:
        # Give CDC match extra weight in the UI
        if cdc_match is True:
            verdict = "✅ **GENERATIONAL MATCH CONFIRMED**"
        else:
            verdict = "✓ matches profile"
    else:
        verdict = "(profile present, unable to compare)"

    return {
        "name":   "Vehicle (YOLO + CDC Cascade)",
        "value":  f"{detected_str}\n{verdict}",
        "inline": False,
    }
