"""
backend/services/waypoint_generator.py

Converts a GeoJSON polygon (alert search area) into a boustrophedon (lawnmower)
waypoint path for autonomous drone coverage.

Algorithm:
  1. Project polygon vertices to a local metric frame (origin = centroid).
  2. Find the optimal sweep direction (minimize number of lanes = sweep along
     the longest polygon extent).
  3. Rotate frame to align with sweep direction.
  4. Generate parallel transect lines at lane_spacing intervals across the bbox.
  5. Clip each transect to the polygon via segment intersection.
  6. Connect transects in alternating direction (boustrophedon).
  7. Un-project back to WGS-84 lat/lng.

Returns a list of dicts: {lat, lng, altitude_m, heading_deg, speed_mps}
"""

import math
from typing import Optional

import numpy as np


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_lawnmower(
    polygon_geojson: dict,
    altitude_m: float = 60.0,
    speed_mps: float = 8.0,
    camera_hfov_deg: float = 84.0,
    overlap_pct: float = 0.3,
    min_waypoints: int = 4,
) -> list[dict]:
    """
    Generate a boustrophedon (lawnmower) waypoint path for a GeoJSON polygon.

    Returns a list of waypoint dicts: {lat, lng, altitude_m, heading_deg, speed_mps}.
    Returns an empty list if the polygon is too small to generate min_waypoints.
    """
    coords = _extract_exterior_coords(polygon_geojson)
    if len(coords) < 3:
        return []

    # Lane spacing: ground swath width per pass * (1 - overlap)
    lane_spacing = (
        2.0 * altitude_m * math.tan(math.radians(camera_hfov_deg / 2.0))
        * (1.0 - overlap_pct)
    )

    # Project to local metric frame (origin = centroid)
    lat0, lng0 = _centroid_latlon(coords)
    pts_m = _project_to_metric(coords, lat0, lng0)

    # Find sweep angle that minimises lane count
    sweep_angle = _optimal_sweep_angle(pts_m)

    # Rotate points into sweep frame
    rot_pts = _rotate(pts_m, -sweep_angle)

    # Generate transects in rotated frame, clip, then un-rotate + un-project
    waypoints = _build_waypoints(
        rot_pts, sweep_angle, lane_spacing,
        altitude_m, speed_mps, lat0, lng0,
    )

    if len(waypoints) < min_waypoints:
        return []

    return waypoints


def estimate_mission_duration_minutes(
    waypoints: list[dict],
    speed_mps: float = 8.0,
) -> float:
    """Sum of great-circle distances between consecutive waypoints divided by speed."""
    if len(waypoints) < 2:
        return 0.0
    total_m = 0.0
    for a, b in zip(waypoints, waypoints[1:]):
        total_m += _haversine_m(a["lat"], a["lng"], b["lat"], b["lng"])
    return total_m / speed_mps / 60.0


def check_vlos_radius(
    waypoints: list[dict],
    home_lat: float,
    home_lng: float,
    radius_m: float = 400.0,
) -> tuple[bool, float]:
    """
    Return (within_radius, max_distance_m).
    Returns True only when every waypoint is within radius_m of the pilot home position.
    """
    max_dist = 0.0
    for wp in waypoints:
        d = _haversine_m(home_lat, home_lng, wp["lat"], wp["lng"])
        if d > max_dist:
            max_dist = d
    return max_dist <= radius_m, max_dist


def mission_coverage_sqkm(polygon_geojson: dict) -> float:
    """Shoelace area formula on the projected polygon."""
    coords = _extract_exterior_coords(polygon_geojson)
    if len(coords) < 3:
        return 0.0
    lat0, lng0 = _centroid_latlon(coords)
    pts = _project_to_metric(coords, lat0, lng0)
    # Shoelace
    x = pts[:, 0]
    y = pts[:, 1]
    area_m2 = 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    return area_m2 / 1_000_000.0


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_exterior_coords(geojson: dict) -> list[tuple[float, float]]:
    """Return list of (lat, lng) from a GeoJSON Polygon or Feature."""
    if geojson.get("type") == "Feature":
        geojson = geojson["geometry"]
    if geojson.get("type") != "Polygon":
        return []
    ring = geojson["coordinates"][0]  # exterior ring
    # GeoJSON is [lng, lat]
    return [(pt[1], pt[0]) for pt in ring]


def _centroid_latlon(coords: list[tuple[float, float]]) -> tuple[float, float]:
    lats = [c[0] for c in coords]
    lngs = [c[1] for c in coords]
    return sum(lats) / len(lats), sum(lngs) / len(lngs)


def _project_to_metric(
    coords: list[tuple[float, float]],
    lat0: float,
    lng0: float,
) -> np.ndarray:
    """Project (lat, lng) pairs to local (x=east, y=north) metres."""
    cos_lat0 = math.cos(math.radians(lat0))
    pts = []
    for lat, lng in coords:
        y = (lat - lat0) * 111_111.0
        x = (lng - lng0) * 111_111.0 * cos_lat0
        pts.append([x, y])
    return np.array(pts, dtype=float)


