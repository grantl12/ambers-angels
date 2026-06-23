"""
backend/services/water_body_service.py

Queries OpenStreetMap Overpass API for water bodies near a given location,
caches results in the water_bodies table, and returns them ranked by distance.

Used by the water search mission type for Purple Alert (autism / developmental
disability) scenarios where drowning risk is the primary concern.
"""

import json
import logging
import math
from datetime import datetime, timezone

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

_CACHE_TTL_HOURS = 24
_EARTH_R = 6_371_000.0


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2)
    return 2 * _EARTH_R * math.asin(math.sqrt(a)) / 1000.0


def _bbox_from_center(lat: float, lng: float, radius_km: float) -> dict:
    delta_lat = radius_km / 111.0
    delta_lng = radius_km / (111.0 * math.cos(math.radians(lat)))
    return {
        "south": lat - delta_lat,
        "north": lat + delta_lat,
        "west": lng - delta_lng,
        "east": lng + delta_lng,
    }


def _compute_area_sqm(coords: list[list[float]]) -> float:
    """Shoelace area on projected coordinates. coords = [[lng, lat], ...]."""
    if len(coords) < 3:
        return 0.0
    lat0 = sum(c[1] for c in coords) / len(coords)
    cos_lat = math.cos(math.radians(lat0))
    pts = []
    for c in coords:
        x = (c[0] - coords[0][0]) * 111_111.0 * cos_lat
        y = (c[1] - coords[0][1]) * 111_111.0
        pts.append((x, y))
    area = 0.0
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2.0


def _centroid_from_coords(coords: list[list[float]]) -> tuple[float, float]:
    """Return (lat, lng) centroid from GeoJSON ring [[lng, lat], ...]."""
    lats = [c[1] for c in coords]
    lngs = [c[0] for c in coords]
    return sum(lats) / len(lats), sum(lngs) / len(lngs)


async def _query_overpass_water(
    south: float, north: float, west: float, east: float,
) -> list[dict]:
    query = (
        f'[out:json][timeout:60];'
        f'('
        f'way["natural"="water"]({south},{west},{north},{east});'
        f'way["water"~"^(lake|pond|reservoir|basin)$"]({south},{west},{north},{east});'
        f'way["landuse"="reservoir"]({south},{west},{north},{east});'
        f'way["waterway"="riverbank"]({south},{west},{north},{east});'
        f'relation["natural"="water"]({south},{west},{north},{east});'
        f');'
        f'out geom;'
    )
    headers = {"User-Agent": "AmberAngels-water-search/1.0"}
    last_err = None
    async with httpx.AsyncClient(timeout=90) as client:
        for url in OVERPASS_URLS:
            try:
                resp = await client.post(url, data={"data": query}, headers=headers)
                resp.raise_for_status()
                return resp.json().get("elements", [])
            except Exception as exc:
                logger.warning("Overpass %s failed: %s", url, exc)
                last_err = exc
    logger.error("All Overpass mirrors failed: %s", last_err)
    return []


def _parse_overpass_elements(elements: list[dict]) -> list[dict]:
    """Convert Overpass JSON elements to our internal format."""
    parsed = []
    for elem in elements:
        osm_type = elem.get("type", "way")
        osm_id = elem.get("id")
        if not osm_id:
            continue

        tags = elem.get("tags", {})
        name = tags.get("name")
        water_type = (
            tags.get("water")
            or tags.get("natural")
            or tags.get("landuse")
            or tags.get("waterway")
            or "water"
        )

        # Extract coordinates
        coords = []
        if osm_type == "way" and "geometry" in elem:
            coords = [[pt["lon"], pt["lat"]] for pt in elem["geometry"]]
        elif osm_type == "relation" and "members" in elem:
            for member in elem["members"]:
                if member.get("role") == "outer" and "geometry" in member:
                    coords = [[pt["lon"], pt["lat"]] for pt in member["geometry"]]
                    break

        if len(coords) < 3:
            continue

        # Close the ring if not already closed
        if coords[0] != coords[-1]:
            coords.append(coords[0])

        centroid_lat, centroid_lng = _centroid_from_coords(coords)
        area_sqm = _compute_area_sqm(coords)

        # Skip tiny features (< 100 sqm — puddles, fountains)
        if area_sqm < 100:
            continue

        parsed.append({
            "id": f"{osm_type}:{osm_id}",
            "name": name,
            "water_type": water_type,
            "centroid_lat": centroid_lat,
            "centroid_lng": centroid_lng,
            "area_sqm": area_sqm,
            "polygon_geojson": {
                "type": "Polygon",
                "coordinates": [coords],
            },
        })

    return parsed


