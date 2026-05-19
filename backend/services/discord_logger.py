"""
backend/services/discord_logger.py

Custom logging handler that POSTs ERROR and CRITICAL log records to a
Discord webhook as rich embeds.

Design:
- Fires in a daemon thread — never blocks the request thread
- 30-minute dedup per (logger_name + first line of message)
  so a tight error loop doesn't flood the channel
- Stack trace included when available, truncated to fit Discord limits
- Graceful failure — if Discord is unreachable, the error is silently dropped
  rather than triggering more errors
"""

import logging
import threading
import time
import traceback
from datetime import datetime, timezone

import requests as _requests

_COLORS = {
    "CRITICAL": 0x8B0000,  # dark red
    "ERROR":    0xE74C3C,  # red
}

_ICONS = {
    "CRITICAL": "🔴",
    "ERROR":    "🟠",
}


class DiscordErrorHandler(logging.Handler):
    def __init__(self, webhook_url: str, cooldown_s: int = 1800):
        super().__init__(level=logging.ERROR)
        self._webhook_url = webhook_url
        self._cooldown_s  = cooldown_s
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        threading.Thread(target=self._send, args=(record,), daemon=True).start()

    def _dedup_key(self, record: logging.LogRecord) -> str:
        first_line = record.getMessage().split("\n")[0][:120]
        return f"{record.name}:{first_line}"

    def _send(self, record: logging.LogRecord) -> None:
        key = self._dedup_key(record)
        now = time.time()

        with self._lock:
            if now - self._seen.get(key, 0) < self._cooldown_s:
                return
            self._seen[key] = now

        try:
            msg     = record.getMessage()
            color   = _COLORS.get(record.levelname, 0xE74C3C)
            icon    = _ICONS.get(record.levelname,   "🟠")
            ts      = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()

            fields = [
                {"name": "Level",  "value": record.levelname, "inline": True},
                {"name": "Logger", "value": record.name,      "inline": True},
                {"name": "Source", "value": f"`{record.pathname}:{record.lineno}`", "inline": False},
            ]

            if record.exc_info:
                tb = "".join(traceback.format_exception(*record.exc_info))
                # Keep the tail — that's where the actual exception is
                tb_trimmed = tb[-900:] if len(tb) > 900 else tb
                fields.append({
                    "name":   "Stack Trace",
                    "value":  f"```python\n{tb_trimmed}\n```",
                    "inline": False,
                })

            payload = {
                "username": "Amber's Angels — Backend",
                "embeds": [{
                    "title":       f"{icon} {record.levelname}: Backend Error",
                    "description": msg[:1500],
                    "color":       color,
                    "fields":      fields,
                    "footer":      {"text": "ambers-angels-api"},
                    "timestamp":   ts,
                }],
            }

            _requests.post(self._webhook_url, json=payload, timeout=5)
        except Exception:
            pass  # never let error logging cause more errors
