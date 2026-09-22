# 50mm Retina — Engineering plan to production-grade media platform

**Written against:** the measured findings in `POST_REMEDIATION_FORENSIC_AUDIT_2026-08-13.md`.
**Retraction carried forward:** the previous document's "two months gets this to 7.5–8" was a prediction stated as a conclusion. No schedule estimate appears in this plan. Each phase has an **acceptance gate expressed as a number**, and the phase is done when the number is met — not when a date passes.

---

## 0. THREE STRUCTURAL DISAGREEMENTS WITH THE OBVIOUS PLAN

The obvious plan orders work by severity: security, then database, then media, then upload, then pagination, then observability. That ordering is correct about *importance* and wrong about *sequence*, for three reasons.

### 0.1 Order by irreversibility, not severity

Some decisions here are one-way doors. Once 10,000 photographs are stored under a key scheme, the scheme is effectively permanent — every migration afterwards is a bulk copy of terabytes. Once a ranking model ships, changing it changes what every member sees.

The one-way doors, in the order they must be decided:

| Decision | Why it is one-way | Blocks |
|---|---|---|
| **Storage key scheme** | Re-keying N objects costs N× egress + N× ingest, forever growing | derivatives, upload retry, orphan cleanup, dedup, CDN caching |
| **Ranking determinism** | Changing what "next page" means changes the product | pagination, caching, fan-out, any read replica |
| **Derivative ladder + generation site** | Pre-generated tiers are stored objects; changing the ladder means regenerating all of them | CDN cost, upload cost, app build cadence |

Everything else in the plan is reversible in an afternoon. **Decide these three first, even though none of them is the most urgent thing.**

### 0.2 Build the measuring instrument before the first fix, not inside Phase 1

The audit's most useful sentences are the ones with numbers attached, and every number above 210 posts in it is extrapolation — I said so at the time. A seeded-dataset harness is not a step *within* the database phase; it is the instrument that makes every claim in every later phase checkable.

It is also cheap: generate posts, profiles, follows, friendships and `feed_events` at realistic ratios into a Supabase **branch** (the connector supports `create_branch`), then run the same `EXPLAIN (ANALYZE, BUFFERS)` at 10k / 100k / 1M and diff. Without it, Phase 1 ends with "it looks faster."

Current production ratios to preserve when seeding, measured 2026-08-13:

```
210 posts / 94 profiles      = 2.23 posts per profile
989 feed_events / 210 posts  = 4.7 events per post
952 reactions / 210 posts    = 4.5 reactions per post
210 comments / 210 posts     = 1.0 comments per post
294 follows / 94 profiles    = 3.1 follows per profile
173 friendships / 94         = 1.8 friendships per profile
100% of posts are privacy='public'
```

⚠ That last line matters more than it looks. **Every plan measurement so far has been taken on a dataset where `can_view_post` never once had to call `are_friends()`.** The seed must include a realistic share of `friends`-privacy posts, or Phase 1 will be measured on the easy case again.

### 0.3 Exploit the shipping asymmetry — it is the strongest lever this project has

| | Database / edge function | Client bundle | Android app |
|---|---|---|---|
| Deploy cost | one migration | one Cloudflare Pages build | AAB → owner uploads → Play review → **users must update** |
| Reversible | yes, rollback file | yes, redeploy | **no** — an installed build is permanent |
| Reaches everyone | immediately | on next load | over weeks, never fully |

**So: every change that can be made server-side should be, and client changes should be batched into as few builds as possible.** Phase 0, 1 and most of 2 require **zero app builds**. That is not a scheduling convenience — it means most of this plan is reversible, and only a small tail is not.

And the pattern for making a client change safe across that gap already exists in this codebase and is its single best idea: `useFeedQuery.ts:214-227` decides behaviour from the **payload shape** rather than a version flag, so an old installed APK and a new server negotiate without either knowing about the other.

> ```ts
> const rpcHasThumbs = "thumbnail_urls" in first;
> ...
> rpcHasThumbs ? Promise.resolve({ data: [] }) : supabase.from("posts").select(...)
> ```

