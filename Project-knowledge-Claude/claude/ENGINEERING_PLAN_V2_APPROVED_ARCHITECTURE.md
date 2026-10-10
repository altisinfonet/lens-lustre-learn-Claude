# 50mm Retina — Engineering plan v2 (decision-complete)

**Supersedes** `ENGINEERING_PLAN_TO_PRODUCTION_GRADE.md`. Incorporates the owner's three approval conditions, plus two corrections I am making to my own v1 — one of which is a genuine design flaw, not a refinement.

Every phase below carries five things, not one: **work · acceptance gate (numeric, observed) · abort criteria · rollback · the regression test that locks the invariant in.** A phase without all five is not planned, it is hoped for.

---

## 0. WHAT CHANGED, AND WHAT I AM WITHDRAWING

### 0.1 Accepted without reservation

| Owner condition | Effect |
|---|---|
| Content-addressed storage: approve the concept, require a security/data-model review before migration | §1 is that review, and it changes the design materially |
| Ranking: prove no duplicates/omissions **and** that fairness survives, before declaring pagination solved | §2 defines the proof obligations as executable properties |
| Media gate must be device-network-observed, not `srcset`-presence | §3 and the Phase 2 gate are rewritten around observed bytes |
| Explicit `media_object` metadata rather than a fixed filename convention | §3 — and it kills my own `image_meta` design, see 0.3 |
| AVIF not mandatory in Phase 2 — one variable at a time | Accepted. WebP-only ladder ships first; AVIF is its own benchmarked change |
| Drop "Instagram cannot match" — marketing, not engineering | Accepted. §5 is restated as verifiable properties of *our* pipeline only |
| Gate-based execution with a report to you at each boundary | §6 defines the report format so "Claude says it's ready" is never the artifact |
| Phase 3 must kill the app at 8 stages, not 1 | §4 redesigns the upload path so all 8 are safe **by construction** |

### 0.2 CORRECTION TO MY OWN v1 — global content-addressing was wrong

I proposed keying every object by the SHA-256 of its bytes in a **global** namespace, flagged the cross-user dedup side channel, and proposed mitigating it by "never exposing dedup." **That mitigation is insufficient, and I should have caught it.**

The deeper problem is not dedup *timing*. It is that a globally content-addressed public object has a **guessable address**. Post images are served from a public CDN. If the key is `media/<sha256>.webp`, then anyone holding candidate bytes can compute the hash, request the URL, and learn from a 200 whether that image exists on the platform — no upload, no timing analysis, nothing to observe. Hiding the dedup response does not close it, because the attacker never has to upload at all.

Adding the owner to the path (`media/<user_id>/<sha256>`) makes it *worse* in the case that matters: `user_id` is public, so an attacker who suspects a specific person posted a specific photograph can confirm it with one GET.

**Your gate — "no user can infer that another user possesses a particular image merely because the same SHA-256 exists" — is not satisfiable by any design where the hash appears in the address.**

### 0.3 SUPERSEDING MY OWN PENDING MIGRATION

`supabase/migrations/20260813190000_post_image_meta.sql` (local commits `41b1989` + `df0e57e`, **never applied**) adds an `image_meta jsonb` column to `posts`. It was the right idea when the alternative was parsing dimensions out of filenames. It is the wrong idea now that a real `media_objects` table is on the table — it would encode media structure into a per-post JSON blob that a proper relational model replaces, and it would spend one DROP/CREATE of `get_broadcast_feed` (the highest-risk operation in this database) on a design we are about to replace.

**Recommendation: withdraw it. Do not apply it.** The dimension backfill it performs is still needed and moves into Phase 2 against `media_objects`. I will revert the two local commits on your word — they are local-only and nothing depends on them.

That is the whole point of the gate model working: the plan caught my own work.

---

## 1. DESIGN REVIEW — MEDIA IDENTITY AND AUTHORIZATION

### 1.1 Three identities, deliberately separated

The flaw in v1 was collapsing three different things into one string. They must stay separate:

| Identity | What it is | Where it may appear | Purpose |
|---|---|---|---|
| **Content identity** | `sha256(bytes)` | **Server-side only. Never in a URL, never in an API response, never in a client payload.** | integrity, retry idempotency, per-owner dedup |
| **Object identity** | `media_objects.id` — a random UUID | in URLs, immutable forever | addressing, CDN caching |
| **Reference identity** | rows in `post_media`, `entry_media`, … | in authorization checks | *the only* basis for "may this viewer see this" |

