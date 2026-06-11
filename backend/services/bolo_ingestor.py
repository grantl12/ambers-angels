"""
backend/services/bolo_ingestor.py

Extracts plate / vehicle / person data from a BOLO screenshot using Claude
vision, then returns structured fields for the caller to persist.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re

import anthropic

logger = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"

_PROMPT = """
You are processing a BOLO (Be On the Lookout) or missing-person alert image
from social media or law enforcement. Extract the fields below as a JSON object.
Use null for any field not found in the image.

{
  "plate_text":    "license plate — letters/digits only, no spaces or dashes",
  "vehicle_make":  "manufacturer (e.g. Nissan, Toyota, Ford)",
  "vehicle_model": "model name (e.g. Altima, Camry, F-150)",
  "vehicle_year":  "4-digit year as a string, or null",
  "vehicle_color": "primary color (e.g. silver, black, white)",
  "vehicle_type":  "car | truck | suv | van | motorcycle",
  "person_name":   "full name of missing or wanted person",
  "case_number":   "case or incident number",
  "headline":      "one-sentence summary suitable as an alert headline",
  "area":          "city / county / state where person was last seen",
  "alert_type":    "amber (child abduction) | silver (elderly/adult missing) | blue (law enforcement) — default amber"
}

Return ONLY the raw JSON object with no markdown fences or explanation.
"""

_ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


async def extract_bolo(image_bytes: bytes, content_type: str = "image/jpeg") -> dict:
    """
    Send the image to Claude Haiku vision and return the extracted fields dict.
    Raises ValueError if the model returns unparseable JSON.
    """
    media_type = content_type if content_type in _ALLOWED_MEDIA_TYPES else "image/jpeg"
    b64 = base64.standard_b64encode(image_bytes).decode()

    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    msg = await client.messages.create(
        model=_MODEL,
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": b64},
                },
                {"type": "text", "text": _PROMPT},
            ],
        }],
    )

    raw = msg.content[0].text.strip()
    # Strip markdown code fences if the model wraps the response
    raw = re.sub(r"^```(?:json)?\n?", "", raw).rstrip("`").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("BOLO extractor returned non-JSON: %s", raw[:200])
        raise ValueError(f"Model returned unparseable response: {exc}") from exc
