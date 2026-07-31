"""
backend/services/bolo_extractor.py

Local BOLO text extractor — zero external API calls per extraction.

Uses regex patterns for structured fields (plate, year, case number) and
keyword/dictionary matching for vehicle attributes (make, color, type).
Named-entity recognition for person names and locations uses spaCy
en_core_web_sm when available (lazy-loaded on first call).

Designed to be pluggable: if optimum-intel / OpenVINO is available on the
inference host, swap _spacy_nlp() for an OpenVINO-optimized NER model.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# ── Vehicle dictionaries ──────────────────────────────────────────────────────

_MAKES = {
    "acura", "alfa romeo", "aston martin", "audi", "bentley", "bmw", "buick",
    "cadillac", "chevrolet", "chevy", "chrysler", "dodge", "ferrari", "fiat",
    "ford", "genesis", "gmc", "honda", "hummer", "hyundai", "infiniti",
    "jaguar", "jeep", "kia", "lamborghini", "land rover", "landrover", "lexus",
    "lincoln", "maserati", "mazda", "mclaren", "mercedes", "mercedes-benz",
    "mini", "mitsubishi", "nissan", "oldsmobile", "pontiac", "porsche", "ram",
    "rivian", "rolls royce", "rolls-royce", "saab", "saturn", "scion",
    "subaru", "suzuki", "tesla", "toyota", "volkswagen", "vw", "volvo",
}

# Ordered list so "dark blue" is checked before "blue", etc. Do NOT convert to set.
_COLORS: list[str] = [
    "dark blue", "dark green", "dark gray", "dark grey", "dark red",
    "light blue", "light gray", "light grey", "olive green",
    "black", "white", "silver", "gray", "grey", "red", "blue", "green",
    "yellow", "orange", "brown", "tan", "beige", "gold", "purple", "maroon",
    "navy", "teal", "burgundy", "charcoal", "bronze", "cream",
]

# Maps keywords found in text to YOLO body-type labels.
# Keys are checked with word-boundary regex, so " car " is not needed — use "car".
_TYPES: dict[str, str] = {
    "sedan": "car",
    "coupe": "car",
    "hatchback": "car",
    "convertible": "car",
    "car": "car",
    "suv": "suv",
    "crossover": "suv",
    "truck": "truck",
    "pickup": "truck",
    "minivan": "van",
    "van": "van",
    "motorcycle": "motorcycle",
    "motorbike": "motorcycle",
    "dirt bike": "motorcycle",
}

# Specific model names — checked before make to avoid make shadowing model matches.
# Only unambiguous model names included; common English words (escape, focus, etc.) omitted.
_MODEL_PATTERNS: list[tuple[str, str]] = [
    (r"\bsilverado\b",        "Silverado"),
    (r"\bf-?150\b",           "F-150"),
    (r"\bf-?250\b",           "F-250"),
    (r"\bf-?350\b",           "F-350"),
    (r"\bcamry\b",            "Camry"),
    (r"\bcorolla\b",          "Corolla"),
    (r"\baccord\b",           "Accord"),
    (r"\bcivic\b",            "Civic"),
    (r"\bcr-?v\b",            "CR-V"),
    (r"\baltima\b",           "Altima"),
    (r"\bsentra\b",           "Sentra"),
    (r"\brogue\b",            "Rogue"),
    (r"\bram\s*1500\b",       "Ram 1500"),
    (r"\bcharger\b",          "Charger"),
    (r"\bchallenger\b",       "Challenger"),
    (r"\bdurango\b",          "Durango"),
    (r"\btahoe\b",            "Tahoe"),
    (r"\bsuburban\b",         "Suburban"),
    (r"\bequinox\b",          "Equinox"),
    (r"\bmalibu\b",           "Malibu"),
    (r"\bcruze\b",            "Cruze"),
    (r"\bsierra\b",           "Sierra"),
    (r"\bmustang\b",          "Mustang"),
    (r"\bsonata\b",           "Sonata"),
    (r"\btucson\b",           "Tucson"),
    (r"\bsanta\s*fe\b",       "Santa Fe"),
    (r"\bsorento\b",          "Sorento"),
    (r"\bsportage\b",         "Sportage"),
    (r"\bpathfinder\b",       "Pathfinder"),
    (r"\bmurano\b",           "Murano"),
    (r"\boutback\b",          "Outback"),
    (r"\bforester\b",         "Forester"),
    (r"\bimpreza\b",          "Impreza"),
    (r"\bjetta\b",            "Jetta"),
    (r"\bpassat\b",           "Passat"),
    (r"\btiguan\b",           "Tiguan"),
    (r"\bcorvette\b",         "Corvette"),
    (r"\bwrangler\b",         "Wrangler"),
    (r"\bgrand\s*cherokee\b", "Grand Cherokee"),
    (r"\bcherokee\b",         "Cherokee"),
    (r"\bmodel\s*s\b",        "Model S"),
    (r"\bmodel\s*y\b",        "Model Y"),
    (r"\bmodel\s*3\b",        "Model 3"),
    (r"\bmodel\s*x\b",        "Model X"),
]

# ── Regex patterns ────────────────────────────────────────────────────────────

# Explicit labeled plate — "plate: ABC1234", "tag #XY5678"
_PLATE_LABELED_RE = re.compile(
    r'(?:license\s+plate|plate|tag|lic\.?)[:\s#]*([A-Z0-9]{3,8})',
    re.IGNORECASE,
)

# Generic plate shape: letters+digits mix, 4–8 chars (catches most US formats)
_PLATE_BARE_RE = re.compile(
    r'\b([A-Z]{1,3}\d{1,4}[A-Z]{0,3}|\d{1,4}[A-Z]{2,4}\d{0,4})\b',
)

_YEAR_RE   = re.compile(r'\b(19[6-9]\d|20[0-3]\d)\b')
_CASE_RE   = re.compile(
    r'(?:case|incident|report|event)[:\s#]*([A-Z0-9][A-Z0-9\-]{3,19})',
    re.IGNORECASE,
)

# ── spaCy lazy loader ─────────────────────────────────────────────────────────

_nlp_cache = None   # None = not loaded yet; False = unavailable

def _nlp():
    """Lazy-load spaCy en_core_web_sm. Returns model or None."""
    global _nlp_cache
    if _nlp_cache is not None:
        return _nlp_cache if _nlp_cache is not False else None
    try:
        import spacy  # noqa: PLC0415
        _nlp_cache = spacy.load("en_core_web_sm")
        logger.info("[BoloExtractor] spaCy en_core_web_sm loaded")
    except Exception as exc:
        logger.info("[BoloExtractor] spaCy unavailable (%s) — NER disabled", exc)
        _nlp_cache = False
    return _nlp_cache if _nlp_cache is not False else None


# ── Main extraction function ───────────────────────────────────────────────────

def extract(text: str) -> dict:
    """
    Extract BOLO fields from plain text.
    Returns a dict with the same keys as bolo_ingestor.extract_bolo() so
    downstream code works with either extractor interchangeably.
    All values are str | None.
    """
    result: dict[str, Optional[str]] = {
        "plate_text":    None,
        "vehicle_make":  None,
        "vehicle_model": None,
        "vehicle_year":  None,
        "vehicle_color": None,
        "vehicle_type":  None,
        "person_name":   None,
        "case_number":   None,
        "headline":      None,
        "area":          None,
        "alert_type":    "bolo",
    }

    tl = text.lower()

    # ── Plate ──────────────────────────────────────────────────────────────────
    labeled = _PLATE_LABELED_RE.search(text)
    if labeled:
        result["plate_text"] = re.sub(r'[\s\-]', '', labeled.group(1)).upper()
    else:
        for m in _PLATE_BARE_RE.finditer(text):
            cand = m.group().upper()
            # Skip obvious false positives (all-digit strings ≤ 4 chars, common words)
            if re.fullmatch(r'\d{1,4}', cand):
                continue
            if 4 <= len(cand) <= 8:
                result["plate_text"] = cand
                break

    # ── Year ───────────────────────────────────────────────────────────────────
    ym = _YEAR_RE.search(text)
    if ym:
        result["vehicle_year"] = ym.group(1)

    # ── Color — check longest phrases first (list order is critical) ───────────
    for color in _COLORS:
        if color in tl:
            result["vehicle_color"] = color
            break

    # ── Model — checked before make to prevent make match shadowing the model ──
    for pattern, label in _MODEL_PATTERNS:
        if re.search(pattern, tl):
            result["vehicle_model"] = label
            break

    # ── Make — longest match first to handle "land rover" before "rover" ───────
    for make in sorted(_MAKES, key=len, reverse=True):
        if re.search(r'\b' + re.escape(make) + r'\b', tl):
            result["vehicle_make"] = make.title()
            break

    # ── Vehicle type — word-boundary matching prevents " car " space trap ───────
    for kw, vtype in _TYPES.items():
        if re.search(r'\b' + re.escape(kw) + r'\b', tl):
            result["vehicle_type"] = vtype
            break

    # ── Alert type from keyword signals ────────────────────────────────────────
    if any(k in tl for k in ("amber alert", "child abduction", "abducted minor")):
        result["alert_type"] = "amber"
    elif any(k in tl for k in ("silver alert", "elderly missing", "dementia", "alzheimer")):
        result["alert_type"] = "silver"
    elif any(k in tl for k in ("blue alert", "officer missing", "officer involved")):
        result["alert_type"] = "blue"

    # ── Case number ────────────────────────────────────────────────────────────
    cm = _CASE_RE.search(text)
    if cm:
        result["case_number"] = cm.group(1).strip()

    # ── Headline — first substantial sentence ──────────────────────────────────
    for sentence in re.split(r'[\n.!?]', text):
        sentence = sentence.strip()
        if 15 < len(sentence) <= 140:
            result["headline"] = sentence
            break
    if not result["headline"] and len(text) > 0:
        result["headline"] = text[:140].split('\n')[0].strip() or None

    # ── NER: person name + location via spaCy ─────────────────────────────────
    nlp = _nlp()
    if nlp is not None:
        doc = nlp(text[:2500])
        persons = [e.text for e in doc.ents if e.label_ == "PERSON"]
        places  = [e.text for e in doc.ents if e.label_ in ("GPE", "LOC")]
        if persons:
            result["person_name"] = persons[0]
        if places:
            result["area"] = ", ".join(dict.fromkeys(places[:3]))

    return result


def is_actionable(fields: dict) -> bool:
    """
    Gate: does this extraction have enough to add to watchlist or vehicle_targets?

    Paths (any one suffices):
      - plate alone          → watchlist lookup
      - make + model         → specific vehicle identification
      - make + color + area  → YOLO matching with vehicle profile
      - color + type + area  → YOLO matching on color/body even without make
                               ("blue pickup truck in GA" is actionable)
    """
    has_plate   = bool(fields.get("plate_text"))
    has_vehicle = bool(fields.get("vehicle_make")) and bool(fields.get("vehicle_model"))
    has_partial = (
        bool(fields.get("vehicle_make"))
        and bool(fields.get("vehicle_color"))
        and bool(fields.get("area"))
    )
    has_type_partial = (
        bool(fields.get("vehicle_color"))
        and bool(fields.get("vehicle_type"))
        and bool(fields.get("area"))
    )
    return has_plate or has_vehicle or has_partial or has_type_partial
