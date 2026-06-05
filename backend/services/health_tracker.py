"""
Lightweight in-process poll-time tracker.
Each background loop stamps its last successful iteration here so the
/health endpoint can report live freshness without a DB round-trip.
"""
from datetime import datetime, timezone
from typing import Optional

_stamps: dict[str, datetime] = {}


def stamp(source: str) -> None:
    _stamps[source] = datetime.now(timezone.utc)


def get_iso(source: str) -> Optional[str]:
    ts = _stamps.get(source)
    return ts.isoformat() if ts else None
