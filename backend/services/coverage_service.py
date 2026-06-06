"""
backend/services/coverage_service.py

Road-segment-based Flock camera coverage scoring.

Each road segment (from road_segments table, seeded via scripts/seed_road_segments.py)
is scored by how many Flock cameras can see it, using:
  - Distance check (≤ MAX_RANGE_M from segment centroid)
  - Heading/FOV check (segment within ±FOV_HALF_DEG of camera facing direction)
    If a camera has no heading data, distance-only coverage is assumed.

Two public endpoints:
  compute_coverage_map(db, bbox)   → all segments with scores (coordinator)
  compute_priority_zones(db, bbox) → uncovered/sparse segments only (pilots)

Security model:
  - Raw camera positions and exact counts never leave this module.
  - Pilots receive only segment geometry + priority label.
  - Coordinators receive segment geometry + score (int, no camera positions).
"""

import json
import math
from sqlalchemy import text

# Camera effective range in metres — Flock cameras influence a road corridor
# well beyond plate-read range; 800m keeps adjacent roads out while covering
# the same road across a typical camera spacing interval.
MAX_RANGE_M = 800

# ±FOV_HALF_DEG from camera heading (total 160°).
# Cameras mounted roadside cover the road in both adjacent directions;
# the wide FOV prevents false negatives from minor heading misalignment.
FOV_HALF_DEG = 80

# Extra degrees of padding around bbox for coordinator view
MAP_PAD_DEG = 0.3

# Pad for camera query (degrees equivalent of MAX_RANGE_M at mid-latitudes)
_CAM_PAD_DEG = MAX_RANGE_M / 111_320

# Coverage thresholds
_SPARSE_MAX    = 2   # ≤ this → medium priority (sparse coverage)
_COVERED_MIN   = 3   # ≥ this → well covered (omit from pilot zones)

_EARTH_R = 6_371_000.0


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * _EARTH_R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """True bearing (0–360°) from point 1 to point 2."""
    dlon = math.radians(lng2 - lng1)
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    x = math.sin(dlon) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _camera_covers_point(
    cam_lat: float, cam_lng: float, cam_heading: int | None,
    pt_lat: float, pt_lng: float,
) -> bool:
    """Return True if this camera can see the point (distance + FOV check)."""
    if _haversine_m(cam_lat, cam_lng, pt_lat, pt_lng) > MAX_RANGE_M:
        return False
    if cam_heading is None:
        return True  # No heading data — assume the camera covers its surroundings
    bearing = _bearing_deg(cam_lat, cam_lng, pt_lat, pt_lng)
    angular_diff = abs((bearing - cam_heading + 180) % 360 - 180)
    return angular_diff <= FOV_HALF_DEG


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_active_fema_bbox(db) -> dict | None:
    rows = db.execute(text("""
        SELECT polygon FROM vehicle_targets
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND polygon IS NOT NULL AND polygon <> ''
    """)).fetchall()

    lats, lngs = [], []
    for (poly,) in rows:
        for pair in (poly or "").strip().split():
            try:
                lat_s, lon_s = pair.split(",", 1)
                lats.append(float(lat_s)); lngs.append(float(lon_s))
            except Exception:
                continue

    if not lats:
        return None
    return {
        "south":        min(lats),
        "north":        max(lats),
        "west":         min(lngs),
        "east":         max(lngs),
        "centroid_lat": sum(lats) / len(lats),
        "centroid_lng": sum(lngs) / len(lngs),
    }


def _fetch_segments(db, south: float, north: float, west: float, east: float) -> list:
    return db.execute(text("""
        SELECT id, name, highway_type, geometry_json, centroid_lat, centroid_lng
        FROM road_segments
        WHERE centroid_lat BETWEEN :south AND :north
          AND centroid_lng BETWEEN :west  AND :east
        ORDER BY
            CASE highway_type
                WHEN 'motorway'     THEN 1
                WHEN 'trunk'        THEN 2
                WHEN 'primary'      THEN 3
                WHEN 'secondary'    THEN 4
                WHEN 'tertiary'     THEN 5
                WHEN 'residential'  THEN 6
                WHEN 'unclassified' THEN 7
                ELSE 8
            END
        LIMIT 8000
    """), {"south": south, "north": north, "west": west, "east": east}).fetchall()


