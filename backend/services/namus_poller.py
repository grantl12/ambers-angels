"""
backend/services/namus_poller.py

Polls the NamUs (National Missing and Unidentified Persons System) API for
recent missing-persons cases that have associated vehicle data, then:

  1. Persists cases in `namus_cases`.
  2. For actionable cases (plate OR make+model present):
     - Adds plate(s) to the watchlist via `_add_to_watchlist`.
     - Inserts a vehicle_targets row for YOLO matching.
     - Fires a Discord embed.
     - Push-notifies watching pilots.
  3. Skips non-actionable cases (no vehicle data) after persisting them.
  4. On startup: loads existing case numbers from DB to avoid re-alerting
     after a PM2 restart.

NamUs API — no auth required for public search:
  POST https://api.namus.nij.ojp.gov/api/CaseSets/NamUs/MissingPersons/Search
  GET  https://api.namus.nij.ojp.gov/api/CaseSets/NamUs/MissingPersons/{caseNumber}

Runs as a FastAPI background task (asyncio loop).
"""

import asyncio
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import certifi as _certifi
import httpx
from sqlalchemy import text

from services.fema_connector import (
    _add_to_watchlist,
    _notify_watching_pilots,
    _post_discord,
)

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

POLL_INTERVAL = int(os.getenv("NAMUS_POLL_INTERVAL", "1800"))   # 30 minutes
RECENT_DAYS   = int(os.getenv("NAMUS_RECENT_DAYS",   "30"))     # search window in days

NAMUS_BASE_URL    = "https://api.namus.nij.ojp.gov"
NAMUS_SEARCH_URL  = f"{NAMUS_BASE_URL}/api/CaseSets/NamUs/MissingPersons/Search"
NAMUS_DETAIL_URL  = f"{NAMUS_BASE_URL}/api/CaseSets/NamUs/MissingPersons/{{case_number}}"
NAMUS_SEARCH_SIZE = 50  # results per page

# Discord embed color — orange, distinct from FEMA amber yellow (0xFFAA00)
_DISCORD_COLOR = 0xFF6B35

# ── In-memory state ───────────────────────────────────────────────────────────

_seen_cases: set[str] = set()         # populated from DB on startup

last_poll_at: Optional[datetime] = None


# ── NamUs API helpers ─────────────────────────────────────────────────────────

def _search_payload(skip: int = 0) -> dict:
    """Build the POST body for a NamUs missing-persons search."""
    from_date = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    return {
        "take": NAMUS_SEARCH_SIZE,
        "skip": skip,
        "filters": {
            "modifiedDate": {"from": from_date},
        },
    }


def _parse_case(raw: dict) -> dict:
    """
    Normalise a NamUs result/detail dict into a flat case dict.

    Handles both search-result items and full detail objects — the structure
    is identical; detail objects just have richer sub-fields.
    """
    def _safe(path: list, default=None):
        node = raw
        for key in path:
            if not isinstance(node, dict):
                return default
            node = node.get(key)
        return node if node is not None else default

    case_number   = _safe(["caseNumber"], "")
    first_name    = _safe(["subjectIdentification", "firstName"], "")
    last_name     = _safe(["subjectIdentification", "lastName"], "")
    name          = f"{first_name} {last_name}".strip() or "Unknown"
    age_now       = _safe(["subjectDescription", "currentAgeFrom"])
    try:
        age_now = int(age_now) if age_now is not None else None
    except (ValueError, TypeError):
        age_now = None

    date_missing_raw = _safe(["circumstances", "dateMissing"], "")
    missing_since: Optional[date] = None
    if date_missing_raw:
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                missing_since = datetime.strptime(date_missing_raw[:19], fmt).date()
                break
            except ValueError:
                continue

    agency  = _safe(["reportingAgency", "agencyDetails"], {}) or {}
    state   = (agency.get("state") or "").strip().upper()[:2] or None
    county  = (agency.get("county") or "").strip() or None
    city    = (agency.get("city")   or "").strip() or None

    vehicles_raw = _safe(["vehicles"], []) or []
    vehicles: list[dict] = []
    for v in vehicles_raw:
        if not isinstance(v, dict):
            continue
        vehicles.append({
            "make":      (v.get("make")     or "").strip() or None,
            "model":     (v.get("model")    or "").strip() or None,
            "year":      str(v.get("year") or "").strip() or None,
            "color":     (v.get("color")    or "").strip().lower() or None,
            "plate":     (v.get("tag")      or "").strip().upper() or None,
            "plate_state": (v.get("tagState") or "").strip().upper() or None,
        })

    return {
        "case_number":  case_number,
        "name":         name,
        "age_now":      age_now,
        "missing_since": missing_since,
        "state":        state,
        "county":       county,
        "city":         city,
        "vehicles":     vehicles,
    }


