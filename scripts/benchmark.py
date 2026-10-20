"""Measure the library queries against a lot of lectures.

Builds a throwaway database (voiceflow_bench_<random>) in the cluster named by
MONGODB_URI, fills it with synthetic lectures, times the queries the API runs and
asks MongoDB to explain each one, then drops the database. Nothing outside that
one database is touched, and it is dropped even if the run fails.

    python scripts/benchmark.py                          # 10,000 lectures
    python scripts/benchmark.py --lectures 2000 --atlas-search

It is a measurement of this schema and these indexes, not of the free tier's
network: the numbers include the round trip from wherever you run it.
"""
from __future__ import annotations

import argparse
import asyncio
import random
import statistics
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient  # noqa: E402

from backend.cloud import insights  # noqa: E402
from backend.cloud.config import Settings  # noqa: E402
from backend.cloud.database import SEARCH_INDEX, Database, _ensure_search_index, prepare_database  # noqa: E402

PREFIX = "voiceflow_bench_"

SUBJECTS = {
    "chemistry": "nucleophile electrophile reaction solvent catalyst enthalpy entropy molecule bond orbital carbon "
                 "oxidation reduction titration equilibrium acid base polymer isomer substitution elimination".split(),
    "economics": "supply demand inflation elasticity monopoly equilibrium tariff interest recession fiscal monetary "
                 "marginal utility consumer producer surplus deficit currency labor capital".split(),
    "biology": "mitochondria ribosome enzyme protein membrane chromosome mutation evolution species genome cell "
               "photosynthesis respiration neuron hormone bacteria virus tissue organism".split(),
    "history": "empire revolution treaty dynasty colony monarchy parliament constitution reform conquest trade "
               "republic senate migration famine alliance rebellion industrial feudal".split(),
    "physics": "momentum velocity acceleration quantum photon entropy gravity friction voltage current resistance "
               "wavelength frequency relativity particle field torque pressure thermal".split(),
    "computing": "algorithm recursion pointer compiler database index query thread network packet cache hash "
                 "function variable stack queue kernel protocol encryption latency".split(),
    "literature": "narrator metaphor symbolism protagonist theme irony allegory sonnet stanza novel tragedy "
                  "chapter dialogue satire motif genre rhetoric imagery plot".split(),
    "psychology": "cognition memory bias attachment conditioning perception therapy stimulus behavior emotion "
                  "development personality anxiety motivation survey cortex reflex".split(),
}
FILLER = ("the and that this with have from they will would there their what about which when your said like just "
          "really actually okay so then because going know think right yeah want need look here more some other "
          "into over also very much make time first next today remember example important question").split()
RARE = "zeppelin"          # appears in about 1 lecture in 500


def lecture_text(rng: random.Random, words: int) -> str:
    a, b = rng.sample(list(SUBJECTS), 2)
    pool = [SUBJECTS[a], SUBJECTS[a], SUBJECTS[b], FILLER, FILLER]       # ~40% / 20% / 40%
    picked = [rng.choice(rng.choice(pool)) for _ in range(words)]
    if rng.random() < 1 / 500:
        picked[rng.randrange(words)] = RARE
    return " ".join(picked)


def naive_topics_pipeline(user_id: str) -> list[dict]:
    """The obvious way to count topics, kept here to measure against: pull every word
    out of every transcript with $regexFindAll and count them, on each request."""
    return [
        {"$match": {"userId": user_id, "deletedAt": None}},
        {"$project": {"words": {"$filter": {
            "input": {"$map": {
                "input": {"$regexFindAll": {"input": {"$toLower": {"$ifNull": ["$text", ""]}}, "regex": insights.WORD.pattern}},
                "as": "m", "in": "$$m.match"}},
            "cond": {"$not": [{"$in": ["$$this", sorted(insights.STOP_WORDS)]}]},
        }}}},
        {"$unwind": "$words"},
        {"$group": {"_id": "$words", "mentions": {"$sum": 1}}},
        {"$sort": {"mentions": -1, "_id": 1}},
        {"$limit": 20},
    ]


def split_lectures(total: int, users: int) -> list[int]:
    """One heavy user with a tenth of everything; everyone else evenly."""
    heavy = total // 10
    rest = total - heavy
    each, extra = divmod(rest, users - 1)
    return [heavy] + [each + (1 if i < extra else 0) for i in range(users - 1)]


