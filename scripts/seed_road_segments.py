#!/usr/bin/env python3
"""
scripts/seed_road_segments.py

Fetches road segments from OpenStreetMap via the Overpass API and upserts them
into the road_segments table.  Run this before (or alongside) scrape_flock.py
so the coverage service has segments to score.

Each OSM way longer than MAX_SEG_M is split into sub-segments so every segment
represents ~200–400 m of road — the right granularity for Flock camera range (~400 m).

Bbox resolution (first match wins):
  1. CLI --south/--north/--west/--east
  2. Env vars ROAD_BBOX_SOUTH/NORTH/WEST/EAST
  3. Active FEMA alert polygons from the DB (+ 0.5° pad)
  4. Hardcoded Carrollton, GA fallback

Usage:
    python3 scripts/seed_road_segments.py [--south S --north N --west W --east E]
"""

import argparse
import json
import math
import os
import sys
import time

import psycopg2
import requests
from psycopg2.extras import execute_values

# ── Constants ─────────────────────────────────────────────────────────────────

_DEFAULT_BBOX = {"south": 33.45, "north": 33.70, "west": -85.25, "east": -84.95}
_ALERT_PAD    = 0.5          # degrees padding around active FEMA alerts
MAX_SEG_M     = 400          # split ways longer than this into sub-segments
MIN_SEG_M     = 80           # discard sub-segments shorter than this
_EARTH_R      = 6_371_000.0  # metres

# OSM highway types to index (ordered most-to-least important)
HIGHWAY_TYPES = (
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "residential", "unclassified", "living_street",
)

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]


# ── Geometry helpers ──────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * _EARTH_R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _centroid(coords: list[tuple[float, float]]) -> tuple[float, float]:
    """Mean of lat/lng pairs."""
    lats = [c[0] for c in coords]
    lngs = [c[1] for c in coords]
    return sum(lats) / len(lats), sum(lngs) / len(lngs)


def _way_length_m(coords: list[tuple[float, float]]) -> float:
    return sum(_haversine_m(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1])
               for i in range(len(coords) - 1))


def _split_way(coords: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    """Split a coordinate list into sub-segments no longer than MAX_SEG_M."""
    if len(coords) < 2:
        return []

    segments: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = [coords[0]]
    acc_m = 0.0

    for i in range(1, len(coords)):
        step = _haversine_m(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1])
        acc_m += step
        current.append(coords[i])

        if acc_m >= MAX_SEG_M and i < len(coords) - 1:
            segments.append(current)
            # Start the next segment from the current point (shared node)
            current = [coords[i]]
            acc_m = 0.0

    if len(current) >= 2:
        segments.append(current)

    # Drop segments that are too short (e.g. tiny closing edges)
    return [s for s in segments if _way_length_m(s) >= MIN_SEG_M]


# ── Bbox helpers ──────────────────────────────────────────────────────────────

def _explicit_bbox(args) -> dict | None:
    def _get(key, arg_val):
        if arg_val is not None:
            return arg_val
        env = os.environ.get(f"ROAD_BBOX_{key.upper()}")
        return float(env) if env is not None else None

    vals = {k: _get(k, getattr(args, k)) for k in ("south", "north", "west", "east")}
    return vals if all(v is not None for v in vals.values()) else None


