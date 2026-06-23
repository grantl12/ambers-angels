"""
backend/services/waypoint_generator.py

Generates waypoint missions for autonomous drones.

Primary mode — Observation Post:
  The drone flies to a single strategic position and hovers to watch.
  Coordinator picks a target area (polygon or lat/lng); we compute the
  centroid as the hover point.  ALPR + YOLO run on the live stream.

  generate_observation_point(polygon_geojson | lat/lng, altitude_m) → [waypoint]

Fallback — Lawnmower (kept for future use):
  generate_lawnmower(polygon_geojson, ...) → [waypoints]
"""

import math
from typing import Optional

import numpy as np


# ---------------------------------------------------------------------------
# Public API — Observation Post (primary mode)
# ---------------------------------------------------------------------------

def generate_observation_point(
    polygon_geojson: Optional[dict] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    altitude_m: float = 60.0,
    speed_mps: float = 8.0,
) -> list[dict]:
    """
    Return a single-waypoint mission: fly to the observation point and hover.

    Supply either polygon_geojson (centroid is used) or explicit lat/lng.
    Returns an empty list if neither is provided or the polygon is malformed.
    """
    if lat is not None and lng is not None:
        obs_lat, obs_lng = lat, lng
    elif polygon_geojson is not None:
        coords = _extract_exterior_coords(polygon_geojson)
        if len(coords) < 3:
            return []
        obs_lat, obs_lng = _centroid_latlon(coords)
    else:
        return []

    return [{
        "lat":         round(obs_lat, 8),
        "lng":         round(obs_lng, 8),
        "altitude_m":  altitude_m,
        "heading_deg": 0.0,   # drone will use auto-heading toward subject area
        "speed_mps":   speed_mps,
    }]


