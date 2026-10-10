# PHASE 2 · CONTROL CYCLE 6 — MANIFEST-DRIVEN MIGRATION ENGINE (BUILD AND PROVE)

Date: 2026-08-17 · **PRODUCTION CHANGES: NONE.**
Not deployed · not applied · not executed · no `media_objects` insert · no
`post_media` insert · no post modified · no media uploaded, deleted or replaced ·
no constraint, trigger, index or grant altered.

Production verified after the cycle: ledger `20260817102540`, `media_objects`
**0 rows**, `post_media` **0 rows**, `media_migrate_post` **does not exist**,
migration `20260817170000` **not in the ledger**.

---

## 1. WHAT WAS BUILT

| file | git hash | what it is |
|---|---|---|
| `supabase/functions/_shared/manifestPlan.ts` | `f4a4964f7521aa5866178aca6bc68c8d96d5c078` | the refusals — pure logic, no I/O, runs in Deno and in vitest |
| `supabase/functions/migrate-post-media/index.ts` | `9668c7e4b1ea717a8ea434bd0fda4385bfb3c017` | the orchestrator. **No `config.toml` entry: not deployable by accident** |
| `supabase/migrations/20260817170000_media_migration_engine.sql` | `d3174df5b40c6af696222dd61a69f96c17030b08` | three functions. **NOT APPLIED** |
| `supabase/rollback/20260817170000_..._ROLLBACK.sql` | `36941f731eb164cdd8813d724aa5edf4ec198fd8` | matching rollback |
| `src/__tests__/manifestMigrator.test.ts` | `ef360e1f2f721d5618c140eb8a672554ee8974f8` | 36 tests, all 20 required failure conditions |
| `tools/mutate-migrator.mjs` | `5a2742266cbe0a0e8a73ed859a77a2c02462afab` | 12 mutation probes |

All six **hash-verified against origin**. `origin/main = 8acb9c69f621e64f90de201f44526bac0e7a356e`.

### The model

```
MANIFEST → INTEGRITY → FENCE → BOUNDED → PER-ITEM VERIFY → COMMIT → RECONCILE
```

**There is no population scan.** The abandoned migrator's central defect was
that it decided its own work list; this one cannot, because the code to do so
does not exist. A test asserts `code` contains no `from("posts")`.

**A count is not a set.** The fence compares md5 digests over sorted
`(post_id, ord, source_url)` key sets — one built in TypeScript by
`keySetText()`, one built in Postgres by `media_migration_fence_digest()`.
Test 18b proves a swap of equal size is still refused.

**The transaction moved into the database.** supabase-js cannot span one; a
plpgsql function is one. `media_migrate_post()` writes a post's media rows and
all its references or nothing. It is idempotent (a post with references returns
`skipped`) and it **repairs** a row stuck below `ready` instead of throwing on
it for ever — the old migrator's permanent dead end, closed.

### What it refuses, by code

`MIG-1003` not the approved manifest · `MIG-1015` foreign host · `MIG-1016`
`..` in a path · `MIG-1017` not a post-photograph path (this is what excludes
avatars) · `MIG-1018` url/path drift · `MIG-1019` owner is not the path's folder ·
`MIG-1027/1028` duplicate key or duplicate content in one post · `MIG-1029`
ordinal gap · `MIG-1030` slides disagree about the owner · `MIG-1040` fenced set
≠ manifest · `MIG-1051/1052` live slides ≠ manifest slides · `MIG-1060` object
missing · `MIG-1063` **SHA-256 mismatch** · `MIG-1064/65` MIME · `MIG-1066/67`
dimensions · `MIG-1070…73` reconciliation. Server-side: `MIG-2003` post belongs
to someone else · `MIG-2006` path outside the owner's folder · `MIG-2007`
quarantined content · `MIG-2010/2011` verification inside the transaction.

---

## 2. TESTS — 36 PASSING, ALL 20 CONDITIONS COVERED

They execute the **real planner** against fixtures. They do not grep source for
a string — two of the abandoned migrator's tests did exactly that, and Cycle 5A
proved one passed while the code did the opposite of its own name.

