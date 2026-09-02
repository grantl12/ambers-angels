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
) -> int:
    """
    Persist a push_notifications row for every recipient and fire Expo push
    to those with a registered token.

    recipients — list of (username, expo_push_token); token may be None.
    Returns the number of devices Expo actually accepted (status "ok" per
    ticket) — not just the number of tokens we attempted to send to.
    """
    if not recipients:
        return 0

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

    # Keep (username, token) together so a per-ticket error below can be
    # traced back to whose token failed, not just "some device".
    push_targets = [(username, tok) for username, tok in recipients if tok]
    if not push_targets:
        return 0

    vehicle_image_url = (data or {}).get("vehicleImageUrl")
    messages = [
        {
            "to":       tok,
            "title":    title,
            "body":     body,
            "sound":    "default",
            "priority": "high",
            **({"data": data} if data else {}),
            # mutableContent signals APNs to invoke the NotificationServiceExtension
            # before display — required for iOS banner images
            **({"mutableContent": True} if vehicle_image_url else {}),
            **({"android": {"imageUrl": vehicle_image_url}} if vehicle_image_url else {}),
        }
        for _, tok in push_targets
    ]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                _EXPO_URL,
                json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        if resp.status_code not in (200, 204):
            logger.warning("Expo push HTTP request failed: %s", resp.status_code)
            return 0

        # A 200 here only means Expo accepted the HTTP request — it still
        # returns one ticket per message, and each ticket can independently
        # be status:"error" (DeviceNotRegistered, InvalidCredentials, etc.)
        # while the overall response is 200. Not checking this is why pilots
        # never got notified even though the logs said "sent".
        tickets = (resp.json() or {}).get("data") or []
        sent = 0
        stale_usernames: list[str] = []
        for (username, tok), ticket in zip(push_targets, tickets):
            if ticket.get("status") == "ok":
                sent += 1
                continue
            err = (ticket.get("details") or {}).get("error") or ticket.get("message")
            logger.warning("Expo push failed for %s (%s...): %s", username, tok[:20], err)
            if err == "DeviceNotRegistered":
                stale_usernames.append(username)

        logger.info("Expo push: %d/%d device(s) accepted by Expo", sent, len(push_targets))

        if stale_usernames:
            try:
                async with session_factory() as session:
                    await session.execute(
                        text("UPDATE pilots SET expo_push_token = NULL WHERE username = ANY(:names)"),
                        {"names": stale_usernames},
                    )
                    await session.commit()
                logger.info("Cleared stale expo_push_token for: %s", stale_usernames)
            except Exception as e:
                logger.error("Failed to clear stale push tokens: %s", e)

        return sent
    except Exception as e:
        logger.error("Expo push failed: %s", e)
        return 0
