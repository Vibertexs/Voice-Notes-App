"""A shared MongoDB handle for scripts.

The cloud API (backend/cloud/) owns the data model: the collections, their
validators and indexes are declared in backend/cloud/database.py, with the
reasoning behind them. This module is only a convenience for one-off scripts
and practice files that want `await mongo.connect()` and nothing else.

The phone stays on SQLite. It has to be embedded and work with no network,
which is a different job; it syncs to MongoDB through the cloud API.
"""
from __future__ import annotations

from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from backend.cloud.config import Settings
from backend.cloud.database import Database, open_database

_database: Database | None = None


def configured() -> bool:
    try:
        Settings()
        return True
    except ValueError:
        return False


async def connect() -> AsyncDatabase:
    """The database named by MONGODB_DB, on one pool shared by the script."""
    global _database
    if _database is None:
        _database = open_database(Settings())
    return _database.db


async def close() -> None:
    global _database
    if _database is not None:
        await _database.close()
        _database = None


async def ping() -> dict[str, Any]:
    database = await connect()
    await database.command("ping")
    return {"ok": True, "database": database.name}
