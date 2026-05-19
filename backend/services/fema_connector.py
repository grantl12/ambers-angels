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
import logging
import os
import re
import subprocess
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)
from datetime import datetime, timezone
from typing import Optional

import httpx
import certifi as _certifi
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
# Polygon → centroid
# ---------------------------------------------------------------------------

def _polygon_to_centroid(polygon: str | None) -> tuple[float, float] | None:
    """
    Parse a CAP polygon string (space-separated "lat,lon" pairs) and return
    the arithmetic centroid as (lat, lng).  Returns None on any parse failure.
    """
    if not polygon:
        return None
    try:
        coords = []
        for pair in polygon.strip().split():
            lat_s, lon_s = pair.split(",", 1)
            coords.append((float(lat_s), float(lon_s)))
        if not coords:
            return None
        return (
            sum(c[0] for c in coords) / len(coords),
            sum(c[1] for c in coords) / len(coords),
        )
    except Exception:
        return None


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
# Vehicle profile extraction
# ---------------------------------------------------------------------------

# Ordered by specificity — first match wins for color and body type
_COLOR_WORDS = [
    "maroon", "navy", "teal", "beige", "cream", "silver", "gray", "grey",
    "black", "white", "red", "orange", "yellow", "green", "blue", "purple",
    "brown", "tan", "gold", "pink",
]

# Raw text token → YOLO body_type (car | truck | motorcycle | bus)
_BODY_TYPE_MAP: list[tuple[str, str, str]] = [
    # (regex token, yolo_type, display_label)
    ("minivan",      "truck",      "minivan"),
    ("mini van",     "truck",      "minivan"),
    ("van",          "truck",      "van"),
    ("suv",          "car",        "SUV"),
    ("pickup truck", "truck",      "pickup"),
    ("pickup",       "truck",      "pickup"),
    ("semi truck",   "truck",      "semi"),
    ("tractor.trailer", "truck",   "tractor-trailer"),
    ("truck",        "truck",      "truck"),
    ("motorcycle",   "motorcycle", "motorcycle"),
    ("motor cycle",  "motorcycle", "motorcycle"),
    ("bus",          "bus",        "bus"),
    ("sedan",        "car",        "sedan"),
    ("coupe",        "car",        "coupe"),
    ("hatchback",    "car",        "hatchback"),
    ("convertible",  "car",        "convertible"),
    ("wagon",        "car",        "wagon"),
    ("jeep",         "car",        "Jeep"),
]

_MAKE_WORDS = [
    "honda", "toyota", "ford", "chevrolet", "chevy", "dodge", "nissan",
    "hyundai", "kia", "gmc", "chrysler", "jeep", "ram", "subaru", "mazda",
    "volkswagen", r"\bvw\b", "bmw", "mercedes", "audi", "lexus", "cadillac",
    "buick", "lincoln", "pontiac", "saturn", "mitsubishi", "volvo",
    "acura", "infiniti", "tesla",
]


