"""
backend/services/coverage_service.py

Computes flight priority zones and coverage map cells from flock_cameras + FEMA polygons.

Two outputs:
  compute_priority_zones(db)  → for pilots: low-coverage cells within active search area
  compute_coverage_map(db)    → for coordinators: all cells with bucketed camera counts

Security model:
  - Raw camera positions never leave this module.
  - Camera counts are bucketed ("0", "1-3", "4+") — not exact.
  - Pilots receive only derived priority labels; the coverage reasoning is opaque to them.
"""

import math
from sqlalchemy import text

# Grid resolution: 0.1 degrees ≈ 7 miles at mid-latitudes
CELL_DEG = 0.1

# Extra padding (degrees) around FEMA bbox for the coordinator coverage map
MAP_PAD_DEG = 0.3

# Thresholds for camera count bucketing
_BUCKET_MEDIUM_MIN = 1   # 1–3 cameras → medium priority
_BUCKET_HIGH_MIN   = 4   # 4+ cameras  → well covered, omit from pilot zones


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_polygon(poly_str: str) -> list[tuple[float, float]]:
    coords = []
    for pair in (poly_str or "").strip().split():
        try:
            lat_s, lon_s = pair.split(",", 1)
            coords.append((float(lat_s), float(lon_s)))
        except Exception:
            continue
    return coords


def _cell_polygon_str(cell_lat: float, cell_lon: float) -> str:
    """Space-separated 'lat,lng' closed polygon for a CELL_DEG-square cell."""
    s = round(cell_lat, 6)
    n = round(cell_lat + CELL_DEG, 6)
    w = round(cell_lon, 6)
    e = round(cell_lon + CELL_DEG, 6)
    return f"{s},{w} {n},{w} {n},{e} {s},{e} {s},{w}"


def _cells_for_bbox(south: float, north: float, west: float, east: float) -> list[tuple[float, float]]:
    """All grid cell SW corners (lat, lon) covering the given bbox."""
    lat = math.floor(south / CELL_DEG) * CELL_DEG
    cells = []
    while lat < north:
        lon = math.floor(west / CELL_DEG) * CELL_DEG
        while lon < east:
            cells.append((round(lat, 6), round(lon, 6)))
            lon = round(lon + CELL_DEG, 6)
        lat = round(lat + CELL_DEG, 6)
    return cells


def _compass_label(cell_lat: float, cell_lon: float, centroid_lat: float, centroid_lng: float) -> str:
    dlat = cell_lat - centroid_lat
    dlon = cell_lon - centroid_lng
    angle = math.degrees(math.atan2(dlon, dlat))
    dirs = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"]
    return f"{dirs[round(angle / 45) % 8]} sector"


def _get_active_fema_bbox(db) -> dict | None:
    """
    Derive a bounding box + centroid from all active FEMA alert polygons.
    Returns None when no active alerts exist.
    """
    rows = db.execute(text("""
        SELECT polygon FROM vehicle_targets
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND polygon IS NOT NULL AND polygon <> ''
    """)).fetchall()

    if not rows:
        return None

    all_lats: list[float] = []
    all_lons: list[float] = []
    for (poly,) in rows:
        for lat, lon in _parse_polygon(poly):
            all_lats.append(lat)
            all_lons.append(lon)

    if not all_lats:
        return None

    return {
        "south":        min(all_lats),
        "north":        max(all_lats),
        "west":         min(all_lons),
        "east":         max(all_lons),
        "centroid_lat": sum(all_lats) / len(all_lats),
        "centroid_lng": sum(all_lons) / len(all_lons),
    }


def _camera_counts_in_bbox(db, south: float, north: float, west: float, east: float) -> dict[tuple[float, float], int]:
    """
    Single query: count cameras per CELL_DEG grid cell within the bbox.
    Returns {(cell_lat, cell_lon): count}.
    """
    rows = db.execute(text("""
        SELECT
            FLOOR(lat / :cell) * :cell  AS cell_lat,
            FLOOR(lng / :cell) * :cell  AS cell_lon,
            COUNT(*)                    AS cnt
        FROM flock_cameras
        WHERE lat BETWEEN :south AND :north
          AND lng BETWEEN :west  AND :east
        GROUP BY cell_lat, cell_lon
    """), {
        "cell":  CELL_DEG,
        "south": south,
        "north": north,
        "west":  west,
        "east":  east,
    }).fetchall()

    return {(round(float(r[0]), 6), round(float(r[1]), 6)): int(r[2]) for r in rows}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_priority_zones(db, bbox: dict | None = None) -> list[dict]:
    """
    For pilots: cells within the search area with low camera coverage.
    bbox may be injected by the Deadspace Planner zip search; falls back to active FEMA alert.

    Returns: [{polygon, priority: "high"|"medium", label: str}]
    Well-covered cells (4+ cameras) are omitted entirely.
    """
    if bbox is None:
        bbox = _get_active_fema_bbox(db)
    else:
        bbox = dict(bbox)
        bbox.setdefault("centroid_lat", (bbox["south"] + bbox["north"]) / 2)
        bbox.setdefault("centroid_lng", (bbox["west"]  + bbox["east"])  / 2)
    if not bbox:
        return []

    counts = _camera_counts_in_bbox(db, bbox["south"], bbox["north"], bbox["west"], bbox["east"])
    cells  = _cells_for_bbox(bbox["south"], bbox["north"], bbox["west"], bbox["east"])

    zones = []
    for cell_lat, cell_lon in cells:
        count = counts.get((cell_lat, cell_lon), 0)
        if count >= _BUCKET_MEDIUM_MIN + 3:   # 4+ → well covered, skip
            continue
        priority = "high" if count == 0 else "medium"
        label    = _compass_label(
            cell_lat + CELL_DEG / 2,
            cell_lon + CELL_DEG / 2,
            bbox["centroid_lat"],
            bbox["centroid_lng"],
        )
        zones.append({
            "polygon":  _cell_polygon_str(cell_lat, cell_lon),
            "priority": priority,
            "label":    label,
        })

    return zones


def compute_coverage_map(db, bbox: dict | None = None) -> list[dict]:
    """
    For coordinators: all cells in the search area with bucketed camera counts.
    Includes well-covered cells — needed for the coverage visualization.
    bbox may be injected by the Deadspace Planner zip search; falls back to active FEMA alert.

    Returns: [{polygon, cameraCountBucket: "0"|"1-3"|"4+", centroidLat, centroidLng}]
    Bucket is never an exact count; positions are never returned.
    """
    if bbox is None:
        bbox = _get_active_fema_bbox(db)
    if not bbox:
        return []

    # Expand slightly for context
    south = bbox["south"] - MAP_PAD_DEG
    north = bbox["north"] + MAP_PAD_DEG
    west  = bbox["west"]  - MAP_PAD_DEG
    east  = bbox["east"]  + MAP_PAD_DEG

    counts = _camera_counts_in_bbox(db, south, north, west, east)
    cells  = _cells_for_bbox(south, north, west, east)

    result = []
    for cell_lat, cell_lon in cells:
        count  = counts.get((cell_lat, cell_lon), 0)
        bucket = "0" if count == 0 else ("1-3" if count < _BUCKET_MEDIUM_MIN + 3 else "4+")
        result.append({
            "polygon":           _cell_polygon_str(cell_lat, cell_lon),
            "cameraCountBucket": bucket,
            "centroidLat":       round(cell_lat + CELL_DEG / 2, 6),
            "centroidLng":       round(cell_lon + CELL_DEG / 2, 6),
        })

    return result
