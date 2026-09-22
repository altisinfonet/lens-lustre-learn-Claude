# Phase 2 — delta-2 cycles D1–D3 (measure, pre-flight, dry run) + D4 BLOCKED

**Date:** 2026-08-19 15:38–15:58 UTC

| cycle | result |
|---|---|
| D1 — re-measure the delta at a fresh fence | **DONE** |
| D2 — pre-flight on the new cumulative manifest | **DONE** |
| D3 — dry run, 8 pages | **DONE, PASS** |
| D4 — real migration | **BLOCKED — HTTP 401 on page 1, zero writes** |

## D1 — measurement

Fresh execution fence **`2026-08-19 15:38:02.195291+00`**. Live population 228 items / 197 posts, digest `eff23edc6ede73221fd0a1b3aee6a275`. Delta vs the frozen 14:31:54 fence: **2 items / 2 posts / 2 owners**, at global candidate indices 33 and 53.

Measured with `measure-post-media` through its own `(offset, limit)` contract — two windows of one, 548,946 bytes read, `read_only: true`, `total_candidates: 228`, `ok: true` on both.

**Delta-2 manifest**
```
rows 2 · bytes 862
sha256   8b455f5f13b4d5708303d3b72d1b3b1a6b2373913255980758a046e373ef3a06
cand-md5 237be0436a5d96d3dc005236e4904ea9
objects  548,946 bytes
```

**Cumulative-228 manifest** (the form the engine requires)
```
rows 228 · posts 197 · distinct owner|sha256 228 · file 95,038 bytes
sha256    dc7243e4328b5beb7345df6378ce9850f6a3908559b78d81d92ad5d8530e9801
cand-md5  eff23edc6ede73221fd0a1b3aee6a275   ← equals the live digest at the fresh fence
expected final ref_set_md5  73d4dea406d3c37b67a23f583820b837
objects   128,477,108 bytes
```

Containment, proved: the 226 rows are present **verbatim** (226/226); cumulative == 226 ∪ 2 exactly; overlap on post_id, object_path and owner|sha256 all **0**. Both manifests parse through the **shipped** `manifestPlan.ts` with **no refusal**.

The 226 manifest and the 14:31:54 fence were **not modified**.

## D2 — pre-flight

```
fence at 15:38:02   eff23edc6ede73221fd0a1b3aee6a275, 228 / 197   ✓
production          226 / 226, all six anomaly counters 0, ref_set_md5 d243b755…   ✓
prior frozen fence  46c4cad2…, 226 / 195  unchanged   ✓
delta-2 already referenced   0   ✓
manifest hash verified in-page before arming   ✓
```

## D3 — dry run, 8 pages, PASS

| offset | posts | slides | would-migrate | would-verify | ms |
|---|---|---|---|---|---|
| 0 | 25 | 29 | 0 | 25 | 11,843 |
| 25 | 25 | 37 | **2** | 23 | 17,001 |
| 50 | 25 | 27 | 0 | 25 | 5,227 |
| 75 | 25 | 26 | 0 | 25 | 6,559 |
| 100 | 25 | 30 | 0 | 25 | 8,523 |
| 125 | 25 | 26 | 0 | 25 | 4,846 |
| 150 | 25 | 29 | 0 | 25 | 4,956 |
| 175 | **22** | 24 | 0 | 22 | 10,513 |
| | **197** | **228** | **2** | **195** | |

26 invariants per page, all pass. `production_writes: 0` ×8. 128,477,108 bytes read.

## D4 — BLOCKED

Page 1 (offset 0) returned **HTTP 401** after 6.6 s. The driver stopped immediately and did not retry.

**Cause:** the browser session access token expired between arming and execution. The gateway rejected the request; the function never ran.

**Effect on production: none.**

```
verified 15:58:10 UTC
post_media_rows 226   media_objects_rows 226
ref_set_md5 d243b755b3f5b8a76ba0cc8454c130d3   (the 226 state, unchanged)
all six anomaly counters 0 · posts with references 195
newest media_objects row  2026-08-19 15:24:07+00   ← the previous cycle, nothing since
references on delta-2 posts  0
fence at 15:38:02  eff23edc…, 228/197  unchanged
```

Zero writes. Zero partial state. The 226 migration is intact and the 2 delta photographs are still unmigrated.

## Drift during the cycle

**1 further photograph** arrived after the 15:38:02 fence (noticed at 15:49). Per instruction it was **not** silently included — the fence excludes it, and it belongs to the next delta cycle. Its arrival does not invalidate the current manifest: the digest at the 15:38:02 fence is still `eff23edc…`.

## Next required approval

Re-run D4 unchanged — same manifest `dc7243e4…`, same fence `15:38:02.195291+00`, same 8 offsets — after re-reading a fresh session token. Nothing else changes. Explicit approval required because the standing rule is "stop on the first unexpected result, no automatic retry".
