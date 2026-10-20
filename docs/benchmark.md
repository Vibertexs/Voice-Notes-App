# Benchmark: 10,000 lectures

Run with `python scripts/benchmark.py --atlas-search`. It builds a throwaway database
(`voiceflow_bench_<random>`) in the cluster named by `MONGODB_URI`, loads it with
synthetic lectures, times the queries the API runs, asks MongoDB to `explain()` them,
and drops the database.

**Setup:** 10,000 lectures of 800 words each (about six minutes of speech) across 100
users: one heavy user with 1,000 lectures, the rest around 90. The cluster is a shared
Atlas tier and the numbers include the network round trip from a laptop, which is
**32 ms** for a ping that does nothing. Read every figure as "that, plus a little".
Real lectures run 5-8x longer than these, so absolute times for text-heavy queries
would be higher; the shapes below would not change.

| who | query | median ms | plan | index keys | docs examined | returned |
|---|---|---:|---|---:|---:|---:|
| - | ping (the network, not MongoDB) | 32 | - | - | - | - |
| typical user (91) | 50 newest recordings | 36 | IXSCAN > FETCH > LIMIT | 50 | 50 | 50 |
| typical user (91) | same query, indexes ignored | 48 | COLLSCAN > SORT | 0 | **10,000** | 50 |
| typical user (91) | 50 newest in one folder | 34 | IXSCAN > FETCH > LIMIT | 7 | 7 | 7 |
| typical user (91) | search "zeppelin" (regex) | 35 | IXSCAN > FETCH > LIMIT | 91 | 91 | 0 |
| typical user (91) | top 20 topics, counting words on demand | 781 | IXSCAN > FETCH | 91 | 91 | 91 |
| typical user (91) | top 20 topics, **pre-counted per recording** | **38** | IXSCAN > FETCH | 91 | 91 | 91 |
| heavy user (1,000) | 50 newest recordings | 35 | IXSCAN > FETCH > LIMIT | 50 | 50 | 50 |
| heavy user (1,000) | same query, indexes ignored | 45 | COLLSCAN > SORT | 0 | **10,000** | 50 |
| heavy user (1,000) | 50 newest in one folder | 38 | IXSCAN > FETCH > LIMIT | 50 | 50 | 50 |
| heavy user (1,000) | search "zeppelin" (regex) | 45 | IXSCAN > FETCH > LIMIT | 1,000 | 1,000 | 4 |
| heavy user (1,000) | search "zeppelin" (Atlas Search) | 47 | - | - | - | 4 |
| heavy user (1,000) | top 20 topics, counting words on demand | **8,658** | IXSCAN > FETCH | 1,000 | 1,000 | 1,000 |
| heavy user (1,000) | top 20 topics, **pre-counted per recording** | **62** | IXSCAN > FETCH | 1,000 | 1,000 | 1,000 |

## What it shows

**1. Every query touches only its owner's documents.** Each index leads with `userId`, so a
user's query examines their own documents (50, 91, 1,000) however many lectures the
library holds. With the indexes ignored, the same query examines all 10,000. The
timings barely differ here because the network round trip dominates and 10,000 small
documents is cheap; the *docs examined* column is the number that grows with the
library, and it is the one that stays flat with the index.

**2. The planner picked the wrong index, and the benchmark caught it.** The first run
showed the heavy user's queries examining 10,000 index keys though they own 1,000
documents. The cause was the TTL index on `deletedAt`: every live document has
`deletedAt: null`, so that index contains every document, and for
`{userId, deletedAt: null}` the planner preferred it over the `userId` index. The fix is
to make it a *partial* index (`partialFilterExpression: {deletedAt: {$type: "date"}}`),
which holds only tombstones and cannot answer "not deleted". After it, keys examined
equal the user's own documents (1,000).

**3. Counting words on demand does not scale; pre-counting does.** The first version of
"topics" split every transcript into words inside the aggregation, on every request:
781 ms for a typical user and 8.7 s for the heavy one, almost all of it CPU in
`$regexFindAll` and `$unwind` over 800,000 words, not scanning. The shipped version
counts each recording's top 40 words once, when the recording syncs (computed
pattern), and the query adds up those short lists: 38 ms and 62 ms, a **140x**
improvement for the heavy user, and it no longer depends on how long each lecture is.
The cost moves to sync time: 1,000 recordings catch up in 7 s in Python, once.
The trade: a word counts for a recording only if it is among that recording's 40
most-said, so topics are each lecture's defining terms rather than every passing mention.

**4. At this scale Atlas Search and a regex scan tie** (47 vs 45 ms at 1,000 lectures),
because the regex only scans the user's own documents. Atlas Search earns its place for
relevance ranking, word forms and typo tolerance, not for speed at one person's scale.