**Every server contract change in this plan must use that pattern.** It is what makes "never break an installed build" a property rather than a hope.

---

## 1. THE THREE ONE-WAY DOORS

### 1.1 Content-addressed storage — the highest-leverage change in this document

**Today**, the key is `post-images/<uid>/posts/<Date.now()>-<random>-w1440h960.webp` (`imageUpload.ts:56-58, 83, 300-307`). Because the key is derived from the clock, the same photograph uploaded twice produces two objects, and the audit traced four separate defects to exactly that:

- a retry after a failed PUT generates a **new** key → the first attempt's bytes are orphaned (audit K8)
- duplicate detection hashes `md5(content ‖ image_urls)`, so a retry has different URLs → **different hash → the 10-minute guard never fires** (K6)
- there is no idempotency, so resumable upload cannot be added safely
- orphan cleanup has to *guess* liveness from UUID path segments, and covers only `competition-photos/` (K9)

**Proposal.** Key every object by the SHA-256 of its bytes:

```
media/<sha256[0:2]>/<sha256>.webp            ← the stored original
media/<sha256[0:2]>/<sha256>/1080.webp       ← derivative
media/<sha256[0:2]>/<sha256>/1440.webp
```

with a `media_objects` table: `sha256 (PK), width, height, bytes, mime, created_at`, and a join table carrying references from posts/entries/gallery.

**What this single decision fixes, at once:**

| Problem | How content-addressing solves it |
|---|---|
| Retry orphans bytes | Same bytes → same key. A retry overwrites itself. **Orphans become structurally impossible for retries.** |
| Upload not idempotent | PUT is idempotent by construction. Resumable/chunked upload becomes safe to add. |
| Duplicate detection defeated by retry | Exact and free — the key *is* the content identity. No `md5(urls)` trigger needed. |
| Orphan cleanup is a guess | Becomes a reference-count sweep: `media_objects` with zero references, older than N days. Exact, and it covers every bucket. |
| CDN cannot cache aggressively | Content-addressed objects are immutable → `Cache-Control: public, max-age=31536000, immutable`. **This is a larger CDN win than the derivative ladder itself.** |
| Derivative addresses must be stored, never derived (the 2026-08-07 incident) | Derivatives are deterministic children of an immutable hash, so deriving is safe *precisely because* the parent cannot change. The rule that made string-derivation dangerous no longer applies. |

The client already reads the whole file into memory twice (`WallPosts.tsx:408-469`), so `crypto.subtle.digest('SHA-256', buffer)` adds one pass over data already resident — and the audit's Part Q says that base64 round-trip should be removed anyway.

**The honest costs and risks:**

- **Migration.** 258 existing slides must be re-keyed or dual-referenced. At today's volume this is an afternoon; at 100k it is not. *This is the argument for deciding it now.*
- **A cross-user dedup side channel.** If two members upload identical bytes and the system visibly dedupes, member A can test whether a specific image already exists. Mitigation: always write the reference row and never expose dedup in any response. Ref-counting stays internal.
- **"Replace this image" becomes "point at a different hash"** — which is what you want anyway, and it makes edit history free.
- **Hash-on-client must be verified server-side** or a malicious client can poison a key. The presign function must recompute or, more simply, R2's `Content-MD5`/checksum enforcement must be used.

### 1.2 Deterministic ranking — this is what unblocks pagination

You wrote that keyset pagination is complicated because the feed has a fairness/randomisation ranking, so `WHERE created_at < cursor` is not equivalent. That is exactly right, and it is the crux. But the conclusion is not "pagination is hard." It is:

> **The problem is not that the ranking is random. It is that the randomness is non-deterministic.**

Live ordering, read from production:

```sql
ORDER BY COALESCE(imp.viewers, 0) + random() * 6.0 ASC
```

`random()` is re-evaluated every call, which is why the function must be `VOLATILE`, why the same post can appear twice across pages, why the exclusion array exists at all, and why nothing about this feed can ever be cached.

**Replace `random()` with a deterministic hash of (post, viewer, session seed):**

