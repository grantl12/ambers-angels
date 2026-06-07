"""
Detection agent: evaluates PROBABLE detections (75–85% confidence) using
Claude Haiku with tool use. Only invoked when the static pipeline doesn't
alert and an active FEMA alert exists in the same geographic area.

Cost model: ~$0.0013 per invocation (Haiku 4.5 pricing). Gates ensure the
API is only called when a human coordinator would plausibly care.
"""
from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import anthropic

logger = logging.getLogger(__name__)

MODEL = "claude-haiku-4-5-20251001"

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    return _client


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

TOOLS: list[dict] = [
    {
        "name": "get_active_alerts",
        "description": (
            "Returns all currently active AMBER/Silver/Blue/Purple alerts with vehicle "
            "profiles (plate, color, type, make), area description, and centroid coordinates."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_recent_detections",
        "description": (
            "Returns detection history for a plate in the last N minutes — "
            "confidence values, timestamps, drone sources, and vehicle attributes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "plate": {
                    "type": "string",
                    "description": "Normalized plate text (alphanumeric, uppercase, no spaces)",
                },
                "minutes": {"type": "integer", "default": 10},
            },
            "required": ["plate"],
        },
    },
    {
        "name": "dispatch_alert",
        "description": (
            "Escalate this detection to a full alert (Discord + Expo push). "
            "Only call when you are confident the plate matches an active alert vehicle. "
            "Include clear reasoning — coordinators see it in the Discord embed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "plate": {"type": "string"},
                "confidence": {
                    "type": "number",
                    "description": "Your assessed confidence 0–100",
                },
                "alert_type": {
                    "type": "string",
                    "description": "e.g. amber, silver, blue (from the matched alert)",
                },
                "reasoning": {
                    "type": "string",
                    "description": "Why you are escalating — be specific about which signals aligned",
                },
            },
            "required": ["plate", "confidence", "reasoning"],
        },
    },
    {
        "name": "reposition_drone",
        "description": (
            "Command the drone to move to a new observation point for a better plate read. "
            "Use when confidence is borderline and the drone can safely reposition."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "obs_lat": {"type": "number"},
                "obs_lon": {"type": "number"},
                "reason": {"type": "string"},
            },
            "required": ["obs_lat", "obs_lon", "reason"],
        },
    },
    {
        "name": "request_edge_inference",
        "description": (
            "Request on-device plate/vehicle inference from drone hardware. "
            "Reserved for future Intel edge compute integration — not yet active."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "drone_id": {"type": "string"},
                "inference_type": {
                    "type": "string",
                    "enum": ["plate", "vehicle_classification"],
                },
            },
            "required": ["drone_id", "inference_type"],
        },
    },
]


# ---------------------------------------------------------------------------
# DB-backed tool implementations (no HTTP — avoids auth headers)
# ---------------------------------------------------------------------------

async def _tool_get_active_alerts() -> list[dict]:
    import database
    from sqlalchemy import text

    async with database.AsyncSessionLocal() as session:
        rows = (await session.execute(text("""
            SELECT
                vt.alert_type, vt.source_program, vt.headline, vt.area,
                vt.centroid_lat, vt.centroid_lng, vt.expires_at,
                wl.plate_text, wl.vehicle_color, wl.vehicle_type, wl.vehicle_make
            FROM vehicle_targets vt
            LEFT JOIN watchlist wl
                ON wl.active = TRUE AND wl.plate_text IS NOT NULL
            WHERE (vt.expires_at IS NULL OR vt.expires_at > NOW())
            ORDER BY vt.added_at DESC
            LIMIT 30
        """))).fetchall()

    seen: set[tuple] = set()
    results: list[dict] = []
    for r in rows:
        key = (r[0], r[3], r[7])
        if key in seen:
            continue
        seen.add(key)
        results.append({
            "alert_type":     r[0],
            "source_program": r[1],
            "headline":       r[2],
            "area":           r[3],
            "centroid_lat":   float(r[4]) if r[4] is not None else None,
            "centroid_lng":   float(r[5]) if r[5] is not None else None,
            "expires_at":     r[6].isoformat() if r[6] else None,
            "plate":          r[7],
            "vehicle_color":  r[8],
            "vehicle_type":   r[9],
            "vehicle_make":   r[10],
        })
    return results


