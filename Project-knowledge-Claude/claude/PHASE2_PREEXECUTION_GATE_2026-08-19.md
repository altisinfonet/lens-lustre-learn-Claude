# Phase 2 — Final pre-execution gate (read-only)

**Checked:** 2026-08-19 13:02 UTC · **Verdict: READY FOR HASH-BOUND GO — REAL MIGRATION NOT YET EXECUTED.**

Nothing was modified: no code, manifest, fence, schema, grants, or deployment. `dry_run=false` was not used.

| # | Check | Result |
|---|---|---|
| 1 | Deployed artifact still as approved | `migrate-post-media` **version 1** (never redeployed), ACTIVE, `verify_jwt: true`, bundle `ezbr_sha256 = 28db46a90897c80261ba8065bf3a9841a97f4299a18d4fd7d4a4f87797dae93d` — identical to the value recorded at deployment. Repo sources unchanged: `3a7b399a…`, `caa40061…`, `29499a56…`, combined `6a0d8d73521973b193c139cc8872dd76e5e655fa803b5cd5df23c7e71264dbab`. Working tree clean at `d6d24b8`. |
| 2 | Manifest | `6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84`, 86,055 bytes, **207 rows / 180 posts** |
| 3 | Frozen fence digest | `f0a74d3e74d8a52f61de92a2e0ab429a`, 207 items / 180 posts — live, re-read now |
| 4 | Pre-execution counts | `media_objects = 0`, `post_media = 0` |
| 5 | No prior/partial execution | `post_media = 0`, `media_objects = 0`, `non_ready_media = 0`, `unreferenced_media = 0`, `refs_to_non_ready = 0`, `refs_with_owner_mismatch = 0`, `posts_with_gapped_ords = 0`, `ref_set_md5 = null`. Function version 1 = first deploy; every prior invocation was `dry_run: true` with `production_writes: 0`. |
| 6 | Post-fence photographs excluded | **19** items now sit after the fence (was 18 this morning, 1 in the doc). The fence digest is still `f0a74d3e…` at 207/180, so none is inside the frozen set. `MIG-1040` refuses the whole run if the live fenced set differs from the manifest. |
| 7 | `dry_run=false` not executed | Confirmed — this check ran no invocation at all |
| 8 | Execution pages | 180 ÷ 25 = **8**: `0, 25, 50, 75, 100, 125, 150, 175` |
| 9 | Expected final reconciliation | below |

## Expected end state, derived from the manifest

```
post_media_rows          207
media_objects_rows       207     (distinct owner|sha256 = 207; zero cross-post
                                  content sharing, so no UNIQUE collapse)
ref_set_md5              326834efcf11c7620634f4cbda821bc4
unreferenced_media       0
non_ready_media          0
refs_to_non_ready        0
refs_with_owner_mismatch 0
posts_with_gapped_ords   0
reconciliation_check.ok  true    (only on the final page, offset 175)
```

Per-page expectation, computed from the manifest by sorted `post_id`:

| offset | posts | slides |
|---|---|---|
| 0 | 25 | 31 |
| 25 | 25 | 31 |
| 50 | 25 | 27 |
| 75 | 25 | 26 |
| 100 | 25 | 31 |
| 125 | 25 | 25 |
| 150 | 25 | 30 |
| 175 | 5 | 6 |

Every page must report `refused: 0`, `skipped: 0`, `deferred-time-budget: 0`, `manifest_sha256 = 6f91b572…`, `fence_live = f0a74d3e… / 207 / 180`. Cumulative `migrated` must reach 180.

## Drift to note, not to act on

The post-fence delta is **19** and grows daily. The approved manifest and fence stay frozen; the delta is a separate cycle with a newly measured manifest, and the count must be re-measured at that time.

## Rollback

`supabase/rollback/20260818011014_media_migration_engine_ROLLBACK.sql` (`36941f731eb164cdd8813d724aa5edf4ec198fd8`) drops the three engine functions and deletes no data. Note it does **not** remove rows written by a completed migration — that would be its own deliberate decision.
