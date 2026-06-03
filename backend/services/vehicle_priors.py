"""
Bayesian vehicle prior weighting service.

For a given alert type (amber/silver/blue) and detected vehicle attributes
(color, body_type, make), returns a prior_weight representing how
over- or under-represented that vehicle profile is in historical alert data
relative to the national fleet population.

prior_weight > 1.0  → vehicle type appears MORE than its population share in this alert type
prior_weight = 1.0  → neutral (no data or matches population)
prior_weight < 1.0  → vehicle type appears LESS than its population share

The weight is a geometric mean across available attribute priors. Applied
to scoring as log2(prior_weight) * scale — so:
  prior=3.67 (minivan in AMBER) → +6.9 pts
  prior=1.0  (neutral)          →  0.0 pts
  prior=0.5  (sports car)       → -4.0 pts

Constitutional note: priors apply to inanimate vehicle attributes described
in active government-issued alerts. They improve signal-to-noise for matching
vehicles already specified by law enforcement. No person is flagged based on
vehicle attributes alone — priors only modify confidence when a plate is
already being read by ALPR.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory cache — keyed as (alert_type, attribute_type, attribute_value)
# ---------------------------------------------------------------------------

_priors: dict[tuple[str, str, str], float] = {}
_lock = threading.Lock()
_last_loaded: float = 0.0
_CACHE_TTL = 300.0  # refresh every 5 minutes


def _key(alert_type: str, attr_type: str, value: str) -> tuple[str, str, str]:
    return (alert_type.lower(), attr_type.lower(), value.lower().strip())


def load_from_db(db) -> None:
    """Pull priors from vehicle_alert_priors table into the in-memory cache."""
    global _last_loaded
    try:
        from sqlalchemy import text
        rows = db.execute(text(
            "SELECT alert_type, attribute_type, attribute_value, prior_weight "
            "FROM vehicle_alert_priors WHERE prior_weight IS NOT NULL"
        )).fetchall()
        new_priors: dict[tuple[str, str, str], float] = {}
        for r in rows:
            k = _key(r[0], r[1], r[2])
            new_priors[k] = float(r[3])
        with _lock:
            _priors.clear()
            _priors.update(new_priors)
            _last_loaded = time.monotonic()
        logger.info("[VehiclePriors] Loaded %d priors from DB", len(new_priors))
    except Exception as e:
        logger.warning("[VehiclePriors] Failed to load priors from DB: %s", e)


def maybe_refresh(db) -> None:
    """Load priors from DB if the cache is stale. Call at ingest time."""
    if time.monotonic() - _last_loaded > _CACHE_TTL:
        load_from_db(db)


def get_prior_weight(
    alert_type: Optional[str],
    color: Optional[str],
    body_type: Optional[str],
    make: Optional[str],
) -> float:
    """
    Returns the geometric mean of per-attribute priors for the given combination.
    Returns 1.0 (neutral) when no data is available.
    """
    if not alert_type:
        return 1.0

    individual: list[float] = []

    def _lookup(attr_type: str, value: Optional[str]) -> None:
        if not value:
            return
        with _lock:
            w = _priors.get(_key(alert_type, attr_type, value))
            # Also check 'all' alert type as fallback
            if w is None:
                w = _priors.get(_key("all", attr_type, value))
        if w is not None and w > 0:
            individual.append(w)

    _lookup("color",     color)
    _lookup("body_type", body_type)
    _lookup("make",      make)

    if not individual:
        return 1.0

    # Geometric mean — prevents any single attribute from dominating
    product = math.prod(individual)
    return round(product ** (1.0 / len(individual)), 4)


def prior_score_bonus(prior_weight: float) -> float:
    """
    Convert a prior_weight to an additive score bonus.
    log2 scale so extreme priors taper off gracefully.
    Range: roughly ±8 points.
    """
    clamped = max(0.1, min(10.0, prior_weight))
    return round(math.log2(clamped) * 4.0, 3)
