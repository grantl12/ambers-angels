"""
backend/services/fema_connector.py

Polls FEMA IPAWS for missing/endangered person alerts, extracts suspect vehicle
plate numbers from the CAP XML, adds them to the watchlist, and fires a
pilot notification via Discord.

Supported alert programs (all flow through FEMA IPAWS):
  CAE  — Amber Alert / Levi's Call (child abduction)
  CEM  — Mattie's Call, Silver Alert, Purple Alert, MIPA, EMA (keyed by headline keywords)
  LEW  — Blue Alert (threat to / missing law enforcement officer)

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
POLL_INTERVAL_SECONDS = int(os.getenv("FEMA_POLL_INTERVAL", "300"))
FEMA_LOOKBACK_MINUTES = int(os.getenv("FEMA_LOOKBACK_MINUTES", "60"))

FEMA_URL = (
    "https://apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/public/cmas/get/recent/"
    f"{FEMA_LOOKBACK_MINUTES}"
)

CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2"

# ---------------------------------------------------------------------------
# Alert type registry
# Each entry defines a missing-person alert program we monitor.
# Classification checks cap_codes first, then scans keywords (case-insensitive)
# against the combined headline + description text.
# Priority: lower number = checked first; first match wins.
# CEM with empty keywords = catch-all only reached if no specific program matched.
# ---------------------------------------------------------------------------
ALERT_REGISTRY: list[dict] = [
    {
        "key":        "amber",
        "name":       "Amber Alert",
        "short":      "AMBER",
        "cap_codes":  ["CAE"],
        "keywords":   [],           # CAE is always Amber — no keyword check needed
        "require_kw": False,        # accept any CAE regardless of text
        "emoji":      "🟠",
        "cta":        "Active child abduction — check your area immediately.",
        "priority":   1,
    },
    {
        "key":        "matties",
        "name":       "Mattie's Call",
        "short":      "MATTIE'S",
        "cap_codes":  ["CEM"],
        "keywords":   ["mattie", "mattie's call", "matties call"],
        "require_kw": True,
        "emoji":      "🔴",
        "cta":        "Missing endangered adult — check your area.",
        "priority":   2,
    },
    {
        "key":        "silver",
        "name":       "Silver Alert",
        "short":      "SILVER",
        "cap_codes":  ["CEM"],
        "keywords":   ["silver alert", "gray alert", "grey alert",
                       "elderly", "alzheimer", "dementia", "memory"],
        "require_kw": True,
        "emoji":      "⚪",
        "cta":        "Missing elderly person — check your area.",
        "priority":   3,
    },
    {
        "key":        "blue",
        "name":       "Blue Alert",
        "short":      "BLUE",
        "cap_codes":  ["LEW", "CEM"],
        "keywords":   ["blue alert", "law enforcement", "officer missing", "officer abducted"],
        "require_kw": True,
        "emoji":      "🔵",
        "cta":        "Missing or endangered law enforcement officer.",
        "priority":   4,
    },
    {
        "key":        "purple",
        "name":       "Purple Alert",
        "short":      "PURPLE",
        "cap_codes":  ["CEM"],
        "keywords":   ["purple alert", "developmental disabilit", "intellectual disabilit", "autism"],
        "require_kw": True,
        "emoji":      "🟣",
        "cta":        "Missing person with developmental disability — check your area.",
        "priority":   5,
    },
    {
        "key":        "mipa",
        "name":       "Missing Indigenous Person Alert",
        "short":      "MIPA",
        "cap_codes":  ["CEM"],
        "keywords":   ["indigenous", "mipa", "missing indigenous", "native"],
        "require_kw": True,
        "emoji":      "🟡",
        "cta":        "Missing Indigenous person — check your area.",
        "priority":   6,
    },
    {
        "key":        "ema",
        "name":       "Endangered Missing Alert",
        "short":      "EMA",
        "cap_codes":  ["CEM"],
        "keywords":   ["endangered missing", "missing and endangered",
                       "endangered adult", "mepa", "ema alert"],
        "require_kw": True,
        "emoji":      "🟡",
        "cta":        "Missing endangered person — check your area.",
        "priority":   7,
    },
]

# CAP event codes we care about — anything else is silently skipped
_MONITORED_CODES = {code for entry in ALERT_REGISTRY for code in entry["cap_codes"]}

# ---------------------------------------------------------------------------
# Plate extraction
# ---------------------------------------------------------------------------
_PLATE_PATTERNS = [
    re.compile(r"\bplate[:\s#]*([A-Z0-9]{4,8})\b", re.IGNORECASE),
    re.compile(r"\blicense\s+plate[:\s]+([A-Z0-9]{4,8})\b", re.IGNORECASE),
    re.compile(r"\b([A-Z]{1,3}[0-9]{1,4}[A-Z0-9]{0,3})\b"),
]


def _extract_plates(text_blob: str) -> list[str]:
    found: list[str] = []
    for pattern in _PLATE_PATTERNS:
        for m in pattern.finditer(text_blob):
            candidate = m.group(1).upper().replace(" ", "")
            if 4 <= len(candidate) <= 8 and candidate not in found:
                found.append(candidate)
    return found


# ---------------------------------------------------------------------------
# Alert classification
# ---------------------------------------------------------------------------

def _classify_alert(event_codes: list[str], combined_text: str) -> dict | None:
    """
    Return the matching ALERT_REGISTRY entry, or None if this alert isn't a
    missing/endangered person event we monitor.
    """
    text_lower = combined_text.lower()

    for entry in sorted(ALERT_REGISTRY, key=lambda e: e["priority"]):
        # Does this entry's CAP code appear in the alert?
        if not any(code in event_codes for code in entry["cap_codes"]):
            continue

        # If keywords are required, at least one must appear in the text
        if entry["require_kw"]:
            if not any(kw in text_lower for kw in entry["keywords"]):
                continue

        return entry

    return None


def _extract_source_program(headline: str, alert_type: dict) -> str:
    """
    Try to pull the exact program name from the headline (e.g. "Mattie's Call
    Issued for John Doe" → "Mattie's Call"). Falls back to the registry name.
    """
    hl = headline.strip()
    # If headline starts with one of our known program names, use that verbatim
    for entry in ALERT_REGISTRY:
        if hl.lower().startswith(entry["name"].lower()):
            # Grab just the program portion (up to first dash/colon/for)
            short = re.split(r"[\-–:|]| for | issued", hl, maxsplit=1, flags=re.IGNORECASE)[0].strip()
            return short
    return alert_type["name"]


# ---------------------------------------------------------------------------
# CAP XML parsing
# ---------------------------------------------------------------------------

def _parse_cap_alerts(xml_bytes: bytes) -> list[dict]:
    """
    Parse CAP XML and return alert dicts for any monitored missing-person event.

    Each dict contains:
        identifier    — unique CAP identifier
        sent          — ISO datetime string
        headline      — short headline
        description   — full alert description
        area          — geographic area description
        polygon       — raw polygon string or None
        plates        — list of extracted plate candidates
        alert_type    — ALERT_REGISTRY entry dict
        source_program — human-readable program name extracted from headline
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        print(f"[FEMA] ❌ XML parse error: {e}")
        return []

    alerts: list[dict] = []
    ns = {"cap": CAP_NS}

    alert_nodes = root.findall(".//cap:alert", ns)
    if not alert_nodes:
        alert_nodes = root.findall(".//alert")

    for alert in alert_nodes:
        event_codes = [
            e.text for e in alert.findall(".//cap:eventCode/cap:value", ns)
        ] + [
            e.text for e in alert.findall(".//eventCode/value")
        ]
        event_codes = [c for c in event_codes if c]

        # Skip anything that isn't even in a monitored category
        if not any(code in _MONITORED_CODES for code in event_codes):
            continue

        def find_text(tag: str) -> str:
            el = alert.find(f"cap:{tag}", ns) or alert.find(tag)
            return el.text.strip() if el is not None and el.text else ""

        identifier  = find_text("identifier")
        sent        = find_text("sent")
        headline    = alert.findtext(".//cap:headline",     namespaces=ns) or alert.findtext(".//headline")    or ""
        description = alert.findtext(".//cap:description",  namespaces=ns) or alert.findtext(".//description") or ""
        area_desc   = alert.findtext(".//cap:areaDesc",     namespaces=ns) or alert.findtext(".//areaDesc")    or ""
        polygon     = alert.findtext(".//cap:polygon",      namespaces=ns) or alert.findtext(".//polygon")

        combined = f"{headline} {description}"
        alert_type = _classify_alert(event_codes, combined)

        if alert_type is None:
            # Has a monitored code but no keyword match — not a missing person alert
            continue

        alerts.append({
            "identifier":     identifier,
            "sent":           sent,
            "headline":       headline.strip(),
            "description":    description.strip(),
            "area":           area_desc.strip(),
            "polygon":        polygon,
            "plates":         _extract_plates(combined),
            "alert_type":     alert_type,
            "source_program": _extract_source_program(headline, alert_type),
        })

    return alerts


# ---------------------------------------------------------------------------
# Watchlist insertion
# ---------------------------------------------------------------------------

async def _add_to_watchlist(
    session_factory,
    plate: str,
    description: str,
    alert_type: str,
    source_program: str,
) -> bool:
    """
    Insert plate into watchlist with alert type metadata.
    ON CONFLICT DO NOTHING — existing entries are not overwritten.
    Returns True if newly inserted.
    """
    async with session_factory() as session:
        try:
            result = await session.execute(
                text("""
                    INSERT INTO watchlist (plate_text, description, alert_type, source_program, added_at)
                    VALUES (:plate, :desc, :atype, :prog, :now)
                    ON CONFLICT (plate_text) DO NOTHING
                """),
                {
                    "plate": plate,
                    "desc":  description,
                    "atype": alert_type,
                    "prog":  source_program,
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
# Discord notifications
# ---------------------------------------------------------------------------

async def _post_discord(webhook_url: str, content: str) -> None:
    if not webhook_url:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0, verify=False) as client:
            resp = await client.post(webhook_url, json={"content": content})
        if resp.status_code not in (200, 204):
            print(f"[FEMA] ❌ Discord returned {resp.status_code}")
    except Exception as e:
        print(f"[FEMA] ❌ Discord error: {e}")


async def _notify_no_plate(webhook_url: str, alert: dict) -> None:
    """Notify pilots when an alert fires but no plate was found in the text."""
    atype = alert["alert_type"]
    content = (
        f"{atype['emoji']} **{atype['short']} — {alert['source_program'].upper()}** {atype['emoji']}\n"
        f"**Headline:** {alert['headline']}\n"
        f"**Area:** {alert['area']}\n"
        f"**Issued:** {alert['sent']}\n"
        f"⚠️ No plate number found in alert text — monitor manually.\n"
        f"📋 {alert['description'][:300]}{'...' if len(alert['description']) > 300 else ''}"
    )
    await _post_discord(webhook_url, content)


async def _notify_plates(webhook_url: str, alert: dict, new_plates: list[str]) -> None:
    """Notify pilots when new plates are added to the watchlist."""
    if not new_plates:
        return
    atype      = alert["alert_type"]
    plates_fmt = ", ".join(f"`{p}`" for p in new_plates)
    content = (
        f"{atype['emoji']} **{atype['short']} — PLATES ON WATCHLIST** {atype['emoji']}\n"
        f"**Program:** {alert['source_program']}\n"
        f"**Headline:** {alert['headline']}\n"
        f"**Area:** {alert['area']}\n"
        f"**Plates added:** {plates_fmt}\n"
        f"**Issued:** {alert['sent']}\n"
        f"⚡ {atype['cta']}"
    )
    await _post_discord(webhook_url, content)


# ---------------------------------------------------------------------------
# Seen-identifier cache
# ---------------------------------------------------------------------------
_seen_identifiers: set[str] = set()


# ---------------------------------------------------------------------------
# Main poll coroutine
# ---------------------------------------------------------------------------

async def poll_fema_ipaws(session_factory, webhook_url: Optional[str] = None) -> None:
    print(f"[FEMA] 🛰️  Polling IPAWS ({FEMA_LOOKBACK_MINUTES}m lookback)...")

    try:
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            resp = await client.get(FEMA_URL, headers={"Accept": "application/xml"})
    except Exception as e:
        print(f"[FEMA] ❌ Fetch error: {e}")
        return

    if resp.status_code == 404:
        print("[FEMA] ✅ No active alerts in lookback window.")
        return
    if resp.status_code != 200:
        print(f"[FEMA] ⚠️  IPAWS returned HTTP {resp.status_code}")
        return

    alerts = _parse_cap_alerts(resp.content)

    if not alerts:
        print("[FEMA] ✅ No monitored alerts found.")
        return

    for alert in alerts:
        ident = alert["identifier"]
        if ident in _seen_identifiers:
            continue

        _seen_identifiers.add(ident)
        atype = alert["alert_type"]
        print(
            f"[FEMA] {atype['emoji']} {atype['short']} detected: "
            f"{alert['source_program']} | {alert['headline']} | Area: {alert['area']}"
        )

        if not alert["plates"]:
            print(f"[FEMA] ⚠️  No plate found — sending no-plate notification.")
            if webhook_url:
                await _notify_no_plate(webhook_url, alert)
            continue

        new_plates: list[str] = []
        for plate in alert["plates"]:
            desc = (
                f"{alert['source_program']} | {alert['headline']} | "
                f"Area: {alert['area']} | Issued: {alert['sent']} | ID: {ident}"
            )
            inserted = await _add_to_watchlist(
                session_factory, plate, desc,
                alert_type=atype["key"],
                source_program=alert["source_program"],
            )
            if inserted:
                new_plates.append(plate)
                print(f"[FEMA] ✅ Watchlist: {plate} ({atype['short']})")
            else:
                print(f"[FEMA] ℹ️  {plate} already on watchlist.")

        if new_plates and webhook_url:
            await _notify_plates(webhook_url, alert, new_plates)


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------

async def fema_background_loop(session_factory, webhook_url: Optional[str] = None) -> None:
    print(f"[FEMA] 🟢 Connector started. Poll interval: {POLL_INTERVAL_SECONDS}s")
    print(f"[FEMA] 👁  Monitoring: {', '.join(e['short'] for e in ALERT_REGISTRY)}")
    while True:
        try:
            await poll_fema_ipaws(session_factory, webhook_url)
        except Exception as e:
            print(f"[FEMA] ❌ Unexpected error in poll loop: {e}")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