Storage layout:

```
media/<object_id>/original.webp
media/<object_id>/1440.webp
media/<object_id>/1080.webp
media/<object_id>/600.webp
```

`object_id` is random and unguessable. The hash never leaves the database.

### 1.2 The schema

```sql
CREATE TABLE public.media_objects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- the ONLY public identifier
  owner_id     uuid NOT NULL REFERENCES auth.users(id),
  sha256       bytea NOT NULL,          -- NEVER returned by any RPC or view
  width        int  NOT NULL CHECK (width  > 0),
  height       int  NOT NULL CHECK (height > 0),
  bytes        bigint NOT NULL CHECK (bytes > 0),
  mime         text NOT NULL,
  derivatives  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"600":true,"1080":true,"1440":true}
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Per-owner dedup + retry idempotency. Deliberately NOT global.
CREATE UNIQUE INDEX media_objects_owner_content ON public.media_objects (owner_id, sha256);
```

**Dedup is scoped to the owner. This is a deliberate reversal of v1, and it is correct for four independent reasons:**

1. **It closes the side channel completely.** Two members uploading identical bytes get two rows and two unguessable addresses. There is no observable, no timing difference, no address to guess. Your gate is satisfied structurally rather than by policy.
2. **Retry idempotency is preserved in full** — a retry is *the same owner* re-sending *the same bytes*, which is exactly what the unique index catches. That was the entire point of content-addressing, and it survives.
3. **Deletion and takedown isolate correctly.** With a shared physical object, deleting one member's post, honouring a DMCA notice, or handling an account deletion would silently affect another member's content. Per-owner storage makes that impossible.
4. **The storage cost is negligible here.** Cross-user byte-identical dedup only pays off when many users upload the same file. On a platform where every asset is an original photograph, that population is approximately empty — and where it *isn't* empty (a stolen re-upload), merging them is precisely the wrong behaviour.

**What is given up:** cross-user storage dedup. Measured against what it buys — an unsatisfiable-otherwise privacy gate, correct deletion semantics, and correct takedown semantics — this is not a close call.

### 1.3 Authorization stays at the reference layer — enforced, not documented

Your requirement: *authorization must remain at the reference/object layer, not be inferred from the physical storage object's existence.*

| Bucket | Visibility | Enforcement |
|---|---|---|
| `post-images` (public posts) | public CDN, immutable, long-cache | address unguessability + the post's own `privacy` on the reference row |
| `post-images` (**friends** posts) | ⚠ see below | **must not** be a public object |
| `competition-photos` pre-publication | private | signed URLs only, TTL-bounded |
| avatars, banners, journal | public | as today |

⚠ **A gap this review surfaces that neither audit did.** Today every post object is publicly readable on the CDN regardless of the post's `privacy` value. That is currently harmless *only* because 100% of the 210 production posts are `privacy='public'` — verified. **The moment one member posts a `friends`-only photograph, its bytes are publicly fetchable by anyone with the URL, while the post row is correctly protected by `can_view_post`.** Unguessable addressing makes this hard to exploit; it does not make it correct.

**Design rule, mandatory:** a media object's storage visibility must be derived from the *strictest* privacy of any reference to it. Non-public references are served through signed URLs with a bounded TTL, never from the public bucket. This must be a Phase 2 deliverable, not a later one — it becomes an actual disclosure the day friends-privacy posts get used.

### 1.4 Integrity — the client must not be trusted with the hash

The client computes `sha256` to claim idempotency. A malicious client could claim a hash that is not its bytes. Mitigation: the presign step records the claimed hash; R2 verifies the object checksum on PUT; the derivative worker recomputes the hash from the stored bytes before writing `derivatives`, and quarantines any mismatch. **A row is not usable until server-side recomputation agrees.**

### 1.5 Design-gate checklist — all must pass before any migration

