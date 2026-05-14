"""
backend/routers/autonomous.py

Autonomous drone mission endpoints. Mounted at prefix /autonomous.

POST /autonomous/plan                          — plan a new mission
GET  /autonomous/missions                      — list missions (filterable)
GET  /autonomous/missions/{mission_id}         — single mission with waypoints
PUT  /autonomous/missions/{mission_id}/status  — drone app status callback
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

import database
from routers.auth import get_current_pilot
from services.autonomous_mission_service import (
    create_mission,
    get_mission,
    list_missions,
    update_mission_status,
)

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


class UpdateStatusRequest(BaseModel):
    status: str
    progress_pct: Optional[int] = None
    error_msg: Optional[str] = None


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
    """
    try:
        mission = await create_mission(
            db,
            alert_id=req.alert_id,
            drone_id=req.drone_id,
            polygon_geojson=req.polygon_geojson,
            altitude_m=req.altitude_m,
            speed_mps=req.speed_mps,
        )
    except Exception as exc:
        logger.error("plan_mission failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    if not mission.get("waypoints"):
        raise HTTPException(
            status_code=422,
            detail="Polygon is too small to generate a valid mission path.",
        )
    return mission


@router.get("/autonomous/missions")
async def list_missions_endpoint(
    drone_id: Optional[int] = None,
    status: Optional[str] = None,
    limit: int = 20,
    payload: dict = Depends(get_current_pilot),
    db: AsyncSession = Depends(get_async_db),
):
    """Return missions, optionally filtered by drone_id and/or status."""
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
    """
    Called by the drone app to report mission progress or final status.
    Returns 200 on success.
    """
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