async def _upsert_water_bodies(db: AsyncSession, parsed: list[dict]) -> None:
    for wb in parsed:
        await db.execute(
            text("""
                INSERT INTO water_bodies (id, name, water_type, centroid_lat, centroid_lng,
                                          area_sqm, polygon_json, fetched_at)
                VALUES (:id, :name, :water_type, :centroid_lat, :centroid_lng,
                        :area_sqm, :polygon_json, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    water_type = EXCLUDED.water_type,
                    centroid_lat = EXCLUDED.centroid_lat,
                    centroid_lng = EXCLUDED.centroid_lng,
                    area_sqm = EXCLUDED.area_sqm,
                    polygon_json = EXCLUDED.polygon_json,
                    fetched_at = NOW()
            """),
            {
                "id": wb["id"],
                "name": wb["name"],
                "water_type": wb["water_type"],
                "centroid_lat": wb["centroid_lat"],
                "centroid_lng": wb["centroid_lng"],
                "area_sqm": wb["area_sqm"],
                "polygon_json": json.dumps(wb["polygon_geojson"]),
            },
        )
    await db.commit()


async def _has_fresh_cache(
    db: AsyncSession, south: float, north: float, west: float, east: float,
) -> bool:
    row = await db.execute(
        text("""
            SELECT COUNT(*) FROM water_bodies
            WHERE centroid_lat BETWEEN :south AND :north
              AND centroid_lng BETWEEN :west AND :east
              AND fetched_at > NOW() - INTERVAL ':ttl hours'
        """.replace(":ttl", str(_CACHE_TTL_HOURS))),
        {"south": south, "north": north, "west": west, "east": east},
    )
    count = row.scalar() or 0
    return count > 0


async def fetch_nearby_water_bodies(
    db: AsyncSession,
    lat: float,
    lng: float,
    radius_km: float = 5.0,
    max_results: int = 20,
) -> list[dict]:
    bbox = _bbox_from_center(lat, lng, radius_km)

    has_cache = await _has_fresh_cache(
        db, bbox["south"], bbox["north"], bbox["west"], bbox["east"],
    )
    if not has_cache:
        logger.info("Water body cache miss for (%.4f, %.4f) — querying Overpass", lat, lng)
        elements = await _query_overpass_water(
            bbox["south"], bbox["north"], bbox["west"], bbox["east"],
        )
        parsed = _parse_overpass_elements(elements)
        if parsed:
            await _upsert_water_bodies(db, parsed)
            logger.info("Cached %d water bodies", len(parsed))

    rows = await db.execute(
        text("""
            SELECT id, name, water_type, centroid_lat, centroid_lng,
                   area_sqm, polygon_json
            FROM water_bodies
            WHERE centroid_lat BETWEEN :south AND :north
              AND centroid_lng BETWEEN :west AND :east
            ORDER BY centroid_lat  -- will sort by distance in Python
        """),
        {"south": bbox["south"], "north": bbox["north"],
         "west": bbox["west"], "east": bbox["east"]},
    )

    results = []
    for row in rows:
        dist = _haversine_km(lat, lng, row[3], row[4])
        polygon = row[6] if isinstance(row[6], dict) else json.loads(row[6])
        results.append({
            "id": row[0],
            "name": row[1],
            "water_type": row[2],
            "centroid_lat": row[3],
            "centroid_lng": row[4],
            "area_sqm": row[5],
            "distance_km": round(dist, 2),
            "polygon_geojson": polygon,
        })

    results.sort(key=lambda x: x["distance_km"])
    return results[:max_results]