| # | condition | result |
|---|---|---|
| 1 | wrong manifest hash | FAIL CLOSED `MIG-1003` |
| 2 | altered manifest (one byte) | FAIL CLOSED `MIG-1003` |
| 3 | missing manifest row | FAIL CLOSED `MIG-1050` |
| 4 | unexpected candidate | FAIL CLOSED `MIG-1051/1052` |
| 5 | duplicate manifest key | FAIL CLOSED `MIG-1027` |
| 6 | wrong owner (+ slides disagreeing) | FAIL CLOSED `MIG-1019` / `MIG-1030` |
| 7 | wrong path — avatar, traversal, foreign host, drift | FAIL CLOSED `MIG-1017/1016/1015/1018` |
| 8 | SHA mismatch | FAIL CLOSED `MIG-1063` |
| 9 | duplicate SHA in one post / shared across posts | FAIL CLOSED `MIG-1028` / reported, allowed |
| 10 | missing object | FAIL CLOSED `MIG-1060` |
| 11 | invalid MIME (manifest and bytes) | FAIL CLOSED `MIG-1023/1064/1065` |
| 12 | invalid dimensions, bytes, aspect, ordinal gap | FAIL CLOSED `MIG-1020…1026`, `1029`, `1061`, `1066/67` |
| 13 | media_objects failure | one plpgsql function = one transaction; ≥9 raise paths |
| 14 | post_media failure | same transaction; references insert after the media loop |
| 15 | verification failure | raises **inside** the transaction (`MIG-2010/2011`) |
| 16 | stuck below `ready` | **REPAIRED**, and the advance provably runs on the reused row |
| 17 | repeated execution | `skipped`, nothing rewritten |
| 18 | concurrent arrival | FAIL CLOSED `MIG-1040` |
| 18b | **one leaves + one arrives, count unchanged** | still FAIL CLOSED — a length check would have passed |
| 19 | partial batch | resumable: stable sorted post order, per-post planning |
| 20 | reconciliation mismatch | FAIL `MIG-1070…1073` |

Plus posture tests: no population scan · fetches only `row.source_url`, only
from the CDN, `redirect: "error"` · admin-only · **dry by default** · no direct
table writes (only the RPC) · MIME and dimensions from bytes, never filenames ·
no grant to `anon`/`authenticated` · no constraint, trigger or index dropped ·
`posts.image_urls` never written · the abandoned migrator's hash pinned and its
absence from `config.toml` asserted.

---

## 3. MUTATION TESTING — 12 CONTROLS, ALL DETECTED

```
baseline (no mutation): GREEN

✓ DETECTED  1. manifest hash verification              → suite RED
✓ DETECTED  2. fence set-membership verification       → suite RED
✓ DETECTED  3. per-post live/manifest slide comparison → suite RED
✓ DETECTED  4. owner-is-the-object-path-folder         → suite RED
✓ DETECTED  5. SHA-256 verification of the bytes       → suite RED
✓ DETECTED  6. duplicate (post_id, ord) protection     → suite RED
✓ DETECTED  6b. duplicate content within one post      → suite RED
✓ DETECTED  7. final reconciliation                    → suite RED
✓ DETECTED  8. transactional post-write verification   → suite RED
✓ DETECTED  9. stuck-state repair (SQL)                → suite RED
✓ DETECTED 10. writes only through the RPC             → suite RED
✓ DETECTED 11. MIME/dimensions from the bytes          → suite RED

tracked files modified after restore: NONE (clean)
ALL CONTROLS DETECTED.
```

⚠ **Mutation 9 initially came back UNDETECTED.** The test asserted `/_repaired/`,
and renaming only the declaration left other mentions in place, so it stayed
green. **The test was sharpened to assert the property** — the counter is
declared and returned, and the state-advance provably runs *after* the reuse
branch — and the mutation is now detected. The test was fixed; the target was
not moved. This is exactly the failure the harness exists to find, and it found
one on its first run.

---

## 4. DRY RUN — THE REAL MANIFEST, THE REAL PRODUCTION FENCE

