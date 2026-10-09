"""Sending the one email this service sends: a password reset code.

Resend is used when RESEND_API_KEY is set. Without it, development prints the
message to the log so the flow can be tested end to end, and production logs
that it could not send - never the code itself, since server logs are read by
more people than mailboxes are.
"""
from __future__ import annotations

import logging
from typing import Protocol

import httpx

from backend.cloud.config import Settings

log = logging.getLogger("voiceflow.email")


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, text: str) -> None: ...


class ResendSender:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def send(self, to: str, subject: str, text: str) -> None:
        if not self.settings.resend_api_key:
            if self.settings.production:
                log.error("RESEND_API_KEY is not set; a password reset email to %s was not sent", to)
            else:
                log.warning("email (not sent, no RESEND_API_KEY) to=%s subject=%r\n%s", to, subject, text)
            return
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.settings.resend_api_key}"},
                json={"from": self.settings.email_from, "to": [to], "subject": subject, "text": text},
            )
        if response.status_code >= 400:
            # Logged, not raised: the caller always answers "if that account
            # exists, we sent a code", and a delivery failure must not change
            # that answer into one that reveals whether the account exists.
            log.error("Resend rejected an email to %s: %s %s", to, response.status_code, response.text[:300])


class MemorySender:
    """Keeps sent messages in a list. Used by the tests."""

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def send(self, to: str, subject: str, text: str) -> None:
        self.sent.append({"to": to, "subject": subject, "text": text})