async def _tool_get_recent_detections(plate: str, minutes: int = 10) -> list[dict]:
    import database
    from sqlalchemy import text

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    async with database.AsyncSessionLocal() as session:
        rows = (await session.execute(text("""
            SELECT plate_best, drone_id, status, confidence,
                   last_seen, vehicle_color, vehicle_type
            FROM detection_events
            WHERE plate_normalized = :plate AND last_seen >= :since
            ORDER BY last_seen DESC
            LIMIT 20
        """), {"plate": plate, "since": since})).fetchall()
    return [
        {
            "plate":         r[0],
            "drone_id":      r[1],
            "status":        r[2],
            "confidence":    float(r[3]) if r[3] is not None else None,
            "last_seen":     r[4].isoformat() if r[4] else None,
            "vehicle_color": r[5],
            "vehicle_type":  r[6],
        }
        for r in rows
    ]


async def _tool_reposition_drone(drone_id: str, obs_lat: float, obs_lon: float) -> str:
    import certifi
    import httpx

    internal_key = os.getenv("INTERNAL_API_KEY", "")
    try:
        async with httpx.AsyncClient(verify=certifi.where(), timeout=5.0) as c:
            r = await c.post(
                "http://127.0.0.1:8000/autonomous/plan",
                json={
                    "drone_id": drone_id,
                    "observation_lat": obs_lat,
                    "observation_lon": obs_lon,
                    "operation_mode": "vlos",
                },
                headers={"X-Internal-Key": internal_key},
            )
            return f"HTTP {r.status_code}"
    except Exception as exc:
        return f"failed: {exc}"


# ---------------------------------------------------------------------------
# Cost gate — haversine proximity check
# ---------------------------------------------------------------------------

