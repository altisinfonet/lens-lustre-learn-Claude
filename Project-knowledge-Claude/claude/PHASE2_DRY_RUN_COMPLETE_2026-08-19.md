# Phase 2 — Complete dry run of `migrate-post-media` (8 pages)

**Date:** 2026-08-19 · **STATUS: PASS — all 8 pages, zero production writes. Migration NOT executed.**

## Local pre-verification of the approved manifest

| check | result |
|---|---|
| SHA-256 | `6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84` MATCH |
| bytes | 86,055 |
| rows | 207 |
| distinct posts | 180 |
| distinct owners | 48 |
| columns per row | 13, uniformly |
| candidate-set digest recomputed from the file | `f0a74d3e74d8a52f61de92a2e0ab429a` MATCH |
| live production fence, read-only | `f0a74d3e74d8a52f61de92a2e0ab429a`, 207 / 180 MATCH |

Summing the manifest's own byte column gives **119,717,670 bytes**, exactly the figure recorded in `docs/MANIFEST_PROVENANCE.md` from Cycle 4. The dry run then read **119,717,670 bytes** — identical.

## How it was run without touching the credential

`migrate-post-media` requires an admin session JWT. The owner's boundary was: the token must never be extracted, printed, stored, or transmitted.

Method used:
1. A `<input type=file>` was created in the owner's already-signed-in tab.
2. The manifest was pushed into that input from the session's outputs folder — **from disk to the page, with no transcription step**. 207 rows of random hex and UUIDs must never pass through a retyping step; one wrong digit would have tripped MIG-1003.
3. The page hashed the file itself and refused to proceed unless it equalled the approved SHA-256.
4. The driver read the session token into one local variable inside the page, attached it as a request header, and returned only invariant results. **The token never entered the assistant's context, was never printed, and never left the browser except as a header to the owner's own Supabase project.**
5. Afterwards the input element, the manifest string and the result object were all deleted from the page.

A capability probe first confirmed, without returning any credential, that the signed-in account holds the `admin` role (there is exactly 1 admin account on the project).

## The 8 pages

Post/slide counts per page were **predicted locally from the manifest** before the run (the function slices by sorted `post_id`), then asserted. Every page matched its prediction exactly.

| offset | posts | slides | MiB read | ms | failures |
|---|---|---|---|---|---|
| 0 | 25 | 31 | 21.5 | 22,675 | none |
| 25 | 25 | 31 | 13.9 | 15,356 | none |
| 50 | 25 | 27 | 14.2 | 16,677 | none |
| 75 | 25 | 26 | 22.5 | 14,043 | none |
| 100 | 25 | 31 | 13.9 | 17,304 | none |
| 125 | 25 | 25 | 9.3 | 14,746 | none |
| 150 | 25 | 30 | 17.0 | 12,492 | none |
| 175 | **5** | **6** | 1.8 | 5,106 | none |
| **total** | **180** | **207** | **114.2** | **118 s** | **0** |

23 invariants were asserted per page, 184 assertions in total, all pass:

```
dry_run              true    on all 8 pages
production_writes    0       on all 8 pages
migrated             0       on all 8 pages
skipped              0       on all 8 pages
refused              0       on all 8 pages
manifest_sha256      6f91b572…4673c84   on all 8 pages
manifest_items       207     on all 8 pages
manifest_posts       180     on all 8 pages
fence echoed         2026-08-17 10:52:06.533572+00
fence key_set_md5    f0a74d3e74d8a52f61de92a2e0ab429a   on all 8 pages
fence counts         207 / 180                          on all 8 pages
reconciliation_check null    on all 8 pages  (correct — a dry run has no end state to reconcile)
media_objects        0       on all 8 pages
post_media           0       on all 8 pages
deferred-time-budget 0       on all 8 pages
finished             false ×7, true on offset 175
result values        "would-migrate" — the ONLY value returned, 180 times
HTTP                 200     on all 8 pages
```

`deferred-time-budget` was asserted zero on every page specifically because fixed offsets plus a time-budget deferral would silently skip posts. The two heaviest pages (0 at 21.5 MiB, 75 at 22.5 MiB) finished in 23 s and 14 s against a 110 s budget.

## Production after the dry run — unchanged

```
media_objects        : 0
post_media           : 0
posts                : 251   (251 with images)
posts max updated_at : 2026-08-19 11:50:36+00   — BEFORE the run began (12:37+)
live fence           : f0a74d3e74d8a52f61de92a2e0ab429a, 207 / 180
ledger rows          : 21
```

No post row was written or updated by the dry run. No grants issued. No storage or CDN change.

## The 18 post-fence photographs

Untouched, and not reachable by this run: they sit outside the fence, are absent from the manifest, and `MIG-1040` compares the live fenced key set to the manifest as a **set** — had any of them been inside, every page would have refused. They require their own delta cycle with a freshly measured manifest, and that count must be re-measured at the time.

## What the dry run does NOT prove

The reference-set digest `326834efcf11c7620634f4cbda821bc4` cannot be checked by a dry run — `reconciliation_check` is `null` unless `!dry_run && finished`, by design, because there are no references to compare until the real run. It was verified independently against the manifest on 2026-08-19.

## Next decision — separate GO required

The real migration: same 8 offsets with `dry_run = false`. Expected end state: `post_media_rows = 207`, `ref_set_md5 = 326834efcf11c7620634f4cbda821bc4`, 0 orphans, 0 non-ready, and `reconciliation_check.ok = true` on the final page.

**The dry run is not approval for that.** `dry_run = false` remains unused.