def _is_actionable(case: dict) -> bool:
    """
    A case is actionable when at least one vehicle has:
      - a non-empty plate, OR
      - both make AND model populated.
    """
    for v in case.get("vehicles", []):
        if v.get("plate"):
            return True
        if v.get("make") and v.get("model"):
            return True
    return False


def _alert_type_for_age(age: Optional[int]) -> str:
    if age is not None and age < 18:
        return "amber"
    if age is not None and age >= 65:
        return "silver"
    return "bolo"


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _load_seen_cases(session_factory) -> None:
    """
    Populate _seen_cases from DB on startup so restarts do not re-alert for
    cases we have already processed.
    """
    global _seen_cases
    async with session_factory() as session:
        try:
            rows = await session.execute(
                text("SELECT namus_id FROM namus_cases")
            )
            for (namus_id,) in rows.fetchall():
                _seen_cases.add(namus_id)
            logger.info("[NamUs] Loaded %d known cases from DB.", len(_seen_cases))
        except Exception as e:
            logger.warning("[NamUs] Could not load initial state: %s", e)


async def _upsert_namus_case(
    session_factory,
    case: dict,
    actionable: bool,
    alert_type: Optional[str] = None,
) -> None:
    """Insert or update a row in namus_cases."""
    async with session_factory() as session:
        try:
            await session.execute(
                text("""
                    INSERT INTO namus_cases
                        (namus_id, subject_name, age_now, state, county, city,
                         missing_since, actionable, alert_type, vehicle_info,
                         first_seen_at, last_seen_at)
                    VALUES
                        (:namus_id, :name, :age, :state, :county, :city,
                         :missing_since, :actionable, :alert_type, :vehicle_info,
                         NOW(), NOW())
                    ON CONFLICT (namus_id) DO UPDATE
                        SET last_seen_at  = NOW(),
                            actionable    = EXCLUDED.actionable,
                            alert_type    = COALESCE(EXCLUDED.alert_type, namus_cases.alert_type),
                            vehicle_info  = COALESCE(EXCLUDED.vehicle_info, namus_cases.vehicle_info),
                            resolved_at   = NULL
                """),
                {
                    "namus_id":    case["case_number"],
                    "name":        case["name"],
                    "age":         case.get("age_now"),
                    "state":       case.get("state"),
                    "county":      case.get("county"),
                    "city":        case.get("city"),
                    "missing_since": case.get("missing_since"),
                    "actionable":  actionable,
                    "alert_type":  alert_type,
                    "vehicle_info": (
                        json.dumps(case["vehicles"]) if case.get("vehicles") else None
                    ),
                },
            )
            await session.commit()
        except Exception as e:
            logger.error("[NamUs] DB upsert failed for %s: %s", case["case_number"], e)
            await session.rollback()


