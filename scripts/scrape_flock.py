#!/usr/bin/env python3
"""
scripts/scrape_flock.py

Scrapes Flock Safety camera locations from DeFlock (cdn.deflock.me) and
upserts them into the flock_cameras table.

DeFlock uses a tile-based CDN:
  1. GET /regions/index.json  →  { tile_url, tile_size_degrees, regions, ... }
  2. Tile URL template: https://cdn.deflock.me/regions/{lat}/{lon}.json
     where lat/lon are the SW corner of each tile (multiples of tile_size_degrees)
  3. Each tile is a JSON array of { id, lat, lon, tags: { direction, operator, ... } }

Bbox resolution order (first match wins):
  1. CLI args  (--south / --north / --west / --east)
  2. Env vars  (FLOCK_BBOX_SOUTH / _NORTH / _WEST / _EAST)
  3. Active FEMA alert polygons from the database  ← auto when no alerts are live
  4. Hardcoded Carrollton, GA fallback

Usage:
    python3 scripts/scrape_flock.py [--south S --north N --west W --east E]

Env vars:
    FLOCK_BBOX_SOUTH, FLOCK_BBOX_NORTH, FLOCK_BBOX_WEST, FLOCK_BBOX_EAST
    DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT
"""

import argparse
import math
import os
import sys
import requests
import psycopg2
from psycopg2.extras import execute_values

# ── Fallback bounding box (Carrollton, GA) ────────────────────────────────────
_DEFAULT_BBOX = {
    "south": 33.45,
    "north": 33.70,
    "west":  -85.25,
    "east":  -84.95,
}

# Degrees of padding added around the union of active alert polygons
_ALERT_BBOX_PAD = 0.5

INDEX_URL = "https://cdn.deflock.me/regions/index.json"
HEADERS   = {"User-Agent": "AmberAngels-mission-scraper/1.0"}


# ── Bbox resolution ───────────────────────────────────────────────────────────

def _explicit_bbox(args) -> dict | None:
    """
    Return bbox from CLI args or env vars.
    Returns None if not all four sides are fully specified — callers should
    then try the DB-derived bbox before falling back to the default.
    """
    def _get(key, arg_val):
        if arg_val is not None:
            return arg_val
        env = os.environ.get(f"FLOCK_BBOX_{key.upper()}")
        return float(env) if env is not None else None

    values = {k: _get(k, getattr(args, k)) for k in ("south", "north", "west", "east")}
    if any(v is None for v in values.values()):
        return None
    return values


def _bbox_from_active_alerts(conn) -> dict | None:
    """
    Query vehicle_targets for non-expired FEMA alert polygons and compute a
    bounding box that covers all of them with _ALERT_BBOX_PAD degrees of padding.

    Returns None if no active alerts with polygon data are found.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT polygon FROM vehicle_targets
            WHERE expires_at > NOW()
              AND polygon IS NOT NULL
              AND polygon <> ''
        """)
        rows = cur.fetchall()

    if not rows:
        return None

    all_lats: list[float] = []
    all_lons: list[float] = []
    for (polygon_str,) in rows:
        if not polygon_str:
            continue
        for pair in polygon_str.strip().split():
            try:
                lat_s, lon_s = pair.split(",", 1)
                all_lats.append(float(lat_s))
                all_lons.append(float(lon_s))
            except Exception:
                continue

    if not all_lats:
        return None

    return {
        "south": min(all_lats) - _ALERT_BBOX_PAD,
        "north": max(all_lats) + _ALERT_BBOX_PAD,
        "west":  min(all_lons) - _ALERT_BBOX_PAD,
        "east":  max(all_lons) + _ALERT_BBOX_PAD,
    }


# ── DeFlock tile fetching ─────────────────────────────────────────────────────

def fetch_index():
    resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()


def tiles_for_bbox(bbox, tile_size):
    """Return all (tile_lat, tile_lon) pairs that overlap the bounding box."""
    lat_min = math.floor(bbox["south"] / tile_size) * tile_size
    lat_max = math.floor(bbox["north"] / tile_size) * tile_size
    lon_min = math.floor(bbox["west"]  / tile_size) * tile_size
    lon_max = math.floor(bbox["east"]  / tile_size) * tile_size

    tiles = []
    lat = lat_min
    while lat <= lat_max:
        lon = lon_min
        while lon <= lon_max:
            tiles.append((lat, lon))
            lon += tile_size
        lat += tile_size
    return tiles


