# Phase 2 — Item C: the media read RPC is DEPLOYED

**Date:** 2026-08-19 17:01 UTC · **ITEM C — COMPLETE.**

`post_media_for(uuid[])` is live in production. Nothing reads it yet; that is Item E.

## Pre-apply verification of the migration body · 17/17

`SECURITY DEFINER` ✓ · `STABLE` ✓ · `search_path = public` ✓ · 7 return columns ✓ · `owner_id` absent from return ✓ · 50-id maximum ✓ · `MEDIA-1001` raise ✓ · `can_view_post(auth.uid(), p.user_id, p.privacy)` present ✓ · `REVOKE ALL … FROM public` ✓ · EXECUTE to `anon, authenticated` only ✓ · **no GRANT on `media_objects`** ✓ · **no GRANT on `post_media`** ✓ · no table/policy DDL ✓ · no writes ✓

**One correction to my own checker.** The first pass reported FAIL on "no sha256 / verified_at / quarantine_reason". It was stripping `--` comments but not the `comment on function` string literal, which legitimately says *"Returns no content digest…"*. Re-checked precisely against the return type and the function body:

```
sha256             return type: absent   body: absent
verified_at        return type: absent   body: absent
quarantine_reason  return type: absent   body: absent
select list: pm.post_id, pm.ord, mo.derivatives->>'original',
             mo.width, mo.height, mo.mime, mo.bytes
```

The artifact was correct; the check was wrong. Fixed, and the `comment on` wording changed to avoid naming the columns at all.

## Deployment — one migration, applied once

```
name     post_media_read_rpc
version  20260819170132        ← the version PRODUCTION stamped
ledger   21 → 22 rows, duplicate versions 0
```

The repo file is named `20260819170132_post_media_read_rpc.sql` — the version production recorded, not the one the artifact was authored under. That is the lesson of the `20260818011014` reconciliation applied at the source instead of repaired afterwards, and `postMediaForSecurity.test.ts` pins it.

## Post-deployment verification · 22 identity + 11 behaviour, all PASS

**Identity and privileges (V01–V22):** function exists · args `_post_ids uuid[]` · return `TABLE(post_id uuid, ord integer, object_path text, width integer, height integer, mime text, bytes bigint)` · SECURITY DEFINER · STABLE · `search_path=public` · **PUBLIC has no EXECUTE** · anon EXECUTE ✓ · authenticated EXECUTE ✓ · **deployed body md5 `5ea99d5975ee68086b82aa2ee0b780b7`, 968 chars — identical to the repo file** · sha256/verified_at/quarantine_reason/owner_id absent from the return type · **anon and authenticated table privilege on both media tables: false ×4** · column privilege on `sha256`: false · client column grants: **0** · `media_objects` ACL unchanged (`postgres`, `service_role` only).

**Behaviour against the live function** (synthetic privacy, rolled back):

| # | check | result |
|---|---|---|
| B01 | owner — public/friends/private | **3/1/1** ✓ |
| B02 | accepted friend | **3/1/0** ✓ |
| B03 | stranger (authenticated) | **3/0/0** ✓ |
| B04 | cross-owner: stranger asks for the private post directly | **0** ✓ |
| B05 | anon | **3/0/0** ✓ |
| B06 | anon asks for the private post directly | **0** ✓ |
| B07–B09 | null / empty / nonexistent id | 0 / 0 / 0 ✓ |
| B10 | exactly 50 ids | 50 ✓ |
| B11 | 51 ids | **`22023 MEDIA-1001 at most 50 …`** ✓ |

B11 first showed as a mismatch: I compared `left(msg,20)` against a 22-character expectation. A harness string-length artifact, not a behaviour failure — the SQLSTATE and code are exactly right.

## Regression tests committed

`src/__tests__/postMediaForSecurity.test.ts` — 16 tests, all pass. It reads the shipped migration and pins: the predicate's presence and its use of `auth.uid()` (not a caller-supplied viewer id), SECURITY DEFINER + pinned search_path, STABLE and no writes, the exact 7 return columns in order, the three forbidden columns absent from both return type and body, the 50-cap and MEDIA-1001, empty input being an empty answer, PUBLIC revoked, EXECUTE limited to anon+authenticated, **no table grant**, and the filename matching the applied ledger version.

**One fix during authoring:** the "no table grant" assertion initially failed because its regex matched the phrase *"Grants nothing on media_objects"* inside the `comment on` string. The test now checks executable DDL only, and mutation 7 proves it still catches a real grant.

`tools/mutate-post-media-rpc.mjs` — **8 mutations, 8 DETECTED:**

```
✓ 1. the can_view_post predicate — the entire access control    → RED
✓ 2. auth.uid() replaced by a caller-supplied viewer id         → RED
✓ 3. the 50-id cap                                              → RED
✓ 4. SECURITY DEFINER's pinned search_path                      → RED
✓ 5. sha256 added to the return type and select list            → RED
✓ 6. REVOKE ALL FROM public dropped                             → RED
✓ 7. a table GRANT smuggled in beside the function              → RED
✓ 8. STABLE weakened to VOLATILE                                → RED
files differing from the pre-run snapshot: NONE (fully restored)
```

Full suite: **2016 passed**, 1 skipped, 159 files.

## Production data — unchanged, verified 17:10:25 UTC

```
post_media 228 · media_objects 228 · ref_set_md5 73d4dea406d3c37b67a23f583820b837
unreferenced 0 · non_ready 0 · refs_to_non_ready 0 · owner_mismatch 0 · ord_gaps 0
posts 254 · non-public posts 0 · posts max updated 15:45:41 (before this work)
newest media row 16:10:46 (the delta-2 migration, nothing since)
policies on the media tables 5 — unchanged
ledger 22 rows, duplicate versions 0
live 1-photo delta: 0 references, 1 still outstanding — untouched
```

No RLS policy altered. No table touched. `posts.image_urls`, storage and CDN untouched. No client code changed.

## Commit

`aef6f8a` — 3 files, 374 insertions. **Local only**: `git push` is blocked by the sandbox proxy for this repository, so the commit still needs to reach `origin/main` the way the earlier cycles did (web editor on a branch, squash-merged).

## ITEM C — COMPLETE

Not started: **Item D** (extend `detect-orphan-files` so `post_media` references are understood before anything can treat live media as orphaned), Item E (the client switch), Phase 3. Nothing reads `post_media_for` yet.

D-002 stands: the bucket is still public, `PrivacyGapNotice` is still required.
