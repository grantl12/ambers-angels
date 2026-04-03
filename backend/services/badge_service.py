"""
badge_service.py — compute earned badges for a pilot from live DB data.

Badges are never stored; they're derived each request from the pilot's
stats, profile, and position in the pilot roster. Add new badges here —
the /pilots/my-badges endpoint picks them up automatically.
"""

from __future__ import annotations
from typing import Any

from sqlalchemy import text

# ---------------------------------------------------------------------------
# Badge catalogue
# tier: bronze | silver | gold | platinum | special
# ---------------------------------------------------------------------------

BADGES: dict[str, dict[str, str]] = {
    # ── Bronze — first steps ─────────────────────────────────────────────
    "first_mission": {
        "emoji": "🛫", "tier": "bronze",
        "name": "First Mission",
        "desc": "Flew your very first mission.",
    },
    "first_scan": {
        "emoji": "🔍", "tier": "bronze",
        "name": "First Scan",
        "desc": "Detected your first plate.",
    },
    "first_hit": {
        "emoji": "🎯", "tier": "bronze",
        "name": "First Hit",
        "desc": "Your first watchlist match.",
    },

    # ── Silver — getting serious ─────────────────────────────────────────
    "hour_up": {
        "emoji": "⏱️", "tier": "silver",
        "name": "Hour Up",
        "desc": "1 hour of total flight time.",
    },
    "sharp_eyes": {
        "emoji": "👁️", "tier": "silver",
        "name": "Sharp Eyes",
        "desc": "100 plates scanned.",
    },
    "bloodhound": {
        "emoji": "🐕", "tier": "silver",
        "name": "Bloodhound",
        "desc": "3 watchlist matches.",
    },
    "watch_warden": {
        "emoji": "🗺️", "tier": "silver",
        "name": "Watch Warden",
        "desc": "3 or more watch areas configured.",
    },
    "certified": {
        "emoji": "📋", "tier": "silver",
        "name": "FAA Certified",
        "desc": "Part 107 license on file.",
    },

    # ── Gold — dedicated ─────────────────────────────────────────────────
    "sky_veteran": {
        "emoji": "✈️", "tier": "gold",
        "name": "Sky Veteran",
        "desc": "5 hours of total flight time.",
    },
    "eagle_eye": {
        "emoji": "🦅", "tier": "gold",
        "name": "Eagle Eye",
        "desc": "500 plates scanned.",
    },
    "guardian": {
        "emoji": "🛡️", "tier": "gold",
        "name": "Guardian",
        "desc": "10 watchlist matches.",
    },
    "drone_pilot": {
        "emoji": "🚁", "tier": "gold",
        "name": "Drone Pilot",
        "desc": "Flew missions with a DJI drone.",
    },

    # ── Platinum — elite ─────────────────────────────────────────────────
    "marathon": {
        "emoji": "💪", "tier": "platinum",
        "name": "Marathon",
        "desc": "10 hours of total flight time.",
    },
    "thousand_plates": {
        "emoji": "🏆", "tier": "platinum",
        "name": "Thousand Plates",
        "desc": "1,000 plates scanned.",
    },
    "ace": {
        "emoji": "⭐", "tier": "platinum",
        "name": "Ace",
        "desc": "25 watchlist matches.",
    },

    # ── Special ──────────────────────────────────────────────────────────
    "founding_member": {
        "emoji": "🌟", "tier": "special",
        "name": "Founding Member",
        "desc": "One of the first 50 pilots on the network.",
    },
}

# Display order — determines how badges are sorted in the UI
_TIER_ORDER = {"bronze": 0, "silver": 1, "gold": 2, "platinum": 3, "special": 4}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_badges(username: str, db) -> list[dict[str, Any]]:
    """
    Return a list of earned badge dicts for the given pilot username.
    Each dict: {id, emoji, tier, name, desc, earned: True}
    Unearned badges are omitted — callers can diff against BADGES to show locked ones.
    """
    stats  = _fetch_stats(username, db)
    pilot  = _fetch_pilot(username, db)
    earned = _evaluate(stats, pilot)

    result = []
    for badge_id in earned:
        defn = BADGES[badge_id]
        result.append({
            "id":    badge_id,
            "emoji": defn["emoji"],
            "tier":  defn["tier"],
            "name":  defn["name"],
            "desc":  defn["desc"],
        })

    # Sort: tier order, then alphabetical within tier
    result.sort(key=lambda b: (_TIER_ORDER.get(b["tier"], 9), b["name"]))
    return result