def fetch_tile(tile_url_template, tile_lat, tile_lon):
    url = tile_url_template.replace("{lat}/{lon}", f"{tile_lat}/{tile_lon}")
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def filter_bbox(cameras, bbox):
    return [
        c for c in cameras
        if bbox["south"] <= c["lat"] <= bbox["north"]
        and bbox["west"]  <= c["lon"] <= bbox["east"]
    ]


# ── DB upsert ─────────────────────────────────────────────────────────────────

def upsert_cameras(conn, cameras):
    rows = []
    for c in cameras:
        tags    = c.get("tags", {})
        heading = tags.get("direction")
        agency  = tags.get("operator")
        heading_int = None
        if heading is not None:
            try:
                parts = [int(x) for x in str(heading).split("-") if x.strip()]
                heading_int = sum(parts) // len(parts)
            except (ValueError, ZeroDivisionError):
                pass
        rows.append((
            str(c["id"]),
            c["lat"],
            c["lon"],
            heading_int,
            None,   # road — not in DeFlock data
            agency,
        ))

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO flock_cameras (id, lat, lng, heading, road, agency)
            VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                lat        = EXCLUDED.lat,
                lng        = EXCLUDED.lng,
                heading    = EXCLUDED.heading,
                road       = EXCLUDED.road,
                agency     = EXCLUDED.agency,
                scraped_at = NOW()
        """, rows)
    conn.commit()
    return len(rows)


def _connect():
    return psycopg2.connect(
        dbname   = os.environ.get("DB_NAME",     "ambersangels"),
        user     = os.environ.get("DB_USER",     "postgres"),
        password = os.environ.get("DB_PASSWORD", ""),
        host     = os.environ.get("DB_HOST",     "127.0.0.1"),
        port     = int(os.environ.get("DB_PORT", 5432)),
    )


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Scrape Flock/DeFlock cameras for a bounding box.")
    parser.add_argument("--south", type=float, default=None)
    parser.add_argument("--north", type=float, default=None)
    parser.add_argument("--west",  type=float, default=None)
    parser.add_argument("--east",  type=float, default=None)
    args = parser.parse_args()

    conn = _connect()
    try:
        # 1. Explicit CLI/env args
        bbox = _explicit_bbox(args)
        bbox_source = "CLI/env args"

        # 2. Active FEMA alert polygons from the DB
        if bbox is None:
            bbox = _bbox_from_active_alerts(conn)
            bbox_source = "active FEMA alert polygons"

        # 3. Carrollton, GA fallback
        if bbox is None:
            bbox = _DEFAULT_BBOX
            bbox_source = "default (Carrollton, GA — no active alerts)"

        print(f"Bbox source: {bbox_source}")
        print(f"BBOX: south={bbox['south']:.4f} north={bbox['north']:.4f} "
              f"west={bbox['west']:.4f} east={bbox['east']:.4f}")

        print("Fetching DeFlock index...")
        index = fetch_index()
        tile_size = index["tile_size_degrees"]
        tile_url  = index["tile_url"]
        print(f"Tile size: {tile_size}°  |  Template: {tile_url[:60]}...")

        tiles = tiles_for_bbox(bbox, tile_size)
        print(f"Tiles to fetch: {len(tiles)}")

        all_cameras = []
        for tile_lat, tile_lon in tiles:
            print(f"  Fetching tile {tile_lat}/{tile_lon}...", end=" ", flush=True)
            try:
                raw = fetch_tile(tile_url, tile_lat, tile_lon)
            except Exception as e:
                print(f"ERROR: {e}")
                continue
            filtered = filter_bbox(raw, bbox)
            print(f"{len(filtered)} cameras in bbox (of {len(raw)} in tile)")
            all_cameras.extend(filtered)

        # Deduplicate by id (tiles can overlap at edges)
        seen = {}
        for c in all_cameras:
            seen[c["id"]] = c
        unique = list(seen.values())
        print(f"\nTotal unique cameras in area: {len(unique)}")

        n = upsert_cameras(conn, unique)
        print(f"Upserted {n} cameras into flock_cameras.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
