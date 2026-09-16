# Phase 2 — Cycle 1: delta measurement (read-only)

**Measured:** 2026-08-19 · **Snapshot fence:** `2026-08-19 14:14:28.860070+00`
**STATUS: COMPLETE.** Nothing migrated, no SQL applied, no deploy, no grants, no code change. The frozen 207 manifest and the frozen fence are untouched.

## A–H — the numbers

| | |
|---|---|
| **A. delta items** | **19** |
| **B. delta manifest SHA-256** | `4751d950fcaaecc812b96d0f80614b4f3e5ea154f7ccfa315a1b635ff9ce4eb3` |
| **C. delta candidate-set digest (md5)** | `31eb7da488bab8ec4d49dfdae4339d2d` |
| **D. items / posts / owners** | 19 / 15 / 12 |
| **E. overlap with the frozen 207** | **0 on every axis** (below) |
| **F. total object bytes** | **8,210,492** (manifest file itself: 8,121 bytes, 13 columns, 19 rows) |
| **G. snapshot fence** | `2026-08-19 14:14:28.860070+00`; window `> 2026-08-17 10:52:06.533572+00` and `<= snapshot` |
| **H. anomalies** | **none** |

Population range: earliest `2026-08-17 13:23:31.641699+00`, latest `2026-08-19 11:50:36.227005+00`. All 19 are `image/webp`, all carry `-wXhY` in the filename, all dimensions recovered from bytes, all SHA-256 64-hex, all object paths inside their owner's folder.

## E — the overlap proof, on five axes

Run through the **shipped parser** (`supabase/functions/_shared/manifestPlan.ts`), not a re-implementation:

```
identical keys (post_id|ord|url)   0
shared post_id                     0
shared object_path                 0
shared sha256 (any owner)          0
shared owner_id|sha256             0
────────────────────────────────────
owners appearing in both          10   ← expected and harmless: the same
                                        photographers posted before and after
```

The shipped parser accepted all 19 rows with **no refusal**, and re-accepted the frozen 207 unchanged.

## How it was measured

`measure-post-media` only — the approved read-only, admin-only measurement function. It derives its own population and accepts no URL, so the 19 were reached through its own `(offset, limit)` contract: **13 windows totalling exactly 19 objects**, rather than sweeping all 226. It reported `read_only: true`, `total_candidates: 226` on every call, no timeouts, and `ok: true` on all 19. Bytes read: **8,210,492** — equal to the sum of the manifest's own byte column.

The manifest was built **in the browser** from those measurements and hashed there. It was then **independently rebuilt in the sandbox** by joining database-sourced identifiers with the returned measurements, and the rebuilt file hashes to the same `4751d950…`. Two independent constructions, one hash.

## I — prerequisites for the delta migration, and a blocker you need to know about

**⚠ THE SHIPPED ENGINE CANNOT MIGRATE A 19-ROW MANIFEST.**

`media_migration_fence_digest(_fence)` returns the digest of the **entire** candidate population up to that fence, not of a window. At the snapshot fence it reports:

```
key_set_md5  46c4cad2797a26c4b5613fdff36a4b3a
item_count   226
post_count   195
```

`assertFence` compares that against the manifest's own key-set digest. A 19-row manifest digests to `31eb7da4…`, so every page would refuse with **MIG-1040**. That refusal is correct — it is the control working, not a bug.

### Two ways forward

**Option A — cumulative manifest (no code change, recommended).**
Migrate a 226-row manifest = the frozen 207 + the 19. The 207 already have references, so `media_migrate_post` compares them row-for-row and returns `verified-skip` (MIG-2020 / MIG-2021 refuse if anything disagrees) — the re-verification is a free bonus, not a rewrite. Already built and checked here:

```
file      PHASE2_CUMULATIVE_MANIFEST_226_2026-08-19.tsv
rows      226   posts 195   distinct owner|sha256 226
bytes     94,176 (file)   127,928,162 (objects)
sha256    fd2d2432f1cea09899c7c64501b31591241ee1978e3f0dc61488bedb1c1b53d1
key-set   46c4cad2797a26c4b5613fdff36a4b3a  ← equals the live digest at the snapshot fence
pages     195 posts / 25 = 9  →  offsets 0,25,50,75,100,125,150,175,200
expected  post_media 226, media_objects 226, ref_set_md5 to be computed and approved
```

**Option B — change the engine** to take a fence *window* (lower + upper). New SQL, new approved hash, new deployment, new mutation-tested guards. More work and more risk for the same outcome.

### The prerequisite list, in order

1. **Pick and freeze a new execution fence.** The snapshot above is a measurement, not a fence. **0 photographs arrived between the snapshot and this write-up** — but the platform is live and that will not stay true.
2. **Re-measure at the execution fence** if any arrive between now and then. Do not migrate a stale manifest.
3. **Approve the manifest by hash** — `fd2d2432…` for Option A (or a fresh one if re-measured).
4. **Confirm the deployment is unchanged** — `migrate-post-media` v1, `ezbr_sha256 28db46a9…`, combined source digest `6a0d8d73…`.
5. **Confirm production is still 207/207** with a clean reconcile before starting.
6. **Compute the expected end state** from the chosen manifest: `post_media` 226, `media_objects` 226, and the reference-set digest — derived, not assumed.
7. **Dry run all 9 pages** with `dry_run: true`, expecting `would-verify-existing-references` on the 207 and `would-migrate` on the 19.
8. **Then, and only then**, a separate GO for `dry_run: false`.

`measure-post-media` must stay deployed until this is finished. It self-expires 2026-09-01.

## Production, re-verified during and after

```
post_media_rows          207        media_objects_rows       207
unreferenced_media         0        non_ready_media            0
refs_to_non_ready          0        refs_with_owner_mismatch   0
posts_with_gapped_ords     0        ref_set_md5   326834efcf11c7620634f4cbda821bc4
frozen fence   f0a74d3e74d8a52f61de92a2e0ab429a, 207 / 180  (unchanged)
delta posts already referenced: 0
```
