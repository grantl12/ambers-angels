"""
backend/services/fema_connector.py

Polls FEMA IPAWS for Amber Alert (CAE) events, extracts suspect vehicle
plate numbers from the CAP XML, adds them to the watchlist, and fires a
pilot notification via Discord.

Runs as a FastAPI background task (asyncio loop). Polls every POLL_INTERVAL_SECONDS.

FEMA IPAWS public feed:
  https://apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/public/cmas/get/recent/{minutes}
  Returns CAP-formatted XML. No auth required for recent public alerts.
"""

import asyncio
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy import text

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
POLL_INTERVAL_SECONDS = int(os.getenv("FEMA_POLL_INTERVAL", "300"))   # 5 minutes
FEMA_LOOKBACK_MINUTES = int(os.getenv("FEMA_LOOKBACK_MINUTES", "60")) # how far back to fetch

# FEMA IPAWS public endpoint — returns all recent CAP alerts (CAE = Amber Alert)
FEMA_URL = (
    "https://apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/public/cmas/get/recent/"
    f"{FEMA_LOOKBACK_MINUTES}"
)

# CAP XML namespace
CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2"

# Regex patterns to extract plate numbers from Amber Alert descriptions.
# Amber Alerts commonly say: "CA plate 7ABC123", "license plate: ABC 123", etc.
_PLATE_PATTERNS = [
    re.compile(r"\bplate[:\s#]*([A-Z0-9]{4,8})\b", re.IGNORECASE),
    re.compile(r"\blicense\s+plate[:\s]+([A-Z0-9]{4,8})\b", re.IGNORECASE),
    re.compile(r"\b([A-Z]{1,3}[0-9]{1,4}[A-Z0-9]{0,3})\b"),  # generic plate-shaped token
]


# ---------------------------------------------------------------------------
# Plate extraction
# ---------------------------------------------------------------------------

def _extract_plates(text_blob: str) -> list[str]:
    """Return a deduplicated list of plate candidates found in text_blob."""
    found: list[str] = []
    for pattern in _PLATE_PATTERNS:
        for m in pattern.finditer(text_blob):
            candidate = m.group(1).upper().replace(" ", "")
            if 4 <= len(candidate) <= 8 and candidate not in found:
                found.append(candidate)
    return found


# ---------------------------------------------------------------------------
# CAP XML parsing
# ---------------------------------------------------------------------------

