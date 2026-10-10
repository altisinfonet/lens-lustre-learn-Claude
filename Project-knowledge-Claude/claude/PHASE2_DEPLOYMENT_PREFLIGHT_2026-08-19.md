# Phase 2 — Deployment / execution pre-flight (12 checks)

**Date:** 2026-08-19 · **Cycle:** pre-flight only — nothing deployed, nothing executed, production unchanged.
**Repo state:** `origin/main` = `d6d24b800863063d2980a2bf7637e8b5707b2211`, working tree clean.

## Result: 12 of 12 pass. One documentation drift found (below).

| # | Check | Result |
|---|---|---|
| 1 | `origin/main` == `d6d24b8…` | **PASS** — local HEAD == origin/main == `d6d24b800863063d2980a2bf7637e8b5707b2211`, tree clean |
| 2 | Engine functions exist in production and match the artifact | **PASS** — all 3 bodies byte-identical (md5 + char count) |
| 3 | `media_objects = 0`, `post_media = 0` | **PASS** — 0 / 0 |
| 4 | Manifest SHA | **PASS** — `6f91b572…4673c84`, 86,055 bytes, 207 rows, 180 posts |
| 5 | Fence + candidate-set digest unchanged | **PASS** — live digest at the approved fence = `f0a74d3e74d8a52f61de92a2e0ab429a`, item_count 207, post_count 180 |
| 6 | New photographs outside the frozen set | **PASS** — but the count has moved: see drift below |
| 7 | All artifact hashes vs `origin/main` | **PASS** — worktree == origin/main for every migration, rollback and function file |
| 8 | `migrate-post-media` still not deployed | **PASS** — absent from the live edge-function list; absent from `supabase/config.toml` |
| 9 | Deployment artifact reviewed vs approved source | **PASS** — 3 files, hashes below |
| 10 | Production authorization boundary | **PASS** — see table below |
| 11 | Cannot operate outside the 207-item manifest | **PASS** — 7 independent gates, see below |
| 12 | Rollback availability + hash | **PASS** — `36941f731eb164cdd8813d724aa5edf4ec198fd8` |

## Function-body proof (check 2)

| function | chars | md5 in production | md5 in the artifact |
|---|---|---|---|
| `media_migration_fence_digest` | 543 | `bd6c7bc1dfff2710629f9eabebfacbc6` | same |
| `media_migrate_post` | 8212 | `0b5f94797c1f2cd2ad285a8dddd2d0cd` | same |
| `media_migration_reconcile` | 1873 | `7d86143364b044a367c4d07375a2144a` | same |

All three: `SECURITY DEFINER`, `search_path=public`, correct volatility (`s`/`v`/`s`).

## Authorization boundary (check 10)

| | anon | authenticated | service_role |
|---|---|---|---|
| EXECUTE all 3 engine functions | **no** | **no** | yes |
| `media_objects` SELECT/INSERT/UPDATE/DELETE | **no** | **no** | yes |
| `post_media` SELECT/INSERT/UPDATE/DELETE | **no** | **no** | yes |

ACL on each function is exactly `postgres=X/postgres ; service_role=X/postgres`. RLS enabled on both tables (2 and 3 policies). No client role gains anything from this cycle.

Edge-function boundary: `Bearer` header required → `auth.getUser()` must resolve → row in `user_roles` with `role='admin'` required → otherwise 401/403. Service-role key is only used *after* that gate.

## Manifest-bounding (check 11) — seven gates, any one refuses

1. `MIG-1003` — manifest SHA-256 must equal the approved value, checked **before a single row is parsed**
2. `MIG-1010…1030` — 21 structural refusals during parse (columns, uuids, host, path traversal, owner-folder, ranges, mime, duplicates, dense ordinals)
3. `MIG-1040` — live fenced key set must equal the manifest key set as a **SET** (md5 over `post_id|ord|url`), computed in the database
4. `MIG-1041` — digests equal but counts differ → refuse anyway
5. **No population scan exists in the file** — `grep` confirms no `posts` query; the work list can only be the manifest
6. `MIG-1060…1067` — every object re-fetched and re-measured; SHA-256, bytes, mime, width, height must each equal the manifest
7. `MIG-2001…2021` — in-database, in-transaction: post must exist, owner must be the real author, object path must sit in the owner's folder, existing references compared row-for-row