async def load(database: Database, lectures: int, users: int, words: int, seed: int) -> dict[str, list[str]]:
    rng = random.Random(seed)
    now = datetime.now(timezone.utc)
    folder_names = list(SUBJECTS)
    owners: dict[str, list[str]] = {}
    counts = split_lectures(lectures, users)
    recordings, transcripts, folders = [], [], []
    done = 0

    async def flush() -> None:
        nonlocal recordings, transcripts
        if recordings:
            await database.recordings.insert_many(recordings, ordered=False)
            await database.transcripts.insert_many(transcripts, ordered=False)
        recordings, transcripts = [], []

    for index, count in enumerate(counts):
        user = f"bench-user-{index}"
        folder_ids = [f"{user}-f{n}" for n in range(len(folder_names))]
        folders += [{"_id": fid, "userId": user, "name": name.title(), "updatedAt": now, "syncedAt": now, "deletedAt": None}
                    for fid, name in zip(folder_ids, folder_names)]
        owners[user] = []
        for n in range(count):
            rid = f"{user}-r{n}"
            made = now - timedelta(minutes=rng.randint(0, 60 * 24 * 365))
            owners[user].append(rid)
            recordings.append({
                "_id": rid, "userId": user, "title": f"Lecture {n}", "folderId": rng.choice(folder_ids),
                "createdAt": made, "updatedAt": made, "syncedAt": made, "deletedAt": None,
                "durationSeconds": rng.randint(600, 5400), "markers": [],
            })
            transcripts.append({
                "_id": rid, "userId": user, "text": lecture_text(rng, words),
                "updatedAt": made, "syncedAt": made, "deletedAt": None,
            })
            done += 1
            if len(recordings) >= 250:
                await flush()
                print(f"\r  loaded {done:,} / {lectures:,}", end="", flush=True)
    await flush()
    await database.folders.insert_many(folders, ordered=False)
    print(f"\r  loaded {done:,} / {lectures:,} lectures for {users} users")
    return owners


def plan_stages(plan: dict) -> list[str]:
    stages = []
    while plan:
        stages.append(plan.get("stage", "?"))
        plan = plan.get("inputStage") or (plan.get("inputStages") or [None])[0]
    return stages


async def timed(run, repeat: int = 5) -> float:
    await run()                                              # warm the connection and the cache
    samples = []
    for _ in range(repeat):
        start = time.perf_counter()
        await run()
        samples.append((time.perf_counter() - start) * 1000)
    return statistics.median(samples)


async def explain(cursor) -> dict:
    ex = await cursor.explain()
    stats = ex["executionStats"]
    return {"plan": " > ".join(reversed(plan_stages(ex["queryPlanner"]["winningPlan"]))),
            "docs": stats["totalDocsExamined"], "keys": stats["totalKeysExamined"], "returned": stats["nReturned"]}