- [ ] `sha256` appears in **zero** RPC return types, views, API responses and client payloads (assert with a catalog query + a source test)
- [ ] No URL anywhere is derivable from content
- [ ] Two accounts uploading identical bytes produce two `media_objects` rows and two distinct addresses — **tested**
- [ ] Every read path resolves authorization from the reference row, never from object existence — **tested per bucket**
- [ ] A `friends`-privacy post's bytes are **not** publicly fetchable — **tested with an anonymous request, not the catalog (trap #5)**
- [ ] Server-side hash recomputation gates usability
- [ ] `media_objects` has RLS, matching the 141/141 standard

---

## 2. RANKING — THE PROOF OBLIGATIONS

Proposed ordering:

```sql
ORDER BY COALESCE(p.viewer_count, 0)
       + (hashtextextended(p.id::text || _seed, 0) & 2147483647)::float8
         / 2147483647.0 * 6.0
       ASC, p.id
```

You required proof of no duplicates, no omissions, and preserved fairness. Here are those as executable properties, each with a threshold. **All five must pass on the seeded harness at 10k and 100k posts before pagination is called solved.**

| # | Property | Test | Pass condition |
|---|---|---|---|
| **R1** | **Completeness + uniqueness** | Fix a seed, paginate to exhaustion, collect every id | Returned multiset == set of visible ids, **each exactly once**. Zero duplicates, zero omissions — not sampled, exhaustive |
| **R2** | **Determinism** | Same seed, same dataset, twice | Byte-identical ordering |
| **R3** | **Fairness preserved** | Spearman correlation between `viewer_count` and rank position, new vs current `random()` implementation, 1,000 trials each | New correlation within **±0.05** of current. This is the test that stops us eliminating duplicates by accidentally destroying the reach-equalising behaviour |
| **R4** | **Reshuffle is meaningful** | Kendall's tau between orderings under 100 seed pairs | mean τ **< 0.3**; and mean absolute rank displacement **> 20%** of corpus size. A refresh must genuinely reshuffle, not permute the tail |
| **R5** | **No viewer-linkability** | Correlate two different viewers' orderings under the same seed | τ must show the seed is per-session, not a global shuffle that leaks one viewer's ordering to another |

**And the case not yet raised, which is the one that actually breaks keyset pagination in production:**

**R6 — insertion and deletion mid-session.** A post created after a member started paginating gets a rank score under the current seed. If that score sorts *before* the cursor, the member never sees it until refresh. That is **acceptable and correct** for a keyset cursor — but it must be a stated product behaviour with a "new posts available" affordance, not a silently discovered omission. A post deleted mid-session is harmless: the cursor is `(score, id)`, not an offset.

**R7 — `viewer_count` changes mid-session.** The rank score depends on `viewer_count`, which the Phase 1 trigger now maintains live. A post whose count changes between page 2 and page 3 **moves**, and can therefore be duplicated or skipped — *this defeats R1 in production even though R1 passes on a static harness.* 

**Resolution, and it is not optional:** snapshot the rank input at session start. Either bucket `viewer_count` coarsely (e.g. `floor(viewer_count/5)`) so ordinary drift does not reorder, or materialise the score per (viewer, seed) for the session's duration. **R1 must be re-run against a dataset with concurrent writes**, not a frozen one. A static-only pass here would be exactly the class of false green the audit found three times.

---

## 3. MEDIA CONTRACT — RELATIONAL, NOT PARSED

Your correction — explicit metadata rather than filename convention — is right, and it also removes the last reason `image_meta` existed.

```sql
CREATE TABLE public.post_media (
  post_id   uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  ord       int  NOT NULL,
  media_id  uuid NOT NULL REFERENCES public.media_objects(id),
  PRIMARY KEY (post_id, ord)
);
```

The feed RPC then returns one `media jsonb` column, already resolved server-side — **the client constructs no URLs at all**:

```json
[{ "id": "…", "w": 2000, "h": 1333,
   "thumb":  "https://cdn…/media/<id>/600.webp",
   "feed":   "https://cdn…/media/<id>/1080.webp",
   "detail": "https://cdn…/media/<id>/1440.webp",
   "original":"https://cdn…/media/<id>/original.webp" }]
```

This retires, in one move: `intrinsicFromName()`, `buildThumbFirstSrcSet()`, `isTransformable()`, `buildSrcSet()`, `buildRenderUrl()`, `buildLqipUrl()`, the filename `-wWhH` convention, and the `image_meta` column that never shipped. **Filename parsing stops being load-bearing** — which is the root cause of 153 of 258 slides having no `srcset` today.

