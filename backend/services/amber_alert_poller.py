"""
backend/services/amber_alert_poller.py

Supplementary alert poller that fills the gap when FEMA IPAWS CMAS doesn't
carry a particular state's AMBER alert.

Sources polled each cycle (deduplicated cross-source via shared _seen_identifiers):
  1. FEMA IPAWS EAS endpoint  — Emergency Alert System CAP XML (same format as CMAS)
  2. amber.alert.gov          — DOJ national AMBER alert registry (HTML scrape fallback)

Reuses parsing + notification functions from fema_connector so all three paths
(CMAS, EAS, amber.alert.gov) produce identical watchlist rows and Discord messages.
"""

import asyncio
import logging
import os
import re
import hashlib
from datetime import datetime, timezone
from typing import Optional

import httpx

from services.fema_connector import (
    _seen_identifiers,
    _parse_cap_alerts,
    _extract_plates,
    _extract_vehicle_profile,
    _add_to_watchlist,
    _add_vehicle_target,
    _notify_watching_pilots,
    _notify_no_plate,
    _notify_plates,
    _deactivate_by_references,
    _notify_cancelled,
    _push_notify_cancelled,
    ALERT_REGISTRY,
)

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

POLL_INTERVAL  = int(os.getenv("AMBER_POLL_INTERVAL", "120"))   # 2 minutes
EAS_LOOKBACK   = int(os.getenv("FEMA_LOOKBACK_MINUTES", "60"))

EAS_URL        = (
    "https://apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/public/eas/get/recent/"
    f"{EAS_LOOKBACK}"
)
AMBER_GOV_URLS: list[str] = []  # amber.alert.gov DNS does not resolve — disabled

# Track last poll timestamps for health endpoint
last_eas_poll_at:        Optional[datetime] = None
last_amber_gov_poll_at:  Optional[datetime] = None
last_alert_seen_at:      Optional[datetime] = None


# ── EAS (CAP XML) ─────────────────────────────────────────────────────────────

async def _poll_eas(session_factory, webhook_url: Optional[str]) -> int:
    """
    Poll FEMA IPAWS EAS endpoint. Returns number of new alerts processed.
    Same CAP XML format as CMAS — reuses _parse_cap_alerts directly.
    """
    global last_eas_poll_at
    last_eas_poll_at = datetime.now(timezone.utc)

    try:
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            resp = await client.get(EAS_URL, headers={"Accept": "application/xml"})
    except Exception as e:
        logger.error("[EAS] Fetch error: %s", e)
        return 0

    if resp.status_code == 404:
        logger.info("[EAS] No active alerts in lookback window.")
        return 0
    if resp.status_code != 200:
        logger.warning("[EAS] HTTP %s", resp.status_code)
        return 0

    alerts = _parse_cap_alerts(resp.content)
    if not alerts:
        logger.info("[EAS] No monitored alerts in response.")
        return 0

    return await _process_alerts(alerts, session_factory, webhook_url, source="EAS")


# ── amber.alert.gov scraper ───────────────────────────────────────────────────

_AMBER_ENTRY_RE = re.compile(
    r"(?P<state>[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[-–]\s*(?P<headline>[^\n]{10,120})",
    re.MULTILINE,
)

def _scrape_amber_gov(html: str) -> list[dict]:
    """
    Parse amber.alert.gov HTML into minimal alert dicts compatible with
    the _process_alerts pipeline. We treat the whole page as one big text blob
    and extract any plate numbers + vehicle descriptions we find. Each unique
    plate (or plate-less alert block) becomes one alert record.

    The identifier is a deterministic hash of (headline + area) so re-scraping
    the same active alert within a session won't re-notify.
    """
    alerts: list[dict] = []
    seen_ids: set[str] = set()

    # Strip HTML tags to get plain text
    text_clean = re.sub(r"<[^>]+>", " ", html)
    text_clean = re.sub(r"\s+", " ", text_clean)

    # Split on known separator patterns (state names followed by AMBER ALERT or similar)
    segments = re.split(
        r"(?i)(?=\b(?:AMBER ALERT|AMBER Alert|Child Abduction Emergency)\b)",
        text_clean,
    )

    amber_entry = ALERT_REGISTRY[0]  # AMBER is index 0 / priority 1

    for seg in segments:
        if len(seg.strip()) < 30:
            continue

        plates   = _extract_plates(seg)
        profile  = _extract_vehicle_profile(seg)
        headline = seg.strip()[:120].split(".")[0].strip()
        area     = ""

        # Try to extract a US state name as the area
        state_m = re.search(
            r"\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|"
            r"Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|"
            r"Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|"
            r"Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|"
            r"New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|"
            r"Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|"
            r"Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b",
            seg,
        )
        if state_m:
            area = state_m.group(1)

        ident_raw = f"ambgov:{headline}:{area}"
        ident = hashlib.sha256(ident_raw.encode()).hexdigest()[:32]

        if ident in seen_ids:
            continue
        seen_ids.add(ident)

        alerts.append({
            "identifier":      ident,
            "sent":            datetime.now(timezone.utc).isoformat(),
            "headline":        headline,
            "description":     seg.strip()[:500],
            "area":            area,
            "polygon":         None,
            "plates":          plates,
            "vehicle_profile": profile,
            "alert_type":      amber_entry,
            "source_program":  "AMBER Alert (amber.alert.gov)",
        })

    return alerts


