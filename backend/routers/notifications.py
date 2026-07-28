"""
backend/routers/notifications.py

GET  /notifications           — notification inbox for the authenticated pilot
POST /notifications/mark-read — mark all (or specific IDs) as read
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text

import database
from routers.auth import get_current_pilot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])


class MarkReadRequest(BaseModel):
    ids: Optional[list[int]] = None  # None → mark all unread as read


@router.get("")
async def get_notifications(
    limit: int = 50,
    payload: dict = Depends(get_current_pilot),
):
    username = payload["sub"]
    async with database.AsyncSessionLocal() as session:
        rows = await session.execute(
            text("""
                SELECT id, title, body, type, data, sent_at, read_at
                FROM push_notifications
                WHERE username = :username
                ORDER BY sent_at DESC
                LIMIT :limit
            """),
            {"username": username, "limit": min(limit, 200)},
        )
        notifications = [
            {
                "id":      r[0],
                "title":   r[1],
                "body":    r[2],
                "type":    r[3],
                "data":    r[4] or {},
                "sent_at": r[5].isoformat() if r[5] else None,
                "read_at": r[6].isoformat() if r[6] else None,
            }
            for r in rows.fetchall()
        ]

        unread_row = await session.execute(
            text("SELECT COUNT(*) FROM push_notifications WHERE username = :username AND read_at IS NULL"),
            {"username": username},
        )
        unread_count = unread_row.scalar() or 0

    return {"notifications": notifications, "unread_count": unread_count}


@router.post("/mark-read")
async def mark_notifications_read(
    req: MarkReadRequest,
    payload: dict = Depends(get_current_pilot),
):
    username = payload["sub"]
    async with database.AsyncSessionLocal() as session:
        if req.ids:
            for nid in req.ids:
                await session.execute(
                    text("""
                        UPDATE push_notifications
                        SET read_at = NOW()
                        WHERE username = :username AND id = :id AND read_at IS NULL
                    """),
                    {"username": username, "id": nid},
                )
        else:
            await session.execute(
                text("""
                    UPDATE push_notifications
                    SET read_at = NOW()
                    WHERE username = :username AND read_at IS NULL
                """),
                {"username": username},
            )
        await session.commit()
    return {"ok": True}