Migration safety: `image_urls`/`thumbnail_urls` stay populated and correct throughout. The new `media` column is **additive**, and the client selects on payload shape (`"media" in first`) exactly as `rpcHasThumbs` does today — so an installed APK keeps working unchanged. One DROP/CREATE of `get_broadcast_feed`, not two.

---

## 4. UPLOAD — A STATE MACHINE THAT MAKES ALL 8 KILL POINTS SAFE

Your 8-point kill test cannot be passed by adding retry to the current design. It needs the post and its media to be created in a defined order with a resumable state. That is the design:

```
client generates idempotency_key (uuid), once, before anything

1. INSERT posts (status='pending_media', idempotency_key)   ← unique index on (user_id, idempotency_key)
2. per photo: INSERT media_objects (owner_id, sha256, …)     ← unique (owner_id, sha256) makes this idempotent
3. presign → PUT to media/<object_id>/original.webp          ← same bytes, same object_id, always
4. server verifies checksum, recomputes sha256
5. derivative worker writes 600/1080/1440, sets derivatives
6. INSERT post_media rows
7. UPDATE posts SET status='published'
```

| Kill point | State on relaunch | Recovery |
|---|---|---|
| 1. before presign | post `pending_media`, no media rows | resume from step 2; or swept after N hours |
| 2. after presign | as above, presign simply expires | re-presign, no orphan — nothing was written |
| 3. 10% uploaded | partial object at a **known** key | re-PUT same key, overwrites itself. **No orphan is possible** |
| 4. 50% | same | same |
| 5. 90% | same | same |
| 6. after original uploaded | `media_objects` row exists, `derivatives` empty | worker resumes at step 5 |
| 7. after derivatives | derivatives set, no `post_media` | resume at step 6 |
| 8. after DB post creation | `published` | done — retry with the same `idempotency_key` is a no-op |

**Zero duplicate posts** — `UNIQUE (user_id, idempotency_key)`. **Zero orphan objects** — every key is deterministic from `(owner, content)`, so a retry lands on the same address; anything unreferenced after the sweep window is provably garbage. **Zero duplicate media objects** — `UNIQUE (owner_id, sha256)`.

The sweep is now exact rather than a guess: `media_objects` with no reference row, older than the window. That is a correctness property, not a heuristic — unlike today's `purge-s3-orphans`, which infers liveness from UUID path segments and covers only `competition-photos/`.

---

## 5. THE PHOTOGRAPHY DIFFERENTIATION — RESTATED AS VERIFIABLE PROPERTIES

Your correction is fair; I was writing marketing. Rewritten as claims about our own pipeline that can each be tested:

| Property | How it is verified |
|---|---|
| A member can retrieve the exact bytes they uploaded, indefinitely | byte-comparison of download vs upload |
| The full-resolution stored image is encoded to a measured perceptual target, not a fixed quality number | SSIM/butteraugli score per image within a stated band |
| Colour profile is preserved end to end | a Display-P3 source round-trips without conversion to sRGB |
| Capture metadata is retained and displayable | camera, lens, focal length, aperture, shutter, ISO present after upload |
| GPS is removed by default, restorable only by explicit opt-in | EXIF GPS block absent in stored bytes unless opted in |
| Feed delivery never exceeds the measured slot requirement | Phase 2 gate |

No comparison to any other platform appears. If marketing wants one later, it can be made from these measurements — that is a different exercise with a different standard of proof.

**Current baseline for the second row:** `webpQuality: 0.92` (`imageCompression.ts:33`), measured at 335 KB where a q82 re-encode of the same 2000×1333 pixels is 157 KB. Roughly 2× heavier than the resolution requires, with no perceptual justification behind the number.

---

## 6. THE GATE REPORT — SO THE ARTIFACT IS NEVER "CLAUDE SAYS IT'S READY"

At each phase boundary you receive one document containing exactly these sections. No phase advances without it.