```sql
ORDER BY COALESCE(imp.viewers, 0)
       + (hashtextextended(p.id::text || _seed, 0) & 2147483647)::float8 / 2147483647.0 * 6.0
       ASC, p.id
```

`_seed` is a value the client generates once per feed session and sends with every page.

What that one change buys:

- **The ordering becomes a stable total order for the duration of a session** → a keyset cursor `(rank_score, id) > (last_score, last_id)` is now *exactly* correct, not an approximation.
- **The exclusion array disappears entirely.** 990 UUIDs at page 100 → 0. The O(P×N) per-row array scan → gone.
- **Fairness is preserved, not sacrificed.** Every viewer still gets a differently-shuffled feed; low-viewer posts still surface first; a new seed on pull-to-refresh reshuffles.
- **The feed becomes cacheable and replicable** — a stable ordering can be materialised, served from a read replica, or fanned out later. Non-deterministic ordering forecloses all three permanently.

This is the smallest possible change that unblocks pagination, caching, read replicas and eventual fan-out simultaneously. It should be made in the same migration as the sargable visibility fix, because both touch the same function and each DROP/CREATE of `get_broadcast_feed` is a risk event (trap #3).

### 1.3 The derivative ladder — pre-generate, server-side, keyed by hash

Measured slots (audit Part D): feed card is **exactly 590 CSS px** on desktop and `100vw` on phones; phone need is **720–1505 device px, clustered ~1080**.

| Tier | Long edge | Serves | Format |
|---|---|---|---|
| `thumb` | 600 | grids, 117px strip, DPR-1 desktop card | WebP + AVIF |
| `feed` | **1080** | phone card at the dominant DPR cluster; desktop 590@DPR2 = 1180, within 10% | WebP + AVIF |
| `detail` | **1440** | 412×3.5 phones, desktop retina headroom, full-screen viewer | WebP + AVIF |
| `original` | ≤2560 | zoom and download **only** — and it must stay the untransformed, CORS-clean URL | WebP |

**Generate server-side, not on the client.** The client already does 2 WebP encodes and 4 full decodes per photo on the main thread (Part Q). Adding two more tiers would make that 4 encodes and 6 decodes on a mid-range Android. Generation belongs in an edge function modelled on `supabase/functions/backfill-thumbnails/`, which already parses both Supabase and CDN URL shapes.

**Do not build the pipeline on Cloudflare's `/cdn-cgi/image/`.** It works — I verified 200 OK from `www` and `cdn` — but it is zone configuration outside this repository that has flipped once already (trap #1), it sends **no CORS headers** so it can never serve the download or canvas path, and the free plan caps at 5,000 unique transforms per month. Use it as the *fallback for legacy objects only*, always behind `originalOnError`.

---

## 2. PHASES, EACH WITH A NUMERIC ACCEPTANCE GATE

No phase is "done" until its gate is met and re-measured with the same instrument.

### Phase 0 — Security, build integrity, and the measuring instrument
*No app build. Nothing user-visible.*

| # | Work | Gate |
|---|---|---|
| 0.1 | `REVOKE EXECUTE ON FUNCTION public.enqueue_email(text,jsonb) FROM anon, authenticated;` then add a queue-name allow-list + `auth.uid()` check before any grant is restored | `has_function_privilege('anon', …)` returns **false** |
| 0.2 | Audit the other 247 anon-granted SECURITY DEFINER functions for a missing `auth.uid()` gate. `enqueue_email` proves a spot check is insufficient | every mutating anon-executable function either gates internally or is revoked; **count of ungated = 0** |
| 0.3 | CI typecheck → `npx tsc -b`; fix the 2 exposed errors | `tsc -b` exit 0, and `--listFiles` > 0 |
| 0.4 | 4 ERROR-level `security_definer_view` advisors; 8 mutable `search_path`; enable leaked-password protection | advisor ERROR count **0** |
| 0.5 | Address the 1 critical / 19 high npm advisories — as their own reviewed change with their own build (trap #6) | `npm audit` critical **0** |
| 0.6 | **The seeded-dataset harness**, on a Supabase branch, at production ratios *including a realistic share of `friends`-privacy posts* | `EXPLAIN ANALYZE` reproducible at 10k / 100k / 1M |

**Phase 0 gate: the repository is genuinely green** — `tsc -b` clean, 1,336 tests passing, security audit 0/0, advisor ERRORs 0, and the harness can produce a plan at 1M posts on demand.

### Phase 1 — Feed database
*No app build. One migration, all three overloads, one DROP/CREATE.*

| # | Work | Gate |
|---|---|---|
| 1.1 | `is_public boolean GENERATED ALWAYS AS (privacy = 'public') STORED` + `CREATE INDEX … (is_public, created_at DESC) WHERE is_public`. Generated column = no write-path code, no drift | plan shows **Index Scan, not Seq Scan** |
| 1.2 | Replace the `count(DISTINCT)` LATERAL with a maintained `viewer_count` on `posts` (trigger on `feed_events`) | **`loops=1`, not `loops=207`** |
| 1.3 | Deterministic seeded ordering (§1.2) | same post never returned twice across pages for one seed |
| 1.4 | Drop duplicate indexes: `idx_feed_events_post` vs `_post_id` (identical), `idx_posts_user_id` (prefix of `_user_id_created_at`) | index count down 2, no plan regression |
| 1.5 | Re-measure at 10k / 100k / 1M on the harness | see gate |

**Phase 1 gate, measured on the harness at 100k posts:** feed page **< 50 ms** and **< 2,000 buffer hits**. Today at 210 posts it is 10.751 ms / 1,072 buffers, with the sargable form at 1.358 ms / 10 buffers — so this gate is demanding but grounded in a measured 107× headroom.

### Phase 2 — Media pipeline
*Server side needs no build. The client half is build #1 of two.*

| # | Work | Gate |
|---|---|---|
| 2.1 | `media_objects` + content-addressed keys (§1.1); dual-reference the 258 existing slides | every new upload is hash-keyed; zero orphans creatable by retry |
| 2.2 | Immutable `Cache-Control` on content-addressed objects | `max-age=31536000, immutable` verified on a real response |
| 2.3 | Recover dimensions for the **153 slides that have none**, server-side (byte-read), modelled on `backfill-thumbnails` | **258 / 258** slides have dimensions |
| 2.4 | Generate `1080` + `1440` server-side for every existing and new object | 258 × 3 derivatives present |
| 2.5 | Client: four-candidate `srcset`; delete the dead `buildSrcSet`/`buildRenderUrl`/`isTransformable` path; add the non-test-importer assertion (trap #11); add `width`/`height` and `fetchPriority="high"` on the first card's sharp image | **0 slides without `srcset`** |
| 2.6 | Guard the download/canvas path against transformed URLs — no CORS on `/cdn-cgi/image/` | a transformed URL can never reach `loadImageFromUrl` |
| 2.7 | **Test from the Android WebView origin** before shipping | photos render in a real APK on a real device |

**Phase 2 gate:** on a 390×844 DPR-3 phone, the largest image transferred for a feed card is **≤ 1440 px on its long edge**, and the measured bytes for a 10-card page fall by **≥ 70%** against today's baseline. Verify with the network panel on a real device, not a simulator — the audit's whole trap #1 is that the wrong origin passes.

### Phase 3 — Upload reliability
*Client-heavy. Build #2.*

| # | Work | Gate |
|---|---|---|
| 3.1 | Retry with backoff on the **PUT** (today only the 2 KB presign call retries; the multi-MB transfer does not) | a PUT failure retries ≥ 3× |
| 3.2 | `AbortController` + timeout — there are currently **zero** in `src/`, so a stalled PUT hangs forever | no request outlives its timeout |
| 3.3 | Re-presign on 403 rather than surfacing the S3 body. Both PUTs share one `amzDate`; a 50 MB entry exceeds the 300 s TTL below ~1.4 Mbps | expiry no longer terminal |
| 3.4 | `XMLHttpRequest` for real progress (`fetch` cannot report upload progress) | byte-accurate progress UI |
| 3.5 | Persistent pending-upload state (IndexedDB), resumable via content-addressed idempotency from §1.1 | an app kill mid-upload resumes, does not restart |
| 3.6 | Extend orphan purge to all buckets as a **ref-count sweep**, and give it a schedule — today it is competition-only and has no trigger at all | scheduled; orphan count trends to 0 |
| 3.7 | Move encode/hash off the main thread into a Worker; remove the base64 round-trip at `WallPosts.tsx:408-469` | 0 synchronous full-buffer passes on the main thread |

**Phase 3 gate:** with the network killed at 50% of a 5-photo upload and the app force-quit, relaunching **completes the same post** with no duplicate objects and no orphans. That is the test; anything less is not production-grade.

### Phase 4 — Pagination and realtime
*Server-mostly. Client half rides build #3 or waits.*

| # | Work | Gate |
|---|---|---|
| 4.1 | Keyset cursor on `(rank_score, id)`, enabled by §1.2. Remove the exclusion array | `_exclude_ids` payload at page 100: **990 → 0 UUIDs** |
| 4.2 | `useIsPrimaryInstance` on `useFeedRealtime` — the guard already exists for the bell and was not carried across; and fix `Feed.tsx:298` running the wall query behind `composerOnly` | `/feed` opens **1** `feed-live` channel, not 2 |
| 4.3 | Server-side `filter:` on the 5 remaining unfiltered `posts`/`post_reactions` bindings | 0 unfiltered bindings on hot tables |
| 4.4 | Collapse the duplicate global `user_roles` subscriptions; scope `profile-map-badges` so one badge grant does not bust every client's cache | global always-on channels ≤ 3 |
| 4.5 | Window `/profile`; give `useUserPostsQuery` a `maxPages` | mounted PostCards on a wall **≤ 15**, not 300 |
| 4.6 | Fix `useProfileMutations.ts:138` (invalidates a one-element ID-set key nothing writes) | a profile edit refreshes feed author lines |

**Phase 4 gate:** at 500 simulated concurrent members, realtime messages delivered per reaction is **≈ 1 per interested client**, not 500. And a wall scrolled 30 pages holds ≤ 15 mounted cards.

### Phase 5 — Observability
*Should start in parallel with Phase 1, not after Phase 4.*

The existing first-party pipeline (`log_app_event` → `client_errors`, 75-code catalog with mandatory resolutions) is a genuinely good base. What is missing is **latency and crash**, plus a second sink.

| # | Work | Gate |
|---|---|---|
| 5.1 | Instrument feed and RPC latency — `logger.timed()` exists with **0 call sites** | p50/p95/p99 queryable for feed + every RPC |
| 5.2 | Un-gate `networkTracer` for production behind a sampling flag (today dev-only, twice) | sampled request timings in production |
| 5.3 | `unhandledrejection` + `window.onerror` capture — neither exists | both captured |
| 5.4 | Native crash + OOM reporting. **An Android OOM currently produces no signal at all** — the exact failure the windowing work was done to prevent | crash rate measurable per build |
| 5.5 | Realtime channel status — 25 of 26 `.subscribe()` ignore it | subscribe failure rate measurable |
| 5.6 | **A second, independent sink with alerting.** Supabase is currently the sole sink, and both senders swallow their own rejection by design — so a Supabase outage is invisible *by construction* | an outage pages someone |

**Phase 5 gate:** you can answer, without opening a code editor: what was feed p95 yesterday, what fraction of uploads failed, and how many app sessions ended in a crash.

---

## 3. WHAT MAKES IT *BETTER* THAN INSTAGRAM, NOT JUST EQUAL

Everything above is catching up. This section is the part that is actually a differentiator, and it is available precisely because you are a photography platform and they are not.

**Instagram is, by the standards of photographers, bad at images.** It recompresses hard, caps effective resolution, discards colour profiles, and strips metadata. It optimises for feed throughput at a billion users. You do not have that constraint, and your members are people who care about the difference.

Five concrete things, all cheap once Phase 2's pipeline exists:

1. **Quality-targeted encoding instead of a fixed quality number.** Today it is `webpQuality: 0.92` for everything (`imageCompression.ts:33`), which the audit measured as ~2× heavier than needed — 335 KB where a q82 re-encode of the same pixels is 157 KB. A flat number is wrong in both directions: it wastes bytes on smooth images and crushes detailed ones. Encode server-side to a **perceptual target** (SSIM/butteraugli), per image. Photographers see the difference on foliage, skin, and gradients; Instagram does not do this.

2. **AVIF first, WebP fallback.** ~30% smaller than WebP at matched quality on photographic content. With `<picture>` and content-addressed immutable objects, adding a format is a data change, not a code change.

3. **Preserve the colour profile.** Canvas `drawImage` currently converts everything to sRGB and discards Display P3. A photographer who shot and edited in P3 sees their work desaturate on upload. Preserving the profile is a differentiator you can *name in marketing* and Instagram cannot match.

4. **Metadata policy that respects both the photographer and their safety.** Preserve the EXIF photographers care about — camera, lens, focal length, aperture, shutter, ISO — and **strip GPS by default with an explicit opt-in**. `exifr` is already a dependency and already used on the competition path. Displaying shot data under a photograph is a feature the audience actively wants, and it costs one column.

5. **The original is a first-class deliverable, not an accident.** Content-addressing makes "download the original, untouched, with its metadata" trivially correct and permanently cacheable. For a photography community this is a feature, not a bandwidth problem — and it is the single clearest way to say *"we do not destroy your photograph."*

None of these is expensive after Phase 2. All of them are impossible before it.

---

## 4. WHAT I WOULD DELIBERATELY NOT DO

- **Do not migrate to React Native or Flutter.** No measured bottleneck is attributable to the framework. Every one is a query plan, an index, an `<img>` attribute, a missing `filter:`, or an absent retry.
- **Do not build fan-out-on-write yet.** It is the right answer at ~500k users and the wrong answer now — it adds a worker, a consistency problem, and a backfill to solve a problem that §1.1–1.3 solve with an index and a hash. Deterministic ordering (§1.2) is the prerequisite that keeps the door open.
- **Do not add iOS before Phase 2 completes.** It would inherit every image-delivery defect and double the surface on which you have to fix them. After Phase 2 it costs one workflow, because the web layer is already shared.
- **Do not commit `android/`.** Determinism comes from pinned versions. This was decided, correctly, and reversed once already.
- **Do not add video, reels, or live.** Standing rule, and the architecture note is right that a WebView loses on a vertical video feed. If that ever changes, build *that one screen* as a native Capacitor plugin — do not migrate the app.
- **Do not run `npm install <package>` to add a dependency.** It regenerated the lockfile and moved 700+ packages once already. Any dependency change is its own reviewed change with its own build.
- **Do not cut an Android build per phase.** Phases 0 and 1 need none. Batch the client work: **build #1 after Phase 2, build #2 after Phase 3**, and only when each batch is genuinely complete.

---

## 5. THE ONE DECISION I NEED BEFORE PHASE 2

**Content-addressed storage (§1.1) is a one-way door.** It is the single highest-leverage change in this plan — it collapses retry orphans, upload idempotency, duplicate detection, orphan cleanup and CDN cacheability into one property — and it is also the change that gets more expensive every day it is deferred, because it must re-key everything already stored.

Today that is 258 slides. It will not stay 258.

Three options:

- **A — Adopt it now, before the derivative work.** Derivatives are then generated once, into their permanent home. Costs a re-key of 258 objects.
- **B — Adopt it after the derivative ladder.** Ships the visible image win sooner, then re-keys ~1,000 objects (258 originals + derivatives) instead of 258.
- **C — Keep timestamp keys.** Then upload retry, resumability and orphan cleanup each need their own separate mechanism, and none of them can be made exact.

I would take **A**, and the argument is entirely about §0.1: it is the only item in this plan whose cost grows with time.
