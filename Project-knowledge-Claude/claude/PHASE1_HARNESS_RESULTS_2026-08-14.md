# Phase 1 — harness results. **The design as approved FAILS its own gate.**

Measured, not extrapolated. **No production write.** Supabase branching is Pro-only
(`PaymentRequiredException`), so the harness is a local PostgreSQL 16 instance seeded at
measured production ratios — free, and it scales further than a branch would have.

**Harness:** 100k → 1M posts · 45k profiles · 471k feed_events · 165.6k friendships ·
80% public / 15% friends / 5% private.
⚠ Production is **100% `privacy='public'`**, so every measurement ever taken on it skipped
`are_friends()` entirely. This seed exercises that branch deliberately.

---

## Results

| variant | 100k posts | | 1M posts | |
|---|---:|---:|---:|---:|
| | **buffers** | **ms** | **buffers** | **ms** |
| **BEFORE** — production shape today | 827,766 | 1,603 | 4,836,645 | **9,489** |
| **AFTER-1** — Phase 1 as approved | 207,112 | 941 | — | — |
| **AFTER-2** — bounded candidate pool | **577** | **3.9** | **650** | **4.5** |

At 1M posts today's feed also spills to disk: `Sort Method: external merge Disk: 148,672 kB`
— **148 MB written per feed page view.**

---

## 1. FAIL — and I am not moving the threshold

The Phase 1 gate I wrote and you approved was **< 50 ms and < 2,000 buffers at 100k posts**.
Phase 1 as designed delivers **941 ms and 207,112 buffers**. It misses by **19× on time and
100× on buffers**. Per your standing rule, that is a FAIL to be reported, not a gate to be
adjusted.

## 2. Why sargable visibility alone cannot work — the 107× was misleading

The 107× I measured on production was `SELECT … WHERE privacy='public' ORDER BY created_at
DESC LIMIT 10` — an index scan that stops after 10 rows. **The real feed has no such
shortcut: it ranks the entire visible set before taking 10.**

At 100k posts, 80,000 rows are visible. The planner therefore chooses a **Seq Scan**, and it is
right to — no index helps when you need 80% of a table. Adding `is_public` and a partial index
changed the shape and bought 4×, but it cannot fix an O(total_posts) algorithm.

**I over-read my own earlier measurement. That number described a different query than the one
the feed runs.**

## 3. What the remaining cost actually was

After sargability, the dominant cost moved: **200,821 of 207,112 buffers (97%) were the
friends branch**, an `EXISTS` on `friendships` re-evaluated once per friends-post
(`loops=15000`). Resolving friend ids **once** into a `MATERIALIZED` CTE removes it.

## 4. What works — bound the candidate pool before ranking

```
candidates AS MATERIALIZED (
  (SELECT … WHERE is_public                    ORDER BY created_at DESC LIMIT 500)
  UNION (SELECT … WHERE user_id = me           ORDER BY created_at DESC LIMIT 100)
  UNION (SELECT … WHERE privacy='friends'
                   AND user_id IN (SELECT fid FROM friends)
                                                ORDER BY created_at DESC LIMIT 200)
)
```

**3.9 ms at 100k · 4.5 ms at 1M.** Essentially flat — the cost is now a function of the
*candidate cap*, not of corpus size. That is the property the feed needs and does not have.

## 5. ⚠ The bounded pool changes product behaviour — this is your decision, not mine

Today's feed ranks **every** visible post, which is what lets the `unseen` and `recycled` tiers
resurface an old photograph that few people have seen. That is the reach-equalising behaviour
the fairness ordering exists for.

**A pool of the 500 newest public posts cannot resurface anything older than the 500 newest.**
A member who posts on a busy day and gets few views would never be resurfaced once their post
falls out of the window. That is a real regression in exactly the property this feed was built
to protect.

Three ways to keep both, none yet measured:

- **A — recent + random sample.** Take 500 newest *plus* 200 sampled from older unseen posts
  (`TABLESAMPLE` or an indexed random key). Keeps the cost bounded and old posts reachable.
- **B — per-user unseen pool**, maintained incrementally. Exact fairness, costs a table and a
  writer — this is fan-out by another name.
- **C — widen the window by age tier** (e.g. 300 from last 7 days, 200 from 8–90 days).
  Cheapest to build, coarsest fairness.

**I recommend measuring A next.** It is the only one that preserves the current semantics
without introducing fan-out, and it is one query change on the harness.

## 6. Status

- Phase 1 migration **not written for production** — the design must change first.
- Nothing applied. Production is untouched: newest migration is still `20260814042609`.
- `is_public`, `viewer_count` and `viewer_bucket` are still correct and still wanted; they are
  necessary but, on this evidence, not sufficient.
- Harness is reproducible: local PG16, schema + seed recorded in this session's commands.
