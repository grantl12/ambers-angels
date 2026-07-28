"""
backend/services/ncmec_poller.py

Polls NCMEC (National Center for Missing & Exploited Children) RSS feeds
for all 50 US states every 30 minutes to:

  1. Persist active missing-children cases in `ncmec_cases`.
  2. Detect when a case disappears from the feed (child found / alert resolved)
     and fire a Discord + push "possibly resolved" notification.
  3. When a new case appears in a state that has an active FEMA vehicle target,
     post a Discord cross-reference with the child's NCMEC photo link.

Feed URL pattern:
  https://www.missingkids.org/missingkids/servlet/XmlServlet
      ?act=rss&LanguageCountry=en_US&orgPrefix=NCMC&state={STATE}
"""

import asyncio
import logging
import os
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx
import certifi as _certifi
from sqlalchemy import text

from services.fema_connector import _post_discord
from services import push_service

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

POLL_INTERVAL = int(os.getenv("NCMEC_POLL_INTERVAL", "1800"))   # 30 minutes
RECENT_DAYS   = int(os.getenv("NCMEC_RECENT_DAYS",   "30"))     # track cases missing ≤ N days ago

NCMEC_URL = (
    "https://www.missingkids.org/missingkids/servlet/XmlServlet"
    "?act=rss&LanguageCountry=en_US&orgPrefix=NCMC&state={state}"
)

US_STATES = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
    "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
    "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
    "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]

# ── In-memory state ───────────────────────────────────────────────────────────

# Per-state set of GUIDs seen in the most recent successful poll.
# On startup we populate this from DB so we don't flood with "resolved"
# notifications for cases that were already resolved before this boot.
_prev_cases:  dict[str, set[str]] = {}   # state → set of GUIDs
_initialized: bool = False

last_poll_at:       Optional[datetime] = None
last_resolved_at:   Optional[datetime] = None
last_new_case_at:   Optional[datetime] = None


# ── Feed parsing ──────────────────────────────────────────────────────────────

_DESC_RE = re.compile(
    r"^(?P<name>.+?),\s*Age Now:\s*(?P<age>\d+).*?"
    r"Missing:\s*(?P<missing>\d{2}/\d{2}/\d{4}).*?"
    r"Missing From\s+(?P<city>[^,]+),\s*[A-Z]{2}",
    re.IGNORECASE | re.DOTALL,
)

# Vehicle mention patterns in NCMEC description text
_VEHICLE_RE = re.compile(
    r"(?:may be in|last seen in|possibly in|traveling in|in a)\s+(?:a\s+)?"
    r"(?P<vehicle>.{8,80}?)(?:\.|\band\b|$)",
    re.IGNORECASE | re.DOTALL,
)
_PLATE_RE = re.compile(
    r"(?:[A-Z]{2})\s+(?:tag|plate|license plate|registration)\s+([A-Z0-9\-]{4,9})"
    r"|(?:plate|tag|license)\s*[#:\s]+([A-Z0-9\-]{4,9})",
    re.IGNORECASE,
)

def _extract_vehicle(desc: str) -> tuple[str | None, str | None]:
    """Return (vehicle_description, plate) extracted from NCMEC RSS description text."""
    vm = _VEHICLE_RE.search(desc)
    vehicle = vm.group("vehicle").strip() if vm else None
    pm = _PLATE_RE.search(desc)
    plate = next((g for g in (pm.group(1), pm.group(2)) if g), None) if pm else None
    return vehicle, plate

