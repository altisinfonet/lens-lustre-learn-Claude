# Phase 1 — Option A measured. **It works, and fairness is measured, not claimed.**

Follows `PHASE1_HARNESS_RESULTS_2026-08-14.md`, which reported the approved design as a FAIL.
Local PG16 harness, **1,000,000 posts** · 800k public · 45k profiles · 471k events · 165.6k
friendships. **No production write.**

---

## Option A — bounded candidates *plus* a uniform random slice of the whole corpus

```
candidates =
    500 newest public
  + N   sampled uniformly from the ENTIRE public corpus   ← restores reach
  + 100 own
  + 200 friends' (friend ids resolved once, MATERIALIZED)
```

The sample uses an indexed `rand_key double precision` column with a partial index
`(rand_key) WHERE is_public`, and a seed-derived start point:
`WHERE rand_key >= hash(seed) ORDER BY rand_key LIMIT N`.

Chosen over the alternatives for measured reasons: `ORDER BY random()` sorts the whole table,
and `TABLESAMPLE` samples *pages*, so it clusters by physical layout rather than sampling
uniformly.

## Performance at 1M posts

| variant | buffers | ms |
|---|---:|---:|
| Production shape today | 4,836,645 | **9,489** (+ 148 MB disk spill) |
| Phase 1 as approved | — | 941 @100k — **FAILED gate** |
| **Option A, sample = 200** | ~854 | **3.8** |
| Option A, sample = 500 | ~1,155 | 6.2 |
| Option A, sample = 1000 | ~1,656 | 8.1 |
| Option A, sample = 2000 | ~2,659 | 15.2 |

**Against the pre-stated gate (< 50 ms, < 2,000 buffers at 100k): Option A PASSES at 1M, at
every sample size up to 1000.** The threshold was not moved.

## Fairness — measured over 500 simulated sessions

| | |
|---|---|
| Public corpus | 800,000 |
| Slots drawn (500 sessions × 200) | 99,847 |
| **Distinct posts reached** | **92,805 — 11.6% of the corpus** |
| Collision rate | 7% — the sampler is near-uniform |
| **Average age of posts reached** | **215.0 days** |
| **Average age of the corpus** | **214.7 days** |

**No recency bias.** The reached set is statistically indistinguishable in age from the corpus,
which is exactly what the bounded-window design (AFTER-2) destroyed. A photograph from six
months ago is as reachable as one from yesterday.

The analytic model agrees with the measurement — expected distinct after N draws is
`800000·(1−(1−N_sample/800000)^N_sessions)`, predicting 94,000 against 92,805 observed.

## The fairness knob, and its price

Sample size is the dial. Days for a given post to reach a 50% chance of at least one
impression, at 500 feed sessions/day:

| sample | 50%-reach | cost |
|---:|---:|---:|
| 200 | ~5.5 days | 3.8 ms |
| 500 | ~2.2 days | 6.2 ms |
| **1000** | **~1.1 days** | **8.1 ms** |
| 2000 | ~0.6 days | 15.2 ms |

**Recommendation: sample = 1000.** Every public photograph gets a better-than-even chance of
being surfaced to someone within roughly a day, and the feed still answers in ~8 ms at 1M
posts — three orders of magnitude better than today's 9.5 s.

Note the dial should scale with corpus size, not stay fixed: reach time is
`corpus / (sample × sessions_per_day)`. At 100k posts, sample 1000 gives ~0.14 days; at 10M it
would give ~11 days. Make it a function of `count(*) WHERE is_public`, revisited when the
corpus grows an order of magnitude.

## What this does NOT cover

- Ranking properties R1–R7 are **not yet run** — no duplicate/omission proof, no fairness
  correlation against today's `random()`, no run under concurrent writes. The candidate pool
  changes what R1 even means, so those tests must be written against this design, not the old
  one.
- `viewer_count` is a static column here. In production it needs the trigger, and R7 (bucket
  stability under live updates) is unproven.
- The 500/1000/100/200 caps are round numbers chosen to demonstrate the shape. They should be
  set from real slot and traffic figures before shipping.
- Nothing has been written for production. Newest applied migration is still
  `20260814042609`.

## Decision needed

Adopt Option A with sample = 1000 as the Phase 1 design? If yes, the next cycle is: write
R1–R7 against this shape, run them on the harness including under concurrent writes, then draft
the migration and rollback for review.