```
STAGE 1  INTEGRITY
  manifest sha256 : 6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84
  approved        : 6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84
  result          : PASS

STAGE 2  PARSE            rows 207 · posts 180 · owners 48 · PASS

STAGE 3  FENCE (set, not count)
  manifest digest : f0a74d3e74d8a52f61de92a2e0ab429a
  live digest     : f0a74d3e74d8a52f61de92a2e0ab429a   (read-only SELECT, fence 2026-08-17 10:52:06.533572+00)
  live count      : 207
  result          : PASS

STAGE 4  PLAN             180 posts planned · 207 slides · 0 refused
                          content shared across posts by one owner: 0

STAGE 7  RECONCILIATION ARITHMETIC
  expected post_media    : 207
  expected media_objects : 207
  reconcile() on that state    : PASS
  reconcile() if one ref lost  : FAIL (correct)

PRODUCTION WRITES BY THIS DRY RUN: 0
```

**Zero writes is structural, not promised:** the dry-run harness imports the
planner only. No database client and no fetch client exists in its process.
`media_objects` and `post_media` were **0 rows before and 0 rows after**.

### Dry run vs manifest

| | expected | actual |
|---|---|---|
| items | 207 | **207** |
| posts | 180 | **180** |
| owners | 48 | **48** |
| refusals | 0 | **0** |
| production writes | 0 | **0** |

---

## 5. INVARIANTS RE-RUN

| invariant | result |
|---|---|
| full test suite | **PASS** — 1,965 passed / 1 skipped / 0 failures (156 files) |
| `securityDefinerGrants` · `deletionCoverage` · `mediaWritePath` · `mediaIdentityContainment` · `mediaBackfill` | **PASS** — 88/88, no gate weakened |
| SHA-256 is server-side only | **PASS** — `anon`/`authenticated` still have no privilege; the SQL grants none |
| `media_objects.id` stays `gen_random_uuid()` | **PASS** — the insert names 7 columns and `id` is not one |
| `post_media` remains the reference layer | **PASS** |
| no constraint/trigger/index weakened | **PASS** — asserted by test, and no DDL touches them |
| `posts.image_urls` untouched | **PASS** |
| production media tables empty | **PASS** — 0 / 0 |

---

## 6. THE ABANDONED MIGRATOR

```
supabase/functions/backfill-media-objects/index.ts
hash (local and origin) : cfc5051e7dadf488e2c34bb963892d7d39e69f03
status                  : ABANDONED — preserved unmodified for forensics
config.toml entry       : NONE
deployed                : NO (absent from the project's function list)
```

**Execution blocked: YES**, by three independent facts — it is not deployed, it
has no `config.toml` entry, and a test fails if either its bytes change or it
gains a config entry. It was **not deleted**; removal is a separate controlled
cleanup after independent review, as instructed.

---

## 7. THE 208TH PHOTOGRAPH — DELTA, NOT MIGRATED

```
fenced items (created_at <= 2026-08-17 10:52:06.533572+00) : 207
arrivals since the fence                                    :   1
arrival posts                                                :   1
arrival timestamp                                            : 2026-08-17 13:23:31.641699+00
```

Not migrated. Not added to the manifest. The manifest hash is unchanged.

The engine handles this **by refusing**: `media_migration_fence_digest(_fence)`
filters `created_at <= _fence`, so the arrival is outside the fenced set and the
digest still matches. Had I quietly widened the fence, `MIG-1040` would have
fired. The delta path is: measure the arrival exactly as Cycle 4 measured the
207 → produce a delta manifest with its own hash → approve it → run the engine
with the delta fence → final reconciliation across both.

---

## 8. OPEN RED

1. **Deployment and application are NOT approved** — the edge function has no
   config entry and the SQL is not in the ledger. Both need a separate decision.
2. `measure-post-media` is still deployed (auto-expires 2026-09-01). Delete when
   you are done with it.
3. `backfill-media-objects` still in the repo, abandoned, pending controlled
   removal.
4. **The client switch will fail with permission denied** — `authenticated` has
   no privilege on `media_objects`/`post_media`. When granted it must be
   **column-scoped**, or `sha256` becomes client-readable.
5. **The manifest is not in the repository.** It carries member post ids and
   owner ids and this repo is **public**; committing it is a privacy decision
   that is yours, not mine. Today it lives in the session workspace and in the
   project. The engine takes it as input, so this does not block anything — but
   it must be resolved before a run, or the run has no reproducible input.
6. Population drift will continue while the platform is live.
7. RED-B3d-IMG-2 — Supabase transformation 403, 11 shipped code paths.
8. Phase 1 carry-over unchanged.
