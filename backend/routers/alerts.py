"""
backend/routers/alerts.py

Alert management endpoints — callable by coordinator or admin.

POST /alerts/resolve   — manually resolve a FEMA or NCMEC alert
GET  /alerts/resolutions — audit log of past resolutions
"""

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

import database
from routers.auth import get_current_pilot, require_coordinator
from services.fema_connector import (
    _deactivate_by_references,
    _notify_cancelled,
    _push_notify_cancelled,
    _post_discord,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["alerts"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ResolveAlertRequest(BaseModel):
    fema_identifier: Optional[str] = None
    ncmec_guid:      Optional[str] = None
    reason:          str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _resolve_ncmec(ncmec_guid: str) -> Optional[dict]:
    """Mark an NCMEC case resolved. Returns the case dict or None if not found."""
    async with database.AsyncSessionLocal() as session:
        try:
            row = await session.execute(
                text("""
                    UPDATE ncmec_cases
                    SET resolved_at = NOW()
                    WHERE guid = :guid AND resolved_at IS NULL
                    RETURNING name, age_now, state, city, missing_since, poster_url
                """),
                {"guid": ncmec_guid},
            )
            r = row.fetchone()
            await session.commit()
            if r:
                return {"name": r[0], "age_now": r[1], "state": r[2],
                        "city": r[3], "missing_since": str(r[4]) if r[4] else None,
                        "poster_url": r[5]}
        except Exception as e:
            logger.error("NCMEC resolve failed: %s", e)
            await session.rollback()
    return None


async def _log_resolution(
    resolved_by: str,
    role: str,
    fema_identifier: Optional[str],
    ncmec_guid: Optional[str],
    reason: str,
    plates_deactivated: list[str],
) -> None:
    async with database.AsyncSessionLocal() as session:
        try:
            await session.execute(
                text("""
                    INSERT INTO alert_resolutions
                        (resolved_by, role, fema_identifier, ncmec_guid,
                         reason, plates_deactivated, resolved_at)
                    VALUES
                        (:by, :role, :fema_id, :ncmec_guid,
                         :reason, :plates, NOW())
                """),
                {
                    "by":       resolved_by,
                    "role":     role,
                    "fema_id":  fema_identifier,
                    "ncmec_guid": ncmec_guid,
                    "reason":   reason,
                    "plates":   plates_deactivated or [],
                },
            )
            await session.commit()
        except Exception as e:
            logger.error("Resolution audit log failed: %s", e)
            await session.rollback()


async def _get_vehicle_target(fema_identifier: str) -> Optional[dict]:
    async with database.AsyncSessionLocal() as session:
        try:
            row = await session.execute(
                text("SELECT headline, area FROM vehicle_targets WHERE fema_identifier = :fid"),
                {"fid": fema_identifier},
            )
            r = row.fetchone()
            return {"headline": r[0] or "", "area": r[1] or ""} if r else None
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/alerts/resolve")
async def resolve_alert(
    req: ResolveAlertRequest,
    payload: dict = Depends(require_coordinator),
):
    """
    Manually mark a FEMA alert or NCMEC case as resolved.
    Deactivates watchlist plates, expires vehicle targets, and pushes
    'stand down' notifications to pilots. Logged to alert_resolutions.
    Callable by coordinator or admin.
    """
    if not req.fema_identifier and not req.ncmec_guid:
        raise HTTPException(status_code=400, detail="Provide fema_identifier or ncmec_guid")
    if not req.reason.strip():
        raise HTTPException(status_code=400, detail="reason is required")

    resolved_by = payload["sub"]
    role        = payload.get("role", "coordinator")
    webhook_url = os.getenv("ALERT_WEBHOOK_URL", "")

    deactivated_plates: list[str] = []
    ncmec_case: Optional[dict]    = None

    # ── FEMA resolution ───────────────────────────────────────────────────────
    if req.fema_identifier:
        target = await _get_vehicle_target(req.fema_identifier)
        deactivated_plates = await _deactivate_by_references(
            database.AsyncSessionLocal, [req.fema_identifier]
        )

        cancel_alert = {
            "msg_type":    "cancel",
            "headline":    (target or {}).get("headline", ""),
            "area":        (target or {}).get("area", ""),
            "references":  [req.fema_identifier],
        }

        if webhook_url:
            content = (
                f"✅ **ALERT MANUALLY RESOLVED — STAND DOWN** ✅\n"
                f"**Resolved by:** {resolved_by} ({role})\n"
                f"**Reason:** {req.reason}\n"
                f"**Headline:** {cancel_alert['headline'] or '—'}\n"
                f"**Area:** {cancel_alert['area'] or '—'}\n"
                f"**Plates removed:** "
                + (", ".join(f"`{p}`" for p in deactivated_plates) or "none on watchlist")
            )
            await _post_discord(webhook_url, content)

        await _push_notify_cancelled(database.AsyncSessionLocal, cancel_alert)
        logger.info(
            "FEMA alert %s manually resolved by %s (%s). Reason: %s. Plates: %s",
            req.fema_identifier, resolved_by, role, req.reason, deactivated_plates,
        )

    # ── NCMEC resolution ──────────────────────────────────────────────────────
    if req.ncmec_guid:
        ncmec_case = await _resolve_ncmec(req.ncmec_guid)
        if ncmec_case and webhook_url:
            content = (
                f"✅ **NCMEC CASE MANUALLY RESOLVED** ✅\n"
                f"**Resolved by:** {resolved_by} ({role})\n"
                f"**Reason:** {req.reason}\n"
                f"**Child:** {ncmec_case['name']}, age {ncmec_case['age_now']} "
                f"— {ncmec_case['city']}, {ncmec_case['state']}\n"
                f"🔗 {ncmec_case['poster_url'] or '—'}"
            )
            await _post_discord(webhook_url, content)

        logger.info(
            "NCMEC case %s manually resolved by %s (%s). Reason: %s",
            req.ncmec_guid, resolved_by, role, req.reason,
        )

    # ── Audit log ─────────────────────────────────────────────────────────────
    await _log_resolution(
        resolved_by, role,
        req.fema_identifier, req.ncmec_guid,
        req.reason, deactivated_plates,
    )

    return {
        "status":            "resolved",
        "resolved_by":       resolved_by,
        "fema_identifier":   req.fema_identifier,
        "ncmec_guid":        req.ncmec_guid,
        "plates_deactivated": deactivated_plates,
        "ncmec_case":        ncmec_case,
    }


@router.get("/alerts/resolutions")
def get_resolutions(
    limit: int = 50,
    payload: dict = Depends(require_coordinator),
):
    """Audit log of manual alert resolutions. Coordinator + admin."""
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT id, resolved_by, role, fema_identifier, ncmec_guid,
                   reason, plates_deactivated, resolved_at
            FROM alert_resolutions
            ORDER BY resolved_at DESC
            LIMIT :limit
        """), {"limit": limit}).fetchall()
        return [
            {
                "id":               r[0],
                "resolvedBy":       r[1],
                "role":             r[2],
                "femaIdentifier":   r[3],
                "ncmecGuid":        r[4],
                "reason":           r[5],
                "platesDeactivated": r[6] or [],
                "resolvedAt":       r[7].isoformat() if r[7] else None,
            }
            for r in rows
        ]
    finally:
        db.close()