def _extract_vehicle_profile(text_blob: str) -> dict:
    """
    Parse freeform alert text for vehicle color, body type, and make.
    Returns a dict with keys: color, body_type, yolo_body_type, make.
    Any key may be None if not found.
    """
    tl = text_blob.lower()

    color = None
    for word in _COLOR_WORDS:
        if re.search(r"\b" + word + r"\b", tl):
            color = word
            break

    body_type = None
    yolo_body_type = None
    for token, yolo, label in _BODY_TYPE_MAP:
        if re.search(token, tl):
            body_type = label
            yolo_body_type = yolo
            break

    make = None
    for pattern in _MAKE_WORDS:
        m = re.search(pattern, tl)
        if m:
            make = m.group(0).strip().title().replace(r"\B", "").replace("Vw", "VW")
            break

    return {"color": color, "body_type": body_type, "yolo_body_type": yolo_body_type, "make": make}


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
    Parse CAP XML and return alert dicts for monitored missing-person events.

    Returns two kinds of dicts, distinguished by msg_type:
      msg_type="alert"  — new or updated alert (same fields as before)
      msg_type="cancel" — cancellation; has a `references` list of original identifiers

    Alerts are sorted so all "alert" entries come before "cancel" entries,
    ensuring we've registered an alert in _seen_identifiers before processing
    its cancellation in the same poll cycle.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        logger.error("XML parse error: %s", e)
        return []

    alerts: list[dict] = []
    ns = {"cap": CAP_NS}

    alert_nodes = root.findall(".//cap:alert", ns)
    if not alert_nodes:
        alert_nodes = root.findall(".//alert")

    for alert in alert_nodes:
        def find_text(tag: str) -> str:
            el = alert.find(f"cap:{tag}", ns) or alert.find(tag)
            return el.text.strip() if el is not None and el.text else ""

        identifier = find_text("identifier")
        sent       = find_text("sent")
        msg_type   = find_text("msgType") or "Alert"
        headline   = alert.findtext(".//cap:headline",    namespaces=ns) or alert.findtext(".//headline")    or ""
        area_desc  = alert.findtext(".//cap:areaDesc",    namespaces=ns) or alert.findtext(".//areaDesc")    or ""

        if msg_type == "Cancel":
            refs_raw = find_text("references")
            # CAP references format: "sender,identifier,sent ..." (space-separated)
            references = [
                part.split(",")[1].strip()
                for part in refs_raw.split()
                if part.count(",") >= 1
            ]
            if not references:
                continue
            alerts.append({
                "msg_type":        "cancel",
                "identifier":      identifier,
                "sent":            sent,
                "headline":        headline.strip(),
                "description":     "",
                "area":            area_desc.strip(),
                "polygon":         None,
                "references":      references,
                "plates":          [],
                "vehicle_profile": {},
                "alert_type":      None,
                "source_program":  "",
            })
            continue

        # ── Active alert ──────────────────────────────────────────────────────
        event_codes = [
            e.text for e in alert.findall(".//cap:eventCode/cap:value", ns)
        ] + [
            e.text for e in alert.findall(".//eventCode/value")
        ]
        event_codes = [c for c in event_codes if c]

        if not any(code in _MONITORED_CODES for code in event_codes):
            continue

        description = alert.findtext(".//cap:description", namespaces=ns) or alert.findtext(".//description") or ""
        polygon     = alert.findtext(".//cap:polygon",     namespaces=ns) or alert.findtext(".//polygon")

        combined   = f"{headline} {description}"
        alert_type = _classify_alert(event_codes, combined)

        if alert_type is None:
            continue

        alerts.append({
            "msg_type":        "alert",
            "identifier":      identifier,
            "sent":            sent,
            "headline":        headline.strip(),
            "description":     description.strip(),
            "area":            area_desc.strip(),
            "polygon":         polygon,
            "references":      [],
            "plates":          _extract_plates(combined),
            "vehicle_profile": _extract_vehicle_profile(combined),
            "alert_type":      alert_type,
            "source_program":  _extract_source_program(headline, alert_type),
        })

    # Process active alerts before cancellations in the same poll cycle
    alerts.sort(key=lambda a: 0 if a["msg_type"] == "alert" else 1)
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
    vehicle_color: str | None = None,
    vehicle_type:  str | None = None,
    vehicle_make:  str | None = None,
) -> bool:
    """
    Insert plate into watchlist with alert type and vehicle profile metadata.
    ON CONFLICT: vehicle profile columns are filled in if they were previously NULL,
    so a re-polled alert with profile data can enrich an existing bare-plate entry.
    Returns True if newly inserted.
    """
    async with session_factory() as session:
        try:
            result = await session.execute(
                text("""
                    INSERT INTO watchlist
                        (plate_text, description, alert_type, source_program,
                         vehicle_color, vehicle_type, vehicle_make, added_at)
                    VALUES
                        (:plate, :desc, :atype, :prog,
                         :vcolor, :vtype, :vmake, :now)
                    ON CONFLICT (plate_text) DO UPDATE SET
                        vehicle_color = COALESCE(watchlist.vehicle_color, EXCLUDED.vehicle_color),
                        vehicle_type  = COALESCE(watchlist.vehicle_type,  EXCLUDED.vehicle_type),
                        vehicle_make  = COALESCE(watchlist.vehicle_make,  EXCLUDED.vehicle_make)
                """),
                {
                    "plate":  plate,
                    "desc":   description,
                    "atype":  alert_type,
                    "prog":   source_program,
                    "vcolor": vehicle_color,
                    "vtype":  vehicle_type,
                    "vmake":  vehicle_make,
                    "now":    datetime.now(timezone.utc),
                },
            )
            await session.commit()
            return result.rowcount > 0
        except Exception as e:
            logger.error("Watchlist insert failed for %s: %s", plate, e)
            await session.rollback()
            return False


