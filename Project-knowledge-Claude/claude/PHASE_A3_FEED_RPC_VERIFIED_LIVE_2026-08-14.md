# PHASE A ITEM 3 — CLEARED: the feed RPC verified live, end to end

**Date:** 2026-08-14 · read-only, no production write · `VERDICT: READY`

This was the oldest open debt in the program. The candidate-pool rewrite shipped
as `20260814074922` and **two further cycles were built on top of it** without it
ever being exercised outside a local harness.

---

## Result: PASS on function, FAIL on half the cost gate

| | Measured | Pre-stated gate | |
|---|---|---|---|
| Latency | **18.804 ms** | < 50 ms | **PASS** |
| Buffers | **2,359** | < 2,000 | **FAIL — 18% over** |

Reported as measured. **The threshold is not moved.**

For scale: the design this replaced measured `941 ms` / `207,112` buffers. So
this is roughly 50× faster and 88× cheaper — and still misses the buffer line I
wrote down beforehand. Both facts are true and both belong in the record.

### The honest caveat

`feed_candidates()` alone is `6.326 ms` / `1,406` buffers returning **210 rows**
— 60% of the total buffers. Production has 210 posts, so **the "bounded pool" is
currently the entire corpus.** The cap that makes this design scale has not been
exercised by real data at all; only by the seeded 100k/1M harness. That is the
real caveat on this result, and it is why Phase D still needs the scale re-run.

---

## What was verified

### Over PostgREST, with the public anon key — exactly what the app sends

| Check | Result |
|---|---|
| HTTP | `200`, 9,530 bytes, 10 rows |
| Contract | **15 columns**, exact names incl. `feed_tier`, `author_name`, `author_avatar`, `thumbnail_urls`, `categories` |
| Tier mix | `newest=3`, `unseen=7` |
| Privacy | `public` ×10 — **no non-public post leaked** |
| Author identity | `author_name` 10/10 · `author_avatar` 10/10 (migration `20260813171159` working end to end) |
| Media fields | `image_urls` 10/10 · `thumbnail_urls` 10/10 · `categories` 3/10 |
| Hash containment | no hash column on the wire; no 64-hex-looking value anywhere in the payload |
| Legacy overloads | 3-arg and 2-arg forms both return 15 cols — **no shipped Android build stranded** |
| `_categories` filter | `['street']` → 1 row |
| `_exclude_ids` | excluded id absent from the result |
| **Determinism** | 4 identical calls, same viewer, same hour → identical id-sequence hash `b909fcd12a37` and identical tier sequence |

### In a real browser, on the owner's Windows machine

`https://www.50mmretina.com/feed` — feed renders correctly. Photos, author
names, avatars, reaction and comment counts all display.

- `get_broadcast_feed` called **exactly once**, `200`
- **24 of 24** `cdn.50mmretina.com` requests returned `200` — avatars, post
  images, journal, course and ad images
- **Trap #1 has not recurred.** The `/cdn-cgi/image/` apex breakage that killed
  every photo for four days is not present; zone rules are behaving.

---

## A check of mine misfired, and it is recorded

My hash-containment test used a substring match for `'sha'` and printed **FAIL**
— because `shares_count` contains `sha`. A false positive in my own test, not a
finding. Re-checked by exact column name and by scanning every string value for
a 64-hex pattern: nothing leaks.

Worth keeping because it is the same shape as the vacuous checks caught in B1
(W11) and B2 (W16): the test was wrong in a direction that would have wasted an
investigation rather than hidden a defect — but a substring match that loose
could equally have hidden one.

---

## Where this leaves the program

```
phase: B          state: DEPLOYED
db_migration: 20260814104119
next_action: PHASE_B3_DESIGN
```

**Open debts, updated:**

1. ~~Phase A item 3 — feed RPC never verified live~~ → **CLEARED**
2. **Buffer gate missed by 18%** at 210 posts. Not a regression — a target set
   before the work and not quite met. Belongs in Phase D alongside keyset
   pagination and the 100k/1M scale re-run, where the bounded pool will actually
   bite and the number will change anyway.
3. **Phase A item 7** — unfiltered realtime bindings on the four busiest tables.
   Still blocked on Broadcast-from-trigger vs accept-and-document.
4. **Phase B3** — derivative worker, R2 storage layout, EXIF/GPS stripping.
   Nothing writes bytes yet; `posts.image_urls` remains authoritative and both
   media tables are empty by design.
5. **Transport** — 31 unpushed commits; push blocked by a per-repo allowlist
   that must be changed outside this session.
