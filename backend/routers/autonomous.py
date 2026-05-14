"""
backend/routers/autonomous.py

Autonomous drone mission endpoints. Mounted at prefix /autonomous.

Operation modes (FAA regulatory tier):
  vlos            — Part 107 standard; all waypoints must stay within
                    vlos_radius_m of the drone's home position (default 400 m)
  bvlos_tactical  — Part 107 BVLOS waiver on file; requires bvlos_authorized=TRUE
                    on the drone record; admin sets this via PATCH /autonomous/drones/{id}
  bvlos_autonomous — Part 108 / full autonomous BVLOS (future — same auth gate as tactical)

Endpoints:
  POST /autonomous/plan                          — plan & create pending mission
  GET  /autonomous/missions                      — list missions (filterable)
  GET  /autonomous/missions/{mission_id}         — single mission with waypoints
  PUT  /autonomous/missions/{mission_id}/status  — drone app status callback
  GET  /autonomous/drones                        — list registered drones
  PATCH /autonomous/drones/{drone_id}            — admin: update drone auth flags
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import database
from routers.auth import get_current_pilot, require_admin
from services.autonomous_mission_service import (
    VALID_OPERATION_MODES,
    create_mission,
    get_mission,
    list_missions,
    update_mission_status,
)
from services.waypoint_generator import check_vlos_radius

logger = logging.getLogger(__name__)
router = APIRouter(tags=["autonomous"])


# ---------------------------------------------------------------------------
# Dependency: async DB session
# ---------------------------------------------------------------------------

async def get_async_db():
    async with database.AsyncSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PlanMissionRequest(BaseModel):
    alert_id: str
    drone_id: int
    polygon_geojson: dict
    altitude_m: float = 60.0
    speed_mps: float = 8.0
    operation_mode: str = "vlos"   # vlos | bvlos_tactical | bvlos_autonomous


class UpdateStatusRequest(BaseModel):
    status: str
    progress_pct: Optional[int] = None
    error_msg: Optional[str] = None


class UpdateDroneAuthRequest(BaseModel):
    bvlos_authorized: Optional[bool] = None
    vlos_radius_m: Optional[int] = None   # metres, default 400


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _check_dispatch_permission(payload: dict, db: AsyncSession) -> None:
    """Raise 403 unless caller is admin or has can_dispatch_drones flag."""
    role = payload.get("role", "")
    if role == "admin":
        return
    username = payload.get("sub") or payload.get("username", "")
    row = await db.execute(
        text("SELECT can_dispatch_drones FROM pilots WHERE username = :u"),
        {"u": username},
    )
    rec = row.fetchone()
    if not rec or not rec[0]:
        raise HTTPException(
            status_code=403,
            detail="Drone dispatch requires admin role or the can_dispatch_drones permission.",
        )


async def _fetch_drone(db: AsyncSession, drone_id: int) -> dict:
    row = await db.execute(
        text("""
            SELECT id, pilot_username, drone_model, home_lat, home_lng,
                   camera_hfov_deg, bvlos_authorized,
                   COALESCE(vlos_radius_m, 400) AS vlos_radius_m
            FROM autonomous_drones WHERE id = :id
        """),
        {"id": drone_id},
    )
    rec = row.fetchone()
    if not rec:
        raise HTTPException(status_code=404, detail=f"Drone {drone_id} not found.")
    return {
        "id": rec[0],
        "pilot_username": rec[1],
        "drone_model": rec[2],
        "home_lat": rec[3],
        "home_lng": rec[4],
        "camera_hfov_deg": rec[5],
        "bvlos_authorized": bool(rec[6]),
        "vlos_radius_m": rec[7],
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/autonomous/plan")
async def plan_mission(
    req: PlanMissionRequest,
    payload: dict = Depends(get_current_pilot),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Generate a lawnmower waypoint path for the given polygon and create a
    pending autonomous mission record.

    Regulatory gates enforced here:
      - vlos            → all waypoints must be within drone.vlos_radius_m of home
      - bvlos_tactical  → drone.bvlos_authorized must be TRUE
      - bvlos_autonomous → drone.bvlos_authorized must be TRUE (Part 108 placeholder)
    """
    if req.operation_mode not in VALID_OPERATION_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid operation_mode '{req.operation_mode}'. "
                   f"Must be one of: {sorted(VALID_OPERATION_MODES)}",
        )

    await _check_dispatch_permission(payload, db)

    drone = await _fetch_drone(db, req.drone_id)

    # BVLOS authorization gate
    if req.operation_mode in ("bvlos_tactical", "bvlos_autonomous"):
        if not drone["bvlos_authorized"]:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Drone {req.drone_id} is not authorized for BVLOS operations. "
                    "An admin must record the FAA waiver and set bvlos_authorized=true "
                    "via PATCH /autonomous/drones/{id}."
                ),
            )

    try:
        mission = await create_mission(
            db,
            alert_id=req.alert_id,
            drone_id=req.drone_id,
            polygon_geojson=req.polygon_geojson,
            altitude_m=req.altitude_m,
            speed_mps=req.speed_mps,
            operation_mode=req.operation_mode,
        )
    except Exception as exc:
        logger.error("plan_mission failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    if not mission.get("waypoints"):
        raise HTTPException(
            status_code=422,
            detail="Polygon is too small to generate a valid mission path.",
        )

    # VLOS radius enforcement (post waypoint generation)
    if req.operation_mode == "vlos":
        home_lat = drone.get("home_lat")
        home_lng = drone.get("home_lng")
        if home_lat is None or home_lng is None:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Drone home position is not set. The pilot must report a heartbeat "
                    "with GPS position before a VLOS mission can be dispatched."
                ),
            )
        within, max_dist = check_vlos_radius(
            mission["waypoints"], home_lat, home_lng,
            radius_m=float(drone["vlos_radius_m"]),
        )
        if not within:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"VLOS mission exceeds the {drone['vlos_radius_m']} m radius limit. "
                    f"Farthest waypoint is {max_dist:.0f} m from drone home. "
                    "Reduce the search polygon or switch to bvlos_tactical if a Part 107 "
                    "BVLOS waiver is on file."
                ),
            )

    return mission