# ---------------------------------------------------------------------------
# Vehicle target insertion
# ---------------------------------------------------------------------------

async def _add_vehicle_target(session_factory, alert: dict) -> bool:
    """
    Store a vehicle profile from a FEMA alert in vehicle_targets.
    ON CONFLICT DO NOTHING — re-polling the same alert doesn't duplicate rows.
    Returns True if newly inserted.
    """
    profile = alert.get("vehicle_profile", {})
    if not any(profile.get(k) for k in ("color", "body_type", "make")):
        return False

    from datetime import timedelta
    centroid = _polygon_to_centroid(alert.get("polygon"))

    async with session_factory() as session:
        try:
            result = await session.execute(
                text("""
                    INSERT INTO vehicle_targets
                        (fema_identifier, alert_type, source_program, headline,
                         area, color, body_type, make,
                         polygon, centroid_lat, centroid_lng, expires_at)
                    VALUES
                        (:fema_id, :atype, :prog, :headline,
                         :area, :color, :body_type, :make,
                         :polygon, :centroid_lat, :centroid_lng, :expires_at)
                    ON CONFLICT (fema_identifier) DO NOTHING
                """),
                {
                    "fema_id":      alert["identifier"],
                    "atype":        alert["alert_type"]["key"],
                    "prog":         alert["source_program"],
                    "headline":     alert["headline"],
                    "area":         alert["area"],
                    "color":        profile.get("color"),
                    "body_type":    profile.get("yolo_body_type"),
                    "make":         profile.get("make"),
                    "polygon":      alert.get("polygon"),
                    "centroid_lat": centroid[0] if centroid else None,
                    "centroid_lng": centroid[1] if centroid else None,
                    "expires_at":   datetime.now(timezone.utc) + timedelta(hours=24),
                },
            )
            await session.commit()
            return result.rowcount > 0
        except Exception as e:
            logger.error("Vehicle target insert failed: %s", e)
            await session.rollback()
            return False


# ---------------------------------------------------------------------------
# Alert cancellation
# ---------------------------------------------------------------------------

async def _deactivate_by_references(
    session_factory,
    references: list[str],
) -> list[str]:
    """
    Called when a CAP Cancel message is received. Marks watchlist entries as
    inactive and expires matching vehicle_targets. The alert description always
    contains 'ID: {fema_identifier}' so we match on that substring.
    Returns the list of plate texts that were deactivated.
    """
    if not references:
        return []

    deactivated: list[str] = []
    async with session_factory() as session:
        try:
            # Expire vehicle targets whose fema_identifier is in the references list
            await session.execute(
                text("""
                    UPDATE vehicle_targets
                    SET expires_at = NOW()
                    WHERE fema_identifier = ANY(:refs)
                      AND (expires_at IS NULL OR expires_at > NOW())
                """),
                {"refs": references},
            )

            # Deactivate watchlist entries — descriptions contain 'ID: {ident}'
            for ref in references:
                rows = await session.execute(
                    text("""
                        UPDATE watchlist
                        SET active = FALSE, removed_at = NOW()
                        WHERE active = TRUE
                          AND description LIKE :pattern
                        RETURNING plate_text
                    """),
                    {"pattern": f"%ID: {ref}%"},
                )
                deactivated.extend(r[0] for r in rows.fetchall())

            # Abort any active autonomous missions tied to these cancelled alerts
            if references:
                await session.execute(
                    text("""
                        UPDATE autonomous_missions
                        SET status = 'aborted', completed_at = NOW()
                        WHERE alert_id = ANY(:refs)
                          AND status IN ('pending', 'dispatched', 'uploading', 'executing', 'active')
                    """),
                    {"refs": references},
                )

            await session.commit()
        except Exception as e:
            logger.error("Alert deactivation failed: %s", e)
            await session.rollback()

    return deactivated


async def _notify_cancelled(
    webhook_url: str,
    alert: dict,
    deactivated_plates: list[str],
) -> None:
    """Discord notification when an alert is officially cancelled."""
    plates_fmt = (
        ", ".join(f"`{p}`" for p in deactivated_plates)
        if deactivated_plates
        else "none on watchlist"
    )
    content = (
        f"✅ **ALERT CANCELLED — STAND DOWN** ✅\n"
        f"**Headline:** {alert['headline'] or 'Cancellation received'}\n"
        f"**Area:** {alert['area'] or '—'}\n"
        f"**Plates removed from watchlist:** {plates_fmt}\n"
        f"📋 This alert has been officially cancelled by the issuing authority."
    )
    await _post_discord(webhook_url, content)


