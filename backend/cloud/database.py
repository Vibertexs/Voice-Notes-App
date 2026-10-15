"""The MongoDB side: connection, the shape of every collection, its indexes.

The data model
--------------
Embed what is bounded, reference what is unbounded.

    users          one per account
    sessions       one per signed-in device; holds a hash of its refresh token
    folders        a user's folders
    recordings     metadata for one recording; bookmarks are embedded
    transcripts    the words of one recording, keyed by the recording's id
    password_resets, rate_limits   short-lived bookkeeping, expired by TTL

Transcripts are their own collection because they are the one thing that grows
without limit - a long lecture is a thousand segments and fifteen thousand word
timings - and listing a folder should never pull them into memory.

Every synced document carries two clocks, and they do different jobs:

    updatedAt   when the user made the change, on whatever device they made it.
                Last-write-wins compares these.
    syncedAt    when this server accepted the change. Pull cursors walk these,
                because a phone with a wrong clock must not be able to hide a
                change from other phones by stamping it in the past.

Deletes are tombstones (`deletedAt` set, content cleared) so they can reach
devices that are offline when they happen. A TTL index removes them after
`tombstone_days`.

Validators
----------
Each synced collection has a $jsonSchema validator. Pydantic already checks
everything the API accepts; the validator is the database refusing documents
that would silently break sync - one with no userId, or no syncedAt, would be
invisible to every pull and nobody would ever find out.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure
from pymongo.operations import SearchIndexModel

from backend.cloud.config import Settings

log = logging.getLogger("voiceflow.db")

SEARCH_INDEX = "transcripts_text"

_DATE = {"bsonType": "date"}
_DATE_OR_NULL = {"bsonType": ["date", "null"]}
_STRING = {"bsonType": "string"}
_STRING_OR_NULL = {"bsonType": ["string", "null"]}

_SYNCED = {
    "userId": _STRING,
    "updatedAt": _DATE,
    "syncedAt": _DATE,
    "deletedAt": _DATE_OR_NULL,
}

VALIDATORS: dict[str, dict[str, Any]] = {
    "users": {
        "bsonType": "object",
        "required": ["createdAt"],
        "properties": {
            "email": _STRING_OR_NULL,
            "passwordHash": _STRING_OR_NULL,
            "appleSub": _STRING_OR_NULL,
            "googleSub": _STRING_OR_NULL,
            "createdAt": _DATE,
        },
    },
    "sessions": {
        "bsonType": "object",
        "required": ["userId", "tokenHash", "createdAt", "expiresAt"],
        "properties": {
            "userId": _STRING,
            "tokenHash": _STRING,
            "createdAt": _DATE,
            "expiresAt": _DATE,
        },
    },
    "folders": {
        "bsonType": "object",
        "required": ["userId", "name", "updatedAt", "syncedAt"],
        "properties": {**_SYNCED, "name": {"bsonType": "string", "maxLength": 120}},
    },
    "recordings": {
        "bsonType": "object",
        "required": ["userId", "title", "updatedAt", "syncedAt"],
        "properties": {
            **_SYNCED,
            "title": {"bsonType": "string", "maxLength": 300},
            "folderId": _STRING_OR_NULL,
            "markers": {"bsonType": "array"},
        },
    },
    "transcripts": {
        "bsonType": "object",
        "required": ["userId", "updatedAt", "syncedAt"],
        "properties": {**_SYNCED, "segments": {"bsonType": "array"}},
    },
}


def _index(keys: list[tuple[str, int]], name: str, **options: Any) -> dict[str, Any]:
    return {"keys": keys, "name": name, **options}


def declared_indexes(settings: Settings) -> dict[str, list[dict[str, Any]]]:
    """Every index the API relies on, by collection.

    Every query is scoped to one user, so every compound index leads with
    userId. After that the order follows ESR - fields matched exactly, then
    the sort, then ranges - which is what lets the index serve the query
    instead of being scanned.
    """
    tombstone_ttl = settings.tombstone_days * 24 * 3600
    tombstones = _index([("deletedAt", ASCENDING)], "tombstone_ttl", expireAfterSeconds=tombstone_ttl)
    # Sync pulls walk documents in (syncedAt, _id) order. The _id makes the
    # order total, so a page boundary can never fall between two documents
    # that share a millisecond.
    sync_order = _index([("userId", ASCENDING), ("syncedAt", ASCENDING), ("_id", ASCENDING)], "sync_order")
    return {
        "users": [
            # Partial rather than sparse: an Apple account can have no email,
            # and partial indexes skip documents where the field is null.
            _index([("email", ASCENDING)], "email_unique", unique=True,
                   partialFilterExpression={"email": {"$type": "string"}}),
            _index([("appleSub", ASCENDING)], "apple_sub_unique", unique=True,
                   partialFilterExpression={"appleSub": {"$type": "string"}}),
            _index([("googleSub", ASCENDING)], "google_sub_unique", unique=True,
                   partialFilterExpression={"googleSub": {"$type": "string"}}),
        ],
        "sessions": [
            _index([("tokenHash", ASCENDING)], "token_hash_unique", unique=True),
            _index([("previousTokenHash", ASCENDING)], "previous_token_hash", sparse=True),
            _index([("userId", ASCENDING)], "user"),
            # expireAfterSeconds=0 means "expire at the time stored in the
            # field", so each session carries its own lifetime.
            _index([("expiresAt", ASCENDING)], "expiry_ttl", expireAfterSeconds=0),
        ],
        "password_resets": [
            _index([("expiresAt", ASCENDING)], "expiry_ttl", expireAfterSeconds=0),
        ],
        "rate_limits": [
            _index([("expiresAt", ASCENDING)], "expiry_ttl", expireAfterSeconds=0),
        ],
        "folders": [sync_order, tombstones],
        "recordings": [
            sync_order,
            _index([("userId", ASCENDING), ("folderId", ASCENDING), ("createdAt", DESCENDING)], "by_folder"),
            _index([("userId", ASCENDING), ("createdAt", DESCENDING)], "by_created"),
            tombstones,
        ],
        "transcripts": [sync_order, tombstones],
    }


@dataclass
class Database:
    client: AsyncMongoClient
    db: AsyncDatabase

    @property
    def users(self) -> AsyncCollection: return self.db["users"]
    @property
    def sessions(self) -> AsyncCollection: return self.db["sessions"]
    @property
    def password_resets(self) -> AsyncCollection: return self.db["password_resets"]
    @property
    def rate_limits(self) -> AsyncCollection: return self.db["rate_limits"]
    @property
    def folders(self) -> AsyncCollection: return self.db["folders"]
    @property
    def recordings(self) -> AsyncCollection: return self.db["recordings"]
    @property
    def transcripts(self) -> AsyncCollection: return self.db["transcripts"]

    async def ping(self) -> None:
        await self.db.command("ping")

    async def close(self) -> None:
        await self.client.close()


def open_database(settings: Settings) -> Database:
    """One client, one connection pool, for the life of the process.

    The driver pools and is safe to share. A client per request would open a
    new pool every time and exhaust the cluster's connection limit.
    """
    client = AsyncMongoClient(
        settings.mongodb_uri,
        # Fail in five seconds with a clear error rather than hang a request
        # for thirty when the cluster is unreachable - usually an IP missing
        # from the Atlas access list.
        serverSelectionTimeoutMS=5000,
        tz_aware=True,
        appname="voiceflow-api",
    )
    return Database(client=client, db=client[settings.mongodb_db])


async def _ensure_validator(database: Database, name: str, schema: dict[str, Any]) -> None:
    validator = {"$jsonSchema": schema}
    existing = set(await database.db.list_collection_names())
    if name in existing:
        await database.db.command("collMod", name, validator=validator,
                                  validationLevel="strict", validationAction="error")
    else:
        await database.db.create_collection(name, validator=validator,
                                            validationLevel="strict", validationAction="error")


async def _ensure_indexes(collection: AsyncCollection, wanted: list[dict[str, Any]]) -> list[str]:
    """Make the collection's indexes exactly the declared set.

    Undeclared indexes are dropped first: one left behind from an earlier
    schema with the same keys but different options would make the matching
    create_index fail.
    """
    wanted_names = {spec["name"] for spec in wanted}
    current = await collection.index_information()
    for name in current:
        if name != "_id_" and name not in wanted_names:
            log.info("dropping obsolete index %s.%s", collection.name, name)
            await collection.drop_index(name)
    created = []
    for spec in wanted:
        options = {key: value for key, value in spec.items() if key != "keys"}
        created.append(await collection.create_index(spec["keys"], **options))
    return created


async def _ensure_search_index(database: Database) -> str:
    """Create the Atlas Search index on transcripts if it is missing.

    Atlas builds it in the background, so it is not queryable straight away;
    search falls back to a regex scan until it is. Anything other than Atlas
    (a local mongod, for instance) has no search indexes at all, which is
    also fine.
    """
    definition = {
        "mappings": {
            "dynamic": False,
            "fields": {
                "userId": {"type": "token"},
                "text": {"type": "string", "analyzer": "lucene.standard"},
            },
        },
    }
    try:
        existing = [index async for index in await database.transcripts.list_search_indexes(SEARCH_INDEX)]
        if existing:
            return existing[0].get("status", "unknown")
        await database.transcripts.create_search_index(SearchIndexModel(name=SEARCH_INDEX, definition=definition))
        return "created"
    except OperationFailure as error:
        log.warning("Atlas Search unavailable, search will use regex: %s", error.details.get("errmsg"))
        return "unavailable"


async def prepare_database(database: Database, settings: Settings) -> dict[str, Any]:
    """Validators, indexes and the search index. Idempotent; runs at startup."""
    for name, schema in VALIDATORS.items():
        await _ensure_validator(database, name, schema)
    indexes = {}
    for name, wanted in declared_indexes(settings).items():
        indexes[name] = await _ensure_indexes(database.db[name], wanted)
    search = "skipped"
    if settings.search_backend != "regex":
        search = await _ensure_search_index(database)
    return {"indexes": indexes, "search": search}