def _unproject_from_metric(
    x: float,
    y: float,
    lat0: float,
    lng0: float,
) -> tuple[float, float]:
    cos_lat0 = math.cos(math.radians(lat0))
    lat = lat0 + y / 111_111.0
    lng = lng0 + x / (111_111.0 * cos_lat0)
    return lat, lng


def _rotate(pts: np.ndarray, angle_rad: float) -> np.ndarray:
    c, s = math.cos(angle_rad), math.sin(angle_rad)
    R = np.array([[c, -s], [s, c]])
    return pts @ R.T


def _optimal_sweep_angle(pts_m: np.ndarray) -> float:
    """
    Try 0°, 45°, 90°, 135° and return the angle whose rotated bbox has the
    smallest width (perpendicular to the sweep direction) — minimises lane count.
    """
    best_angle = 0.0
    best_width = float("inf")
    for deg in (0, 45, 90, 135):
        angle = math.radians(deg)
        rot = _rotate(pts_m, -angle)
        width = rot[:, 1].max() - rot[:, 1].min()  # extent perpendicular to sweep
        if width < best_width:
            best_width = width
            best_angle = angle
    return best_angle


def _segment_intersect_y(
    y_line: float,
    x0: float, y0: float,
    x1: float, y1: float,
) -> Optional[float]:
    """Return x-coordinate where the segment (x0,y0)-(x1,y1) crosses y=y_line, or None."""
    if (y0 <= y_line < y1) or (y1 <= y_line < y0):
        t = (y_line - y0) / (y1 - y0)
        return x0 + t * (x1 - x0)
    return None


def _clip_transect_to_polygon(
    y_line: float,
    rot_pts: np.ndarray,
) -> Optional[tuple[float, float]]:
    """
    Find the x-extent of the polygon at horizontal line y=y_line in the rotated frame.
    Returns (x_min, x_max) or None if the line misses the polygon.
    """
    xs = []
    n = len(rot_pts)
    for i in range(n):
        x0, y0 = rot_pts[i]
        x1, y1 = rot_pts[(i + 1) % n]
        xi = _segment_intersect_y(y_line, x0, y0, x1, y1)
        if xi is not None:
            xs.append(xi)
    if len(xs) < 2:
        return None
    return min(xs), max(xs)


def _heading_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Initial bearing from point 1 to point 2 (degrees, 0=North, CW)."""
    d_lng = math.radians(lng2 - lng1)
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    x = math.sin(d_lng) * math.cos(lat2_r)
    y = (math.cos(lat1_r) * math.sin(lat2_r)
         - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(d_lng))
    brng = math.degrees(math.atan2(x, y))
    return (brng + 360.0) % 360.0


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _build_waypoints(
    rot_pts: np.ndarray,
    sweep_angle: float,
    lane_spacing: float,
    altitude_m: float,
    speed_mps: float,
    lat0: float,
    lng0: float,
) -> list[dict]:
    """
    Generate boustrophedon waypoints in the rotated frame, then un-rotate and
    un-project back to WGS-84.
    """
    y_min = rot_pts[:, 1].min()
    y_max = rot_pts[:, 1].max()

    # Build transect y-positions
    y_positions = []
    y = y_min + lane_spacing / 2.0
    while y <= y_max:
        y_positions.append(y)
        y += lane_spacing

    # Build raw waypoint pairs (rotated frame)
    raw_pairs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for y_line in y_positions:
        result = _clip_transect_to_polygon(y_line, rot_pts)
        if result is None:
            continue
        x_start, x_end = result
        raw_pairs.append(((x_start, y_line), (x_end, y_line)))

    if not raw_pairs:
        return []

    # Boustrophedon: alternate direction each transect
    flat_rot: list[tuple[float, float]] = []
    for idx, (start, end) in enumerate(raw_pairs):
        if idx % 2 == 0:
            flat_rot.append(start)
            flat_rot.append(end)
        else:
            flat_rot.append(end)
            flat_rot.append(start)

    # Un-rotate and un-project
    rot_arr = np.array(flat_rot, dtype=float)
    unrot = _rotate(rot_arr, sweep_angle)

    waypoints = []
    for i, (x, y) in enumerate(unrot):
        lat, lng = _unproject_from_metric(x, y, lat0, lng0)
        if i == 0:
            hdg = 0.0
        else:
            prev_lat, prev_lng = waypoints[-1]["lat"], waypoints[-1]["lng"]
            hdg = _heading_deg(prev_lat, prev_lng, lat, lng)
        waypoints.append({
            "lat": round(lat, 8),
            "lng": round(lng, 8),
            "altitude_m": altitude_m,
            "heading_deg": round(hdg, 1),
            "speed_mps": speed_mps,
        })

    # Fix first waypoint heading to match the direction of travel
    if len(waypoints) >= 2:
        waypoints[0]["heading_deg"] = waypoints[1]["heading_deg"]

    return waypoints
