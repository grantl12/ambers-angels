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

Usage:
    python3 scripts/scrape_flock.py

Env vars (same as backend):
    DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT
"""

import math
import os
import sys
import requests
import psycopg2
from psycopg2.extras import execute_values

# ── Bounding box to scrape ─────────────────────────────────────────────────────
# Extend this as the operation area grows
BBOX = {
    "south": 33.45,
    "north": 33.70,
    "west":  -85.25,
    "east":  -84.95,
}

INDEX_URL = "https://cdn.deflock.me/regions/index.json"
HEADERS   = {"User-Agent": "AmberAngels-mission-scraper/1.0"}


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


def upsert_cameras(conn, cameras):
    rows = []
    for c in cameras:
        tags    = c.get("tags", {})
        heading = tags.get("direction")
        agency  = tags.get("operator")
        # heading can be a plain int string ("180") or a range ("184-229") — take midpoint
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
            None,          # road — not in DeFlock data
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


def main():
    print("Fetching DeFlock index...")
    index = fetch_index()
    tile_size = index["tile_size_degrees"]
    tile_url  = index["tile_url"]
    print(f"Tile size: {tile_size}°  |  Template: {tile_url[:60]}...")

    tiles = tiles_for_bbox(BBOX, tile_size)
    print(f"Tiles to fetch for bbox: {tiles}")

    all_cameras = []
    for tile_lat, tile_lon in tiles:
        print(f"  Fetching tile {tile_lat}/{tile_lon}...", end=" ", flush=True)
        raw = fetch_tile(tile_url, tile_lat, tile_lon)
        filtered = filter_bbox(raw, BBOX)
        print(f"{len(filtered)} cameras in bbox (of {len(raw)} in tile)")
        all_cameras.extend(filtered)

    # Deduplicate by id (tiles can overlap at edges)
    seen = {}
    for c in all_cameras:
        seen[c["id"]] = c
    unique = list(seen.values())
    print(f"\nTotal unique cameras in area: {len(unique)}")

    conn = psycopg2.connect(
        dbname   = os.environ.get("DB_NAME",     "ambersangels"),
        user     = os.environ.get("DB_USER",     "postgres"),
        password = os.environ.get("DB_PASSWORD", ""),
        host     = os.environ.get("DB_HOST",     "127.0.0.1"),
        port     = int(os.environ.get("DB_PORT", 5432)),
    )

    try:
        n = upsert_cameras(conn, unique)
        print(f"Upserted {n} cameras into flock_cameras.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
