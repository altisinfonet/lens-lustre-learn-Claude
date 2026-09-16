# Phase 2 — Cumulative 226 dry run (8 pages) — PASS

**Ran:** 2026-08-19 14:45–14:47 UTC · **STATUS: PASS on all 8 pages. Zero production writes. Real migration NOT executed.**

Manifest `fd2d2432f1cea09899c7c64501b31591241ee1978e3f0dc61488bedb1c1b53d1` · fence `2026-08-19 14:31:54.025005+00` · `dry_run: true` · `max_posts: 25` · 30 s between pages.

## Page by page

| page | offset | posts | slides | would-migrate | would-verify | MiB | ms | invariants |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 25 | 29 | 2 | 23 | 20.9 | 10,065 | all pass |
| 2 | 25 | 25 | 37 | 1 | 24 | 14.5 | 9,085 | all pass |
| 3 | 50 | 25 | 27 | 2 | 23 | 13.1 | 12,666 | all pass |
| 4 | 75 | 25 | 26 | 5 | 20 | 21.3 | 10,225 | all pass |
| 5 | 100 | 25 | 30 | 2 | 23 | 17.9 | 10,582 | all pass |
| 6 | 125 | 25 | 26 | 3 | 22 | 8.8 | 10,270 | all pass |
| 7 | 150 | 25 | 29 | 0 | 25 | 16.4 | 8,260 | all pass |
| 8 | 175 | **20** | 22 | 0 | 20 | 9.1 | 9,405 | all pass |
| | | **195** | **226** | **15** | **180** | **122.0** | **81 s** | |

Every page's post count, slide count, would-migrate count and would-verify count was **predicted from the manifest before the run** and asserted. Not one deviated.

## Expected outcome vs actual

| expected | actual |
|---|---|
| 195 posts | **195** ✓ |
| 226 media references | **226** ✓ |
| 180 existing references verified | **180** `would-verify-existing-references` ✓ |
| 15 new posts to migrate | **15** `would-migrate` ✓ |
| `production_writes = 0` | **0** on all 8 pages ✓ |
| zero refusals | `refused: 0` ×8 ✓ |
| zero skips | `skipped: 0` ×8 ✓ |
| zero deferred pages | `deferred-time-budget: 0` ×8 ✓ |
| final page `finished = true` | true on offset 175, false on the other 7 ✓ |
| `reconciliation_check = null` | null ×8 ✓ |

27 invariants asserted per page, 216 assertions, all pass — including `manifest_sha256 = fd2d2432…` ×8, `manifest_items 226` ×8, `manifest_posts 195` ×8, `fence_live.key_set_md5 = 46c4cad2…` ×8, fence counts 226/195 ×8, and the database counters held at 207/207 on every page.

Objects re-read: **127,928,162 bytes**, exactly the sum of the manifest's own byte column.

## Production — untouched, verified after

```
post_media_rows          207        media_objects_rows       207
unreferenced_media         0        non_ready_media            0
refs_to_non_ready          0        refs_with_owner_mismatch   0
posts_with_gapped_ords     0        ref_set_md5   326834efcf11c7620634f4cbda821bc4
newest media_objects row : 2026-08-19 13:37:32+00   (the 207 migration; nothing since)
posts max updated_at     : 2026-08-19 11:50:36+00   (before any of today's runs)
fence at 14:31:54        : 46c4cad2797a26c4b5613fdff36a4b3a, 226 / 195  unchanged
arrivals since the fence : 0
```

## Method

Run from the owner's signed-in browser. Manifest loaded from disk into a file input — never retyped — and hashed in-page before anything was sent. Session token used in place, never printed, stored or returned. Tab disarmed afterwards.

## Next — separate GO required

Real run: same 8 offsets, `dry_run: false`, same hash and fence, 30 s pauses.
Expected end state: `post_media 226`, `media_objects 226`, `ref_set_md5 = d243b755b3f5b8a76ba0cc8454c130d3`, 0 orphans, 0 non-ready, `reconciliation_check.ok = true` on offset 175, and 180 `verified-skip` + 15 `migrated`.

If any photograph arrives before that run, `MIG-1040` refuses every page and the manifest must be re-measured and re-approved.
