"""
backend/services/bolo_crawler.py

Crawls configurable BOLO / missing-persons sources (RSS, HTML) and creates
watchlist + vehicle_targets entries for actionable cases.

Extraction is done entirely on-device via bolo_extractor.py (regex + spaCy
NER) — no Claude API calls are made per post.  Adequacy gate mirrors the
NamUs poller: plate, OR (make + model), OR (make + color + area).

Sources are stored in the `bolo_sources` DB table so admins can add/disable
them without a code deploy.  Initial seed rows are inserted by run_migration.py.

Dedup uses the `processed_alerts` table with identifiers like
`bolo-crawler-<sha256[:12]>` so the seen-set survives PM2 restarts.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import certifi as _certifi
import httpx
from sqlalchemy import text

from services.bolo_extractor import extract as local_extract, is_actionable
from services.fema_connector import (
    _add_to_watchlist,
    _notify_watching_pilots,
    _post_discord,
)
from services.health_tracker import stamp

logger = logging.getLogger(__name__)

POLL_INTERVAL  = int(os.getenv("BOLO_CRAWL_INTERVAL", "900"))   # 15 min
_EXPIRES_DAYS  = int(os.getenv("BOLO_EXPIRES_DAYS",   "7"))
_DISCORD_COLOR = 0xFF6B35   # orange-red, same as NamUs BOLO

# ── In-memory dedup set ───────────────────────────────────────────────────────

_seen_ids: set[str] = set()
last_poll_at: Optional[datetime] = None


# ── Dedup helpers ─────────────────────────────────────────────────────────────

def _item_id(item: dict) -> str:
    """Stable 12-char hex ID for a scraped item (link, else title+body hash)."""
    key = item.get("link") or f"{item.get('title','')[:60]}{item.get('summary','')[:80]}"
    return f"bolo-crawler-{hashlib.sha256(key.encode()).hexdigest()[:12]}"


async def _load_seen_ids(session_factory) -> None:
    async with session_factory() as session:
        try:
            rows = await session.execute(
                text(
                    "SELECT identifier FROM processed_alerts "
                    "WHERE identifier LIKE 'bolo-crawler-%' "
                    "ORDER BY processed_at DESC LIMIT 10000"
                )
            )
            for (ident,) in rows.fetchall():
                _seen_ids.add(ident)
            logger.info("[BOLOCrawler] Loaded %d processed IDs from DB.", len(_seen_ids))
        except Exception as exc:
            logger.warning("[BOLOCrawler] Could not load seen IDs: %s", exc)


async def _mark_seen(session_factory, item_id: str) -> None:
    async with session_factory() as session:
        try:
            await session.execute(
                text(
                    "INSERT INTO processed_alerts (identifier) VALUES (:id) "
                    "ON CONFLICT DO NOTHING"
                ),
                {"id": item_id},
            )
            await session.commit()
        except Exception as exc:
            logger.debug("[BOLOCrawler] mark_seen failed for %s: %s", item_id, exc)


# ── Source fetching ───────────────────────────────────────────────────────────

async def _fetch_rss(url: str, client: httpx.AsyncClient) -> list[dict]:
    """Fetch an RSS/Atom feed; return list of {title, summary, link} dicts."""
    try:
        import feedparser  # noqa: PLC0415
    except ImportError:
        logger.warning("[BOLOCrawler] feedparser not installed — RSS sources skipped")
        return []
    try:
        resp = await client.get(url, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        feed = feedparser.parse(resp.text)
        items = []
        for entry in feed.entries:
            items.append({
                "title":     getattr(entry, "title",   "") or "",
                "summary":   getattr(entry, "summary", "") or getattr(entry, "description", "") or "",
                "link":      getattr(entry, "link",    "") or "",
                "published": getattr(entry, "published", "") or "",
            })
        return items
    except Exception as exc:
        logger.warning("[BOLOCrawler] RSS fetch failed for %s: %s", url, exc)
        return []


async def _fetch_html(url: str, selector: str, client: httpx.AsyncClient) -> list[dict]:
    """Scrape HTML; extract text blobs matching a CSS selector."""
    try:
        from bs4 import BeautifulSoup  # noqa: PLC0415
    except ImportError:
        logger.warning("[BOLOCrawler] beautifulsoup4 not installed — HTML sources skipped")
        return []
    try:
        resp = await client.get(url, timeout=20, follow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        items = []
        for el in soup.select(selector)[:100]:
            body = el.get_text(separator=" ", strip=True)
            if len(body) < 30:
                continue
            link_tag = el.find("a", href=True)
            link = link_tag["href"] if link_tag else url
            if link.startswith("/"):
                from urllib.parse import urlparse  # noqa: PLC0415
                parsed = urlparse(url)
                link = f"{parsed.scheme}://{parsed.netloc}{link}"
            items.append({"title": "", "summary": body, "link": link, "published": ""})
        return items
    except Exception as exc:
        logger.warning("[BOLOCrawler] HTML scrape failed for %s: %s", url, exc)
        return []


# ── Per-item processing ───────────────────────────────────────────────────────

async def _process_item(
    item: dict,
    source_name: str,
    source_state: Optional[str],
    session_factory,
    webhook_url: str,
) -> None:
    text_blob = f"{item.get('title', '')} {item.get('summary', '')}".strip()
    if len(text_blob) < 25:
        return

    item_id = _item_id(item)
    if item_id in _seen_ids:
        return
    _seen_ids.add(item_id)

    fields = local_extract(text_blob)

    # Fill in state from source if extractor didn't find a location
    if not fields.get("area") and source_state:
        fields["area"] = source_state

    if not is_actionable(fields):
        logger.debug("[BOLOCrawler] %s: not actionable — skipping (%s)", source_name, item_id)
        await _mark_seen(session_factory, item_id)
        return

    plate      = fields.get("plate_text")
    alert_type = fields.get("alert_type") or "bolo"
    headline   = (
        fields.get("headline")
        or item.get("title")
        or f"BOLO from {source_name}"
    )
    area       = fields.get("area") or source_state or "Unknown"
    fema_id    = item_id  # reuse the dedup ID as fema_identifier

    expires_at = datetime.now(timezone.utc) + timedelta(days=_EXPIRES_DAYS)

    color     = fields.get("vehicle_color")
    make      = fields.get("vehicle_make")
    model     = fields.get("vehicle_model")
    vtype     = fields.get("vehicle_type")

    # ── vehicle_targets (YOLO matching, no plate required) ─────────────────────
    async with session_factory() as session:
        try:
            await session.execute(
                text("""
                    INSERT INTO vehicle_targets
                        (fema_identifier, alert_type, source_program, headline,
                         area, color, body_type, make,
                         polygon, centroid_lat, centroid_lng, expires_at, source)
                    VALUES
                        (:fema_id, :atype, :prog, :headline,
                         :area, :color, :body_type, :make,
                         NULL, NULL, NULL, :expires_at, 'bolo')
                    ON CONFLICT (fema_identifier) DO NOTHING
                """),
                {
                    "fema_id":   fema_id,
                    "atype":     alert_type,
                    "prog":      source_name,
                    "headline":  headline[:500],
                    "area":      area[:200],
                    "color":     color,
                    "body_type": vtype,
                    "make":      make,
                    "expires_at": expires_at,
                },
            )
            await session.commit()
        except Exception as exc:
            logger.error("[BOLOCrawler] vehicle_targets insert failed: %s", exc)
            await session.rollback()

    # ── watchlist (only when plate is present) ─────────────────────────────────
    if plate:
        vdesc_parts = [p for p in [fields.get("vehicle_year"), color, make, model] if p]
        vdesc = " ".join(vdesc_parts).strip()
        desc  = (
            f"[ID: {fema_id}] {headline} | Area: {area}"
            + (f" | Vehicle: {vdesc}" if vdesc else "")
        )
        try:
            inserted = await _add_to_watchlist(
                session_factory,
                plate=plate,
                description=desc[:1000],
                alert_type=alert_type,
                source_program=source_name,
                vehicle_color=color,
                vehicle_type=vtype,
                vehicle_make=make,
            )
            if inserted:
                logger.info(
                    "[BOLOCrawler] Watchlist: %s | %s | %s | src=%s",
                    plate, alert_type, area, source_name,
                )
        except Exception as exc:
            logger.error("[BOLOCrawler] Watchlist insert failed for %s: %s", plate, exc)

    # ── Discord notification ────────────────────────────────────────────────────
    if webhook_url:
        vdesc_parts = [p for p in [fields.get("vehicle_year"), color, make, model] if p]
        vehicle_str = " ".join(vdesc_parts).title() or "—"
        content = (
            f"🔶 **BOLO CRAWLER — {alert_type.upper()}** 🔶\n"
            f"**Source:** {source_name}\n"
            f"**Headline:** {headline}\n"
            f"**Area:** {area}\n"
            f"**Vehicle:** {vehicle_str}\n"
            + (f"**Plate:** `{plate}`\n" if plate else "")
            + (f"**Link:** {item.get('link')}\n" if item.get("link") else "")
            + f"📋 ID: `{fema_id}`"
        )
        try:
            await _post_discord(webhook_url, content)
        except Exception as exc:
            logger.warning("[BOLOCrawler] Discord notify failed: %s", exc)

    # ── Push notifications ─────────────────────────────────────────────────────
    _alert_dict = {
        "alert_type": {
            "key":   alert_type,
            "short": alert_type.upper(),
            "name":  {"amber": "Amber Alert", "silver": "Silver Alert", "blue": "Blue Alert"}.get(
                alert_type, "Law Enforcement BOLO"
            ),
            "emoji": {"amber": "🟠", "silver": "⚪", "blue": "🔵"}.get(alert_type, "🔶"),
            "cta":   "Check your area for this vehicle.",
        },
        "headline": headline,
        "area":     area,
        "sent":     datetime.now(timezone.utc).isoformat(),
        "polygon":  None,
    }
    try:
        await _notify_watching_pilots(session_factory, _alert_dict)
    except Exception as exc:
        logger.warning("[BOLOCrawler] Push notify failed: %s", exc)

    await _mark_seen(session_factory, item_id)
    logger.info(
        "[BOLOCrawler] Processed: %s | plate=%s | type=%s | src=%s",
        item_id, plate or "none", alert_type, source_name,
    )


# ── Poll cycle ────────────────────────────────────────────────────────────────

async def _crawl_all_sources(session_factory, webhook_url: str) -> None:
    """Fetch all active bolo_sources rows and process new items."""
    async with session_factory() as session:
        rows = await session.execute(
            text(
                "SELECT id, name, url, source_type, state, css_selector "
                "FROM bolo_sources WHERE active = TRUE"
            )
        )
        sources = rows.fetchall()

    if not sources:
        logger.debug("[BOLOCrawler] No active sources configured.")
        return

    async with httpx.AsyncClient(
        headers={"User-Agent": "AmberAngels-BOLOCrawler/1.0 (info@amberangels.org)"},
        verify=_certifi.where(),
    ) as client:
        for (src_id, name, url, source_type, state, css_selector) in sources:
            try:
                if source_type == "rss":
                    items = await _fetch_rss(url, client)
                elif source_type == "html":
                    sel = css_selector or "article, .post-content, .entry-content, p"
                    items = await _fetch_html(url, sel, client)
                else:
                    logger.warning("[BOLOCrawler] Unknown source_type '%s' for %s", source_type, name)
                    items = []

                logger.debug("[BOLOCrawler] %s: %d items fetched", name, len(items))

                for item in items:
                    try:
                        await _process_item(item, name, state, session_factory, webhook_url)
                    except Exception as exc:
                        logger.warning("[BOLOCrawler] Item error from %s: %s", name, exc)

            except Exception as exc:
                logger.error("[BOLOCrawler] Source error for %s (%s): %s", name, url, exc)

            # Update last_crawled_at regardless of errors
            async with session_factory() as session:
                try:
                    await session.execute(
                        text("UPDATE bolo_sources SET last_crawled_at = NOW() WHERE id = :id"),
                        {"id": src_id},
                    )
                    await session.commit()
                except Exception:
                    pass


# ── Background loop ───────────────────────────────────────────────────────────

async def bolo_crawler_loop(session_factory, webhook_url: str = "") -> None:
    """
    Long-running background task — crawl all active bolo_sources every
    BOLO_CRAWL_INTERVAL seconds (default 900 / 15 min).
    """
    global last_poll_at

    await _load_seen_ids(session_factory)
    logger.info("[BOLOCrawler] Started (interval=%ds, expires=%dd).", POLL_INTERVAL, _EXPIRES_DAYS)

    while True:
        try:
            await _crawl_all_sources(session_factory, webhook_url)
            last_poll_at = datetime.now(timezone.utc)
            stamp("bolo_crawler")
        except Exception as exc:
            logger.error("[BOLOCrawler] Loop error: %s", exc, exc_info=True)

        await asyncio.sleep(POLL_INTERVAL)