async def _insert_vehicle_target(
    session_factory,
    case: dict,
    vehicle: dict,
    fema_identifier: str,
    alert_type: str,
) -> bool:
    """
    Insert a vehicle_targets row for a NamUs vehicle.
    ON CONFLICT DO NOTHING — re-polls are idempotent.
    Returns True if a new row was inserted.
    """
    color     = vehicle.get("color")
    make      = vehicle.get("make")
    model     = vehicle.get("model")
    body_type = None  # NamUs does not supply YOLO body_type; leave NULL

    # Build a human-readable area string from the case location
    location_parts = [p for p in [case.get("city"), case.get("county"), case.get("state")] if p]
    area = ", ".join(location_parts) if location_parts else None

    headline_parts = [
        f"NamUs BOLO — {case['name']}",
        f"Age: {case['age_now']}" if case.get("age_now") is not None else None,
        f"Missing since: {case.get('missing_since')}" if case.get("missing_since") else None,
    ]
    headline = " | ".join(p for p in headline_parts if p)

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
                         NULL, NULL, NULL, :expires_at)
                    ON CONFLICT (fema_identifier) DO NOTHING
                """),
                {
                    "fema_id":    fema_identifier,
                    "atype":      alert_type,
                    "prog":       "NamUs NIJ",
                    "headline":   headline,
                    "area":       area,
                    "color":      color,
                    "body_type":  body_type,
                    "make":       make,
                    "expires_at": datetime.now(timezone.utc) + timedelta(days=RECENT_DAYS),
                },
            )
            await session.commit()
            return (result.rowcount or 0) > 0
        except Exception as e:
            logger.error(
                "[NamUs] vehicle_targets insert failed for %s / %s: %s",
                case["case_number"], fema_identifier, e,
            )
            await session.rollback()
            return False


# ── Discord notifications ─────────────────────────────────────────────────────

async def _post_namus_discord(webhook_url: str, case: dict, alert_type: str) -> None:
    """Post a rich Discord embed for a new actionable NamUs case."""
    if not webhook_url:
        return

    case_number = case["case_number"]
    name        = case["name"]
    age         = case.get("age_now")
    age_str     = str(age) if age is not None else "Unknown"
    missing_str = str(case["missing_since"]) if case.get("missing_since") else "Unknown"

    location_parts = [p for p in [case.get("city"), case.get("county"), case.get("state")] if p]
    location_str   = ", ".join(location_parts) if location_parts else "Unknown"

    vehicles = case.get("vehicles", [])
    vehicle_lines: list[str] = []
    plate_lines:   list[str] = []
    for v in vehicles:
        parts = [p for p in [v.get("year"), v.get("color"), v.get("make"), v.get("model")] if p]
        vdesc = " ".join(parts).title() if parts else "Unknown vehicle"
        vehicle_lines.append(vdesc)
        if v.get("plate"):
            plate_str = v["plate"]
            if v.get("plate_state"):
                plate_str = f"{v['plate_state']} {plate_str}"
            plate_lines.append(f"`{plate_str}`")

    vehicles_str = "\n".join(vehicle_lines) if vehicle_lines else "—"
    plates_str   = ", ".join(plate_lines) if plate_lines else "—"

    # Build a plain-text embed approximation (Discord webhooks accept embeds
    # but the codebase uses plain content strings via _post_discord).
    alert_label = alert_type.upper()
    content = (
        f"🔍 **NAMUS {alert_label} — {name}** 🔍\n"
        f"**Case:** {case_number}\n"
        f"**Name:** {name}\n"
        f"**Age:** {age_str}\n"
        f"**Missing Since:** {missing_str}\n"
        f"**Last Known Location:** {location_str}\n"
        f"**Vehicle(s):** {vehicles_str}\n"
        f"**Plate(s):** {plates_str}\n"
        f"🔗 https://www.namus.gov/MissingPersons/Case#{case_number}\n"
        f"📋 Source: NamUs NIJ — Case {case_number}"
    )
    await _post_discord(webhook_url, content)


# ── Per-case processing ───────────────────────────────────────────────────────

async def _process_case(
    case: dict,
    session_factory,
    webhook_url: Optional[str],
) -> None:
    """
    Handle one NamUs case end-to-end:
      - Adequacy check → skip or process
      - Watchlist + vehicle_targets inserts
      - Discord + push notifications
      - DB upsert
    """
    case_number = case["case_number"]
    if not case_number:
        logger.debug("[NamUs] Case missing caseNumber, skipping.")
        return

    if case_number in _seen_cases:
        logger.debug("[NamUs] %s already seen, skipping.", case_number)
        return

    _seen_cases.add(case_number)

    actionable = _is_actionable(case)
    if not actionable:
        logger.debug("[NamUs] %s not actionable (no vehicle/plate data).", case_number)
        await _upsert_namus_case(session_factory, case, actionable=False)
        return

    alert_type = _alert_type_for_age(case.get("age_now"))
    logger.info(
        "[NamUs] New actionable case: %s | %s | age=%s | type=%s | vehicles=%d",
        case_number, case["name"],
        case.get("age_now", "?"), alert_type, len(case.get("vehicles", [])),
    )

    # Build a watchlist description embedding the case identifier
    location_parts = [p for p in [case.get("city"), case.get("county"), case.get("state")] if p]
    location_str   = ", ".join(location_parts) if location_parts else "Unknown"
    base_desc = (
        f"NamUs {alert_type.upper()} | {case['name']} | "
        f"Missing from: {location_str} | "
        f"Since: {case.get('missing_since') or '?'} | "
        f"ID: namus-{case_number}"
    )

    vehicles = case.get("vehicles", [])
    for i, vehicle in enumerate(vehicles):
        fema_identifier = f"namus-{case_number}-{i}"

        # ── vehicle_targets row ───────────────────────────────────────────────
        try:
            await _insert_vehicle_target(
                session_factory, case, vehicle, fema_identifier, alert_type
            )
        except Exception as e:
            logger.error("[NamUs] vehicle_target insert error for %s veh %d: %s", case_number, i, e)

        # ── watchlist (plate only) ────────────────────────────────────────────
        if vehicle.get("plate"):
            plate = vehicle["plate"]
            vdesc_parts = [p for p in [
                str(vehicle.get("year") or ""),
                vehicle.get("color"),
                vehicle.get("make"),
                vehicle.get("model"),
            ] if p]
            vdesc = " ".join(vdesc_parts).strip()
            desc  = f"{base_desc} | Vehicle: {vdesc}" if vdesc else base_desc
            try:
                inserted = await _add_to_watchlist(
                    session_factory,
                    plate=plate,
                    description=desc,
                    alert_type=alert_type,
                    source_program="NamUs NIJ",
                    vehicle_color=vehicle.get("color"),
                    vehicle_type=None,    # NamUs provides make/model but not YOLO body_type
                    vehicle_make=vehicle.get("make"),
                )
                if inserted:
                    logger.info("[NamUs] Watchlist: %s (%s, %s)", plate, case_number, alert_type)
                else:
                    logger.debug("[NamUs] Plate %s already on watchlist.", plate)
            except Exception as e:
                logger.error("[NamUs] Watchlist insert error for plate %s: %s", plate, e)

    # ── Notifications ─────────────────────────────────────────────────────────
    if webhook_url:
        try:
            await _post_namus_discord(webhook_url, case, alert_type)
        except Exception as e:
            logger.error("[NamUs] Discord notify failed for %s: %s", case_number, e)

    # Push-notify watching pilots.  _notify_watching_pilots expects an "alert dict"
    # shaped like a FEMA alert — we build the minimal fields it needs.
    _alert_dict_for_push = {
        "alert_type": {
            "key":   alert_type,
            "short": alert_type.upper(),
            "name":  {"amber": "Amber Alert", "silver": "Silver Alert"}.get(alert_type, "BOLO"),
            "emoji": {"amber": "🟠", "silver": "⚪"}.get(alert_type, "🔍"),
            "cta":   "Check your area for this vehicle.",
        },
        "headline": f"NamUs {alert_type.upper()} — {case['name']}",
        "area":     location_str,
        "sent":     datetime.now(timezone.utc).isoformat(),
        "polygon":  None,
    }
    try:
        await _notify_watching_pilots(session_factory, _alert_dict_for_push)
    except Exception as e:
        logger.error("[NamUs] Push notify failed for %s: %s", case_number, e)

    # ── DB upsert ─────────────────────────────────────────────────────────────
    await _upsert_namus_case(session_factory, case, actionable=True, alert_type=alert_type)


# ── Poll cycle ────────────────────────────────────────────────────────────────

async def _poll_namus(session_factory, webhook_url: Optional[str]) -> None:
    """
    One full poll cycle: search for recently modified cases, paginate until
    exhausted, process each new case.
    """
    skip       = 0
    total_seen = 0

    async with httpx.AsyncClient(
        verify=_certifi.where(),
        timeout=20.0,
        headers={
            "User-Agent":   "AmberAngels-AlertMonitor/1.0",
            "Content-Type": "application/json",
            "Accept":       "application/json",
        },
    ) as client:
        while True:
            payload = _search_payload(skip=skip)
            try:
                resp = await client.post(NAMUS_SEARCH_URL, json=payload)
            except Exception as e:
                logger.warning("[NamUs] Search request failed (skip=%d): %s", skip, e)
                break

            if resp.status_code != 200:
                logger.warning("[NamUs] Search returned HTTP %s (skip=%d)", resp.status_code, skip)
                break

            try:
                data = resp.json()
            except Exception as e:
                logger.warning("[NamUs] Search response not valid JSON: %s", e)
                break

            results = data.get("results") or []
            if not results:
                break  # no more pages

            for raw_case in results:
                total_seen += 1
                try:
                    case = _parse_case(raw_case)
                    if not case["case_number"]:
                        continue

                    # If already known, skip without fetching detail
                    if case["case_number"] in _seen_cases:
                        logger.debug("[NamUs] %s already seen.", case["case_number"])
                        continue

                    # Fetch full detail if the search result vehicles list is empty —
                    # some search results omit nested arrays until the detail is fetched.
                    if not case.get("vehicles"):
                        detail_url = NAMUS_DETAIL_URL.format(case_number=case["case_number"])
                        try:
                            detail_resp = await client.get(detail_url)
                            if detail_resp.status_code == 200:
                                case = _parse_case(detail_resp.json())
                        except Exception as e:
                            logger.debug(
                                "[NamUs] Could not fetch detail for %s: %s",
                                case["case_number"], e,
                            )

                    await _process_case(case, session_factory, webhook_url)

                except Exception as e:
                    logger.error("[NamUs] Error processing case: %s — %s", raw_case.get("caseNumber", "?"), e)

                # Brief yield between cases to avoid blocking the event loop
                await asyncio.sleep(0)

            # Advance page
            skip += NAMUS_SEARCH_SIZE
            if len(results) < NAMUS_SEARCH_SIZE:
                break  # last page

            # Small courtesy delay between pages
            await asyncio.sleep(1.0)

    logger.info("[NamUs] Poll complete. %d case(s) inspected.", total_seen)


# ── Background loop ───────────────────────────────────────────────────────────

async def namus_background_loop(
    session_factory,
    webhook_url: Optional[str] = None,
) -> None:
    """
    Long-running coroutine. Wire into the FastAPI lifespan background tasks
    alongside ncmec_background_loop and fema_background_loop.

    Usage:
        asyncio.create_task(namus_background_loop(AsyncSessionLocal, WEBHOOK_URL))
    """
    from services.health_tracker import stamp
    global last_poll_at

    logger.info(
        "[NamUs] Started. Poll interval: %ds, recent window: %d days",
        POLL_INTERVAL, RECENT_DAYS,
    )

    await _load_seen_cases(session_factory)

    while True:
        last_poll_at = datetime.now(timezone.utc)
        try:
            await _poll_namus(session_factory, webhook_url)
        except Exception as e:
            logger.error("[NamUs] Unexpected error in poll loop: %s", e)
        stamp("namus")
        await asyncio.sleep(POLL_INTERVAL)
