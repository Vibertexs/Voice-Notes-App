"""Small helpers every part of the cloud API agrees on."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


def utcnow() -> datetime:
    """Now, in UTC, truncated to the millisecond.

    MongoDB stores dates to the millisecond. Truncating here means a value
    read back compares equal to the value that was written, which the sync
    cursor and last-write-wins both depend on.
    """
    now = datetime.now(timezone.utc)
    return now.replace(microsecond=(now.microsecond // 1000) * 1000)


def as_utc(value: datetime | None) -> datetime | None:
    """Treat a naive datetime as UTC and truncate to the millisecond."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    value = value.astimezone(timezone.utc)
    return value.replace(microsecond=(value.microsecond // 1000) * 1000)


def new_id(prefix: str = "") -> str:
    return f"{prefix}{secrets.token_hex(12)}"
