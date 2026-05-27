"""
backend/routers/read_api.py

Read-only API endpoints consumed by the frontend dashboard.

GET /missions/active
GET /telemetry/latest
GET /telemetry/trail
GET /detections/feed
"""

import asyncio
import logging
import threading
import time as _time
from fastapi import APIRouter, Query, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from datetime import datetime, timezone, timedelta
from typing import Optional
import math
import uuid
import requests as _requests
import database

logger = logging.getLogger(__name__)
from services.badge_service import compute_all_badges
from routers.auth import get_current_pilot, require_admin, require_coordinator
from services.coverage_service import compute_priority_zones, compute_coverage_map
from services.audit import write_audit_sync

_DEFLOCK_INDEX_URL = "https://cdn.deflock.me/regions/index.json"
_DEFLOCK_HEADERS   = {"User-Agent": "AmberAngels-mission-scraper/1.0"}


_MAX_TILES = 16  # safety cap — prevents timeout on very large bbox searches

def _fetch_flock_for_bbox(db, south: float, north: float, west: float, east: float) -> None:
    """
    Pull cameras from the DeFlock CDN tile API for the given bbox and upsert
    them into flock_cameras.  Called when a pilot flies to an area that has no
    cached cameras yet.
    """
    try:
        idx = _requests.get(_DEFLOCK_INDEX_URL, headers=_DEFLOCK_HEADERS, timeout=10).json()
        tile_size: float = idx["tile_size_degrees"]
        tile_url: str    = idx["tile_url"]
    except Exception as exc:
        logger.warning("DeFlock index fetch failed: %s", exc)
        return

    lat_min = math.floor(south / tile_size) * tile_size
    lat_max = math.floor(north / tile_size) * tile_size
    lon_min = math.floor(west  / tile_size) * tile_size
    lon_max = math.floor(east  / tile_size) * tile_size

    rows: list[dict] = []
    tile_count = 0
    lat = lat_min
    while lat <= lat_max + 1e-9:
        lon = lon_min
        while lon <= lon_max + 1e-9:
            tile_count += 1
            if tile_count > _MAX_TILES:
                logger.warning("DeFlock tile cap reached (%d tiles) — truncating fetch", _MAX_TILES)
                break
            url = tile_url.replace("{lat}/{lon}", f"{lat}/{lon}")
            try:
                cameras = _requests.get(url, headers=_DEFLOCK_HEADERS, timeout=15).json()
            except Exception:
                lon += tile_size
                continue
            for c in cameras:
                if south <= c["lat"] <= north and west <= c["lon"] <= east:
                    tags = c.get("tags", {})
                    heading_raw = tags.get("direction")
                    heading_int = None
                    if heading_raw is not None:
                        try:
                            parts = [int(x) for x in str(heading_raw).split("-") if x.strip()]
                            heading_int = sum(parts) // len(parts)
                        except (ValueError, ZeroDivisionError):
                            pass
                    rows.append({
                        "id":      str(c["id"]),
                        "lat":     c["lat"],
                        "lng":     c["lon"],
                        "heading": heading_int,
                        "road":    None,
                        "agency":  tags.get("operator"),
                    })
            lon = round(lon + tile_size, 10)
        lat = round(lat + tile_size, 10)

    if rows:
        db.execute(text("""
            INSERT INTO flock_cameras (id, lat, lng, heading, road, agency)
            VALUES (:id, :lat, :lng, :heading, :road, :agency)
            ON CONFLICT (id) DO UPDATE SET
                lat        = EXCLUDED.lat,
                lng        = EXCLUDED.lng,
                heading    = EXCLUDED.heading,
                agency     = EXCLUDED.agency,
                scraped_at = NOW()
        """), rows)
        db.commit()
        logger.info("Live-fetched %d cameras for bbox", len(rows))

router = APIRouter()


def _sync_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Missions
# ---------------------------------------------------------------------------

@router.get("/missions/active", dependencies=[Depends(get_current_pilot)])
def get_active_missions():
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT id::text, title, status, started_at, ended_at
            FROM missions
            WHERE status = 'active'
            ORDER BY started_at DESC
        """)).fetchall()

        return [
            {
                "id":        r[0],
                "title":     r[1],
                "status":    r[2],
                "startedAt": r[3].isoformat() if r[3] else None,
                "endedAt":   r[4].isoformat() if r[4] else None,
            }
            for r in rows
        ]
    finally:
        db.close()


class CreateMissionRequest(BaseModel):
    title: str
    area:  Optional[str] = None

@router.post("/missions", dependencies=[Depends(require_admin)])
def create_mission(req: CreateMissionRequest):
    db = database.SessionLocal()
    try:
        row = db.execute(text("""
            INSERT INTO missions (title, status, area)
            VALUES (:title, 'active', :area::jsonb)
            RETURNING id::text, title, status, started_at
        """), {"title": req.title.strip(), "area": req.area}).fetchone()
        db.commit()
        return {"id": row[0], "title": row[1], "status": row[2],
                "startedAt": row[3].isoformat() if row[3] else None, "endedAt": None}
    finally:
        db.close()

@router.post("/missions/{mission_id}/end", dependencies=[Depends(require_admin)])
def end_mission(mission_id: str):
    db = database.SessionLocal()
    try:
        result = db.execute(text("""
            UPDATE missions SET status = 'completed', ended_at = NOW()
            WHERE id = :id AND status = 'active'
            RETURNING id::text, title, ended_at
        """), {"id": mission_id})
        db.commit()
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mission not found or already ended")
        return {"id": row[0], "title": row[1], "endedAt": row[2].isoformat()}
    finally:
        db.close()

@router.get("/missions/all", dependencies=[Depends(require_coordinator)])
def get_all_missions():
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT id::text, title, status, started_at, ended_at
            FROM missions
            ORDER BY started_at DESC
        """)).fetchall()

        return [
            {
                "id":        r[0],
                "title":     r[1],
                "status":    r[2],
                "startedAt": r[3].isoformat() if r[3] else None,
                "endedAt":   r[4].isoformat() if r[4] else None,
            }
            for r in rows
        ]
    finally:
        db.close()


