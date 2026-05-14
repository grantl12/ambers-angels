"""
backend/services/autonomous_mission_service.py

Plans and manages autonomous drone missions tied to active FEMA/watchlist alerts.

Mission lifecycle:
  pending → dispatched (push sent to pilot) → uploading (pilot accepted, DJI upload)
  → active (drone executing) → completed | aborted | failed
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from services.waypoint_generator import (
    generate_lawnmower,
    mission_coverage_sqkm,
)

logger = logging.getLogger(__name__)

VALID_STATUSES = {
    "pending", "dispatched", "uploading", "active", "completed", "aborted", "failed"
}


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def create_mission(
    db: AsyncSession,
    alert_id: str,
    drone_id: int,
    polygon_geojson: dict,
    altitude_m: float = 60.0,
    speed_mps: float = 8.0,
) -> dict:
    """
    Generate waypoints for the given polygon, insert an autonomous_missions row,
    and return the full mission dict (including waypoints).
    """
    # Look up drone's camera HFOV (fall back to DJI Mavic 3 default)
    row = await db.execute(
        text("SELECT camera_hfov_deg FROM autonomous_drones WHERE id = :id"),
        {"id": drone_id},
    )
    drone = row.fetchone()
    hfov = float(drone[0]) if drone and drone[0] else 84.0

    waypoints = generate_lawnmower(
        polygon_geojson,
        altitude_m=altitude_m,
        speed_mps=speed_mps,
        camera_hfov_deg=hfov,
    )
    coverage = mission_coverage_sqkm(polygon_geojson)

    result = await db.execute(
        text("""
            INSERT INTO autonomous_missions
                (alert_id, drone_id, status, waypoints_json,
                 altitude_m, speed_mps, coverage_area_sqkm, created_at)
            VALUES
                (:alert_id, :drone_id, 'pending', :waypoints_json,
                 :altitude_m, :speed_mps, :coverage, NOW())
            RETURNING id, created_at
        """),
        {
            "alert_id": alert_id,
            "drone_id": drone_id,
            "waypoints_json": json.dumps(waypoints),
            "altitude_m": altitude_m,
            "speed_mps": speed_mps,
            "coverage": coverage,
        },
    )
    row = result.fetchone()
    await db.commit()

    return {
        "id": row[0],
        "alert_id": alert_id,
        "drone_id": drone_id,
        "status": "pending",
        "waypoints": waypoints,
        "waypoint_count": len(waypoints),
        "altitude_m": altitude_m,
        "speed_mps": speed_mps,
        "coverage_area_sqkm": round(coverage, 4),
        "created_at": row[1].isoformat() if row[1] else None,
        "dispatched_at": None,
        "started_at": None,
        "completed_at": None,
        "progress_pct": 0,
        "error_msg": None,
    }


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

async def list_missions(
    db: AsyncSession,
    drone_id: Optional[int] = None,
    status: Optional[str] = None,
    limit: int = 20,
) -> list[dict]:
    """
    Return missions filtered by optional drone_id and/or status.
    Waypoints_json is omitted from list results for performance.
    """
    conditions = []
    params: dict = {"limit": limit}

    if drone_id is not None:
        conditions.append("drone_id = :drone_id")
        params["drone_id"] = drone_id
    if status is not None:
        conditions.append("status = :status")
        params["status"] = status

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    result = await db.execute(
        text(f"""
            SELECT id, alert_id, drone_id, status,
                   altitude_m, speed_mps, coverage_area_sqkm,
                   created_at, dispatched_at, started_at, completed_at,
                   progress_pct, error_msg,
                   jsonb_array_length(waypoints_json::jsonb) AS waypoint_count
            FROM autonomous_missions
            {where}
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.fetchall()

    missions = []
    for r in rows:
        missions.append({
            "id": r[0],
            "alert_id": r[1],
            "drone_id": r[2],
            "status": r[3],
            "altitude_m": float(r[4]) if r[4] is not None else None,
            "speed_mps": float(r[5]) if r[5] is not None else None,
            "coverage_area_sqkm": float(r[6]) if r[6] is not None else None,
            "created_at": r[7].isoformat() if r[7] else None,
            "dispatched_at": r[8].isoformat() if r[8] else None,
            "started_at": r[9].isoformat() if r[9] else None,
            "completed_at": r[10].isoformat() if r[10] else None,
            "progress_pct": r[11],
            "error_msg": r[12],
            "waypoint_count": r[13],
        })
    return missions


# ---------------------------------------------------------------------------
# Update status
# ---------------------------------------------------------------------------

async def update_mission_status(
    db: AsyncSession,
    mission_id: int,
    status: str,
    progress_pct: Optional[int] = None,
    error_msg: Optional[str] = None,
) -> None:
    """
    Transition a mission to a new status, optionally recording progress and
    error message. Timestamps (dispatched_at, started_at, completed_at) are
    set automatically based on the target status.
    """
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid mission status '{status}'. Must be one of {VALID_STATUSES}")

    # Build dynamic timestamp assignments
    ts_clause = ""
    if status == "dispatched":
        ts_clause = ", dispatched_at = NOW()"
    elif status == "active":
        ts_clause = ", started_at = NOW()"
    elif status in ("completed", "aborted", "failed"):
        ts_clause = ", completed_at = NOW()"

    params: dict = {
        "mission_id": mission_id,
        "status": status,
        "progress_pct": progress_pct,
        "error_msg": error_msg,
    }

    await db.execute(
        text(f"""
            UPDATE autonomous_missions
            SET status = :status,
                progress_pct = COALESCE(:progress_pct, progress_pct),
                error_msg = COALESCE(:error_msg, error_msg)
                {ts_clause}
            WHERE id = :mission_id
        """),
        params,
    )
    await db.commit()
    logger.info("Mission %d → %s (progress=%s)", mission_id, status, progress_pct)


# ---------------------------------------------------------------------------
# Fetch single mission (with full waypoints)
# ---------------------------------------------------------------------------

async def get_mission(db: AsyncSession, mission_id: int) -> Optional[dict]:
    """Return a single mission dict with full waypoints, or None if not found."""
    result = await db.execute(
        text("""
            SELECT id, alert_id, drone_id, status, waypoints_json,
                   altitude_m, speed_mps, coverage_area_sqkm,
                   created_at, dispatched_at, started_at, completed_at,
                   progress_pct, error_msg
            FROM autonomous_missions
            WHERE id = :mission_id
        """),
        {"mission_id": mission_id},
    )
    r = result.fetchone()
    if not r:
        return None

    waypoints = json.loads(r[4]) if r[4] else []
    return {
        "id": r[0],
        "alert_id": r[1],
        "drone_id": r[2],
        "status": r[3],
        "waypoints": waypoints,
        "waypoint_count": len(waypoints),
        "altitude_m": float(r[5]) if r[5] is not None else None,
        "speed_mps": float(r[6]) if r[6] is not None else None,
        "coverage_area_sqkm": float(r[7]) if r[7] is not None else None,
        "created_at": r[8].isoformat() if r[8] else None,
        "dispatched_at": r[9].isoformat() if r[9] else None,
        "started_at": r[10].isoformat() if r[10] else None,
        "completed_at": r[11].isoformat() if r[11] else None,
        "progress_pct": r[12],
        "error_msg": r[13],
    }
