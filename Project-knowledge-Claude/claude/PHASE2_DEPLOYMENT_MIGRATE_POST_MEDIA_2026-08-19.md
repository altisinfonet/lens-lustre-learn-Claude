# Phase 2 — Control Cycle: deployment of `migrate-post-media` (deployment only)

**Date:** 2026-08-19 · **STATUS: COMPLETE — deployed and verified. Migration NOT executed.**

## What was deployed

| | |
|---|---|
| function | `migrate-post-media` |
| version | **1** |
| status | ACTIVE |
| id | `4844f23a-e7aa-417a-a2b0-b725773d4091` |
| `verify_jwt` | **true** |
| entrypoint | `migrate-post-media/index.ts` |
| bundle `ezbr_sha256` | `28db46a90897c80261ba8065bf3a9841a97f4299a18d4fd7d4a4f87797dae93d` |
| repo state at deploy | `d6d24b800863063d2980a2bf7637e8b5707b2211` |

## Deployed artifact == approved artifact

Fetched back from production with `get_edge_function`, written to disk, hashed, and `diff`ed against the repo copies:

| file | sha256 (deployed) | vs approved | `diff` |
|---|---|---|---|
| `migrate-post-media/index.ts` | `3a7b399a96d2b7bce03f686c94e69436b5bede7305c52654bb30e8968f4951ff` | MATCH | identical |
| `_shared/manifestPlan.ts` | `caa400615ccc5c4d4bc8d621dd0a39f489ef067241d5c2a4e6cd9ef6c17d5281` | MATCH | identical |
| `_shared/imageDims.ts` | `29499a56d639e715034a45e6ced172b648f6237345f857b9439d7ade3c4eb4b5` | MATCH | identical |

**Combined digest of the deployed set: `6a0d8d73521973b193c139cc8872dd76e5e655fa803b5cd5df23c7e71264dbab`** — equal to the approved combined digest.

Three files deployed, exactly the approved three. No other function was touched.

## Production after deployment

```
media_objects        : 0
post_media           : 0
ledger rows          : 21
duplicate versions   : 0
fence digest         : f0a74d3e74d8a52f61de92a2e0ab429a  (207 items / 180 posts) — unchanged
```

Repo working tree clean at `d6d24b8`; none of the three source files were modified.

## Not done in this cycle

Migration not executed. No invocation of any kind — not even a dry run. No client grants. No storage/CDN/post-data change. No Phase 1 cleanup.

## Documentation drift — recorded, not acted on

`docs/MANIFEST_PROVENANCE.md` states the post-fence delta is **1 photograph**. Measured 2026-08-19 it is **18** (live population 225; 207 inside the fence). The approved manifest and the fence are deliberately **left unchanged** — the 18 are outside the frozen set and belong to a separate, separately-approved delta cycle. Re-measure that number at the moment the delta cycle runs; do not read it from the doc.

## Next decision (separate approval required)

GO for the **dry run only**: `dry_run = true`, `approved_hash = 6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84`, `fence = 2026-08-17 10:52:06.533572+00`, `max_posts = 25`, `offset = 0`. Expected: `production_writes: 0`.

## Rollback

`supabase/rollback/20260818011014_media_migration_engine_ROLLBACK.sql` (hash `36941f731eb164cdd8813d724aa5edf4ec198fd8`) drops the three engine functions and touches no data. The edge function itself can be removed from the Supabase dashboard; while it exists it can write nothing without an admin JWT **and** `dry_run: false`.