@router.get("/missions/{mission_id}/debrief", dependencies=[Depends(require_coordinator)])
def get_mission_debrief(mission_id: str):
    db = database.SessionLocal()
    try:
        # Mission info
        mission_row = db.execute(text("""
            SELECT id::text, title, status, started_at, ended_at
            FROM missions
            WHERE id = :mission_id
        """), {"mission_id": mission_id}).fetchone()

        if mission_row is None:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Mission not found")

        mid, title, status, started_at, ended_at = mission_row

        now = datetime.now(timezone.utc)
        window_end = ended_at if ended_at else now

        if started_at:
            duration_minutes = int((window_end - started_at).total_seconds() / 60)
        else:
            duration_minutes = 0

        # Total detections within mission window
        total_detections = db.execute(text("""
            SELECT COUNT(*)
            FROM detections
            WHERE detected_at >= :start AND detected_at <= :end
        """), {"start": started_at, "end": window_end}).scalar() or 0

        # Watchlist hits — alerted events with last_seen within mission window
        watchlist_hits = db.execute(text("""
            SELECT COUNT(*)
            FROM detection_events
            WHERE status = 'alerted'
              AND last_seen >= :start AND last_seen <= :end
        """), {"start": started_at, "end": window_end}).scalar() or 0

        # Drones active
        drone_rows = db.execute(text("""
            SELECT DISTINCT drone_id
            FROM telemetry_points
            WHERE ts >= :start AND ts <= :end
            ORDER BY drone_id
        """), {"start": started_at, "end": window_end}).fetchall()
        drones_active = [r[0] for r in drone_rows]

        # Pilots active (filter nulls)
        pilot_rows = db.execute(text("""
            SELECT DISTINCT pilot_id
            FROM telemetry_points
            WHERE ts >= :start AND ts <= :end
              AND pilot_id IS NOT NULL
            ORDER BY pilot_id
        """), {"start": started_at, "end": window_end}).fetchall()
        pilots_active = [r[0] for r in pilot_rows]

        # Plates scanned (distinct plate_text)
        plates_scanned = db.execute(text("""
            SELECT COUNT(DISTINCT plate_text)
            FROM detections
            WHERE detected_at >= :start AND detected_at <= :end
        """), {"start": started_at, "end": window_end}).scalar() or 0

        # Top 5 plates by occurrence
        top_plate_rows = db.execute(text("""
            SELECT plate_text, COUNT(*) AS cnt
            FROM detections
            WHERE detected_at >= :start AND detected_at <= :end
            GROUP BY plate_text
            ORDER BY cnt DESC
            LIMIT 5
        """), {"start": started_at, "end": window_end}).fetchall()
        top_plates = [{"plate": r[0], "count": r[1]} for r in top_plate_rows]

        # Alerts by type — watchlist entries joined via plate_text
        alert_type_rows = db.execute(text("""
            SELECT w.alert_type, COUNT(*) AS cnt
            FROM detection_events de
            JOIN watchlist w ON w.plate_text = de.plate_best
            WHERE de.status = 'alerted'
              AND de.last_seen >= :start AND de.last_seen <= :end
            GROUP BY w.alert_type
        """), {"start": started_at, "end": window_end}).fetchall()
        alerts_by_type = {r[0] or "amber": r[1] for r in alert_type_rows}

        return {
            "missionId":       mid,
            "title":           title,
            "startedAt":       started_at.isoformat() if started_at else None,
            "endedAt":         ended_at.isoformat() if ended_at else None,
            "durationMinutes": duration_minutes,
            "totalDetections": total_detections,
            "watchlistHits":   watchlist_hits,
            "dronesActive":    drones_active,
            "pilotsActive":    pilots_active,
            "platesScanned":   plates_scanned,
            "topPlates":       top_plates,
            "alertsByType":    alerts_by_type,
        }
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Telemetry — latest position per drone
# ---------------------------------------------------------------------------

