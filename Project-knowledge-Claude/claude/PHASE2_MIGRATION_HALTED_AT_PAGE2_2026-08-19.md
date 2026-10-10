# Phase 2 — Real migration STARTED and HALTED at page 2 of 8

**Date:** 2026-08-19 13:15–13:17 UTC · **STATUS: HALTED. 1 of 8 pages committed. State is clean and provably exact.**

## What happened

| page | offset | result |
|---|---|---|
| 1 | 0 | **COMMITTED** — 25 posts, 31 references, 31 media rows, 18.6 s, all 24 invariants pass |
| 2 | 25 | **HTTP 503 — request never reached the function.** Run stopped. No retry. |
| 3–8 | 50…175 | not attempted |

The driver halted on the first failure exactly as instructed: no retry, no skip, no repair, no improvisation.

## The 503 was infrastructure, not the migration

```
13:15:15.765  POST | 503 | .../functions/v1/migrate-post-media   exec 131 ms   function_id = (empty)
```

131 ms with **no `function_id`** means the request was rejected at the platform edge and never entered the function worker. Nothing in the manifest, the fence, the engine or the data was involved. The most likely cause is the worker still recycling from page 1 (18.6 s, 21.5 MiB read) with no gap between pages.

## The committed state is provably exactly page 1

```
post_media_rows          31
media_objects_rows       31   (all state='ready')
posts_with_references    25
unreferenced_media        0
non_ready_media           0
refs_to_non_ready         0
refs_with_owner_mismatch  0
posts_with_gapped_ords    0
ref_set_md5              b14617fcb3f8093f7f860dfb8218d076
rows written             13:15:00.710 → 13:15:14.419 (page 1 only)
```

The reference-set digest computed **locally from the manifest for the first 25 sorted post_ids** is `b14617fcb3f8093f7f860dfb8218d076` — **identical** to the live database digest. So the database holds exactly the approved page-1 slice: not a row more, not a row fewer, not a row different. Page 2 wrote nothing.

## Why resuming is safe (but was NOT done)

`media_migrate_post` is per-post transactional and idempotent. Re-running offset 25 touches only posts 26–50, which have no references. Even re-running offset 0 would be safe: a post that already has references is re-measured and compared row-for-row against the manifest, returning `verified-skip` or refusing (MIG-2020 / MIG-2021) — it never blindly skips and never double-writes.

**Nothing was resumed. That needs a separate GO.**

## Recommendation for the resume cycle

Resume at offsets `25, 50, 75, 100, 125, 150, 175` — **with a pause between pages** (20–30 s) so the worker is not asked to boot while the previous invocation is still winding down. Page 1's numbers stay as they are; expected cumulative totals are unchanged: 207 references, 207 media rows, final `ref_set_md5 = 326834efcf11c7620634f4cbda821bc4`.

If a page 503s again, the same halt applies.

## Untouched

Manifest, fence, code, schema, grants, deployment: unchanged. The 19 post-fence photographs: untouched and outside the frozen set. No Phase 3 work.