def _parse_cap_alerts(xml_bytes: bytes) -> list[dict]:
    """
    Parse a CAP XML feed and return a list of dicts for CAE (Amber Alert) entries.

    Each dict contains:
        identifier  - unique CAP identifier
        sent        - ISO datetime string
        headline    - short headline
        description - full alert description
        area        - geographic area description string
        polygon     - raw polygon string (if present) or None
        plates      - list of extracted plate candidates
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        print(f"[FEMA] ❌ XML parse error: {e}")
        return []

    alerts: list[dict] = []
    ns = {"cap": CAP_NS}

    # The feed may be a <feed> wrapper containing multiple <alert> elements,
    # or a bare <alert>. Handle both.
    alert_nodes = root.findall(".//cap:alert", ns)
    if not alert_nodes:
        # Try without namespace (some FEMA responses omit it)
        alert_nodes = root.findall(".//alert")

    for alert in alert_nodes:
        # Filter to CAE (Child Abduction Emergency = Amber Alert) only
        event_codes = [
            e.text for e in alert.findall(".//cap:eventCode/cap:value", ns)
        ] + [
            e.text for e in alert.findall(".//eventCode/value")
        ]
        if "CAE" not in event_codes:
            continue

        def find_text(tag: str) -> str:
            el = alert.find(f"cap:{tag}", ns) or alert.find(tag)
            return el.text.strip() if el is not None and el.text else ""

        identifier  = find_text("identifier")
        sent        = find_text("sent")
        headline    = find_text("headline") or alert.findtext(".//cap:headline", namespaces=ns) or ""
        description = alert.findtext(".//cap:description", namespaces=ns) or alert.findtext(".//description") or ""
        area_desc   = alert.findtext(".//cap:areaDesc", namespaces=ns) or alert.findtext(".//areaDesc") or ""
        polygon     = alert.findtext(".//cap:polygon", namespaces=ns) or alert.findtext(".//polygon")

        combined_text = f"{headline} {description}"
        plates = _extract_plates(combined_text)

        alerts.append({
            "identifier":  identifier,
            "sent":        sent,
            "headline":    headline,
            "description": description,
            "area":        area_desc,
            "polygon":     polygon,
            "plates":      plates,
        })

    return alerts


# ---------------------------------------------------------------------------
# Watchlist insertion
# ---------------------------------------------------------------------------

async def _add_to_watchlist(session_factory, plate: str, description: str) -> bool:
    """
    Insert plate into watchlist. Returns True if newly inserted, False if already present.
    Uses INSERT ... ON CONFLICT DO NOTHING so existing plates are untouched.
    """
    async with session_factory() as session:
        try:
            result = await session.execute(
                text("""
                    INSERT INTO watchlist (plate_text, description, added_at)
                    VALUES (:plate, :desc, :now)
                    ON CONFLICT (plate_text) DO NOTHING
                """),
                {
                    "plate": plate,
                    "desc":  description,
                    "now":   datetime.now(timezone.utc),
                },
            )
            await session.commit()
            return result.rowcount > 0
        except Exception as e:
            print(f"[FEMA] ❌ Watchlist insert failed for {plate}: {e}")
            await session.rollback()
            return False


# ---------------------------------------------------------------------------
# Discord pilot notification
# ---------------------------------------------------------------------------

async def _notify_national_alert(webhook_url: str, alert: dict) -> None:
    """Fire when an Amber Alert is detected but no plate could be extracted."""
    if not webhook_url:
        return
    payload = {
        "content": (
            f"🔔 **AMBER ALERT DETECTED — FEMA IPAWS** 🔔\n"
            f"**Headline:** {alert['headline']}\n"
            f"**Area:** {alert['area']}\n"
            f"**Issued:** {alert['sent']}\n"
            f"⚠️ No plate number found in alert text. Monitor manually.\n"
            f"📋 Details: {alert['description'][:300]}{'...' if len(alert['description']) > 300 else ''}"
        )
    }
    async with httpx.AsyncClient(timeout=5.0, verify=certifi.where()) as client:
        try:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code in (200, 204):
                print(f"[FEMA] ✅ National alert notification sent.")
            else:
                print(f"[FEMA] ❌ Discord returned {resp.status_code}")
        except Exception as e:
            print(f"[FEMA] ❌ Notification error: {e}")


async def _notify_pilots(webhook_url: str, alert: dict, new_plates: list[str]) -> None:
    if not webhook_url or not new_plates:
        return

    plates_fmt = ", ".join(f"`{p}`" for p in new_plates)
    payload = {
        "content": (
            f"🚨 **AMBER ALERT — PLATES ON WATCHLIST** 🚨\n"
            f"**Headline:** {alert['headline']}\n"
            f"**Area:** {alert['area']}\n"
            f"**Plates added to watchlist:** {plates_fmt}\n"
            f"**Issued:** {alert['sent']}\n"
            f"⚡ Drones: check your area — active rescue mission nearby."
        )
    }

    async with httpx.AsyncClient(timeout=5.0, verify=certifi.where()) as client:
        try:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code in (200, 204):
                print(f"[FEMA] ✅ Pilot notification sent for plates: {new_plates}")
            else:
                print(f"[FEMA] ❌ Discord returned {resp.status_code}")
        except Exception as e:
            print(f"[FEMA] ❌ Notification error: {e}")


# ---------------------------------------------------------------------------
# Seen-identifier cache (in-memory; resets on restart, fine for our use case)
# ---------------------------------------------------------------------------
_seen_identifiers: set[str] = set()


# ---------------------------------------------------------------------------
# Main poll coroutine
# ---------------------------------------------------------------------------

async def poll_fema_ipaws(session_factory, webhook_url: Optional[str] = None) -> None:
    """
    Single poll cycle. Fetches FEMA IPAWS, processes CAE alerts,
    adds new plates to watchlist, notifies pilots.
    """
    print(f"[FEMA] 🛰️  Polling IPAWS ({FEMA_LOOKBACK_MINUTES}m lookback)...")

    try:
        # FEMA IPAWS uses an intermediate CA not in the default certifi bundle.
        # verify=False is acceptable here — we're only reading public broadcast data
        # from a known government endpoint, not sending any credentials.
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            resp = await client.get(FEMA_URL, headers={"Accept": "application/xml"})
    except Exception as e:
        print(f"[FEMA] ❌ Fetch error: {e}")
        return

    if resp.status_code == 404:
        # FEMA returns 404 (not an empty body) when no alerts exist in the window
        print("[FEMA] ✅ No active alerts in lookback window.")
        return
    if resp.status_code != 200:
        print(f"[FEMA] ⚠️  IPAWS returned HTTP {resp.status_code}")
        return

    alerts = _parse_cap_alerts(resp.content)

    if not alerts:
        print("[FEMA] ✅ No active Amber Alerts found.")
        return

    for alert in alerts:
        ident = alert["identifier"]
        if ident in _seen_identifiers:
            continue  # already processed this alert

        _seen_identifiers.add(ident)
        print(f"[FEMA] 🚨 Amber Alert detected: {alert['headline']} | Area: {alert['area']}")

        if not alert["plates"]:
            print(f"[FEMA] ⚠️  No plate found in alert text — sending national alert.")
            print(f"[FEMA]    Description: {alert['description'][:200]}")
            if webhook_url:
                await _notify_national_alert(webhook_url, alert)
            continue

        new_plates: list[str] = []
        for plate in alert["plates"]:
            desc = (
                f"FEMA Amber Alert | {alert['headline']} | Area: {alert['area']} | "
                f"Issued: {alert['sent']} | ID: {ident}"
            )
            inserted = await _add_to_watchlist(session_factory, plate, desc)
            if inserted:
                new_plates.append(plate)
                print(f"[FEMA] ✅ Added to watchlist: {plate}")
            else:
                print(f"[FEMA] ℹ️  {plate} already on watchlist.")

        if new_plates and webhook_url:
            await _notify_pilots(webhook_url, alert, new_plates)


# ---------------------------------------------------------------------------
# Background loop (called from FastAPI lifespan)
# ---------------------------------------------------------------------------

async def fema_background_loop(session_factory, webhook_url: Optional[str] = None) -> None:
    """
    Runs forever, polling FEMA IPAWS on POLL_INTERVAL_SECONDS cadence.
    Designed to be launched with asyncio.create_task().
    """
    print(f"[FEMA] 🟢 Connector started. Poll interval: {POLL_INTERVAL_SECONDS}s")
    while True:
        try:
            await poll_fema_ipaws(session_factory, webhook_url)
        except Exception as e:
            print(f"[FEMA] ❌ Unexpected error in poll loop: {e}")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