def _bbox_from_alerts(conn) -> dict | None:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT polygon FROM vehicle_targets
            WHERE expires_at > NOW()
              AND polygon IS NOT NULL AND polygon <> ''
        """)
        rows = cur.fetchall()

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
        "south": min(lats) - _ALERT_PAD, "north": max(lats) + _ALERT_PAD,
        "west":  min(lngs) - _ALERT_PAD, "east":  max(lngs) + _ALERT_PAD,
    }


# ── Overpass fetch ────────────────────────────────────────────────────────────

def _overpass_query(bbox: dict) -> list[dict]:
    highway_filter = "|".join(HIGHWAY_TYPES)
    query = (
        f'[out:json][timeout:60];'
        f'(way["highway"~"^({highway_filter})$"]'
        f'({bbox["south"]},{bbox["west"]},{bbox["north"]},{bbox["east"]}););'
        f'out geom;'
    )
    headers = {"User-Agent": "AmberAngels-road-seeder/1.0"}
    last_err = None
    for url in OVERPASS_URLS:
        try:
            resp = requests.post(url, data={"data": query}, headers=headers, timeout=90)
            resp.raise_for_status()
            return resp.json().get("elements", [])
        except Exception as exc:
            print(f"  Overpass {url} failed: {exc}")
            last_err = exc
            time.sleep(2)
    raise RuntimeError(f"All Overpass mirrors failed. Last error: {last_err}")


# ── DB helpers ────────────────────────────────────────────────────────────────

def _connect() -> psycopg2.extensions.connection:
    return psycopg2.connect(
        dbname   = os.environ.get("DB_NAME",     "ambersangels"),
        user     = os.environ.get("DB_USER",     "postgres"),
        password = os.environ.get("DB_PASSWORD", "Ambers1Angels"),
        host     = os.environ.get("DB_HOST",     "127.0.0.1"),
        port     = int(os.environ.get("DB_PORT", 5432)),
    )


def _upsert_segments(conn, rows: list[tuple]) -> int:
    """
    rows: (osm_way_id, osm_segment_idx, name, highway_type, geometry_json,
           centroid_lat, centroid_lng, length_m,
           bbox_south, bbox_north, bbox_west, bbox_east)
    """
    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO road_segments
                (osm_way_id, osm_segment_idx, name, highway_type, geometry_json,
                 centroid_lat, centroid_lng, length_m,
                 bbox_south, bbox_north, bbox_west, bbox_east)
            VALUES %s
            ON CONFLICT (osm_way_id, osm_segment_idx) DO UPDATE SET
                name         = EXCLUDED.name,
                highway_type = EXCLUDED.highway_type,
                geometry_json= EXCLUDED.geometry_json,
                centroid_lat = EXCLUDED.centroid_lat,
                centroid_lng = EXCLUDED.centroid_lng,
                length_m     = EXCLUDED.length_m,
                bbox_south   = EXCLUDED.bbox_south,
                bbox_north   = EXCLUDED.bbox_north,
                bbox_west    = EXCLUDED.bbox_west,
                bbox_east    = EXCLUDED.bbox_east
        """, rows)
    conn.commit()
    return len(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Seed OSM road segments for a bounding box.")
    parser.add_argument("--south", type=float, default=None)
    parser.add_argument("--north", type=float, default=None)
    parser.add_argument("--west",  type=float, default=None)
    parser.add_argument("--east",  type=float, default=None)
    args = parser.parse_args()

    conn = _connect()
    try:
        bbox = _explicit_bbox(args)
        source = "CLI/env"
        if bbox is None:
            bbox = _bbox_from_alerts(conn)
            source = "active FEMA alerts"
        if bbox is None:
            bbox = _DEFAULT_BBOX
            source = "default (Carrollton, GA)"

        print(f"Bbox source : {source}")
        print(f"Bbox        : S={bbox['south']:.4f} N={bbox['north']:.4f} "
              f"W={bbox['west']:.4f} E={bbox['east']:.4f}")
        print("Querying Overpass API...")

        elements = _overpass_query(bbox)
        print(f"OSM ways returned: {len(elements)}")

        rows: list[tuple] = []
        for elem in elements:
            if elem.get("type") != "way":
                continue
            osm_id   = elem["id"]
            tags     = elem.get("tags", {})
            name     = tags.get("name") or tags.get("ref")
            hw_type  = tags.get("highway", "road")
            geom     = elem.get("geometry", [])  # [{lat, lon}, ...]

            if len(geom) < 2:
                continue

            # Convert to (lat, lng) tuples
            coords = [(float(n["lat"]), float(n["lon"])) for n in geom]

            sub_segs = _split_way(coords)
            for idx, seg_coords in enumerate(sub_segs):
                c_lat, c_lng = _centroid(seg_coords)
                length = _way_length_m(seg_coords)
                lats   = [p[0] for p in seg_coords]
                lngs   = [p[1] for p in seg_coords]

                # GeoJSON: coordinates are [lng, lat]
                geometry = {
                    "type": "LineString",
                    "coordinates": [[p[1], p[0]] for p in seg_coords],
                }

                rows.append((
                    osm_id, idx, name, hw_type,
                    json.dumps(geometry),
                    c_lat, c_lng, length,
                    min(lats), max(lats), min(lngs), max(lngs),
                ))

        print(f"Segments generated: {len(rows)}")
        if not rows:
            print("Nothing to upsert.")
            return

        n = _upsert_segments(conn, rows)
        print(f"Upserted {n} road segments into road_segments.")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