def _parse_feed(xml_bytes: bytes, state: str) -> list[dict]:
    """
    Parse NCMEC RSS and return a list of case dicts:
        guid, name, age_now, state, city, missing_since, poster_url, photo_url
    Only includes cases missing within the last RECENT_DAYS days.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        logger.warning("[NCMEC/%s] XML parse error: %s", state, e)
        return []

    cutoff = date.today() - timedelta(days=RECENT_DAYS)
    cases: list[dict] = []

    for item in root.findall(".//item"):
        def txt(tag: str) -> str:
            el = item.find(tag)
            return el.text.strip() if el is not None and el.text else ""

        guid       = txt("guid") or txt("link")
        poster_url = txt("link")
        desc       = txt("description")
        photo_url  = ""
        enc = item.find("enclosure")
        if enc is not None:
            photo_url = enc.get("url", "")

        m = _DESC_RE.match(desc)
        if not m:
            continue

        name = m.group("name").strip()
        try:
            age = int(m.group("age"))
        except ValueError:
            age = 0

        try:
            missing_since = datetime.strptime(m.group("missing"), "%m/%d/%Y").date()
        except ValueError:
            missing_since = None

        # Skip cases that are older than our recency window
        if missing_since and missing_since < cutoff:
            continue

        city = m.group("city").strip().title()
        vehicle_desc, vehicle_plate = _extract_vehicle(desc)

        cases.append({
            "guid":               guid,
            "name":               name,
            "age_now":            age,
            "state":              state,
            "city":               city,
            "missing_since":      missing_since,
            "poster_url":         poster_url,
            "photo_url":          photo_url,
            "vehicle_description": vehicle_desc,
            "vehicle_plate":      vehicle_plate,
        })

    return cases


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _upsert_cases(session_factory, cases: list[dict]) -> list[dict]:
    """
    Insert new cases; update last_seen_at for existing ones.
    Returns the subset that are genuinely new (first_seen_at just set).
    """
    new_cases: list[dict] = []
    if not cases:
        return new_cases

    async with session_factory() as session:
        try:
            for c in cases:
                result = await session.execute(
                    text("""
                        INSERT INTO ncmec_cases
                            (guid, name, age_now, state, city,
                             missing_since, poster_url, photo_url,
                             vehicle_description, vehicle_plate,
                             first_seen_at, last_seen_at)
                        VALUES
                            (:guid, :name, :age, :state, :city,
                             :missing_since, :poster_url, :photo_url,
                             :vehicle_description, :vehicle_plate,
                             NOW(), NOW())
                        ON CONFLICT (guid) DO UPDATE
                            SET last_seen_at        = NOW(),
                                resolved_at         = NULL,
                                vehicle_description = COALESCE(EXCLUDED.vehicle_description, ncmec_cases.vehicle_description),
                                vehicle_plate       = COALESCE(EXCLUDED.vehicle_plate, ncmec_cases.vehicle_plate)
                        RETURNING (xmax = 0) AS is_new
                    """),
                    {
                        "guid":               c["guid"],
                        "name":               c["name"],
                        "age":                c["age_now"],
                        "state":              c["state"],
                        "city":               c["city"],
                        "missing_since":      c["missing_since"],
                        "poster_url":         c["poster_url"],
                        "photo_url":          c["photo_url"],
                        "vehicle_description": c.get("vehicle_description"),
                        "vehicle_plate":      c.get("vehicle_plate"),
                    },
                )
                row = result.fetchone()
                if row and row[0]:
                    new_cases.append(c)
            await session.commit()
        except Exception as e:
            logger.error("[NCMEC] DB upsert failed: %s", e)
            await session.rollback()

    return new_cases


async def _mark_resolved(session_factory, guids: list[str]) -> list[dict]:
    """
    Mark cases as resolved. Returns the cases that were previously unresolved.
    """
    if not guids:
        return []

    async with session_factory() as session:
        try:
            rows = await session.execute(
                text("""
                    UPDATE ncmec_cases
                    SET resolved_at = NOW()
                    WHERE guid = ANY(:guids)
                      AND resolved_at IS NULL
                    RETURNING name, age_now, state, city, missing_since,
                              poster_url, photo_url
                """),
                {"guids": guids},
            )
            resolved = [
                {
                    "name":         r[0],
                    "age_now":      r[1],
                    "state":        r[2],
                    "city":         r[3],
                    "missing_since": r[4],
                    "poster_url":   r[5],
                    "photo_url":    r[6],
                }
                for r in rows.fetchall()
            ]
            await session.commit()
            return resolved
        except Exception as e:
            logger.error("[NCMEC] Mark-resolved failed: %s", e)
            await session.rollback()
            return []


async def _active_vehicle_target_in_state(session_factory, state: str) -> bool:
    """True if we have an unexpired FEMA vehicle target whose area mentions this state."""
    state_names = {
        "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California",
        "CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia",
        "HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa",
        "KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland",
        "MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi",
        "MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire",
        "NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina",
        "ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania",
        "RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee",
        "TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington",
        "WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming",
    }
    state_name = state_names.get(state, state)
    async with session_factory() as session:
        try:
            row = await session.execute(
                text("""
                    SELECT 1 FROM vehicle_targets
                    WHERE (expires_at IS NULL OR expires_at > NOW())
                      AND (area ILIKE :abbr OR area ILIKE :name)
                    LIMIT 1
                """),
                {"abbr": f"% {state} %", "name": f"%{state_name}%"},
            )
            return row.fetchone() is not None
        except Exception:
            return False


async def _load_initial_state(session_factory) -> None:
    """
    Populate _prev_cases from DB on startup so we don't re-fire resolved
    notifications for cases that were already gone before this boot.
    """
    global _prev_cases, _initialized
    async with session_factory() as session:
        try:
            rows = await session.execute(
                text("""
                    SELECT state, guid FROM ncmec_cases
                    WHERE resolved_at IS NULL
                      AND last_seen_at > NOW() - INTERVAL '2 hours'
                """)
            )
            for state, guid in rows.fetchall():
                _prev_cases.setdefault(state, set()).add(guid)
        except Exception as e:
            logger.warning("[NCMEC] Could not load initial state: %s", e)
    _initialized = True


# ── Notifications ─────────────────────────────────────────────────────────────

async def _notify_resolved(webhook_url: str, cases: list[dict]) -> None:
    for c in cases:
        content = (
            f"✅ **POSSIBLY RESOLVED — {c['state']}** ✅\n"
            f"**{c['name']}**, age {c['age_now']} — "
            f"missing from {c['city']}, {c['state']} "
            f"since {c['missing_since'] or '?'}\n"
            f"Removed from NCMEC feed — child may have been found.\n"
            f"🔗 {c['poster_url']}"
        )
        await _post_discord(webhook_url, content)


async def _notify_new_case(
    webhook_url: str,
    case: dict,
    has_vehicle_target: bool = False,
) -> None:
    if has_vehicle_target:
        header = f"🟠 **NEW NCMEC CASE — ACTIVE VEHICLE TARGET IN {case['state']}** 🟠"
        footer = "\n⚠️ Cross-reference with active vehicle target in this state."
    else:
        header = f"🔴 **NEW MISSING CHILD — {case['state']}** 🔴"
        footer = ""
    content = (
        f"{header}\n"
        f"**{case['name']}**, age {case['age_now']} — "
        f"missing from {case['city']}, {case['state']} "
        f"since {case['missing_since'] or '?'}\n"
        f"📸 Photo: {case['photo_url']}\n"
        f"🔗 {case['poster_url']}"
        f"{footer}"
    )
    await _post_discord(webhook_url, content)


async def _push_notify_resolved(session_factory, case: dict) -> None:
    """Push 'possibly resolved' to admin + nationwide pilots."""
    try:
        async with session_factory() as session:
            rows = await session.execute(
                text("""
                    SELECT DISTINCT username, expo_push_token FROM pilots
                    WHERE status = 'approved'
                      AND (role = 'admin' OR alert_scope = 'nationwide')
                """)
            )
            recipients = [(r[0], r[1]) for r in rows.fetchall()]
    except Exception as e:
        logger.error("[NCMEC] Push token query failed: %s", e)
        return

    await push_service.send_push_notifications(
        session_factory,
        recipients,
        f"✅ Possibly Resolved — {case['state']}",
        f"{case['name']} removed from NCMEC — may have been found.",
        "ncmec_resolved",
    )


# ── Per-state poll ────────────────────────────────────────────────────────────

async def _poll_state(
    state: str,
    session_factory,
    webhook_url: Optional[str],
) -> None:
    global last_resolved_at, last_new_case_at

    url = NCMEC_URL.format(state=state)
    try:
        async with httpx.AsyncClient(verify=_certifi.where(), timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "AmberAngels-AlertMonitor/1.0"})
    except Exception as e:
        logger.warning("[NCMEC/%s] Fetch error: %s", state, e)
        return

    if resp.status_code != 200:
        logger.debug("[NCMEC/%s] HTTP %s", state, resp.status_code)
        return

    cases = _parse_feed(resp.content, state)
    current_guids = {c["guid"] for c in cases}

    # ── Detect resolved ───────────────────────────────────────────────────────
    prev_guids = _prev_cases.get(state, set())
    disappeared_guids = list(prev_guids - current_guids)
    if disappeared_guids:
        resolved = await _mark_resolved(session_factory, disappeared_guids)
        if resolved:
            logger.info("[NCMEC/%s] %d case(s) resolved: %s",
                        state, len(resolved), [r["name"] for r in resolved])
            last_resolved_at = datetime.now(timezone.utc)
            # Push notifications for resolved cases disabled — DB still marked resolved.

    _prev_cases[state] = current_guids

    if not cases:
        return

    # ── Upsert and detect new cases ───────────────────────────────────────────
    new_cases = await _upsert_cases(session_factory, cases)
    if new_cases:
        logger.info("[NCMEC/%s] %d new case(s): %s",
                    state, len(new_cases), [c["name"] for c in new_cases])
        last_new_case_at = datetime.now(timezone.utc)

        if webhook_url:
            has_target = await _active_vehicle_target_in_state(session_factory, state)
            if has_target:
                for c in new_cases:
                    await _notify_new_case(webhook_url, c, has_vehicle_target=True)


# ── Background loop ───────────────────────────────────────────────────────────

async def ncmec_background_loop(
    session_factory,
    webhook_url: Optional[str] = None,
) -> None:
    from services.health_tracker import stamp
    global last_poll_at

    logger.info("[NCMEC] Started. %d states, interval: %ds, recent window: %d days",
                len(US_STATES), POLL_INTERVAL, RECENT_DAYS)

    await _load_initial_state(session_factory)

    while True:
        last_poll_at = datetime.now(timezone.utc)
        try:
            # Stagger requests — don't hammer NCMEC with 50 simultaneous GETs
            for state in US_STATES:
                await _poll_state(state, session_factory, webhook_url)
                await asyncio.sleep(0.5)  # 0.5s between states → ~25s total per cycle
        except Exception as e:
            logger.error("[NCMEC] Unexpected error: %s", e)
        stamp("ncmec")

        await asyncio.sleep(POLL_INTERVAL)