1. **Claim** — the numeric gate, stated before the work began
2. **Instrument** — what measured it, and the identical measurement taken *before* the change
3. **Result** — measured after, same instrument, same dataset
4. **Verdict** — PASS / FAIL against the pre-stated number. No prose verdicts
5. **Regressions** — full gate re-run: `tsc -b`, `vitest`, `npm run build`, `security-audit.mjs`, and the advisor ERROR count
6. **What I could not verify** — explicitly, with the reason
7. **The invariant lock** — the test added that will fail if this work is ever silently reverted
8. **Abort criteria met?** — yes/no

Section 7 is the one that matters most over time. This project has had a fix silently revert with the guard test green — `feedFreshness.test.ts:31-46` records the COALESCE guard missing from production for eight days, and the audit found `postCategoriesPhaseB.test.ts:51` doing the same thing *today*, pinned to a superseded migration. **Every architectural invariant in this plan gets a test that reads the newest definition at run time.**

| Invariant | Lock |
|---|---|
| Visibility stays sargable | plan-shape assertion: the feed plan must contain `Index Scan`, never `Seq Scan on posts` |
| The 207× LATERAL never returns | plan assertion: `loops=1` on the viewer aggregation |
| No original in a feed card | asset-size assertion against a rendered page |
| `sha256` never leaves the server | catalog + source assertion, zero occurrences in any return type |
| Realtime bindings stay filtered | source assertion: zero unfiltered bindings on `posts`/`post_reactions` |
| One `feed-live` channel per client | source assertion that `useFeedRealtime` is primary-instance guarded |
| Ranking determinism | R1–R7 in CI against the harness |

---

## 7. PHASES — WORK · GATE · ABORT · ROLLBACK · LOCK

### Phase 0 — Security, build integrity, instrument
*No app build. Nothing user-visible.*

- **Work:** revoke `enqueue_email` from `anon`/`authenticated` + queue allow-list + `auth.uid()` gate · audit the other 247 anon-granted SECURITY DEFINER functions · CI `tsc -b` + fix the 2 exposed errors · 4 advisor ERRORs · leaked-password protection · 1 critical/19 high npm advisories as their own change · **seeded harness on a Supabase branch at production ratios including a realistic share of `friends`-privacy posts**
- **Gate:** `has_function_privilege('anon','enqueue_email','EXECUTE')` = **false** · ungated anon-executable mutating functions = **0** · `tsc -b` exit 0 with `--listFiles` > 0 · advisor ERROR = **0** · npm critical = **0** · harness reproduces a plan at 1M posts
- **Abort:** revoking `enqueue_email` breaks a live email path → restore the grant immediately, ship the internal gate first, revoke after
- **Rollback:** each item independently reversible; no data migration in this phase
- **Lock:** a test asserting no SECURITY DEFINER function is anon-executable without an `auth.uid()`/role check

### Phase 1 — Feed database
*No app build. One migration, three overloads, one DROP/CREATE.*

- **Work:** `is_public` generated column + partial index · maintained `viewer_count` replacing the LATERAL · deterministic seeded ordering · drop the 2 duplicate indexes
- **Gate:** at **100k** posts on the harness — **< 50 ms** and **< 2,000 buffers** per feed page · plan shows Index Scan · `loops=1` · **R1–R7 all pass, including R1 under concurrent writes**
- **Abort:** R3 fails (fairness correlation moves > ±0.05) → ship sargability and `viewer_count` alone, hold the ranking change. They are independent wins and must be separable in the migration
- **Rollback:** matching file in `supabase/rollback/`, round-trip tested. `is_public` is generated, so dropping it cannot lose data
- **Lock:** plan-shape assertions + R1–R7 in CI

### Phase 2 — Media
*Server-side first. Client half is **build #1 of 2**.*