@router.get("/telemetry/latest", dependencies=[Depends(require_coordinator)])
def get_latest_telemetry(mission_id: Optional[str] = None):
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT DISTINCT ON (drone_id)
                drone_id, pilot_id, ts, lat, lon, altitude_m, heading_deg, speed_mps, volunteer_mode
            FROM telemetry_points
            ORDER BY drone_id, ts DESC
        """)).fetchall()

        return [
            {
                "droneId":       r[0],
                "pilotId":       r[1],
                "timestamp":     r[2].isoformat() if r[2] else None,
                "lat":           r[3],
                "lng":           r[4],
                "altitude":      r[5],
                "heading":       r[6],
                "speed":         r[7],
                "volunteerMode": r[8],
            }
            for r in rows
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Telemetry — flight trail
# ---------------------------------------------------------------------------

@router.get("/telemetry/trail", dependencies=[Depends(require_coordinator)])
def get_telemetry_trail(
    drone_id: str = Query("drone1"),
    minutes: int = Query(30, ge=1, le=1440),
):
    db = database.SessionLocal()
    try:
        since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        rows = db.execute(text("""
            SELECT ts, lat, lon, altitude_m
            FROM telemetry_points
            WHERE drone_id = :drone_id
              AND ts >= :since
            ORDER BY ts ASC
        """), {"drone_id": drone_id, "since": since}).fetchall()

        # If no recent data (drone offline), return last N points instead
        if not rows:
            rows = db.execute(text("""
                SELECT ts, lat, lon, altitude_m
                FROM telemetry_points
                WHERE drone_id = :drone_id
                ORDER BY ts DESC
                LIMIT 500
            """), {"drone_id": drone_id}).fetchall()
            rows = list(reversed(rows))

        return {
            "droneId": drone_id,
            "points": [
                {
                    "timestamp": r[0].isoformat() if r[0] else None,
                    "lat":       r[1],
                    "lng":       r[2],
                    "altitude":  r[3],
                }
                for r in rows
            ],
        }
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Detections feed
# ---------------------------------------------------------------------------

@router.get("/detections/feed", dependencies=[Depends(get_current_pilot)])
def get_detections_feed(
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = None,
):
    db = database.SessionLocal()
    try:
        status_filter = "AND de.status = :status" if status else ""
        rows = db.execute(text(f"""
            SELECT
                de.id::text,
                de.plate_best,
                de.drone_id,
                de.status,
                de.confidence,
                de.last_seen,
                de.frame_url,
                d.lat,
                d.lon,
                de.vehicle_color,
                de.vehicle_type,
                de.vehicle_make,
                de.vehicle_model
            FROM detection_events de
            LEFT JOIN LATERAL (
                SELECT lat, lon
                FROM detections
                WHERE drone_id = de.drone_id
                  AND plate_text = de.plate_best
                  AND lat IS NOT NULL
                ORDER BY detected_at DESC
                LIMIT 1
            ) d ON true
            {status_filter}
            ORDER BY de.last_seen DESC
            LIMIT :limit
        """), {"limit": limit, "status": status} if status else {"limit": limit}).fetchall()

        return [
            {
                "id":           r[0],
                "plateText":    r[1],
                "droneId":      r[2],
                "status":       r[3],
                "confidence":   r[4],
                "timestamp":    r[5].isoformat() if r[5] else None,
                "frameUrl":     r[6],
                "lat":          r[7],
                "lng":          r[8],
                "vehicleColor": r[9],
                "vehicleType":  r[10],
                "vehicleMake":  r[11],
                "vehicleModel": r[12],
            }
            for r in rows
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Flock cameras
# Without bbox params → return all cached cameras (default view).
# With bbox params    → filter by bbox; if <3 cached, live-fetch from DeFlock.
# ---------------------------------------------------------------------------

@router.get("/flock/cameras", dependencies=[Depends(require_coordinator)])
def get_flock_cameras(
    south: Optional[float] = Query(None),
    north: Optional[float] = Query(None),
    west:  Optional[float] = Query(None),
    east:  Optional[float] = Query(None),
):
    db = database.SessionLocal()
    try:
        has_bbox = all(v is not None for v in [south, north, west, east])

        if not has_bbox:
            # Derive bbox from active FEMA alert polygons so the camera layer
            # auto-populates for the current mission area without needing a
            # map viewport bbox from the client.
            alert_rows = db.execute(text("""
                SELECT polygon FROM vehicle_targets
                WHERE expires_at > NOW()
                  AND polygon IS NOT NULL AND polygon <> ''
            """)).fetchall()
            if alert_rows:
                all_lats, all_lons = [], []
                for (poly,) in alert_rows:
                    for pair in (poly or "").strip().split():
                        try:
                            lat_s, lon_s = pair.split(",", 1)
                            all_lats.append(float(lat_s))
                            all_lons.append(float(lon_s))
                        except Exception:
                            pass
                if all_lats:
                    PAD = 0.5
                    south = min(all_lats) - PAD
                    north = max(all_lats) + PAD
                    west  = min(all_lons) - PAD
                    east  = max(all_lons) + PAD
                    has_bbox = True

        if has_bbox:
            existing_count = db.execute(text("""
                SELECT COUNT(*) FROM flock_cameras
                WHERE lat BETWEEN :south AND :north
                  AND lng BETWEEN :west  AND :east
            """), {"south": south, "north": north, "west": west, "east": east}).scalar()

            if existing_count < 3:
                _fetch_flock_for_bbox(db, south, north, west, east)

            rows = db.execute(text("""
                SELECT id, lat, lng, heading, road, agency, scraped_at
                FROM flock_cameras
                WHERE lat BETWEEN :south AND :north
                  AND lng BETWEEN :west  AND :east
                ORDER BY id
            """), {"south": south, "north": north, "west": west, "east": east}).fetchall()
        else:
            rows = db.execute(text("""
                SELECT id, lat, lng, heading, road, agency, scraped_at
                FROM flock_cameras
                ORDER BY id
            """)).fetchall()

        return [
            {
                "id":        r[0],
                "lat":       r[1],
                "lng":       r[2],
                "heading":   r[3],
                "road":      r[4],
                "agency":    r[5],
                "scrapedAt": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Coverage endpoints
# ---------------------------------------------------------------------------

@router.get("/alert-areas", dependencies=[Depends(get_current_pilot)])
async def get_alert_areas(
    q: str = Query("", min_length=0, max_length=100),
    limit: int = Query(10, ge=1, le=50),
):
    """
    Autocomplete suggestions for watch_areas. Returns area tokens harvested
    from real FEMA/NWS alerts, ordered by how often they've appeared.
    Pass ?q= for prefix/substring filtering.
    """
    async with database.AsyncSessionLocal() as session:
        if q.strip():
            rows = await session.execute(
                text("""
                    SELECT area_text, seen_count
                    FROM alert_areas
                    WHERE area_text ILIKE :q
                    ORDER BY seen_count DESC, area_text
                    LIMIT :lim
                """),
                {"q": f"%{q.strip()}%", "lim": limit},
            )
        else:
            rows = await session.execute(
                text("""
                    SELECT area_text, seen_count
                    FROM alert_areas
                    ORDER BY seen_count DESC, area_text
                    LIMIT :lim
                """),
                {"lim": limit},
            )
        return [{"area": r[0], "seen_count": r[1]} for r in rows.fetchall()]


@router.get("/coverage/priority-zones", dependencies=[Depends(get_current_pilot)])
def get_priority_zones(
    south: Optional[float] = Query(None),
    north: Optional[float] = Query(None),
    west:  Optional[float] = Query(None),
    east:  Optional[float] = Query(None),
):
    """
    All authenticated pilots: low-coverage cells within the active FEMA search area.
    If south/north/west/east are provided (Deadspace Planner bbox), use those instead.
    Returns derived priority labels only — no camera positions or counts.
    """
    db = database.SessionLocal()
    try:
        bbox = None
        if all(v is not None for v in [south, north, west, east]):
            bbox = {"south": south, "north": north, "west": west, "east": east}
        return compute_priority_zones(db, bbox=bbox)
    finally:
        db.close()


@router.get("/coverage/map", dependencies=[Depends(require_coordinator)])
def get_coverage_map(
    south: Optional[float] = Query(None),
    north: Optional[float] = Query(None),
    west:  Optional[float] = Query(None),
    east:  Optional[float] = Query(None),
):
    """
    Coordinator + admin: full coverage grid with bucketed camera counts.
    If south/north/west/east are provided (Deadspace Planner bbox), use those instead.
    Counts are bucketed ("0", "1-3", "4+") — never exact, never positions.
    """
    db = database.SessionLocal()
    try:
        bbox = None
        if all(v is not None for v in [south, north, west, east]):
            bbox = {"south": south, "north": north, "west": west, "east": east}
        return compute_coverage_map(db, bbox=bbox)
    finally:
        db.close()



# ---------------------------------------------------------------------------
# Coverage gap volunteer ping
# ---------------------------------------------------------------------------

class GapAlertRequest(BaseModel):
    alert_id: str
    south: float
    north: float
    west: float
    east: float

# In-memory cooldown: alert_id → unix timestamp of last successful ping
_gap_ping_cooldown: dict[str, float] = {}
_GAP_PING_COOLDOWN_S = 30 * 60  # 30 minutes per alert


@router.post("/coverage/gap-alert")
def post_gap_alert(req: GapAlertRequest, payload: dict = Depends(require_coordinator)):
    """
    Coordinator: send a generic push notification to all active pilots.
    Notification contains no plate/vehicle/victim details — just a zone alert.
    Enforces a 30-minute per-alert cooldown to prevent spamming volunteers.
    Returns { notified, cooldown, cooldown_seconds_remaining? }.
    """
    now = _time.time()
    last_ping = _gap_ping_cooldown.get(req.alert_id, 0)
    remaining = _GAP_PING_COOLDOWN_S - (now - last_ping)
    if remaining > 0:
        return {"notified": 0, "cooldown": True, "cooldown_seconds_remaining": int(remaining)}

    db = database.SessionLocal()
    try:
        rows = db.execute(
            text(
                "SELECT expo_push_token FROM pilots "
                "WHERE status = 'active' AND expo_push_token IS NOT NULL AND expo_push_token != ''"
            )
        ).fetchall()
    finally:
        db.close()

    tokens = [r[0] for r in rows]
    if not tokens:
        return {"notified": 0, "cooldown": False}

    messages = [
        {
            "to": tok,
            "title": "Volunteer support needed",
            "body": "Coverage gap detected in your area. Open the app to help with an active search.",
            "data": {"type": "coverage_gap"},
            "sound": "default",
            "priority": "high",
        }
        for tok in tokens
    ]

    try:
        resp = _requests.post(
            "https://exp.host/--/api/v2/push/send",
            json=messages,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=10,
        )
    except _requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Push notification failed: {exc}")

    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=502, detail="Push notification service error")

    _gap_ping_cooldown[req.alert_id] = now
    logger.info("Coverage gap ping sent to %d pilot(s) for alert %s", len(tokens), req.alert_id)

    db2 = database.SessionLocal()
    try:
        write_audit_sync(db2, payload["sub"], "coverage_gap_ping", {
            "alert_id": req.alert_id,
            "notified": len(tokens),
        })
    finally:
        db2.close()

    return {"notified": len(tokens), "cooldown": False}


# ---------------------------------------------------------------------------
# Admin audit log
# ---------------------------------------------------------------------------

@router.get("/admin/audit-log", dependencies=[Depends(require_admin)])
def get_audit_log(
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    username: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
):
    """Admin: paginated audit log of coordinator and system actions."""
    db = database.SessionLocal()
    try:
        where_clauses = []
        params: dict = {"limit": limit, "offset": offset}
        if username:
            where_clauses.append("username = :uname")
            params["uname"] = username
        if action:
            where_clauses.append("action = :action")
            params["action"] = action
        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        rows = db.execute(
            text(f"SELECT id, username, action, details, created_at FROM audit_log {where} ORDER BY created_at DESC LIMIT :limit OFFSET :offset"),
            params,
        ).fetchall()
        return [
            {"id": r[0], "username": r[1], "action": r[2], "details": r[3], "createdAt": r[4].isoformat() if r[4] else None}
            for r in rows
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# FEMA alerts — active vehicle targets with polygon / centroid
# ---------------------------------------------------------------------------

@router.get("/fema/alerts", dependencies=[Depends(get_current_pilot)])
def get_fema_alerts():
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT id, fema_identifier, alert_type, source_program, headline,
                   area, polygon, centroid_lat, centroid_lng, added_at, expires_at
            FROM vehicle_targets
            WHERE expires_at IS NULL OR expires_at > NOW()
            ORDER BY added_at DESC
        """)).fetchall()

        return [
            {
                "id":            r[0],
                "femaIdentifier": r[1],
                "alertType":     r[2] or "amber",
                "sourceProgram": r[3],
                "headline":      r[4],
                "area":          r[5],
                "polygon":       r[6],
                "centroidLat":   r[7],
                "centroidLng":   r[8],
                "addedAt":       r[9].isoformat() if r[9] else None,
                "expiresAt":     r[10].isoformat() if r[10] else None,
            }
            for r in rows
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Pilot leaderboard — per-pilot aggregated stats
# ---------------------------------------------------------------------------

@router.get("/pilots/leaderboard", dependencies=[Depends(get_current_pilot)])
def get_pilot_leaderboard():
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT
                COALESCE(tp.pilot_id, d.pilot_id)           AS pilot_id,
                COALESCE(tp.drone_id, d.drone_id)           AS drone_id,
                COALESCE(d.total_detections, 0)             AS total_detections,
                COALESCE(de.watchlist_hits, 0)              AS watchlist_hits,
                COALESCE(tp.flight_minutes, 0)              AS flight_minutes,
                tp.last_seen,
                p.full_name
            FROM (
                SELECT
                    pilot_id,
                    drone_id,
                    COUNT(*)                                 AS flight_rows,
                    ROUND((COUNT(*) / 60.0)::numeric, 1)    AS flight_minutes,
                    MAX(ts)                                  AS last_seen
                FROM telemetry_points
                GROUP BY pilot_id, drone_id
            ) tp
            FULL OUTER JOIN (
                SELECT
                    COALESCE(pilot_id, drone_id)            AS pilot_id,
                    drone_id,
                    COUNT(*)                                 AS total_detections
                FROM detections
                GROUP BY COALESCE(pilot_id, drone_id), drone_id
            ) d ON COALESCE(tp.pilot_id, tp.drone_id) = d.pilot_id
              AND tp.drone_id = d.drone_id
            LEFT JOIN (
                SELECT
                    drone_id,
                    COUNT(*)                                 AS watchlist_hits
                FROM detection_events
                WHERE status = 'alerted'
                GROUP BY drone_id
            ) de ON COALESCE(tp.drone_id, d.drone_id) = de.drone_id
            LEFT JOIN pilots p ON p.username = COALESCE(tp.pilot_id, d.pilot_id)
            ORDER BY total_detections DESC
        """)).fetchall()

        return [
            {
                "pilotId":         r[0],
                "droneId":         r[1],
                "totalDetections": int(r[2]),
                "watchlistHits":   int(r[3]),
                "flightMinutes":   float(r[4]),
                "lastSeen":        r[5].isoformat() if r[5] else None,
                "fullName":        r[6],
            }
            for r in rows
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Badges — gamification, computed live from pilot stats + profile
# ---------------------------------------------------------------------------

@router.get("/pilots/my-badges")
def get_my_badges(payload: dict = Depends(get_current_pilot)):
    db = database.SessionLocal()
    try:
        return compute_all_badges(payload["sub"], db)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Watchlist — for the event feed to badge alert plates
# ---------------------------------------------------------------------------

@router.get("/alerts/history", dependencies=[Depends(get_current_pilot)])
def get_alert_history(limit: int = Query(200, le=500)):
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT
                a.id, a.plate_text, a.drone_id, a.channel, a.sent_at,
                de.vehicle_color, de.vehicle_type, de.vehicle_make, de.vehicle_model,
                de.confidence, w.alert_type, w.description
            FROM alerts a
            LEFT JOIN detection_events de ON de.id::text = a.event_id
            LEFT JOIN watchlist w ON w.plate_text = a.plate_text
            ORDER BY a.sent_at DESC
            LIMIT :limit
        """), {"limit": limit}).fetchall()
        return [
            {
                "id":           r[0],
                "plate":        r[1],
                "droneId":      r[2],
                "channel":      r[3],
                "sentAt":       r[4].isoformat() if r[4] else None,
                "vehicleColor": r[5],
                "vehicleType":  r[6],
                "vehicleMake":  r[7],
                "vehicleModel": r[8],
                "confidence":   round(r[9], 1) if r[9] else None,
                "alertType":    r[10] or "amber",
                "description":  r[11],
            }
            for r in rows
        ]
    finally:
        db.close()