Bounded by construction: `HARD_MAX_POSTS = 25` (a caller cannot raise it), `dry_run` defaults to **true**, 110 s time budget, 25 MB per-object cap.

Independently verified today: all 207 manifest rows have `object_path` segment 2 == `owner_id`, and all 207 `source_url` values match the fence regex the SQL uses.

## The exact deployment artifact

| file | bytes | sha256 | git blob |
|---|---|---|---|
| `supabase/functions/migrate-post-media/index.ts` | 12,463 | `3a7b399a96d2b7bce03f686c94e69436b5bede7305c52654bb30e8968f4951ff` | `3b82c61d61a830b6f679789e3407c2f7588c5136` |
| `supabase/functions/_shared/manifestPlan.ts` | 20,117 | `caa400615ccc5c4d4bc8d621dd0a39f489ef067241d5c2a4e6cd9ef6c17d5281` | `71975b8cd3eec38e080031861bcf24e62a2d7bbe` |
| `supabase/functions/_shared/imageDims.ts` | 5,156 | `29499a56d639e715034a45e6ced172b648f6237345f857b9439d7ade3c4eb4b5` | `bc5938b0fa55fd6ae80c9db5405e9730eb7a5aaa` |

**Combined artifact digest** (sha256 of the three `sha256sum` lines, path-sorted):
`6a0d8d73521973b193c139cc8872dd76e5e655fa803b5cd5df23c7e71264dbab`

## ⚠ Drift found — the documentation understates it

`docs/MANIFEST_PROVENANCE.md` records: *"As of 2026-08-17 the live population is 208 — one photograph arrived at 13:23:31+00, after the fence."*

Measured today, 2026-08-19:

```
live fenced items at the approved fence : 207   (digest matches exactly)
live items with NO fence                : 225
items created AFTER the fence           :  18
first post after the fence              : 2026-08-17 13:23:31.641699+00
```

**This does not affect the migration.** The fence digest still equals the manifest digest exactly, so the frozen 207 are untouched and `MIG-1040` would refuse anything else. What it changes is the *delta*: the follow-on delta manifest is now **18 items, not 1**, and it grows every day the platform is live. That figure should be re-measured immediately before the delta cycle, not read from the doc.

## The exact next operation (after separate GO)

**Step A — deploy only.** Deploy `migrate-post-media` from the three files above, `verify_jwt = true`. Deployment alone writes nothing: `dry_run` defaults to `true`.

**Step B — dry run (still zero production writes).** Invoke with the manifest text, `approved_hash = 6f91b572…4673c84`, `fence = 2026-08-17 10:52:06.533572+00`, `dry_run = true`, `max_posts = 25`, `offset = 0`. Expect `production_writes: 0` and `would-migrate` for every post.

**Step C — the real run, paged.** Same payload with `dry_run = false`, over 8 pages (`offset` = 0, 25, 50, 75, 100, 125, 150, 175) because 180 posts ÷ `HARD_MAX_POSTS` 25 = 8. Final page returns `finished: true` and a `reconciliation_check`, which must show `ref_set_md5 = 326834efcf11c7620634f4cbda821bc4`, `post_media_rows = 207`, and 0 orphans / 0 non-ready.

**Rollback** if needed: `supabase/rollback/20260818011014_media_migration_engine_ROLLBACK.sql` (hash `36941f73…`) — drops the three functions, touches no data.

## Not done in this cycle (by instruction)

No deployment, no execution, no client grants, no Phase 1 cleanup, no comment corrections to the applied migration/rollback files (their hashes are preserved).
