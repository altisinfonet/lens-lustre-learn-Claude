# PHASE 2 — WRITE PATH CLOSURE

**Date:** 2026-08-20 · **Workstream 2** · **main:** `d5906ef` (PR #81, squash-merged 15:51:45 UTC)
**Phase 3:** not started. **measure-post-media:** not removed. **D-002/D-003:** not attempted.

---

## THE HEADLINE

> **At 16:12:34 UTC a real photograph travelled the whole media write path in production
> for the first time.** `post_publish_with_media` created post `98b2d052`, one
> `post_media` row, one verified `media_objects` row, and derived `image_urls` from the
> media graph. Before today that function had **never once executed**: 0 of 252 posts
> carried the `idempotency_key` it always sets. It is now 1 of 253.

**The primary objective — STOP THE DELTA FROM GROWING — is met and measured:**
`new_unexplained_legacy_posts = 0`, `delta_growing = false`, and the one post created
after the fix is **not** `image_urls`-only.

---

## 1. PHASE 2 PERCENTAGE

| | |
|---|---|
| Before WS1 (as claimed) | 92% |
| After the WS1 audit correction | **89%** — Priority 1 was scored 10/10 on an architecture that had never run |
| **Now** | **94%** |
| If D-002/D-003 are ruled OUTSIDE the completion criteria | ~97% |

Priority 1 returns to **10/10**: RED-1 is fixed, deployed, and a real photograph has been
observed going through it end to end. The remaining 6 points are §12.

---

## 2. RED-1 STATUS — **FIXED, DEPLOYED, PROVEN IN PRODUCTION**

`src/lib/media/postMediaWrite.ts` stored `supabase.rpc` in a variable at both call sites.
supabase-js declares `rpc` as a prototype method whose body is `return this.rest.rpc(...)`,
so the copy ran with `this === undefined` and threw. `publishViaMedia` had no try/catch, so
the throw sailed **past** the legacy fallback: the member got "Could not publish" and **no
post at all**.

**Fix:** both sites now use the in-call-position form proven at `postMediaRead.ts:146`.

**Proof it is fixed in the code members actually run** — not merely in the repository.
Reading the deployed bundle `index-cSt3z7BJ.js` on `www.50mmretina.com`:

| RPC | called as a member expression `.rpc("…")` | called as a bare detached identifier |
|---|---|---|
| `media_begin_upload` | ✅ true | false |
| `post_publish_with_media` | ✅ true | false |
| `post_media_for` | ✅ true | false |

**Four guards, because this bug has now appeared twice in two files three days apart:**

1. **The mock is now a class.** It was an object literal — an own property that survives
   detachment. Every test passed against a client *incapable of exhibiting the defect*.
   `MockSupabaseClient.rpc` is now a prototype method returning `this.rest.rpc(...)`, so a
   detached call throws in the tests exactly as it did in production.
2. **Regression tests** assert the detached form throws `TypeError`, the destructured form
   throws, and the shipped form does not.
3. **A repository-wide static scan** forbids the assignment in *any* file under `src/`,
   with a self-check that the pattern matches the historical bug line, and a guard that the
   walk found >100 files — a scan that reads nothing passes everything.
4. **`MEDIA-4009`** closes the throw boundary at runtime for all five callers: an exception
   in the media path is now an ERROR and a `null`, never an escape.

---

## 3. RED-2 STATUS — **FIXED AND DEPLOYED** (latent; never fired in production)

`handleDuplicate` built the copy as an inline object literal: six fields listed, four
omitted. The table defaults then decided — `privacy 'public'`, `indexing_disabled false`,
`categories '{}'`, `media_ids NULL`. A duplicate of a **private**, search-excluded,
categorised post would have been scheduled public, indexable, uncategorised and
legacy-only, then published that way by cron hours later with nobody watching.

**Root cause, and why review could not have caught it:** the `ScheduledPost` *read* type
did not declare `privacy`, `indexing_disabled` or `media_ids` at all. `p.privacy` would not
have compiled even if its author had reached for it — while `select("*")` had been
returning all three the whole time.

**Fixed at four levels:**

| level | what it stops |
|---|---|
| the read type carries the fields | the copy can now reference what it must preserve |
| `duplicateScheduledPostInput` — one pure function | no second inline literal to forget a field in |
| every carried field **required** on `CreateScheduledPostInput` | omission is a **compile error**; a `tsc` probe in the suite compiles the historical RED-2 payload and asserts the compiler refuses it |
| `assertCarriesMemberChoices` **throws** | an `as any`, an untyped caller or a column-less row can no longer let a table default choose a member's privacy |

The `?? "public"` / `?? false` / `?? []` defaults at the INSERT were **removed** — a default
there is indistinguishable from a choice.

**Blast radius, measured:** production has 1 scheduled post ever (published 2026-07-03),
0 pending, 0 non-public. No member was affected.

---

## 4. PRODUCTION PROOF STATUS — **OBTAINED**

One controlled post, published from the live site on the new bundle, **audience "Only Me"**
so nothing was disclosed publicly.

**Post `98b2d052-aac5-4602-813b-ff9d2c9028c7`, 2026-08-20 16:12:34 UTC**

| requirement | result |
|---|---|
| a NEW post is created | ✅ `98b2d052…`, `post_kind = member` |
| `media_objects` row exists | ✅ `ff8108e6…` |
| `post_media` row exists | ✅ 1 row, `refs = slides = 1` |
| owner matches | ✅ `media_objects.owner_id = posts.user_id` |
| `ord` is correct | ✅ `ord = 0`, dense from zero |
| media is ready | ✅ `state = ready`, `verified_at` set |
| privacy is correct | ✅ **`private`** — carried verbatim, not defaulted |
| `post_media_for` returns the media | ✅ the photograph renders on `/post/98b2d052…`, decoded 1600×1067 |
| `image_urls` derived correctly | ✅ equals `public_url ‖ derivatives.original` exactly; thumbnail is its `-thumb` sibling |
| `idempotency_key` populated | ✅ **`ef03927f`** — the first ever |
| no duplicate post created | ✅ 1 post in the window, 1 row for that key |
| no orphan media created | ✅ 0 new orphans |

**Byte-level content identity, computed independently of the app.** I fetched the stored
object from `cdn.50mmretina.com` and hashed it myself:

- SHA-256 of the retrieved bytes **equals** `media_objects.sha256` (`d9c85888…`) ✅
- retrieved length 25,680 bytes **equals** `media_objects.bytes` ✅
- decoded 1600×1067 **equals** `media_objects.width/height` ✅
- `content-type: image/webp` **equals** `media_objects.mime` ✅
- the `-thumb` sibling returns 200 ✅

The source JPEG's own hash is deliberately different — `describeStoredObject` fingerprints
the **encoded** bytes, which is the whole point.

`client_errors` in the window: **none**. No `MEDIA-4001`, no `MEDIA-4009`, no `MEDIA-4010`.

> ⚠ **The test post is still there, private, on the 50mm Retina World account.** Caption:
> *"WS2 write-path verification, 2026-08-20. Private test post - safe to delete."*
> I did not delete it — deleting production data is outside what I will do unattended.
> It is safe to remove whenever you like.

---

## 5. NEW LEGACY-ONLY POSTS AFTER THE FIX

**Zero.**

| | |
|---|---|
| posts created after the deploy fence (15:51:45 UTC) | 1 |
| of those, legacy-only | **0** |
| of those, legacy-only slides | **0** |
| `media_write_path_delta().new_unexplained_legacy_posts` | **0** |
| `media_write_path_delta().delta_growing` | **false** |

---

## 6. REMAINING LEGACY SLIDES

| population | posts | slides | disposition |
|---|---|---|---|
| **Permanent floor** (profile/cover announcements) | 18 | 18 | correct and permanent — MUTABLE `avatar.webp`/`cover.webp`, no stable content identity, `media_mark_ready` refuses them (MEDIA-2102). Counted as MEDIA-4007, excluded from `delta_growing`. |
| **Migratable backlog** | 17 | 29 | genuine remaining work — pre-existing, not growing |
| **Total legacy-only** | 35 | 47 | unchanged from the pre-deploy baseline |

---

## 7. PERMANENT LEGACY FLOOR

**18 posts / 18 slides.** Not a defect and not migratable. See §6.

---

## 8. MUTATION RESULTS

| harness | mutations | detected | baseline |
|---|---|---|---|
| `tools/mutate-write-path.mjs` | **58** | **58 / 58** | GREEN |
| `tools/mutate-scheduled-duplicate.mjs` *(new)* | **24** | **24 / 24** | GREEN |

**New this workstream:**

- **R1a–R1b** re-introduce the *exact* RED-1 line at each call site → both RED.
- **R1c** reverts the mock to an object literal → RED. **R1d** binds `rpc` in the mock →
  RED. (Production does not bind; a mock that does cannot fail.)
- **R1e** makes the repository scan walk nothing → RED. **R1f** makes its pattern match
  nothing → RED.
- **P3a–P3g** merge the two fallback conditions, remove the throw guard, silence
  MEDIA-4006/4010, downgrade MEDIA-4010 to a warning → all RED.
- **D1–D24** drop each duplicated field in turn (**D3 is the privacy one**), re-add each
  `??` default, make each field optional again, remove the runtime refusal, and restore the
  original RED-2 literal verbatim → all RED.

**One stale mutation retargeted, and said so in place:** mutation 1 quoted the *detached*
line, which no longer exists. A mutation aimed at a line that is gone does not apply and
reports a **false escape** — the same stale-target class as mutations 13, 21, 22 and the
candidate-widening 11. Retargeted at the live form; the invariant is unchanged.

**Both harnesses now refuse to run against a red baseline.** The new one printed *24 green
ticks over a failing suite* on its first run, because `scheduledPostThumbnails.test.ts` was
already red. Every "detection" in that run was worthless. The gate exists so that cannot
read as proof again.

---

## 9. FULL TEST RESULTS

```
Test Files  163 passed | 1 skipped (164)
     Tests  2253 passed | 1 skipped (2254)
```

- `tsc --noEmit -p tsconfig.app.json` — clean (this is the CI config)
- `tsc --noEmit -p tsconfig.node.json` — clean
- `npm run build` — 5,182 modules, built, `dist/index.html` produced
- ESLint on every touched file — **zero new findings**, verified by linting each file at
  its pre-change revision and diffing the counts

**Four stale assertions RETARGETED, NOT WEAKENED** — each is stricter than the one it
replaced, and each carries the reason in place:

| file | was | now |
|---|---|---|
| `scheduledPostThumbnails.test.ts` | looked for `thumbnail_urls: p.thumbnail_urls` *inside the inline literal* | asserts the builder carries them **and** that the component delegates rather than rebuilds |
| `scheduledPostThumbnails.test.ts` | `thumbnail_urls: input.thumbnail_urls ?? []` | asserts the column is written **and** that the field is not optional on the write type |
| `postCategoriesPhaseB.test.ts` | `categories: input.categories ?? []` | asserts the choice is stored, is **not** defaulted, is required on the input type, is refused when missing, and survives a duplicate |
| `mediaWritePath.test.ts` | outcome shape `{postId, viaMedia}` | plus the `failure` classification |

**A CI failure I did not paper over.** `typecheck` went red on the first push: `tsc -p
tsconfig.app.json` is stricter than the bare `npx tsc --noEmit` I had been running, and
rejected a `Record<string, unknown>` cast in the new test. Fixed by casting through
`unknown`, then re-verified with the *exact* CI command.

---

## 10. CI RESULTS — PR #81, all seven green

| check | result |
|---|---|
| typecheck | ✅ success |
| build | ✅ success |
| Every control reachable, nothing regressed | ✅ success |
| This project's own security rules | ✅ success |
| Secret scan (full history) | ✅ success |
| Dependency vulnerabilities (production only) | ✅ success |
| Cloudflare Pages | ✅ success |

`mergeable_state: clean` before merge. Same seven green on `main` after merge.

---

## 11. DEPLOYMENT HASHES

| artefact | hash |
|---|---|
| `main` after squash-merge | **`d5906ef`** |
| PR | **#81**, 9 commits, 13 files, +1,739 −96 |
| deployed client bundle | **`/assets/index-cSt3z7BJ.js`** (1,547,524 bytes) |
| `__APP_BUILD` marker served | `2026-08-20-2` |

**Verified byte-for-byte before opening the PR:** all 13 files' git blob SHAs on the branch
matched my local commit exactly, and `compare/main...branch` showed those 13 files and
nothing else. One file (`WallPosts.tsx`) had *silently failed to commit* — the button moved
when the ProTip line appeared — and the SHA check is what caught it.

**Unchanged, deliberately:** no migration, no schema change, no grant change, no RLS change,
no edge-function deployment. Live function versions are as WS1 recorded them:

| function | version | body md5 |
|---|---|---|
| `post_publish_with_media` | 7-arg | `b38d88b5…` (unchanged) |
| `post_attach_media` | — | `fef4bf75…` (unchanged) |
| `create_system_post` | 5-arg | `2a90beb4…` (unchanged) |
| `publish_post_draft` | — | `3c208e23…` (unchanged) |

**New in the repository:** `docs/DECISIONS.md` **D-005** — *"The legacy insert stays as the
airbag, and is now told apart from the steering."* Pinned by
`src/__tests__/mediaWritePath.test.ts`.

---

## 12. DATABASE RECONCILIATION

Fence = the WS2 deploy, **2026-08-20 15:51:45 UTC**.

| metric | before | after | Δ |
|---|---|---|---|
| total posts | 252 | **253** | +1 |
| total slides | 310 | **311** | +1 |
| `post_media` rows | 263 | **264** | +1 |
| `media_objects` rows | 264 | **265** | +1 |
| legacy-only posts | 35 | **35** | 0 |
| legacy-only slides | 47 | **47** | 0 |
| permanent floor (posts / slides) | 18 / 18 | **18 / 18** | 0 |
| migratable backlog (posts / slides) | 17 / 29 | **17 / 29** | 0 |
| posts created after the fix | — | **1** | |
| **legacy-only posts after the fix** | — | **0** | |
| **posts carrying `idempotency_key`** | **0 / 252** | **1 / 253** | **+1** |
| owner mismatches | 0 | **0** | 0 |
| ordinal gaps | 0 | **0** | 0 |
| duplicate `(post_id, ord)` | 0 | **0** | 0 |
| duplicate `(owner_id, sha256)` | 0 | **0** | 0 |
| partial posts (`0 < refs < slides`) | 0 | **0** | 0 |
| non-ready media | 0 | **0** | 0 |
| orphan media | 1 | **1** | 0 |

**The one orphan is known and is not a defect:** `18b96d23…`, 1620×1081, created
2026-08-19 15:23 — the D-002 delivery probe. Retained by policy (*"ambiguous media is
retained"*), not created by the write path.

**The invariant, stated as it was asked for:**

> **A NEW NORMAL PHOTO POST MUST NOT BE `image_urls`-ONLY.**
> Post `98b2d052…` — 1 slide, 1 `post_media` row, 1 verified `media_objects` row,
> `image_urls` derived from the graph. **Held.**

Guarantees confirmed by reading the live functions and constraints, not by assumption:
owner binding via `auth.uid()`; `octet_length(sha256) = 32`; `width/height ∈ (0, 100000]`;
`bytes > 0`; `mime` allow-listed to four types; `state` allow-listed with
`ready ⇒ derivatives ? 'original'` and `verified ⇒ verified_at NOT NULL`; `PK(post_id, ord)`
with `ord ≥ 0`; `privacy ∈ {private, friends, public}`; `UNIQUE(owner_id, sha256)` and
`UNIQUE(post_id, media_id)` for duplicate prevention; partial `UNIQUE(user_id,
idempotency_key)` for idempotency; single-statement function for transaction rollback;
`post_media → posts ON DELETE CASCADE` and `→ media_objects ON DELETE RESTRICT` so a
failure leaves no orphan.

---

## 13. REMAINING D-002 / D-003 BLOCKER — UNCHANGED

**Not attempted, exactly as instructed.** The blocker is unmoved since WS1: the Cloudflare
connector available here is **read-only for Workers** — it can list and read Worker code but
exposes no deploy, binding, route or DNS tool. D-003 requires all four.

- **D-002** — authorized media delivery: a private post's photograph is still reachable by
  direct link. The composer says so honestly in the UI (*"The photo file itself can still be
  opened by anyone who has its direct link — we are still building that protection"*), which
  I confirmed on screen during the production test.
- **D-003** — the Cloudflare handover is written (`docs/D003_CLOUDFLARE_HANDOVER.md`) and
  waiting on infrastructure access that no tool in this session can grant.

---

## 14. EXACT REMAINING PHASE 2 PERCENTAGE

**94% complete. 6% remaining**, itemised:

| remaining item | weight | why it is not done |
|---|---|---|
| **D-002 / D-003** — authorized media delivery | **3%** | genuinely blocked on Cloudflare/R2 infrastructure this session cannot reach |
| **29 migratable legacy slides** (17 posts) | **2%** | real remaining migration work; not growing, and now fenced |
| **class-F repair** — `UNAPPLIED_20260820140000_classF_repoint_originals.sql` | **1%** | deliberately unapplied; it rewrites references and needs your explicit go-ahead |

**Not counted as remaining, and deliberately so:**

- the **18-slide permanent floor** — correct behaviour, not debt;
- **`measure-post-media`** — still deployed, still has dependents, **not removed** as
  instructed;
- **Phase 3** — **not started**.

> If you rule D-002/D-003 outside Phase 2's completion criteria — they are an
> infrastructure dependency rather than a write-path property — Phase 2 stands at **~97%**,
> with only the 29-slide backlog and the class-F repair left. I am not making that ruling
> for you; WS1 flagged it as your decision and it still is.

---

## WHAT I WOULD FLAG BEFORE YOU CALL THIS DONE

1. **One post is one post.** The path is proven to work; it is not yet proven to work at
   volume, on Android, or on a slow connection. `MEDIA-4010` is the code to watch — it is
   the leak, and it is now distinguishable from the floor.
2. **RED-2 was found in code nobody had run.** One scheduled post exists in the entire
   history. The duplicate button had almost certainly never been pressed. Other
   rarely-exercised paths deserve the same reading.
3. **The test post is still live and private.** Yours to delete.