@router.get("/watchlist", dependencies=[Depends(get_current_pilot)])
def get_watchlist():
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT plate_text, description, added_at, alert_type, source_program
            FROM watchlist
            ORDER BY added_at DESC
        """)).fetchall()

        return [
            {
                "plateText":     r[0],
                "description":   r[1],
                "addedAt":       r[2].isoformat() if r[2] else None,
                "alertType":     r[3] or "amber",
                "sourceProgram": r[4],
            }
            for r in rows
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Admin — manual test alert
# ---------------------------------------------------------------------------

_NOMINATIM_URL  = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_UA   = "AmberAngels-admin/1.0"
# Half-side of the standard search box in degrees (≈5.5 km at mid-latitudes)
_ZONE_HALF_DEG  = 0.05


def _geocode(area: str) -> tuple[float, float] | None:
    """Return (lat, lng) for a location string via Nominatim, or None on failure."""
    import re
    query = area.strip()
    # Bare US zip codes (5 digits) confuse Nominatim — append country hint
    if re.fullmatch(r"\d{5}", query):
        query = f"{query}, USA"
    try:
        resp = _requests.get(
            _NOMINATIM_URL,
            params={"q": query, "format": "json", "limit": 1, "countrycodes": "us"},
            headers={"User-Agent": _NOMINATIM_UA},
            timeout=8,
        )
        resp.raise_for_status()
        results = resp.json()
        if results:
            return float(results[0]["lat"]), float(results[0]["lon"])
    except Exception as e:
        logger.warning("Manual alert geocode failed for %r: %s", area, e)
    return None


def _bbox_polygon(lat: float, lng: float, half: float = _ZONE_HALF_DEG) -> str:
    """Return space-separated 'lat,lng' pairs forming a closed rectangular polygon."""
    s, n, w, e = lat - half, lat + half, lng - half, lng + half
    return f"{s},{w} {s},{e} {n},{e} {n},{w} {s},{w}"


def _discord_zone_embed(
    headline: str,
    area: str,
    alert_type: str,
    plate: str | None,
    lat: float,
    lng: float,
    expires_at: str,
    webhook_url: str,
) -> None:
    """Fire-and-forget Discord embed for a new manual search zone."""
    _COLORS = {"amber": 0xF59E0B, "silver": 0x94A3B8, "blue": 0x3B82F6, "test": 0x6B7280}
    color   = _COLORS.get(alert_type.lower(), 0xF59E0B)
    fields  = [
        {"name": "Area",       "value": area,                    "inline": True},
        {"name": "Alert type", "value": alert_type.upper(),      "inline": True},
        {"name": "Expires",    "value": expires_at[:16] + " UTC", "inline": True},
    ]
    if plate:
        fields.insert(0, {"name": "Target plate", "value": f"`{plate}`", "inline": True})
    embed = {
        "title": f"🗺️  Search Zone Activated — {headline}",
        "color": color,
        "fields": fields,
        "footer": {"text": f"centroid {lat:.4f}, {lng:.4f}"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        _requests.post(webhook_url, json={"embeds": [embed]}, timeout=5)
    except Exception as e:
        logger.warning("Manual alert Discord notify failed: %s", e)


class ManualAlertRequest(BaseModel):
    # Plate (watchlist entry)
    plate:        Optional[str] = None
    # Vehicle description (vehicle_targets entry)
    color:        Optional[str] = None
    body_type:    Optional[str] = None
    make:         Optional[str] = None
    area:         Optional[str] = None
    # Shared
    alert_type:   str = "amber"
    description:  Optional[str] = None
    expires_hours: int = 24


@router.post("/admin/manual-alert", dependencies=[Depends(require_admin)])
def create_manual_alert(req: ManualAlertRequest):
    import subprocess, os
    db = database.SessionLocal()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=req.expires_hours)
    created = []

    # Geocode area once — used for both zone polygon and Discord embed
    centroid: tuple[float, float] | None = None
    polygon_str: str | None = None
    if req.area:
        centroid = _geocode(req.area)
        if centroid:
            polygon_str = _bbox_polygon(*centroid)

    try:
        if req.plate:
            plate = req.plate.strip().upper()
            db.execute(text("""
                INSERT INTO watchlist (plate_text, description, alert_type, source_program)
                VALUES (:plate, :desc, :atype, 'manual')
                ON CONFLICT (plate_text) DO UPDATE
                  SET description  = EXCLUDED.description,
                      alert_type   = EXCLUDED.alert_type,
                      source_program = 'manual'
            """), {
                "plate": plate,
                "desc":  req.description or f"Manual test — {req.alert_type.upper()} alert",
                "atype": req.alert_type,
            })
            created.append(f"watchlist:{plate}")

        # Always create a vehicle_targets zone entry when area is provided so the
        # map polygon renders even for plate-only alerts.
        if any([req.color, req.body_type, req.make]) or req.area:
            fema_id  = f"manual-{uuid.uuid4().hex[:8]}"
            headline = " ".join(filter(None, [req.color, req.body_type, req.make])).strip()
            if not headline:
                headline = req.description or (f"Search zone — {req.area}" if req.area else "Manual test vehicle")
            db.execute(text("""
                INSERT INTO vehicle_targets
                    (fema_identifier, alert_type, source_program, headline,
                     area, color, body_type, make, expires_at,
                     polygon, centroid_lat, centroid_lng)
                VALUES
                    (:fid, :atype, 'manual', :headline,
                     :area, :color, :body_type, :make, :expires,
                     :polygon, :clat, :clng)
            """), {
                "fid":       fema_id,
                "atype":     req.alert_type,
                "headline":  headline,
                "area":      req.area,
                "color":     req.color,
                "body_type": req.body_type,
                "make":      req.make,
                "expires":   expires,
                "polygon":   polygon_str,
                "clat":      centroid[0] if centroid else None,
                "clng":      centroid[1] if centroid else None,
            })
            created.append(f"vehicle_target:{fema_id}")

        db.commit()

        # ── Side-effects (best-effort, non-blocking) ──────────────────────────
        # Push-notify pilots exactly as a real FEMA alert would.
        from services.fema_connector import _notify_watching_pilots, ALERT_REGISTRY
        _ATYPE_MAP = {a["key"]: a for a in ALERT_REGISTRY}
        _TEST_ATYPE = {"key": "test", "name": "Test Alert", "short": "TEST",
                       "emoji": "🟡", "cta": "Test alert — volunteers respond."}
        atype_dict = _ATYPE_MAP.get(req.alert_type, _TEST_ATYPE)
        _notify_headline = (
            " ".join(filter(None, [req.color, req.body_type, req.make])).strip()
            or req.description
            or (f"Search zone — {req.area}" if req.area else None)
            or (f"Plate {req.plate.upper()}" if req.plate else "Manual test alert")
        )
        alert_for_notify = {
            "alert_type":     atype_dict,
            "area":           req.area or "",
            "headline":       _notify_headline,
            "polygon":        polygon_str,
            "source_program": "manual",
        }
        threading.Thread(
            target=lambda: asyncio.run(
                _notify_watching_pilots(database.AsyncSessionLocal, alert_for_notify)
            ),
            daemon=True,
        ).start()

        webhook_url = os.getenv("ALERT_WEBHOOK_URL", "")
        if webhook_url and centroid:
            _discord_zone_embed(
                headline    = headline if any([req.color, req.body_type, req.make]) or req.area else "Manual alert",
                area        = req.area or "unknown",
                alert_type  = req.alert_type,
                plate       = req.plate.strip().upper() if req.plate else None,
                lat         = centroid[0],
                lng         = centroid[1],
                expires_at  = expires.isoformat(),
                webhook_url = webhook_url,
            )

        # Kick off Flock camera scraper + road segment seeder in background.
        # Both use the same bbox resolution (active FEMA alerts), so they'll
        # populate data for this new alert zone automatically.
        if polygon_str:
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            for script in ("scripts/scrape_flock.py", "scripts/seed_road_segments.py"):
                subprocess.Popen(
                    ["python3", script],
                    cwd=project_root,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )

        return {
            "created":    created,
            "expires_at": expires.isoformat(),
            "zone":       {"lat": centroid[0], "lng": centroid[1]} if centroid else None,
        }
    finally:
        db.close()


@router.get("/admin/manual-alerts", dependencies=[Depends(require_admin)])
def list_manual_alerts():
    db = database.SessionLocal()
    try:
        plates = db.execute(text("""
            SELECT plate_text, description, alert_type, added_at
            FROM watchlist WHERE source_program = 'manual'
            ORDER BY added_at DESC
        """)).fetchall()

        vehicles = db.execute(text("""
            SELECT id, headline, color, body_type, make, area, alert_type, expires_at
            FROM vehicle_targets WHERE source_program = 'manual'
            ORDER BY added_at DESC
        """)).fetchall()

        return {
            "plates": [
                {"plate": r[0], "description": r[1], "alertType": r[2],
                 "addedAt": r[3].isoformat() if r[3] else None}
                for r in plates
            ],
            "vehicles": [
                {"id": r[0], "headline": r[1], "color": r[2], "bodyType": r[3],
                 "make": r[4], "area": r[5], "alertType": r[6],
                 "expiresAt": r[7].isoformat() if r[7] else None}
                for r in vehicles
            ],
        }
    finally:
        db.close()


@router.delete("/admin/manual-alert/plate/{plate}", dependencies=[Depends(require_admin)])
def delete_manual_plate(plate: str):
    db = database.SessionLocal()
    try:
        db.execute(text(
            "DELETE FROM watchlist WHERE plate_text = :p AND source_program = 'manual'"
        ), {"p": plate.upper()})
        db.commit()
        return {"deleted": plate.upper()}
    finally:
        db.close()


@router.delete("/admin/manual-alert/vehicle/{alert_id}", dependencies=[Depends(require_admin)])
def delete_manual_vehicle(alert_id: int):
    db = database.SessionLocal()
    try:
        db.execute(text(
            "DELETE FROM vehicle_targets WHERE id = :id AND source_program = 'manual'"
        ), {"id": alert_id})
        db.commit()
        return {"deleted": alert_id}
    finally:
        db.close()


@router.delete("/admin/test-data", dependencies=[Depends(require_admin)])
def clear_test_data():
    """Wipe all manual watchlist entries, manual vehicle targets, and detection events."""
    db = database.SessionLocal()
    try:
        wl  = db.execute(text("DELETE FROM watchlist WHERE source_program = 'manual' RETURNING plate_text")).rowcount
        vt  = db.execute(text("DELETE FROM vehicle_targets WHERE source_program = 'manual' RETURNING id")).rowcount
        de  = db.execute(text("DELETE FROM detection_events")).rowcount
        db.commit()
        return {"cleared": {"watchlist": wl, "vehicle_targets": vt, "detection_events": de}}
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Airspace traffic (ADS-B IN via OpenSky Network)
# ---------------------------------------------------------------------------

_OPENSKY_URL      = "https://opensky-network.org/api/states/all"
_AIRSPACE_CACHE: dict[str, tuple[float, list]] = {}
_AIRSPACE_TTL     = 60.0   # seconds — OpenSky anonymous rate limit is ~10s, we're polite


def _resolve_fema_bbox(db) -> dict | None:
    """Return a bbox covering all active FEMA alert polygons + 0.3° padding."""
    rows = db.execute(text("""
        SELECT polygon FROM vehicle_targets
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND polygon IS NOT NULL AND polygon <> ''
    """)).fetchall()
    lats, lngs = [], []
    for (poly,) in rows:
        for pair in (poly or "").strip().split():
            try:
                la, lo = pair.split(",", 1)
                lats.append(float(la)); lngs.append(float(lo))
            except Exception:
                continue
    if not lats:
        return None
    pad = 0.3
    return {
        "south": min(lats) - pad, "north": max(lats) + pad,
        "west":  min(lngs) - pad, "east":  max(lngs) + pad,
    }


@router.get("/airspace/traffic", dependencies=[Depends(get_current_pilot)])
def get_airspace_traffic(
    south: Optional[float] = None,
    north: Optional[float] = None,
    west:  Optional[float] = None,
    east:  Optional[float] = None,
    db = Depends(database.get_db),
):
    """
    Airborne aircraft in the area from OpenSky Network (ADS-B IN).
    Bbox defaults to active FEMA alert area + padding if not supplied.
    Results are cached 60 seconds to stay well within OpenSky's rate limits.
    """
    if None in (south, north, west, east):
        bbox = _resolve_fema_bbox(db)
        if not bbox:
            # No active alerts — use Carrollton, GA as default view
            south, north, west, east = 33.45, 33.70, -85.25, -84.95
        else:
            south, north, west, east = bbox["south"], bbox["north"], bbox["west"], bbox["east"]

    cache_key = f"{round(south,1)},{round(north,1)},{round(west,1)},{round(east,1)}"
    cached = _AIRSPACE_CACHE.get(cache_key)
    if cached and _time.time() - cached[0] < _AIRSPACE_TTL:
        return cached[1]

    try:
        resp = _requests.get(
            _OPENSKY_URL,
            params={"lamin": south, "lamax": north, "lomin": west, "lomax": east},
            headers={"User-Agent": "AmberAngels-airspace/1.0"},
            timeout=8,
        )
        resp.raise_for_status()
        states = resp.json().get("states") or []
    except Exception as exc:
        logger.warning("OpenSky fetch failed: %s", exc)
        # Return stale cache rather than erroring
        return _AIRSPACE_CACHE.get(cache_key, (0, []))[1]

    aircraft = []
    for s in states:
        if len(s) < 11 or s[8]:          # skip on-ground aircraft
            continue
        if s[5] is None or s[6] is None:  # skip if no position
            continue
        aircraft.append({
            "icao24":        s[0],
            "callsign":      (s[1] or "").strip() or None,
            "lng":           s[5],
            "lat":           s[6],
            "altitudeM":     s[7],   # barometric altitude in metres, may be null
            "velocityMs":    s[9],   # ground speed m/s, may be null
            "heading":       s[10],  # true track degrees 0–360, may be null
            "timePosition":  s[3],   # Unix timestamp of last position update, may be null
        })

    _AIRSPACE_CACHE[cache_key] = (_time.time(), aircraft)
    return aircraft


# ---------------------------------------------------------------------------
# NCMEC recent cases feed
# ---------------------------------------------------------------------------

@router.get("/ncmec/recent", dependencies=[Depends(get_current_pilot)])
def get_ncmec_recent(limit: int = 40, db=Depends(_sync_db)):
    rows = db.execute(text("""
        SELECT guid, name, age_now, state, city, missing_since,
               poster_url, photo_url, first_seen_at, resolved_at
        FROM ncmec_cases
        WHERE last_seen_at > NOW() - INTERVAL '30 days'
        ORDER BY first_seen_at DESC
        LIMIT :limit
    """), {"limit": limit}).fetchall()
    return [
        {
            "guid":        r[0],
            "name":        r[1],
            "ageNow":      r[2],
            "state":       r[3],
            "city":        r[4],
            "missingSince": r[5].isoformat() if r[5] else None,
            "posterUrl":   r[6],
            "photoUrl":    r[7],
            "firstSeenAt": r[8].isoformat() if r[8] else None,
            "resolvedAt":  r[9].isoformat() if r[9] else None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Background tasks: daily retention purges
# ---------------------------------------------------------------------------

async def detection_purge_loop(
    session_factory,
    non_alerted_days: int = 30,
    alerted_days: int = 365,
    golden_dir: str | None = None,
):
    """
    Daily background task — two-tier retention:
    - Non-alerted detection events: deleted after non_alerted_days (default 30)
    - Alerted (HIGH_CONFIDENCE) detection events: deleted after alerted_days (default 365)
      Golden frame files on disk are deleted alongside their detection records.
    """
    import os as _os
    import glob as _glob

    _golden_dir = golden_dir or _os.getenv(
        "GOLDEN_DIR",
        "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/golden_frames",
    )

    while True:
        await asyncio.sleep(24 * 3600)
        try:
            async with session_factory() as db:
                # 1. Purge non-alerted events older than 30 days
                r1 = await db.execute(
                    text(
                        f"DELETE FROM detection_events "
                        f"WHERE status NOT IN ('alerted') "
                        f"AND last_seen < NOW() - INTERVAL '{int(non_alerted_days)} days'"
                    )
                )

                # 2. Fetch alerted events older than 365 days so we can clean up golden frames
                old_alerted = await db.execute(
                    text(
                        f"SELECT id, frame_url FROM detection_events "
                        f"WHERE status = 'alerted' "
                        f"AND last_seen < NOW() - INTERVAL '{int(alerted_days)} days'"
                    )
                )
                rows = old_alerted.fetchall()

                if rows:
                    ids = [r[0] for r in rows]
                    frame_urls = [r[1] for r in rows if r[1]]

                    # Delete golden frames from disk
                    deleted_frames = 0
                    for frame_url in frame_urls:
                        filename = _os.path.basename(frame_url)
                        if not _os.path.splitext(filename)[1]:
                            filename += ".jpg"
                        path = _os.path.join(_golden_dir, filename)
                        if _os.path.isfile(path):
                            try:
                                _os.remove(path)
                                deleted_frames += 1
                            except OSError:
                                pass
                        else:
                            # Worker saves as alert_<plate>_<filename> — try glob
                            for match in _glob.glob(_os.path.join(_golden_dir, f"*_{filename}")):
                                try:
                                    _os.remove(match)
                                    deleted_frames += 1
                                except OSError:
                                    pass

                    # Delete the DB records
                    placeholders = ",".join(str(i) for i in ids)
                    r2 = await db.execute(
                        text(f"DELETE FROM detection_events WHERE id IN ({placeholders})")
                    )
                    await db.commit()
                    logger.info(
                        "Detection purge: %d non-alerted (>%dd), %d alerted (>%dd), %d golden frames",
                        r1.rowcount, non_alerted_days, r2.rowcount, alerted_days, deleted_frames,
                    )
                else:
                    await db.commit()
                    logger.info(
                        "Detection purge: %d non-alerted (>%dd), 0 alerted expired",
                        r1.rowcount, non_alerted_days,
                    )
        except Exception as exc:
            logger.error("Detection purge failed: %s", exc)


async def telemetry_purge_loop(session_factory, retention_days: int = 90):
    """Daily background task: delete telemetry_points older than retention_days (default 90)."""
    while True:
        await asyncio.sleep(24 * 3600)
        try:
            async with session_factory() as db:
                result = await db.execute(
                    text(
                        f"DELETE FROM telemetry_points "
                        f"WHERE ts < NOW() - INTERVAL '{int(retention_days)} days'"
                    )
                )
                await db.commit()
                logger.info("Telemetry purge: removed %d points older than %d days", result.rowcount, retention_days)
        except Exception as exc:
            logger.error("Telemetry purge failed: %s", exc)
