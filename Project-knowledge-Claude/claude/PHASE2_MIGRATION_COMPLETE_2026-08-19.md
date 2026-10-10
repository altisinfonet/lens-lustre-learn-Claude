# Phase 2 — THE 207-PHOTOGRAPH MIGRATION IS COMPLETE

**Date:** 2026-08-19 · **STATUS: COMPLETE. All 8 pages. Reconciliation green. Zero anomalies.**

## Result

```
post_media_rows          207
media_objects_rows       207   (all state = 'ready')
posts with references    180
ref_set_md5              326834efcf11c7620634f4cbda821bc4   ← equals the approved value
unreferenced_media         0
non_ready_media            0
refs_to_non_ready          0
refs_with_owner_mismatch   0
posts_with_gapped_ords     0
reconciliation_check.ok  true    failures: []
```

Independently re-verified against the database at 13:39:43 UTC, after the run, with checks the engine does not itself perform:

```
duplicate (owner_id, sha256)          0
duplicate (post_id, ord)              0
media rows missing an object path     0
references on post-fence posts        0   ← the 19 got nothing
live fence digest                     f0a74d3e74d8a52f61de92a2e0ab429a, 207 / 180 (unchanged)
```

## The 8 pages

Page 1 ran in the first cycle and halted the run when page 2 returned an infrastructure 503 (see `PHASE2_MIGRATION_HALTED_AT_PAGE2_2026-08-19.md`). The resume cycle ran offsets 25–175 with a 30-second pause between pages.

| page | offset | posts | slides | cumulative refs | ms | invariants |
|---|---|---|---|---|---|---|
| 1 | 0 | 25 | 31 | 31 | 18,602 | all pass |
| 2 | 25 | 25 | 31 | 62 | 16,362 | all pass |
| 3 | 50 | 25 | 27 | 89 | 15,537 | all pass |
| 4 | 75 | 25 | 26 | 115 | 68,123 | all pass |
| 5 | 100 | 25 | 31 | 146 | 30,992 | all pass |
| 6 | 125 | 25 | 25 | 171 | 11,453 | all pass |
| 7 | 150 | 25 | 30 | 201 | 30,515 | all pass |
| 8 | 175 | **5** | **6** | **207** | 4,630 | all pass + final reconciliation |
| | | **180** | **207** | | | |

Every page was checked against **26 invariants** (29 on the final page) before the next was allowed to start:
`http=200`, `dry_run=false`, `refused=0`, `skipped=0`, `migrated` = the page's expected post count, `production_writes` = same, every result row literally `"migrated"`, slides written = the page's expected slide count, `manifest_sha256 = 6f91b572…`, `manifest_items=207`, `manifest_posts=180`, fence echoed, `fence key_set_md5 = f0a74d3e…`, fence 207/180, offset echoed, `max_posts=25`, `finished` false except on 175, cumulative `post_media` and `media_objects` equal to the value predicted from the manifest, and orphans / non-ready / refs-to-non-ready / owner-mismatch / ordinal-gaps all zero.

Per-page post and slide counts were **predicted from the manifest before the run** (the function slices by sorted `post_id`) and asserted. Not one page deviated.

Page 4 (offset 75) took 68 s against the 110 s budget — the heaviest page at 22.5 MiB. It did not defer.

## Why the numbers are what they are

`media_objects = 207`, equal to `post_media`, because the manifest contains **zero** cases of one owner presenting the same bytes in more than one post. `UNIQUE (owner_id, sha256)` therefore collapsed nothing. This was computed from the manifest in the pre-execution gate and matched exactly.

## Not touched

- Manifest, fence, code, schema, grants, deployment: unchanged
- `posts.image_urls`: never written by the engine, by construction
- Storage and CDN: untouched
- The **19 post-fence photographs**: zero references, confirmed by direct query
- No Phase 3 work started
- No client grants issued — `anon` and `authenticated` still have no privilege on `media_objects` or `post_media`

## Method note

Run from the owner's own signed-in browser. The manifest was loaded from disk into a file input — never retyped. The session token was used in place inside the page and never printed, stored, or returned. The tab was disarmed afterwards: input, manifest and run state all removed.

## Open, and needing its own cycle

1. **The delta.** 19 photographs now sit after the frozen fence and the number grows daily. They need a newly measured manifest, measured the same way, approved separately.
2. **The client switch.** `anon`/`authenticated` still cannot read `media_objects` or `post_media`. Until a reviewed, column-scoped grant exists (sha256 must stay server-side), the app still reads `posts.image_urls`. The migration made the new tables correct; it did not make anything use them.
3. **Remove `measure-post-media`**, the temporary Cycle-4 measurement function.
4. **The stale header comments** in the applied migration and rollback files, deliberately left to preserve their hashes.