@router.get("/autonomous/missions")
async def list_missions_endpoint(
    drone_id: Optional[int] = None,
    status: Optional[str] = None,
    operation_mode: Optional[str] = None,
    limit: int = 20,
    payload: dict = Depends(get_current_pilot),
    db: AsyncSession = Depends(get_async_db),
):
    """Return missions, optionally filtered by drone_id, status, and/or operation_mode."""
    return await list_missions(db, drone_id=drone_id, status=status, limit=limit)


@router.get("/autonomous/missions/{mission_id}")
async def get_mission_endpoint(
    mission_id: int,
    payload: dict = Depends(get_current_pilot),
    db: AsyncSession = Depends(get_async_db),
):
    """Return a single mission including full waypoint list."""
    mission = await get_mission(db, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found.")
    return mission


@router.put("/autonomous/missions/{mission_id}/status")
async def update_status_endpoint(
    mission_id: int,
    req: UpdateStatusRequest,
    payload: dict = Depends(get_current_pilot),
    db: AsyncSession = Depends(get_async_db),
):
    """Called by the drone app to report mission progress or final status."""
    try:
        await update_mission_status(
            db,
            mission_id=mission_id,
            status=req.status,
            progress_pct=req.progress_pct,
            error_msg=req.error_msg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.error("update_status failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    return {"ok": True, "mission_id": mission_id, "status": req.status}


# ---------------------------------------------------------------------------
# Drone registry endpoints
# ---------------------------------------------------------------------------

@router.get("/autonomous/drones")
async def list_drones(
    payload: dict = Depends(get_current_pilot),
    db: AsyncSession = Depends(get_async_db),
):
    """Return all registered autonomous-capable drones."""
    result = await db.execute(text("""
        SELECT id, pilot_username, drone_model, serial_number,
               home_lat, home_lng, max_flight_time_min, camera_hfov_deg,
               registered_at, last_seen_at,
               COALESCE(bvlos_authorized, FALSE) AS bvlos_authorized,
               COALESCE(vlos_radius_m, 400)      AS vlos_radius_m
        FROM autonomous_drones
        ORDER BY last_seen_at DESC NULLS LAST
    """))
    rows = result.fetchall()
    return [
        {
            "id":                 r[0],
            "pilot_username":     r[1],
            "drone_model":        r[2],
            "serial_number":      r[3],
            "home_lat":           r[4],
            "home_lng":           r[5],
            "max_flight_time_min": r[6],
            "camera_hfov_deg":    float(r[7]) if r[7] else None,
            "registered_at":      r[8].isoformat() if r[8] else None,
            "last_seen_at":       r[9].isoformat() if r[9] else None,
            "bvlos_authorized":   bool(r[10]),
            "vlos_radius_m":      r[11],
        }
        for r in rows
    ]


@router.patch("/autonomous/drones/{drone_id}")
async def update_drone_auth(
    drone_id: int,
    req: UpdateDroneAuthRequest,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Admin-only: update BVLOS authorization and/or VLOS radius for a drone.
    Record the FAA Part 107 BVLOS waiver number in your admin notes before
    setting bvlos_authorized=true.
    """
    sets = []
    params: dict = {"id": drone_id}

    if req.bvlos_authorized is not None:
        sets.append("bvlos_authorized = :bvlos_authorized")
        params["bvlos_authorized"] = req.bvlos_authorized
    if req.vlos_radius_m is not None:
        if req.vlos_radius_m < 50 or req.vlos_radius_m > 10_000:
            raise HTTPException(status_code=422, detail="vlos_radius_m must be 50–10000 m")
        sets.append("vlos_radius_m = :vlos_radius_m")
        params["vlos_radius_m"] = req.vlos_radius_m

    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update.")

    result = await db.execute(
        text(f"""
            UPDATE autonomous_drones
            SET {', '.join(sets)}
            WHERE id = :id
            RETURNING id, bvlos_authorized, vlos_radius_m
        """),
        params,
    )
    row = result.fetchone()
    await db.commit()

    if not row:
        raise HTTPException(status_code=404, detail=f"Drone {drone_id} not found.")

    return {
        "id": row[0],
        "bvlos_authorized": bool(row[1]),
        "vlos_radius_m": row[2],
    }
