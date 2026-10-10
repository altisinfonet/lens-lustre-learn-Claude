# Phase 1 — R1–R7 run against Option A. **One design decision reversed on evidence.**

Local PG16 harness · 1M posts · 800k public · candidate pool 1,530 (sample = 1000).
**No production write.** Newest applied migration is still `20260814042609`.

---

## Results

| id | Property | Result |
|---|---|---|
| **R1** | Completeness + uniqueness | **PASS** — pool 1,530, returned 1,530 over 153 pages, 0 duplicates, 0 omissions, 0 not-in-pool |
| **R2** | Determinism | **PASS** — two full paginations byte-identical |
| **R3** | Fairness vs today's `random()` | **PASS** — Spearman(bucket, position): today `+0.9231`, new `+0.9192`, **delta 0.0039** against a 0.05 threshold |
| **R4** | Reshuffle across seeds | **PASS** — Kendall τ `−0.0020` on the 530 shared posts, threshold < 0.30 |
| **R5** | Viewer linkability | **DESIGN CONSTRAINT** — see below |
| **R6** | Mid-session insert | **Documented behaviour**, not a defect |
| **R7** | Rank-input stability | **FAILED as designed, then fixed** — see below |
| **R1c** | R1 under concurrent writes | **FAILED adversarially, then PASSED after the fix** |

---

## 1. Two tests initially passed for the wrong reason. Both caught.

**R3 was vacuous on the first run.** The harness gave every post `viewer_count = 3`, so
`viewer_bucket = LEAST(3/5, 40) = 0` for all 1M rows — the test compared two constants and
reported `delta 0.0297 → PASS`. That is trap #14, a test that cannot fail.

Re-seeded with a skewed distribution (`200 · random()³`: min 0, median 25, p90 146, 41 distinct
buckets) and re-ran. The real numbers are far more informative: **both designs correlate at
≈ +0.92**, meaning low-viewer posts genuinely do surface first — and the new deterministic hash
preserves that to within **0.0039**.

**R1c was vacuous on the first run.** The writer mutated 40 random posts out of 800,000 while
the candidate pool was 1,530 — it almost certainly never touched a pool member, and reported
PASS. Re-run with the writer targeting **the pool itself**.

## 2. R1c adversarial — the reversal

```
pool-member updates during pagination = 18,090
returned = 1,532   distinct = 1,530   duplicates = 2   →  FAIL
```

**Coarse bucketing does not protect the cursor.** A post that crosses a bucket boundary after
the cursor has passed it gets a higher score and is returned a second time.

In the Phase 0 design review I chose bucketing over per-session materialisation and wrote:
*"revisit only if bucketing fails R1 under concurrency."* **It has failed. That decision is
reversed.**

## 3. The fix, measured

`viewer_bucket_stable` — a column refreshed **on a cadence by a job**, never by the view
trigger, so it cannot move mid-session. The session seed encodes the refresh epoch, so a new
epoch simply starts a new pagination rather than corrupting the current one.

```
pool-member updates during pagination = 20,100
returned = 1,530   distinct = 1,530   duplicates = 0   omissions = 0   →  PASS
```

Chosen over the alternatives because it costs one column and one scheduled job — no per-session
table, no TTL, no cleanup — while a per-(viewer, seed) materialisation would have cost all
three, and dropping the bucket from the ordering entirely would have destroyed the +0.92
fairness correlation that R3 shows is real.

**Accepted trade:** the fairness signal is as stale as the refresh interval. For "roughly how
many people have seen this", that is immaterial; hourly is ample.

## 4. R5 — a constraint the tests surfaced, not a failure

Two different viewers on the **same seed** receive **identical** scores for all 1,500 shared
posts. That is inherent: the seed is per-session, not per-viewer.

It is not a defect, but it is a rule: **the seed must be generated client-side per session from
a CSPRNG and never derived from anything shared or predictable** — not the date, not a user id,
not a request hash. Otherwise two members could be given the same feed ordering, and one could
infer the other's.

## 5. R6 — stated behaviour

A post created mid-session that sorts before the cursor is not shown until a refresh. This is
inherent to any keyset cursor and is correct. It requires a **"new posts available"** affordance
so it is a visible product behaviour rather than a silent omission.

## 6. What is still not proven

- These tests ran against a **static `rand_key`**. In production `rand_key` is assigned at
  insert; a backfill for 258 existing slides is trivial, but the sampler's uniformity should be
  re-measured on real data.
- `viewer_count` is updated here by direct `UPDATE`. Production needs the trigger, and the
  **refresh job for `viewer_bucket_stable` does not exist yet** — it is now a required
  deliverable, not an optimisation.
- The caps (500 / 1000 / 100 / 200) remain round numbers pending real traffic figures.
- No production migration has been drafted.

## 7. Next

Draft the Phase 1 migration and rollback for review: `is_public` generated + partial index ·
`rand_key` + partial index · `viewer_count` + trigger · `viewer_bucket_stable` + refresh job ·
`get_broadcast_feed` rewritten to the Option A shape with `_seed` and a keyset cursor, all three
overloads, explicit re-GRANT (trap #3).