async def _poll_amber_gov(session_factory, webhook_url: Optional[str]) -> int:
    """
    Scrape amber.alert.gov and process any new alerts found.
    Returns number of new alerts processed.
    """
    global last_amber_gov_poll_at
    last_amber_gov_poll_at = datetime.now(timezone.utc)

    html: Optional[str] = None
    for url in AMBER_GOV_URLS:
        try:
            async with httpx.AsyncClient(
                timeout=15.0,
                verify=False,
                follow_redirects=True,
                headers={"User-Agent": "AmberAngels-AlertMonitor/1.0"},
            ) as client:
                # Try JSON first
                resp = await client.get(url, headers={"Accept": "application/json"})
                ct = resp.headers.get("content-type", "")
                if resp.status_code == 200 and "json" in ct:
                    # Future: parse structured JSON if DOJ ever adds an API
                    logger.info("[AMBGOV] Got JSON response from %s — JSON parser not yet implemented", url)
                    break

                # Fall back to HTML
                resp = await client.get(url)
                if resp.status_code == 200:
                    html = resp.text
                    logger.debug("[AMBGOV] Fetched %d bytes from %s", len(html), url)
                    break
                else:
                    logger.info("[AMBGOV] %s returned HTTP %s", url, resp.status_code)
        except Exception as e:
            logger.warning("[AMBGOV] %s fetch error: %s", url, e)

    if not html:
        logger.info("[AMBGOV] Could not fetch any amber.alert.gov URL.")
        return 0

    # Only continue if the page looks like it has real alert data
    if not re.search(r"(?i)(AMBER\s+ALERT|Child\s+Abduction|license\s+plate)", html):
        logger.info("[AMBGOV] Page fetched but no alert keywords found (may be no active alerts).")
        return 0

    alerts = _scrape_amber_gov(html)
    if not alerts:
        logger.info("[AMBGOV] No parseable alerts found on page.")
        return 0

    logger.info("[AMBGOV] Parsed %d potential alert segment(s).", len(alerts))
    return await _process_alerts(alerts, session_factory, webhook_url, source="AMBGOV")


# ── Shared processing ─────────────────────────────────────────────────────────

async def _process_alerts(
    alerts: list[dict],
    session_factory,
    webhook_url: Optional[str],
    source: str,
) -> int:
    global last_alert_seen_at
    processed = 0

    for alert in alerts:
        ident = alert["identifier"]
        if ident in _seen_identifiers:
            continue
        _seen_identifiers.add(ident)

        # ── Cancellation ──────────────────────────────────────────────────────
        if alert.get("msg_type") == "cancel":
            refs = alert.get("references", [])
            if not any(r in _seen_identifiers for r in refs):
                continue
            logger.info("[%s] ALERT CANCELLED — references: %s", source, refs)
            deactivated = await _deactivate_by_references(session_factory, refs)
            if deactivated:
                logger.info("[%s] Deactivated plates: %s", source, deactivated)
            if webhook_url:
                await _notify_cancelled(webhook_url, alert, deactivated)
            await _push_notify_cancelled(session_factory, alert)
            processed += 1
            continue

        # ── Active alert ──────────────────────────────────────────────────────
        last_alert_seen_at = datetime.now(timezone.utc)
        atype = alert["alert_type"]

        logger.info(
            "[%s] %s: %s | Area: %s",
            source, atype["short"], alert["headline"], alert["area"],
        )

        await _add_vehicle_target(session_factory, alert)
        await _notify_watching_pilots(session_factory, alert)

        if not alert["plates"]:
            logger.warning("[%s] No plate found — sending no-plate notification.", source)
            if webhook_url:
                await _notify_no_plate(webhook_url, alert)
        else:
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

            if new_plates and webhook_url:
                await _notify_plates(webhook_url, alert, new_plates)

        processed += 1

    return processed


# ── Background loop ───────────────────────────────────────────────────────────

async def amber_background_loop(
    session_factory,
    webhook_url: Optional[str] = None,
) -> None:
    logger.info("[AMBER POLLER] Started. EAS + amber.alert.gov. Interval: %ds", POLL_INTERVAL)
    while True:
        try:
            eas_n   = await _poll_eas(session_factory, webhook_url)
            gov_n   = await _poll_amber_gov(session_factory, webhook_url)
            total   = eas_n + gov_n
            if total:
                logger.info("[AMBER POLLER] Cycle complete — %d new alert(s) processed.", total)
        except Exception as e:
            logger.error("[AMBER POLLER] Unexpected error: %s", e)
        await asyncio.sleep(POLL_INTERVAL)
