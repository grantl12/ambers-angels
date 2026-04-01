"""
backend/routers/read_api.py

Read-only API endpoints consumed by the frontend dashboard.

GET /missions/active
GET /telemetry/latest
GET /telemetry/trail
GET /detections/feed
"""

from fastapi import APIRouter, Query
from sqlalchemy import text
from datetime import datetime, timezone, timedelta
from typing import Optional
import math
import requests as _requests
import database

_DEFLOCK_INDEX_URL = "https://cdn.deflock.me/regions/index.json"
_DEFLOCK_HEADERS   = {"User-Agent": "AmberAngels-mission-scraper/1.0"}


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
        print(f"[FLOCK] DeFlock index fetch failed: {exc}")
        return

    lat_min = math.floor(south / tile_size) * tile_size
    lat_max = math.floor(north / tile_size) * tile_size
    lon_min = math.floor(west  / tile_size) * tile_size
    lon_max = math.floor(east  / tile_size) * tile_size

    rows: list[dict] = []
    lat = lat_min
    while lat <= lat_max + 1e-9:
        lon = lon_min
        while lon <= lon_max + 1e-9:
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
        print(f"[FLOCK] Live-fetched {len(rows)} cameras for bbox")

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

@router.get("/missions/active")
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


# ---------------------------------------------------------------------------
# Telemetry — latest position per drone
# ---------------------------------------------------------------------------

@router.get("/telemetry/latest")
def get_latest_telemetry(mission_id: Optional[str] = None):
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT DISTINCT ON (drone_id)
                drone_id, pilot_id, ts, lat, lon, altitude_m, heading_deg, speed_mps
            FROM telemetry_points
            ORDER BY drone_id, ts DESC
        """)).fetchall()

        return [
            {
                "droneId":   r[0],
                "pilotId":   r[1],
                "timestamp": r[2].isoformat() if r[2] else None,
                "lat":       r[3],
                "lng":       r[4],
                "altitude":  r[5],
                "heading":   r[6],
                "speed":     r[7],
            }
            for r in rows
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Telemetry — flight trail
# ---------------------------------------------------------------------------

@router.get("/telemetry/trail")
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

@router.get("/detections/feed")
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

@router.get("/flock/cameras")
def get_flock_cameras(
    south: Optional[float] = Query(None),
    north: Optional[float] = Query(None),
    west:  Optional[float] = Query(None),
    east:  Optional[float] = Query(None),
):
    db = database.SessionLocal()
    try:
        has_bbox = all(v is not None for v in [south, north, west, east])

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
# FEMA alerts — active vehicle targets with polygon / centroid
# ---------------------------------------------------------------------------

@router.get("/fema/alerts")
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
# Watchlist — for the event feed to badge alert plates
# ---------------------------------------------------------------------------

@router.get("/watchlist")
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