async def _push_notify_cancelled(session_factory, alert: dict) -> None:
    """Push-notify pilots (admin + nationwide + watch-area) that an alert was cancelled."""
    try:
        async with session_factory() as session:
            rows = await session.execute(
                text("""
                    SELECT DISTINCT expo_push_token
                    FROM pilots
                    WHERE status = 'approved'
                      AND expo_push_token IS NOT NULL
                      AND (
                        role = 'admin'
                        OR alert_scope = 'nationwide'
                        OR (
                          watch_areas IS NOT NULL
                          AND array_length(watch_areas, 1) > 0
                          AND EXISTS (
                              SELECT 1 FROM unnest(watch_areas) wa
                              WHERE :area ILIKE '%' || wa || '%'
                          )
                        )
                      )
                """),
                {"area": alert["area"] or ""},
            )
            tokens = [r[0] for r in rows.fetchall()]
    except Exception as e:
        logger.error("Cancelled-alert pilot query failed: %s", e)
        return

    if not tokens:
        return

    messages = [
        {
            "to":       tok,
            "title":    "✅ Alert Cancelled — Stand Down",
            "body":     alert["headline"] or "An active alert in your area has been cancelled.",
            "sound":    "default",
            "priority": "high",
        }
        for tok in tokens
    ]
    try:
        async with httpx.AsyncClient(verify=_certifi.where(), timeout=10.0) as client:
            await client.post(
                "https://exp.host/--/api/v2/push/send",
                json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
    except Exception as e:
        logger.error("Cancelled-alert push failed: %s", e)


# ---------------------------------------------------------------------------
# Discord notifications
# ---------------------------------------------------------------------------

async def _post_discord(webhook_url: str, content: str) -> None:
    if not webhook_url:
        return
    try:
        async with httpx.AsyncClient(verify=_certifi.where(), timeout=5.0) as client:
            resp = await client.post(webhook_url, json={"content": content})
        if resp.status_code not in (200, 204):
            logger.error("Discord returned %s", resp.status_code)
    except Exception as e:
        logger.error("Discord error: %s", e)


async def _notify_no_plate(webhook_url: str, alert: dict) -> None:
    """Notify pilots when an alert fires but no plate was found in the text."""
    atype   = alert["alert_type"]
    profile = alert.get("vehicle_profile", {})
    vehicle_parts = [p for p in [
        profile.get("color"), profile.get("body_type"), profile.get("make")
    ] if p]
    vehicle_line = (
        f"🚗 **Target vehicle:** {' '.join(vehicle_parts).title()}\n"
        if vehicle_parts else
        "⚠️ No plate or vehicle description found — monitor manually.\n"
    )
    content = (
        f"{atype['emoji']} **{atype['short']} — {alert['source_program'].upper()}** {atype['emoji']}\n"
        f"**Headline:** {alert['headline']}\n"
        f"**Area:** {alert['area']}\n"
        f"**Issued:** {alert['sent']}\n"
        f"{vehicle_line}"
        f"📋 {alert['description'][:300]}{'...' if len(alert['description']) > 300 else ''}"
    )
    await _post_discord(webhook_url, content)


async def _notify_vehicle_match(
    webhook_url: str,
    target: dict,
    drone_id: str,
    detected_color: str,
    detected_body: str,
    yolo_conf: float,
) -> None:
    """Alert pilots when YOLO sees a vehicle matching an active FEMA vehicle target."""
    atype_key = target.get("alert_type", "amber")
    atype = next((e for e in ALERT_REGISTRY if e["key"] == atype_key), ALERT_REGISTRY[0])
    target_desc = " ".join(filter(None, [target.get("color"), target.get("body_type"), target.get("make")])).title()
    content = (
        f"{atype['emoji']} **VEHICLE MATCH — {atype['short']}** {atype['emoji']}\n"
        f"**Program:** {target.get('source_program', 'Unknown')}\n"
        f"**Target:** {target_desc or 'unknown vehicle'}\n"
        f"**Detected:** {detected_color} {detected_body} (YOLO {yolo_conf:.0%} confidence)\n"
        f"**Drone:** {drone_id}\n"
        f"**Alert area:** {target.get('area', '—')}\n"
        f"⚡ Verify plates immediately — this may be your suspect vehicle."
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
# Watch-area pilot notifications
# ---------------------------------------------------------------------------

async def _notify_watching_pilots(session_factory, alert: dict) -> None:
    """
    Push-notify approved pilots based on alert scope:
      - Admins and pilots with alert_scope='nationwide' always receive notifications.
      - Pilots with watch_areas receive notifications when any watched area is a
        case-insensitive substring of the alert's area description.

    Notifications respect each pilot's notification_prefs:
      - 'push' in prefs → Expo device push (if token registered)
      - 'email' in prefs → email via SMTP
    Default is both, so pilots who haven't set a preference get everything.
    """
    try:
        async with session_factory() as session:
            rows = await session.execute(
                text("""
                    SELECT DISTINCT email, full_name, expo_push_token, notification_prefs
                    FROM pilots
                    WHERE status = 'approved'
                      AND (
                        role = 'admin'
                        OR alert_scope = 'nationwide'
                        OR (
                          watch_areas IS NOT NULL
                          AND array_length(watch_areas, 1) > 0
                          AND EXISTS (
                              SELECT 1 FROM unnest(watch_areas) wa
                              WHERE :area ILIKE '%' || wa || '%'
                          )
                        )
                      )
                """),
                {"area": alert["area"] or ""},
            )
            matched = rows.fetchall()
    except Exception as e:
        logger.error("Watch-area query failed: %s", e)
        return

    if not matched:
        return

    atype = alert["alert_type"]
    centroid = _polygon_to_centroid(alert.get("polygon"))

    # Partition by preference
    # row: (email, full_name, expo_push_token, notification_prefs)
    push_tokens = [
        row[2] for row in matched
        if row[2] and "push" in (row[3] or ["push", "email"])
    ]
    if push_tokens:
        push_title = f"🚨 {atype['short']} — {alert['area'] or 'Unknown area'}"
        push_body  = alert["headline"] or atype["cta"]
        push_data  = {
            "centroidLat": centroid[0] if centroid else None,
            "centroidLng": centroid[1] if centroid else None,
            "label":       alert["area"] or atype["name"],
        }
        messages = [
            {"to": tok, "title": push_title, "body": push_body,
             "data": push_data, "sound": "default", "priority": "high"}
            for tok in push_tokens
        ]
        try:
            async with httpx.AsyncClient(verify=_certifi.where(), timeout=10.0) as client:
                resp = await client.post(
                    "https://exp.host/--/api/v2/push/send",
                    json=messages,
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
            if resp.status_code in (200, 204):
                logger.info("Expo push sent to %d device(s)", len(push_tokens))
            else:
                logger.warning("Expo push returned %s", resp.status_code)
        except Exception as e:
            logger.error("Expo push failed: %s", e)

    # ── Email ─────────────────────────────────────────────────────────────────
    email_pilots = [
        (row[0], row[1]) for row in matched
        if "email" in (row[3] or ["push", "email"])
    ]
    if email_pilots:
        import smtplib
        from email.mime.text import MIMEText

        smtp_host = os.getenv("SMTP_HOST")
        if not smtp_host:
            logger.warning("SMTP not configured — skipping %d watch-area email(s).", len(email_pilots))
        else:
            subject = f"[Amber's Angels] {atype['short']} alert in your watch area — {alert['area']}"
            body_tpl = (
                "Hi {name},\n\n"
                f"A {atype['name']} has been issued in an area you're watching.\n\n"
                f"Headline: {alert['headline']}\n"
                f"Area:     {alert['area']}\n"
                f"Issued:   {alert['sent']}\n\n"
                f"{atype['cta']}\n\n"
                "Sign in at: http://157.245.125.103/\n\n"
                "— Amber's Angels\n"
                "(You received this because this area matches your watch list. "
                "Update notification preferences from your profile.)"
            )
            for email, full_name in email_pilots:
                try:
                    msg = MIMEText(body_tpl.format(name=full_name or email.split("@")[0]), "plain")
                    msg["Subject"] = subject
                    msg["From"]    = os.getenv("SMTP_FROM", "info@amberangels.org")
                    msg["To"]      = email
                    port = int(os.getenv("SMTP_PORT", "587"))
                    with smtplib.SMTP(smtp_host, port) as s:
                        s.starttls()
                        s.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASS", ""))
                        s.send_message(msg)
                    logger.info("Watch-area email sent to %s", email)
                except Exception as e:
                    logger.error("Watch-area email to %s failed: %s", email, e)


# ---------------------------------------------------------------------------
# Seen-identifier cache  (in-memory + DB-backed so restarts don't re-fire)
# ---------------------------------------------------------------------------
_seen_identifiers: set[str] = set()


async def _load_seen_identifiers(session_factory) -> None:
    """Populate _seen_identifiers from DB on startup so restarts don't re-fire old alerts."""
    async with session_factory() as session:
        try:
            rows = await session.execute(
                text("SELECT identifier FROM processed_alerts WHERE processed_at > NOW() - INTERVAL '24 hours'")
            )
            for (ident,) in rows.fetchall():
                _seen_identifiers.add(ident)
            logger.info("[FEMA] Loaded %d processed identifiers from DB.", len(_seen_identifiers))
        except Exception as e:
            logger.warning("[FEMA] Could not load processed identifiers: %s", e)


async def _persist_identifier(session_factory, ident: str) -> None:
    """Persist a newly-seen identifier so it survives restarts."""
    try:
        async with session_factory() as session:
            await session.execute(
                text("INSERT INTO processed_alerts (identifier) VALUES (:id) ON CONFLICT DO NOTHING"),
                {"id": ident},
            )
            await session.commit()
    except Exception as e:
        logger.warning("[FEMA] Failed to persist identifier %s: %s", ident, e)


# ---------------------------------------------------------------------------
# Main poll coroutine
# ---------------------------------------------------------------------------

async def poll_fema_ipaws(session_factory, webhook_url: Optional[str] = None) -> None:
    logger.info("Polling IPAWS (%dm lookback)...", FEMA_LOOKBACK_MINUTES)

    try:
        # apps.fema.gov does not send its full intermediate cert chain, so Python's
        # SSL stack cannot build the trust path regardless of CA bundle. verify=False
        # is intentional and scoped only to this government endpoint.
        async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
            resp = await client.get(FEMA_URL, headers={"Accept": "application/xml"})
    except Exception as e:
        logger.error("IPAWS fetch error: %s", e)
        return

    if resp.status_code == 404:
        logger.info("No active alerts in lookback window.")
        return
    if resp.status_code != 200:
        logger.warning("IPAWS returned HTTP %s", resp.status_code)
        return

    alerts = _parse_cap_alerts(resp.content)

    if not alerts:
        logger.info("No monitored alerts found.")
        return

    for alert in alerts:
        ident = alert["identifier"]
        if ident in _seen_identifiers:
            continue
        _seen_identifiers.add(ident)
        await _persist_identifier(session_factory, ident)

        # ── Cancellation ──────────────────────────────────────────────────────
        if alert["msg_type"] == "cancel":
            refs = alert["references"]
            # Only act if we've seen at least one of the referenced alerts
            if not any(r in _seen_identifiers for r in refs):
                continue
            logger.info("ALERT CANCELLED — references: %s", refs)
            deactivated = await _deactivate_by_references(session_factory, refs)
            if deactivated:
                logger.info("Deactivated plates: %s", deactivated)
            if webhook_url:
                await _notify_cancelled(webhook_url, alert, deactivated)
            await _push_notify_cancelled(session_factory, alert)
            continue

        # ── Active alert ──────────────────────────────────────────────────────
        atype = alert["alert_type"]
        logger.info(
            "%s detected: %s | %s | Area: %s",
            atype["short"], alert["source_program"], alert["headline"], alert["area"]
        )

        stored = await _add_vehicle_target(session_factory, alert)
        if stored:
            profile = alert.get("vehicle_profile", {})
            vdesc = " ".join(filter(None, [profile.get("color"), profile.get("body_type"), profile.get("make")])).title()
            logger.info("Vehicle target stored: %s", vdesc or "profile incomplete")
            # Seed Flock cameras + road segments for the alert bbox in the background.
            # Both scripts use active FEMA polygons as their bbox source automatically.
            _project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            for _script in ("scripts/scrape_flock.py", "scripts/seed_road_segments.py"):
                subprocess.Popen(
                    ["python3", _script],
                    cwd=_project_root,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )

        await _notify_watching_pilots(session_factory, alert)

        if not alert["plates"]:
            logger.warning("No plate found in alert — sending no-plate notification.")
            if webhook_url:
                await _notify_no_plate(webhook_url, alert)
            continue

        new_plates: list[str] = []
        profile = alert.get("vehicle_profile", {})
        for plate in alert["plates"]:
            desc = (
                f"{alert['source_program']} | {alert['headline']} | "
                f"Area: {alert['area']} | Issued: {alert['sent']} | ID: {ident}"
            )
            inserted = await _add_to_watchlist(
                session_factory, plate, desc,
                alert_type=atype["key"],
                source_program=alert["source_program"],
                vehicle_color=profile.get("color"),
                vehicle_type=profile.get("yolo_body_type"),
                vehicle_make=profile.get("make"),
            )
            if inserted:
                new_plates.append(plate)
                logger.info("Watchlist: %s (%s)", plate, atype["short"])
            else:
                logger.debug("%s already on watchlist.", plate)

        if new_plates and webhook_url:
            await _notify_plates(webhook_url, alert, new_plates)


# ---------------------------------------------------------------------------
# Vehicle target matching (called from ingest pipeline after YOLO)
# ---------------------------------------------------------------------------

import time as _time

_vt_cache:        list[dict] = []
_vt_cache_at:     float      = 0.0
_VT_CACHE_TTL     = 120.0  # refresh every 2 minutes

# Per (target_id, drone_id) cooldown so we don't spam Discord
_match_cooldowns: dict[tuple, float] = {}
_MATCH_COOLDOWN  = 600.0  # 10 minutes


async def _refresh_vehicle_targets(session_factory) -> list[dict]:
    global _vt_cache, _vt_cache_at
    if _time.time() - _vt_cache_at < _VT_CACHE_TTL:
        return _vt_cache
    try:
        async with session_factory() as session:
            rows = (await session.execute(text("""
                SELECT id, alert_type, source_program, headline, area,
                       color, body_type, make
                FROM vehicle_targets
                WHERE expires_at IS NULL OR expires_at > NOW()
                ORDER BY added_at DESC
            """))).fetchall()
        _vt_cache = [
            {
                "id": r[0], "alert_type": r[1], "source_program": r[2],
                "headline": r[3], "area": r[4],
                "color": r[5], "body_type": r[6], "make": r[7],
            }
            for r in rows
        ]
        _vt_cache_at = _time.time()
    except Exception as e:
        logger.warning("Vehicle target cache refresh failed: %s", e)
    return _vt_cache


async def check_vehicle_targets(
    session_factory,
    drone_id: str,
    yolo_vehicles: list,
    webhook_url: str,
) -> None:
    """
    Called from the ingest pipeline after YOLO classification.
    Checks each detected vehicle against active FEMA vehicle targets and
    fires a Discord alert (with 10-minute per-drone cooldown) on a match.
    Matches on color + body_type; either field alone also triggers if the
    other is absent from the target profile.
    """
    if not yolo_vehicles:
        return

    targets = await _refresh_vehicle_targets(session_factory)
    if not targets:
        return

    now = _time.time()

    for target in targets:
        t_color = (target.get("color") or "").lower()
        t_body  = (target.get("body_type") or "").lower()

        for vehicle in yolo_vehicles:
            v_color = (vehicle.color      or "").lower()
            v_body  = (vehicle.body_type  or "").lower()

            color_ok = (not t_color) or (v_color == t_color)
            body_ok  = (not t_body)  or (v_body  == t_body)

            # Need at least one attribute present in target and both to match
            if not (t_color or t_body):
                continue
            if not (color_ok and body_ok):
                continue

            key = (target["id"], drone_id)
            if now - _match_cooldowns.get(key, 0.0) < _MATCH_COOLDOWN:
                continue

            _match_cooldowns[key] = now
            logger.info(
                "Vehicle match: %s %s on drone %s → target #%s (%s)",
                v_color, v_body, drone_id, target["id"], target.get("alert_type", "?")
            )

            if webhook_url:
                await _notify_vehicle_match(
                    webhook_url, target, drone_id,
                    v_color, v_body, vehicle.yolo_conf,
                )
            break  # one match per target per cycle is enough


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------

async def fema_background_loop(session_factory, webhook_url: Optional[str] = None) -> None:
    logger.info("FEMA connector started. Poll interval: %ds", POLL_INTERVAL_SECONDS)
    logger.info("Monitoring: %s", ", ".join(e["short"] for e in ALERT_REGISTRY))
    await _load_seen_identifiers(session_factory)
    while True:
        try:
            await poll_fema_ipaws(session_factory, webhook_url)
        except Exception as e:
            logger.error("Unexpected error in poll loop: %s", e)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