# ---------------------------------------------------------------------------
# Public API — Lawnmower (kept for future area-coverage use)
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
    Not the primary dispatch mode — use generate_observation_point instead.
    """
    coords = _extract_exterior_coords(polygon_geojson)
    if len(coords) < 3:
        return []

    lane_spacing = (
        2.0 * altitude_m * math.tan(math.radians(camera_hfov_deg / 2.0))
        * (1.0 - overlap_pct)
    )

    lat0, lng0 = _centroid_latlon(coords)
    pts_m = _project_to_metric(coords, lat0, lng0)
    sweep_angle = _optimal_sweep_angle(pts_m)
    rot_pts = _rotate(pts_m, -sweep_angle)

    waypoints = _build_waypoints(
        rot_pts, sweep_angle, lane_spacing,
        altitude_m, speed_mps, lat0, lng0,
    )

    if len(waypoints) < min_waypoints:
        return []

    return waypoints


# ---------------------------------------------------------------------------
# Public API — Water Perimeter (shoreline search)
# ---------------------------------------------------------------------------

def generate_water_perimeter(
    polygon_geojson: dict,
    buffer_m: float = 20.0,
    altitude_m: float = 15.0,
    speed_mps: float = 3.0,
    max_waypoints: int = 98,
) -> list[dict]:
    """
    Generate waypoints tracing the shoreline of a water body polygon at a
    safe buffer distance from shore.

    The buffer keeps the drone clear of overhanging trees and obstacles.
    At 15m altitude with an 84° HFOV camera, the drone covers the water
    surface and immediate shoreline.

    Returns a closed loop of waypoints (last connects back to first).
    Returns [] if the polygon is too small or malformed.
    """
    coords = _extract_exterior_coords(polygon_geojson)
    if len(coords) < 3:
        return []

    lat0, lng0 = _centroid_latlon(coords)
    pts_m = _project_to_metric(coords, lat0, lng0)

    # Close the ring if not already closed
    if not np.allclose(pts_m[0], pts_m[-1], atol=0.1):
        pts_m = np.vstack([pts_m, pts_m[0:1]])

    offset_pts = _offset_polygon_outward(pts_m, buffer_m)
    if len(offset_pts) < 3:
        return []

    # Remove the closing point before simplification
    open_pts = offset_pts[:-1] if np.allclose(offset_pts[0], offset_pts[-1], atol=0.1) else offset_pts

    simplified = _simplify_douglas_peucker(open_pts, tolerance_m=3.0)
    while len(simplified) > max_waypoints and simplified is not None:
        # Increase tolerance until we fit within DJI waypoint limit
        tolerance = 3.0 * (len(simplified) / max_waypoints)
        simplified = _simplify_douglas_peucker(open_pts, tolerance_m=tolerance)

    if len(simplified) < 3:
        return []

    # Close the loop
    simplified = np.vstack([simplified, simplified[0:1]])

    waypoints = []
    for i, (x, y) in enumerate(simplified):
        lat, lng = _unproject_from_metric(x, y, lat0, lng0)
        if i == 0:
            hdg = 0.0
        else:
            prev = waypoints[-1]
            hdg = _heading_deg(prev["lat"], prev["lng"], lat, lng)
        waypoints.append({
            "lat": round(lat, 8),
            "lng": round(lng, 8),
            "altitude_m": altitude_m,
            "heading_deg": round(hdg, 1),
            "speed_mps": speed_mps,
        })

    # Fix first waypoint heading
    if len(waypoints) >= 2:
        waypoints[0]["heading_deg"] = waypoints[1]["heading_deg"]

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


# ---------------------------------------------------------------------------
# Water perimeter helpers
# ---------------------------------------------------------------------------

def _offset_polygon_outward(pts_m: np.ndarray, buffer_m: float) -> np.ndarray:
    """
    Offset a polygon outward by buffer_m metres using edge-normal method.
    Falls back to simple radial offset from centroid if offset self-intersects.
    """
    n = len(pts_m) - 1  # exclude closing point
    if n < 3:
        return pts_m

    # Compute outward normals for each edge
    normals = []
    for i in range(n):
        dx = pts_m[(i + 1) % n][0] - pts_m[i][0]
        dy = pts_m[(i + 1) % n][1] - pts_m[i][1]
        length = math.sqrt(dx * dx + dy * dy)
        if length < 1e-9:
            normals.append((0.0, 0.0))
            continue
        # Outward normal (assuming CCW winding)
        nx, ny = dy / length, -dx / length
        normals.append((nx, ny))

    # Check winding order — if CW, flip normals
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts_m[i][0] * pts_m[j][1]
        area -= pts_m[j][0] * pts_m[i][1]
    if area > 0:  # CW winding
        normals = [(-nx, -ny) for nx, ny in normals]

    # Offset each edge and find intersections of consecutive offset edges
    offset_pts = []
    for i in range(n):
        prev = (i - 1) % n
        p1 = pts_m[prev] + np.array(normals[prev]) * buffer_m
        p2 = pts_m[i] + np.array(normals[prev]) * buffer_m
        p3 = pts_m[i] + np.array(normals[i]) * buffer_m
        p4 = pts_m[(i + 1) % n] + np.array(normals[i]) * buffer_m

        intersection = _line_line_intersect(p1, p2, p3, p4)
        if intersection is not None:
            offset_pts.append(intersection)
        else:
            offset_pts.append(pts_m[i] + np.array(normals[i]) * buffer_m)

    if len(offset_pts) < 3:
        return pts_m

    result = np.array(offset_pts, dtype=float)
    result = np.vstack([result, result[0:1]])
    return result


def _line_line_intersect(
    p1: np.ndarray, p2: np.ndarray,
    p3: np.ndarray, p4: np.ndarray,
) -> np.ndarray | None:
    """Find intersection point of line (p1-p2) and line (p3-p4)."""
    d1 = p2 - p1
    d2 = p4 - p3
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(cross) < 1e-10:
        return None
    t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / cross
    return p1 + t * d1


def _simplify_douglas_peucker(
    pts: np.ndarray,
    tolerance_m: float,
) -> np.ndarray:
    """Douglas-Peucker polyline simplification."""
    if len(pts) <= 2:
        return pts

    d_max = 0.0
    idx = 0
    p1 = pts[0]
    p2 = pts[-1]
    line_vec = p2 - p1
    line_len = np.linalg.norm(line_vec)

    for i in range(1, len(pts) - 1):
        if line_len < 1e-10:
            d = np.linalg.norm(pts[i] - p1)
        else:
            d = abs(line_vec[1] * (pts[i][0] - p1[0])
                    - line_vec[0] * (pts[i][1] - p1[1])) / line_len
        if d > d_max:
            d_max = d
            idx = i

    if d_max > tolerance_m:
        left = _simplify_douglas_peucker(pts[:idx + 1], tolerance_m)
        right = _simplify_douglas_peucker(pts[idx:], tolerance_m)
        return np.vstack([left[:-1], right])
    else:
        return np.array([pts[0], pts[-1]])