def _fetch_cameras(db, south: float, north: float, west: float, east: float) -> list[tuple]:
    rows = db.execute(text("""
        SELECT lat, lng, heading FROM flock_cameras
        WHERE lat BETWEEN :south AND :north
          AND lng BETWEEN :west  AND :east
    """), {
        "south": south - _CAM_PAD_DEG * 2, "north": north + _CAM_PAD_DEG * 2,
        "west":  west  - _CAM_PAD_DEG * 2, "east":  east  + _CAM_PAD_DEG * 2,
    }).fetchall()
    return [(float(r[0]), float(r[1]), r[2]) for r in rows]


def _score_segments(segment_rows, cameras: list[tuple]) -> list[dict]:
    """
    For each segment, count cameras that can see it.
    Returns list of dicts ready to serialize.
    """
    result = []
    for row in segment_rows:
        seg_id, name, highway_type, geometry_json, centroid_lat, centroid_lng = row
        c_lat = float(centroid_lat)
        c_lng = float(centroid_lng)

        score = sum(
            1 for cam_lat, cam_lng, cam_heading in cameras
            if _camera_covers_point(cam_lat, cam_lng, cam_heading, c_lat, c_lng)
        )

        geom = geometry_json if isinstance(geometry_json, dict) else json.loads(geometry_json)

        # Build a space-separated "lat,lng" polygon string from the GeoJSON
        # coordinates (which are [lng, lat] order) so the mobile parsePoly helper
        # can consume it without knowing about GeoJSON.
        coords = geom.get("coordinates", []) if isinstance(geom, dict) else []
        polygon_str = " ".join(f"{lat},{lng}" for lng, lat in coords) if coords else ""

        result.append({
            "id":            seg_id,
            "name":          name,
            "highwayType":   highway_type or "road",
            "geometry":      geom,
            "polygon":       polygon_str,
            "label":         name or highway_type or "road",
            "centroidLat":   round(c_lat, 6),
            "centroidLng":   round(c_lng, 6),
            "coverageScore": score,
        })
    return result


# ---------------------------------------------------------------------------
# Public API (called by read_api.py)
# ---------------------------------------------------------------------------

def compute_coverage_map(db, bbox: dict | None = None) -> list[dict]:
    """
    Coordinator view: all road segments in the area colored by camera coverage score.

    Returns: [{id, name, highwayType, geometry (GeoJSON LineString),
                centroidLat, centroidLng, coverageScore}]
    coverageScore = number of Flock cameras that can see the segment.
    """
    if bbox is None:
        bbox = _get_active_fema_bbox(db)
    if not bbox:
        return []

    south = bbox["south"] - MAP_PAD_DEG
    north = bbox["north"] + MAP_PAD_DEG
    west  = bbox["west"]  - MAP_PAD_DEG
    east  = bbox["east"]  + MAP_PAD_DEG

    segments = _fetch_segments(db, south, north, west, east)
    if not segments:
        return []

    cameras = _fetch_cameras(db, south, north, west, east)
    return _score_segments(segments, cameras)


def compute_priority_zones(db, bbox: dict | None = None) -> list[dict]:
    """
    Pilot view: uncovered/sparse road segments in the active search area only.
    Well-covered segments (≥ _COVERED_MIN cameras) are omitted.

    Returns: [{id, name, highwayType, geometry, centroidLat, centroidLng,
                coverageScore, priority: "high"|"medium"}]
    """
    if bbox is None:
        bbox = _get_active_fema_bbox(db)
    if not bbox:
        return []

    # Tight bbox — only show dark roads within the active search zone
    segments = _fetch_segments(db, bbox["south"], bbox["north"], bbox["west"], bbox["east"])
    if not segments:
        return []

    cameras = _fetch_cameras(db, bbox["south"], bbox["north"], bbox["west"], bbox["east"])
    scored  = _score_segments(segments, cameras)

    result = []
    for seg in scored:
        if seg["coverageScore"] >= _COVERED_MIN:
            continue
        result.append({
            **seg,
            "priority": "high" if seg["coverageScore"] == 0 else "medium",
        })
    return result
