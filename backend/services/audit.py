"""Shared audit log helpers — both sync and async flavors."""
import json
import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)

_INSERT = "INSERT INTO audit_log (username, action, details, created_at) VALUES (:u, :a, :d ::jsonb, NOW())"


def write_audit_sync(db, username: str, action: str, details: dict | None = None) -> None:
    """Fire-and-forget audit write using a sync SQLAlchemy session."""
    try:
        db.execute(text(_INSERT), {"u": username, "a": action, "d": json.dumps(details or {})})
        db.commit()
    except Exception as exc:
        logger.warning("Audit log write failed: %s", exc)


async def write_audit_async(session_factory, username: str, action: str, details: dict | None = None) -> None:
    """Fire-and-forget audit write using an async session factory."""
    try:
        async with session_factory() as session:
            await session.execute(text(_INSERT), {"u": username, "a": action, "d": json.dumps(details or {})})
            await session.commit()
    except Exception as exc:
        logger.warning("Audit log write failed: %s", exc)