def _near_any_alert(location: tuple[float, float] | None, alerts: list[dict]) -> bool:
    """True if detection is within 50 km of any active alert centroid."""
    if not alerts:
        return False
    if not location:
        return True  # can't filter without location, pass through
    lat, lng = location
    for a in alerts:
        a_lat = a.get("centroid_lat")
        a_lng = a.get("centroid_lng")
        if a_lat is None or a_lng is None:
            return True  # alert has no coords, can't exclude
        dlat = math.radians(lat - a_lat)
        dlng = math.radians(lng - a_lng)
        hav = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat))
            * math.cos(math.radians(a_lat))
            * math.sin(dlng / 2) ** 2
        )
        if 2 * 6371 * math.asin(math.sqrt(hav)) <= 50:
            return True
    return False


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM = """\
You are a detection agent for Amber's Angels, a nonprofit drone ALPR system \
that supports FEMA AMBER/Silver/Blue Alert responses.

Your task: evaluate a borderline plate detection (75–85% confidence) that the \
static threshold pipeline did not automatically alert on. Decide whether to \
escalate to a full alert, reposition the drone for a better read, or dismiss.

Escalate only when multiple signals align:
- Plate text is a plausible OCR variant of an active alert plate (common errors: \
O↔0, I↔1, S↔5, B↔8, Z↔2, G↔6)
- Vehicle color/type matches the alert profile
- Detection is within the alert's geographic area
- Recent detection history shows consistent reads

Be conservative. A false positive wastes coordinator attention and erodes trust. \
If in doubt, dismiss. If you escalate, state your reasoning clearly and \
specifically — coordinators read it."""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def maybe_evaluate(snapshot: Any, decision: Any, dispatcher: Any) -> None:
    """
    Fire-and-forget background task. Evaluates PROBABLE detections that the
    static pipeline declined to alert on. No-ops (free) if no active alerts
    are nearby — the API is never called.
    """
    from services.aggregation_service import EventClassification

    # Gate 1: PROBABLE only, and only when static pipeline didn't alert
    if snapshot.classification != EventClassification.PROBABLE:
        return
    if decision is None or decision.should_dispatch_alert:
        return

    try:
        # Gate 2: active alerts in DB? (cheap SQL, no Anthropic spend)
        alerts = await _tool_get_active_alerts()
        if not alerts:
            logger.debug("agent: no active alerts — skipping plate=%s", snapshot.plate_best)
            return

        # Gate 3: geographic proximity
        if not _near_any_alert(snapshot.location_centroid, alerts):
            logger.debug("agent: outside all alert areas — skipping plate=%s", snapshot.plate_best)
            return

        logger.info(
            "agent: evaluating plate=%s conf=%.1f drone=%s",
            snapshot.plate_best, snapshot.aggregate_confidence, snapshot.drone_id,
        )

        user_msg = (
            f"Evaluate this PROBABLE detection:\n"
            f"- Plate: {snapshot.plate_best}\n"
            f"- Confidence: {snapshot.aggregate_confidence:.1f}% (auto-alert threshold: 85%)\n"
            f"- Frame count: {snapshot.detection_count}\n"
            f"- Drone: {snapshot.drone_id}\n"
            f"- Location: {snapshot.location_centroid or 'unknown'}\n"
            f"- Vehicle color: {snapshot.vehicle_color or 'unknown'}\n"
            f"- Vehicle type: {snapshot.vehicle_type or 'unknown'}\n"
            f"- Vehicle make: {snapshot.vehicle_make or 'unknown'}\n"
            f"- CDC label: {snapshot.cdc_label or 'unknown'}\n"
            f"- Quality flags: {snapshot.quality_flags or []}\n\n"
            "Call get_active_alerts and get_recent_detections, then decide: "
            "dispatch_alert, reposition_drone, or stop (dismiss)."
        )

        messages: list[dict] = [{"role": "user", "content": user_msg}]
        client = _get_client()
        dispatched = False

        for _turn in range(5):
            response = await client.messages.create(
                model=MODEL,
                max_tokens=1024,
                system=_SYSTEM,
                tools=TOOLS,
                messages=messages,
            )
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "end_turn":
                logger.info("agent: dismissed plate=%s", snapshot.plate_best)
                break

            if response.stop_reason != "tool_use":
                break

            tool_results: list[dict] = []
            for block in response.content:
                if block.type != "tool_use":
                    continue

                result: str

                if block.name == "get_active_alerts":
                    result = str(await _tool_get_active_alerts())

                elif block.name == "get_recent_detections":
                    result = str(await _tool_get_recent_detections(
                        plate=block.input.get("plate", snapshot.plate_best),
                        minutes=int(block.input.get("minutes", 10)),
                    ))

                elif block.name == "dispatch_alert":
                    if dispatched:
                        result = "already dispatched — ignoring"
                    else:
                        dispatched = True
                        reasoning = block.input.get("reasoning", "")
                        loc = (
                            {
                                "lat": snapshot.location_centroid[0],
                                "lng": snapshot.location_centroid[1],
                            }
                            if snapshot.location_centroid
                            else None
                        )
                        await dispatcher.dispatch_alert(
                            plate=block.input["plate"],
                            drone_id=snapshot.drone_id,
                            confidence=float(block.input["confidence"]),
                            location=loc,
                            vehicle_context={
                                "agent_reasoning": reasoning,
                                "watchlist_alert_type": block.input.get("alert_type"),
                                "detected_color": snapshot.vehicle_color,
                                "detected_type": snapshot.vehicle_type,
                            },
                        )
                        logger.info(
                            "agent: escalated plate=%s conf=%.1f reason=%s",
                            block.input["plate"],
                            block.input["confidence"],
                            reasoning,
                        )
                        result = "dispatched"

                elif block.name == "reposition_drone":
                    result = await _tool_reposition_drone(
                        drone_id=snapshot.drone_id,
                        obs_lat=block.input["obs_lat"],
                        obs_lon=block.input["obs_lon"],
                    )
                    logger.info(
                        "agent: reposition drone=%s → (%.5f, %.5f) result=%s",
                        snapshot.drone_id,
                        block.input["obs_lat"],
                        block.input["obs_lon"],
                        result,
                    )

                elif block.name == "request_edge_inference":
                    result = "edge inference not yet active — stub recorded"

                else:
                    result = f"unknown tool: {block.name}"

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })

            messages.append({"role": "user", "content": tool_results})

            if dispatched:
                break

    except Exception as exc:
        logger.error("agent error (plate=%s): %s", snapshot.plate_best, exc)