def compute_all_badges(username: str, db) -> dict[str, Any]:
    """
    Return earned + locked badges so the UI can show a full grid.
    """
    earned_ids = {b["id"] for b in compute_badges(username, db)}
    all_badges = []
    for badge_id, defn in BADGES.items():
        all_badges.append({
            "id":     badge_id,
            "emoji":  defn["emoji"],
            "tier":   defn["tier"],
            "name":   defn["name"],
            "desc":   defn["desc"],
            "earned": badge_id in earned_ids,
        })
    all_badges.sort(key=lambda b: (_TIER_ORDER.get(b["tier"], 9), b["name"]))
    return {
        "earned": sum(1 for b in all_badges if b["earned"]),
        "total":  len(all_badges),
        "badges": all_badges,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _fetch_stats(username: str, db) -> dict:
    """Aggregate flight + detection stats for this pilot."""
    row = db.execute(text("""
        SELECT
            COALESCE(tp.flight_minutes,   0) AS flight_minutes,
            COALESCE(d.total_detections,  0) AS total_detections,
            COALESCE(de.watchlist_hits,   0) AS watchlist_hits,
            COALESCE(tp.used_drone_mode, FALSE) AS used_drone_mode
        FROM (
            SELECT
                pilot_id,
                ROUND((COUNT(*) / 60.0)::numeric, 1) AS flight_minutes,
                bool_or(volunteer_mode IN ('drone','both'))  AS used_drone_mode
            FROM telemetry_points
            WHERE pilot_id = :u
            GROUP BY pilot_id
        ) tp
        FULL OUTER JOIN (
            SELECT
                COALESCE(pilot_id, drone_id) AS pilot_id,
                COUNT(*) AS total_detections
            FROM detections
            WHERE COALESCE(pilot_id, drone_id) = :u
            GROUP BY COALESCE(pilot_id, drone_id)
        ) d ON tp.pilot_id = d.pilot_id
        FULL OUTER JOIN (
            SELECT
                de.drone_id,
                COUNT(*) AS watchlist_hits
            FROM detection_events de
            JOIN detections det ON det.event_id = de.id
            WHERE de.status = 'alerted'
              AND COALESCE(det.pilot_id, det.drone_id) = :u
            GROUP BY de.drone_id
        ) de ON TRUE
    """), {"u": username}).fetchone()

    if not row:
        return {"flight_minutes": 0, "total_detections": 0, "watchlist_hits": 0, "used_drone_mode": False}
    return {
        "flight_minutes":   float(row[0] or 0),
        "total_detections": int(row[1] or 0),
        "watchlist_hits":   int(row[2] or 0),
        "used_drone_mode":  bool(row[3]),
    }


def _fetch_pilot(username: str, db) -> dict:
    """Pull pilot profile fields needed for badge evaluation."""
    row = db.execute(text("""
        SELECT part107, watch_areas, drones, created_at,
               (SELECT COUNT(*) FROM pilots WHERE created_at <= p.created_at) AS roster_pos
        FROM pilots p
        WHERE username = :u
    """), {"u": username}).fetchone()

    if not row:
        return {}
    return {
        "part107":      bool(row[0]),
        "watch_areas":  row[1] or [],
        "drones":       row[2] or [],
        "created_at":   row[3],
        "roster_pos":   int(row[4] or 9999),
    }


def _evaluate(stats: dict, pilot: dict) -> list[str]:
    """Return list of earned badge IDs given preloaded stats + profile."""
    earned: list[str] = []
    fm  = stats.get("flight_minutes",   0)
    det = stats.get("total_detections", 0)
    hit = stats.get("watchlist_hits",   0)

    # Bronze
    if fm  >= 1:    earned.append("first_mission")
    if det >= 1:    earned.append("first_scan")
    if hit >= 1:    earned.append("first_hit")

    # Silver
    if fm  >= 60:   earned.append("hour_up")
    if det >= 100:  earned.append("sharp_eyes")
    if hit >= 3:    earned.append("bloodhound")
    if len(pilot.get("watch_areas", [])) >= 3:
                    earned.append("watch_warden")
    if pilot.get("part107"):
                    earned.append("certified")

    # Gold
    if fm  >= 300:  earned.append("sky_veteran")
    if det >= 500:  earned.append("eagle_eye")
    if hit >= 10:   earned.append("guardian")
    if stats.get("used_drone_mode") or pilot.get("drones"):
                    earned.append("drone_pilot")

    # Platinum
    if fm  >= 600:  earned.append("marathon")
    if det >= 1000: earned.append("thousand_plates")
    if hit >= 25:   earned.append("ace")

    # Special
    if pilot.get("roster_pos", 9999) <= 50:
                    earned.append("founding_member")

    return earned