- **Work:** design-gate checklist §1.5 signed off · `media_objects` + `post_media` · **friends-privacy objects moved off the public bucket** · recover dimensions for the 153 slides with none · generate 600/1080/1440 server-side, **WebP only** · feed RPC returns resolved `media` · client reads `media`, deletes the dead transform path, adds `width`/`height` and `fetchPriority="high"` on the first card
- **Sequencing, and this ordering is not negotiable:** generate derivatives for **100%** of existing media and verify coverage **before** the client flips. A partial flip serves 404s. The client must also fall back per-image if a derivative is missing
- **Gate — device-network-observed, per your correction:** on a real **390×844 DPR-3 Android device**, from the **APK** (not a desktop emulation): every image fetched for a 10-card feed has long edge **≤ 1440 px**, **zero** requests to `/original.`, and total transfer for those 10 cards **≥ 70% below** the pre-change baseline captured on the same device with the same posts
- **Abort:** derivative coverage < 100% at flip time, or the WebView origin test fails (trap #1) → hold the client build; the server work stands alone and is harmless
- **Rollback:** client reverts to `image_urls`/`thumbnail_urls`, which stay correct throughout. New tables are additive and droppable
- **Lock:** asset-size assertion; a non-test-importer assertion (trap #11); a test that `sha256` appears in no return type

### Phase 3 — Upload
*Client-heavy. **Build #2 of 2**.*

- **Work:** the §4 state machine · PUT retry with backoff · `AbortController` + timeout · re-presign on 403 · `XMLHttpRequest` progress · IndexedDB pending state · ref-count orphan sweep on all buckets, scheduled · encode+hash into a Worker · remove the base64 round-trip at `WallPosts.tsx:408-469`
- **Gate — your 8-point test, exactly:** force-quit at each of the 8 stages; after relaunch and resume, assert **exactly one logical post · zero orphan objects · zero duplicate media objects** at every one of the 8. Plus: network killed at 50% of a 5-photo upload, force-quit, relaunch → the same post completes
- **Abort:** any kill point produces a duplicate post or an orphan → the state machine is wrong; stop and fix the model, do not paper over it with cleanup
- **Rollback:** feature-flag the new path; the old path stays until 8/8 pass in production
- **Lock:** the 8-point matrix runs in CI against a simulated harness

### Phase 4 — Pagination and realtime
- **Work:** keyset cursor, exclusion array removed · `useIsPrimaryInstance` on `useFeedRealtime` · fix `Feed.tsx:298` running the wall query behind `composerOnly` · server-side `filter:` on the 5 unfiltered bindings · collapse duplicate global `user_roles` subscriptions · window `/profile` + `maxPages` · fix `useProfileMutations.ts:138`
- **Gate:** `_exclude_ids` at page 100 = **0 UUIDs** (from 990) · `/feed` opens **1** `feed-live` channel · unfiltered hot-table bindings = **0** · a wall scrolled 30 pages holds **≤ 15** mounted cards · at 500 simulated concurrent members, messages per reaction ≈ **1 per interested client**, not 500
- **Abort:** R1 fails under production concurrency → revert to the exclusion array; it is slow, not wrong
- **Lock:** source assertions for the filters and the primary-instance guard

### Phase 5 — Observability
*Starts in parallel with Phase 1, not after Phase 4.*

- **Work:** instrument feed + RPC latency (`logger.timed()` has 0 call sites) · sampled `networkTracer` in production · `unhandledrejection` + `window.onerror` · **native crash/OOM reporting** · realtime subscribe status · **a second independent sink with alerting**
- **Gate:** you can state, without opening an editor — feed p95 yesterday, upload failure rate, crash rate per build, and **CDN egress per 1,000 feed views** (the #1 cost line for a photo platform, currently unmeasured)
- **Abort:** none — this phase only adds visibility
- **Lock:** a test that `logger.timed()` has ≥ 1 call site on the feed path

### Then, and only then
Re-audit end-to-end against the harness at 1M. **Fan-out (`feed_items`) is considered only if that measurement shows the centralised query is the bottleneck** — not before. Deterministic ranking (Phase 1) is what keeps that door open.

**iOS after Phase 2, not before** — it would otherwise inherit every image-delivery defect and double the surface to fix them on.

---

## 8. THE DECISIONS I NEED

1. **Withdraw `20260813190000_post_image_meta`?** (§0.3) My recommendation: yes — revert both local commits, roll the dimension backfill into Phase 2 against `media_objects`.
2. **Per-owner content-addressing** (§1.2) — confirm you accept losing cross-user storage dedup in exchange for a structurally closed side channel and correct deletion/takedown semantics.
3. **Friends-privacy media on the public bucket** (§1.3) — currently harmless because 100% of production posts are public. Confirm this is fixed **inside** Phase 2 rather than deferred, since it becomes a real disclosure the day the feature is used.

Nothing in Phase 0 depends on these three. Phase 0 can begin immediately.
