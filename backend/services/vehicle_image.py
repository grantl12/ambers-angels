"""
Vehicle reference image resolution.

Priority:
  1. Wikimedia Commons — searches for "{year} {make} {model}" or "{make} {model}",
     returns the first image URL that looks like a vehicle photo (JPG/PNG, >50 KB).
  2. Generated card fallback — the /api/vehicle-card route renders a colored card
     with emoji + make text. Used when Wikimedia returns nothing usable.

Wikimedia is queried asynchronously and cached in-process for 1 hour per key
to avoid hammering the API on repeated alerts for the same vehicle profile.
"""
import asyncio
import time
import urllib.parse
import logging

import httpx
import certifi

logger = logging.getLogger(__name__)

CARD_BASE_URL = "https://amberangels.org/api/vehicle-card"
WIKIMEDIA_API  = "https://en.wikipedia.org/w/api.php"
COMMONS_API    = "https://commons.wikimedia.org/w/api.php"

_cache: dict[str, tuple[str | None, float]] = {}
_CACHE_TTL = 3600  # 1 hour


def _card_url(color: str | None, body_type: str | None, make: str | None) -> str | None:
    if not color and not body_type and not make:
        return None
    params: dict[str, str] = {}
    if color:
        params["color"] = color.lower()
    if body_type:
        params["type"] = body_type.lower()
    if make:
        params["make"] = make
    return f"{CARD_BASE_URL}?{urllib.parse.urlencode(params)}"


async def _wikimedia_photo(make: str, model: str | None, year: str | None) -> str | None:
    """Query Wikimedia Commons for a vehicle photo. Returns image URL or None."""
    # Build search terms from most-specific to least-specific
    queries = []
    if year and model:
        queries.append(f"{year} {make} {model}")
    if model:
        queries.append(f"{make} {model}")
    queries.append(make)

    # Wikimedia requires a descriptive User-Agent or returns 403
    headers = {
        "User-Agent": "AmberAngels/1.0 (https://amberangels.org; info@amberangels.org) python-httpx"
    }
    async with httpx.AsyncClient(verify=certifi.where(), timeout=5.0, headers=headers) as client:
        for q in queries:
            try:
                resp = await client.get(COMMONS_API, params={
                    "action": "query",
                    "list": "search",
                    "srsearch": f"{q} automobile",
                    "srnamespace": "6",  # File namespace
                    "srlimit": "5",
                    "format": "json",
                })
                resp.raise_for_status()
                results = resp.json().get("query", {}).get("search", [])
                for result in results:
                    title = result.get("title", "")
                    if not title.lower().endswith((".jpg", ".jpeg", ".png")):
                        continue
                    # Resolve to actual image URL via imageinfo
                    info_resp = await client.get(COMMONS_API, params={
                        "action": "query",
                        "titles": title,
                        "prop": "imageinfo",
                        "iiprop": "url|size",
                        "format": "json",
                    })
                    info_resp.raise_for_status()
                    pages = info_resp.json().get("query", {}).get("pages", {})
                    for page in pages.values():
                        infos = page.get("imageinfo", [])
                        if not infos:
                            continue
                        info = infos[0]
                        size = info.get("size", 0)
                        url  = info.get("url", "")
                        # Skip tiny thumbnails and SVGs
                        if size < 50_000 or not url.lower().endswith((".jpg", ".jpeg", ".png")):
                            continue
                        return url
            except Exception as exc:
                logger.debug("Wikimedia search failed for %r: %s", q, exc)
                continue

    return None


async def resolve_vehicle_image_url(
    *,
    color: str | None = None,
    body_type: str | None = None,
    make: str | None = None,
    model: str | None = None,
    year: str | None = None,
) -> str | None:
    """
    Return the best available vehicle reference image URL.

    Tries Wikimedia Commons first (real photo), falls back to the generated card.
    Returns None only when there is no useful vehicle data at all.
    """
    if not color and not body_type and not make:
        return None

    card = _card_url(color, body_type, make)

    # Only attempt Wikimedia if we have at least a make
    if not make:
        return card

    cache_key = f"{(make or '').lower()}|{(model or '').lower()}|{(year or '').lower()}"
    cached_val, cached_at = _cache.get(cache_key, (None, 0.0))
    if time.monotonic() - cached_at < _CACHE_TTL:
        # cached_val is either a Wikimedia URL or the sentinel "" (meaning "no photo found")
        return cached_val if cached_val else card

    photo = await _wikimedia_photo(make, model, year)
    _cache[cache_key] = (photo or "", time.monotonic())

    if photo:
        logger.debug("Wikimedia photo for %s %s: %s", make, model, photo)
        return photo

    return card
