"""Prove the connection works and put the schema in place.

    python -m backend.mongo_setup

Run it after filling in .env, and against production before the first deploy.
It is safe to run repeatedly - the API runs the same steps at every startup -
so this is mostly a way to see the result, and to get a clear error message
when something is wrong instead of a server that will not start.
"""
from __future__ import annotations

import asyncio
import re
import sys

from pymongo.errors import ConfigurationError, OperationFailure, PyMongoError

from backend.cloud.config import Settings
from backend.cloud.database import open_database, prepare_database


def _safe(uri: str) -> str:
    """The connection string with the password removed, for printing."""
    return re.sub(r"://([^:/@]+):([^@]+)@", r"://\1:***@", uri)


async def main() -> int:
    try:
        settings = Settings()
    except ValueError as error:
        print(f"Configuration problem: {error}")
        print("Copy .env.example to .env and put your Atlas connection string in it.")
        return 1

    print(f"cluster     {_safe(settings.mongodb_uri)}")
    print(f"database    {settings.mongodb_db}")

    database = open_database(settings)
    try:
        await database.ping()
        print("ping        ok")
    except ConfigurationError as error:
        # Almost always a malformed SRV string or an unencoded password.
        print(f"\nThe connection string was rejected: {error}")
        print("If the password contains @ : / or ?, percent-encode it.")
        return 1
    except PyMongoError as error:
        print(f"\nCould not reach the cluster: {error}")
        print("Usually this is Atlas Network Access - add your current IP there.")
        return 1

    try:
        result = await prepare_database(database, settings)
    except OperationFailure as error:
        print(f"\nSetup failed: {error}")
        print("Check the database user has readWrite (and dbAdmin for validators) on this database.")
        return 1
    finally:
        names = sorted(await database.db.list_collection_names())
        await database.close()

    for collection, indexes in result["indexes"].items():
        print(f"{collection:<16}{', '.join(indexes)}")
    print(f"search      {result['search']}")
    print(f"collections {', '.join(names)}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
