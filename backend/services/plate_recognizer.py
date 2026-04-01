"""
backend/services/plate_recognizer.py

Thin wrapper around the Plate Recognizer Snapshot API.
Called only for high-confidence detections to preserve free-tier quota
(2,500 lookups / month on the free plan).

Requires env var: PLATE_RECOGNIZER_TOKEN
API docs: https://docs.platerecognizer.com/

Provides both async (for FastAPI /ingest/frame) and sync (for the worker).
Returns [] silently if the token is not set or the call fails — vehicle
attributes are enrichment only, never blocking.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import httpx
import requests as _requests

PR_URL   = "https://api.platerecognizer.com/v1/plate-reader/"
PR_TOKEN = os.getenv("PLATE_RECOGNIZER_TOKEN", "")


@dataclass
class PRResult:
    plate:      Optional[str] = None
    make:       Optional[str] = None
    model:      Optional[str] = None
    color:      Optional[str] = None
    body_type:  Optional[str] = None
    pr_score:   float = 0.0


def _parse_response(body: dict) -> list[PRResult]:
    out: list[PRResult] = []
    for r in body.get("results", []):
        veh = r.get("vehicle", {})

        def best(field: str) -> Optional[str]:
            candidates = veh.get(field, [])
            return candidates[0].get(field) if candidates else None

        out.append(PRResult(
            plate     = (r.get("plate") or "").upper() or None,
            make      = best("make"),
            model     = best("model"),
            color     = best("color"),
            body_type = best("body_type"),
            pr_score  = float(r.get("score", 0.0)),
        ))
    return out


async def recognize_async(image_bytes: bytes, regions: list[str] | None = None) -> list[PRResult]:
    """Async version — used by FastAPI endpoints."""
    if not PR_TOKEN:
        return []
    data: dict = {}
    if regions:
        data["regions"] = ",".join(regions)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                PR_URL,
                headers={"Authorization": f"Token {PR_TOKEN}"},
                files={"upload": ("frame.jpg", image_bytes, "image/jpeg")},
                data=data,
            )
        if resp.status_code not in (200, 201):
            print(f"[PlateRecognizer] ⚠️ API returned {resp.status_code}")
            return []
        return _parse_response(resp.json())
    except Exception as e:
        print(f"[PlateRecognizer] ⚠️ async request failed: {e}")
        return []


def recognize_sync(image_path: str, regions: list[str] | None = None) -> list[PRResult]:
    """Sync version — used by the unified worker."""
    if not PR_TOKEN:
        return []
    data: dict = {}
    if regions:
        data["regions"] = ",".join(regions)
    try:
        with open(image_path, "rb") as fh:
            resp = _requests.post(
                PR_URL,
                headers={"Authorization": f"Token {PR_TOKEN}"},
                files={"upload": ("frame.jpg", fh, "image/jpeg")},
                data=data,
                timeout=8,
            )
        if resp.status_code not in (200, 201):
            print(f"[PlateRecognizer] ⚠️ API returned {resp.status_code}")
            return []
        return _parse_response(resp.json())
    except Exception as e:
        print(f"[PlateRecognizer] ⚠️ sync request failed: {e}")
        return []
