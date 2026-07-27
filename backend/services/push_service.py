"""
backend/services/push_service.py

Shared helper for sending Expo push notifications and persisting them to the
push_notifications table so pilots can browse their notification history in-app.
"""
import json
import logging
from typing import Optional

import httpx
from sqlalchemy import text

logger = logging.getLogger(__name__)

_EXPO_URL = "https://exp.host/--/api/v2/push/send"


async def send_push_notifications(
    session_factory,
    recipients: list[tuple[str, Optional[str]]],  # (username, expo_push_token | None)
    title: str,
    body: str,
    notif_type: str,
    data: Optional[dict] = None,
) -> None:
    """
    Persist a push_notifications row for every recipient and fire Expo push
    to those with a registered token.

    recipients — list of (username, expo_push_token); token may be None.
    """
    if not recipients:
        return

    data_json = json.dumps(data or {})

    try:
        async with session_factory() as session:
            await session.execute(
                text("""
                    INSERT INTO push_notifications (username, title, body, type, data)
                    VALUES (:username, :title, :body, :type, cast(:data AS jsonb))
                """),
                [
                    {
                        "username": username,
                        "title":    title,
                        "body":     body,
                        "type":     notif_type,
                        "data":     data_json,
                    }
                    for username, _ in recipients
                ],
            )
            await session.commit()
    except Exception as e:
        logger.error("push_notifications insert failed: %s", e)

    tokens = [tok for _, tok in recipients if tok]
    if not tokens:
        return

    messages = [
        {
            "to":       tok,
            "title":    title,
            "body":     body,
            "sound":    "default",
            "priority": "high",
            **({"data": data} if data else {}),
        }
        for tok in tokens
    ]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                _EXPO_URL,
                json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        if resp.status_code in (200, 204):
            logger.info("Expo push sent to %d device(s)", len(tokens))
        else:
            logger.warning("Expo push returned %s", resp.status_code)
    except Exception as e:
        logger.error("Expo push failed: %s", e)
