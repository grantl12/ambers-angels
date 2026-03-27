from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

import httpx

from services.detection_models import (
    Alert,
    AlertChannel,
    AlertCreate,
    AlertDeliveryStatus,
    DetectionEvent,
    build_alert_event_payload,
)


# -----------------------------------------------------------------------------
# Repository protocol
# -----------------------------------------------------------------------------


class AlertRepository(Protocol):
    def create_alert(self, payload: AlertCreate) -> Alert:
        ...

    def update_alert(self, alert: Alert, fields: dict) -> Alert:
        ...


# -----------------------------------------------------------------------------
# Dispatcher
# -----------------------------------------------------------------------------


class AlertDispatcher:
    def __init__(
        self,
        repository: AlertRepository,
        *,
        webhook_url: str | None = None,
        timeout_seconds: float = 5.0,
    ) -> None:
        self.repository = repository
        self.webhook_url = webhook_url
        self.timeout_seconds = timeout_seconds

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def dispatch(self, event: DetectionEvent) -> list[Alert]:
        """
        Fan out alerts for an event.

        POC behavior:
        - always create INTERNAL alert record
        - optionally send WEBHOOK if configured
        """
        alerts: list[Alert] = []

        payload = build_alert_event_payload(event)
        payload_dict = json.loads(payload.model_dump_json())

        # Always create internal alert
        internal = self.repository.create_alert(
            AlertCreate(
                event_id=event.id,
                channel=AlertChannel.INTERNAL,
                payload=payload_dict,
            )
        )
        alerts.append(internal)

        # Optional webhook
        if self.webhook_url:
            webhook_alert = self.repository.create_alert(
                AlertCreate(
                    event_id=event.id,
                    channel=AlertChannel.WEBHOOK,
                    destination=self.webhook_url,
                    payload=payload_dict,
                )
            )

            alerts.append(
                await self._send_webhook(webhook_alert)
            )

        return alerts

    # ------------------------------------------------------------------
    # Webhook
    # ------------------------------------------------------------------

    async def _send_webhook(self, alert: Alert) -> Alert:
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            try:
                response = await client.post(
                    alert.destination,
                    json=alert.payload,
                    headers={"Content-Type": "application/json"},
                )

                updated = self.repository.update_alert(
                    alert,
                    {
                        "delivery_status": AlertDeliveryStatus.SENT.value
                        if response.status_code < 400
                        else AlertDeliveryStatus.FAILED.value,
                        "provider_response": {
                            "status_code": response.status_code,
                            "body": response.text[:2000],
                        },
                        "sent_at": datetime.now(timezone.utc),
                    },
                )
                return updated

            except Exception as exc:
                updated = self.repository.update_alert(
                    alert,
                    {
                        "delivery_status": AlertDeliveryStatus.FAILED.value,
                        "provider_response": {
                            "error": str(exc),
                        },
                        "sent_at": datetime.now(timezone.utc),
                    },
                )
                return updated


# -----------------------------------------------------------------------------
# Simple sync wrapper (optional)
# -----------------------------------------------------------------------------


class SyncAlertDispatcher:
    """
    Convenience wrapper if you're not async yet.
    """

    def __init__(self, async_dispatcher: AlertDispatcher):
        self.async_dispatcher = async_dispatcher

    def dispatch(self, event: DetectionEvent) -> list[Alert]:
        import asyncio

        return asyncio.run(self.async_dispatcher.dispatch(event))
