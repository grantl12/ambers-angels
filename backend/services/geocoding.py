"""
backend/services/geocoding.py

Shared Nominatim geocoding + bbox-polygon helpers used by anything that turns a
free-text area ("Carrollton, GA") into a map zone: the admin manual-alert
endpoint and the NCMEC pending-alert flow.
"""
import logging
import re

import requests

logger = logging.getLogger(__name__)

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_UA  = "AmberAngels-admin/1.0"
# Half-side of the standard search box in degrees (≈5.5 km at mid-latitudes)
_ZONE_HALF_DEG = 0.05


def geocode(area: str) -> tuple[float, float] | None:
    """Return (lat, lng) for a location string via Nominatim, or None on failure."""
    query = area.strip()
    # Bare US zip codes (5 digits) confuse Nominatim — append country hint
    if re.fullmatch(r"\d{5}", query):
        query = f"{query}, USA"
    try:
        resp = requests.get(
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
        logger.warning("Geocode failed for %r: %s", area, e)
    return None


def bbox_polygon(lat: float, lng: float, half: float = _ZONE_HALF_DEG) -> str:
    """Return space-separated 'lat,lng' pairs forming a closed rectangular polygon."""
    s, n, w, e = lat - half, lat + half, lng - half, lng + half
    return f"{s},{w} {s},{e} {n},{e} {n},{w} {s},{w}"