async def run(args: argparse.Namespace) -> None:
    base = Settings()
    name = f"{PREFIX}{uuid.uuid4().hex[:8]}"
    settings = base.model_copy(update={"mongodb_db": name, "search_backend": "regex"})
    client = AsyncMongoClient(settings.mongodb_uri, tz_aware=True, appname="voiceflow-bench")
    database = Database(client=client, db=client[name])
    assert database.db.name.startswith(PREFIX)
    print(f"database {name}")
    try:
        await prepare_database(database, settings)          # the real validators and indexes
        started = time.perf_counter()
        owners = await load(database, args.lectures, args.users, args.words, args.seed)
        print(f"  load took {time.perf_counter() - started:.0f}s")
        stats = await database.db.command("dbStats")
        print(f"  data {stats['dataSize'] / 1e6:.0f} MB, indexes {stats['indexSize'] / 1e6:.0f} MB")

        heavy = "bench-user-0"
        typical = "bench-user-1"
        rows: list[tuple[str, str, float, dict | None]] = []
        # The floor under every number below: one trip to the cluster and back, doing nothing.
        rows.append(("-", "ping (the network, not MongoDB)", await timed(database.ping), None))

        for who, label in ((typical, f"typical user ({len(owners[typical]):,} lectures)"),
                           (heavy, f"heavy user ({len(owners[heavy]):,} lectures)")):
            live = {"userId": who, "deletedAt": None}
            recent = lambda w=who: database.recordings.find({"userId": w, "deletedAt": None}).sort("createdAt", -1).limit(50)
            rows.append((label, "50 newest recordings",
                         await timed(lambda: recent().to_list(50)), await explain(recent())))
            rows.append((label, "  same query, indexes ignored",
                         await timed(lambda: recent().hint([("$natural", 1)]).to_list(50)),
                         await explain(recent().hint([("$natural", 1)]))))

            folder = f"{who}-f0"
            in_folder = lambda w=who, f=folder: database.recordings.find(
                {"userId": w, "folderId": f, "deletedAt": None}).sort("createdAt", -1).limit(50)
            rows.append((label, "50 newest in one folder",
                         await timed(lambda: in_folder().to_list(50)), await explain(in_folder())))

            word = lambda w=who: database.transcripts.find(
                {"userId": w, "deletedAt": None, "text": {"$regex": RARE, "$options": "i"}}, projection={"_id": 1}).limit(20)
            rows.append((label, f'search "{RARE}" (regex)', await timed(lambda: word().to_list(20)), await explain(word())))

            # The first way: split every transcript into words inside the pipeline, every time.
            naive = naive_topics_pipeline(who)

            async def topics_naive(p=naive) -> None:
                [d async for d in await database.transcripts.aggregate(p, allowDiskUse=True)]
            rows.append((label, "top 20 topics, counting words on demand", await timed(topics_naive, repeat=3),
                         await explain(database.transcripts.find({"userId": who, "deletedAt": None}))))

            # What shipped: each recording's top words are counted once, at sync time.
            catch_up = time.perf_counter()
            built = await insights.ensure_user(database, who, limit=10_000)
            print(f"  built {built:,} term sets for {who} in {time.perf_counter() - catch_up:.1f}s (once, in Python)")
            fast = insights.pipeline(who, limit=20)

            async def topics_fast(p=fast) -> None:
                [d async for d in await database.term_sets.aggregate(p)]
            rows.append((label, "top 20 topics, pre-counted per recording", await timed(topics_fast, repeat=5),
                         await explain(database.term_sets.find({"userId": who}))))

        print("\n  sample of what the topics query returns for the typical user:")
        typical_top = [d async for d in await database.term_sets.aggregate(insights.pipeline(typical, limit=8))]
        print("   ", ", ".join(f"{d['word']} ({d['mentions']:,})" for d in typical_top))

        if args.atlas_search:
            print("\n  building the Atlas Search index (a few minutes) ...")
            await _ensure_search_index(database)
            for _ in range(120):
                found = [i async for i in await database.transcripts.list_search_indexes(SEARCH_INDEX)]
                if found and found[0].get("queryable"):
                    break
                await asyncio.sleep(5)
            for who, label in ((typical, "typical user"), (heavy, "heavy user")):
                pipeline = [{"$search": {"index": SEARCH_INDEX, "compound": {
                    "filter": [{"equals": {"path": "userId", "value": who}}],
                    "must": [{"text": {"query": RARE, "path": "text"}}]}}},
                    {"$limit": 20}, {"$project": {"_id": 1}}]
                rows.append((label, f'search "{RARE}" (Atlas Search)',
                             await timed(lambda p=pipeline: _all(database.transcripts.aggregate(p))), None))

        print("\n| who | query | median ms | plan | keys | docs examined | returned |\n|---|---|---:|---|---:|---:|---:|")
        for label, query, ms, ex in rows:
            tail = f"{ex['plan']} | {ex['keys']:,} | {ex['docs']:,} | {ex['returned']:,}" if ex else "- | - | - | -"
            print(f"| {label} | {query} | {ms:.0f} | {tail} |")
    finally:
        assert database.db.name.startswith(PREFIX)
        await client.drop_database(name)
        await client.close()
        print(f"\ndropped {name}")


async def _all(awaitable) -> list:
    return [doc async for doc in await awaitable]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lectures", type=int, default=10_000)
    parser.add_argument("--users", type=int, default=100)
    parser.add_argument("--words", type=int, default=800, help="words per lecture (800 is about six minutes of speech)")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--atlas-search", action="store_true", help="also build an Atlas Search index and compare")
    asyncio.run(run(parser.parse_args()))
