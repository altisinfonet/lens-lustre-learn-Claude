# 50mm Retina — Post-Remediation Forensic Audit

**Date:** 2026-08-13 · **Repo state:** local `41b1989`, `origin/main` `8259c5b` · **Production DB:** newest applied migration `20260813171159 feed_author_identity`

**Evidence base.** `npm ci` + `npm run build` + `npx vitest run` + `node scripts/security-audit.mjs` were actually executed. `EXPLAIN (ANALYZE, BUFFERS)` was run against the live production database. The live feed was measured in a real browser on `www`. Nothing in this document is inferred where it could be measured; where it could not be, it says so.

---

## 0. FIRST — A REGRESSION I INTRODUCED, AND THE GATE THAT CAUGHT IT

**FAILED.** `npx vitest run` → **2 failed, 1333 passed, 1 skipped (1336)**. Both failures are in `src/hooks/feed/__tests__/feedFreshness.test.ts`, and **both are caused by the migration I wrote earlier today**, `supabase/migrations/20260813190000_post_image_meta.sql` (uncommitted to GitHub, unapplied to the database).

That test resolves the newest migration defining `get_broadcast_feed` at run time (`feedFreshness.test.ts:49-60`). It now resolves to my file, which:

1. **omits `VOLATILE`** — the previous definition declared it explicitly. Postgres defaults to `VOLATILE`, so runtime behaviour is unchanged, but the explicit invariant the test exists to protect is gone. This is a real regression in intent.
2. contains `feed_tier      text,` (aligned columns) where the test's regex demands `/feed_tier text/` with exactly one space. This one is a brittle test, not a code defect.

The gate did exactly what it was built to do. **The migration must not be applied until both are fixed.** This also means the claim "1,335 tests, all green" in `docs/status-done-and-remaining.md` is no longer true of the working tree.

**Separately — the documented gate `npx tsc --noEmit` checks nothing at all.** VERIFIED empirically with `--listFiles`:

| command | files checked | exit | errors |
|---|---:|---:|---:|
| `tsc --noEmit -p tsconfig.json` | **0** | 0 | 0 |
| `tsc --noEmit -p tsconfig.app.json` | 1643 | 2 | **2** |
| `tsc -b tsconfig.json` | — | 2 | 2 |

`tsconfig.json:15` is `"files": []` with `references` (`:16-23`); without `-b`, `tsc` ignores references. The Android build's *blocking* typecheck (`.github/workflows/android-build.yml:116`) uses the no-op form. The two real errors it has been hiding — **neither of them mine** — are:

```
src/components/feed/__tests__/FeedCardWindow.test.tsx(113,5): TS2578 Unused '@ts-expect-error' directive
src/lib/profileMapCache.ts(344,17): TS2339 Property 'data' does not exist on type '{ error: unknown; }'
```

So the repository does **not** currently pass a real typecheck, and has not been required to.

---

# PART A — TECHNOLOGY FOUNDATION

**VERIFIED.** Declared range → lockfile-resolved version:

| Package | Declared | Resolved | Evidence |
|---|---|---|---|
| react | `^18.3.1` | 18.3.1 | package.json:69 / lock:11617 |
| react-dom | `^18.3.1` | 18.3.1 | :71 / :11643 |
| typescript | `^5.8.3` | 5.8.3 | :107 / :13416 |
| vite | `^7.3.1` | 7.3.1 | :109 / :13818 |
| @tanstack/react-query | **`5.62.0` exact** | 5.62.0 | :50 / :5158 |
| react-router-dom | `^6.30.1` | 6.30.1 | :78 / :11832 |
| @supabase/supabase-js | `^2.97.0` | 2.97.0 | :49 / :4856 |
| tailwindcss | `^3.4.17` | 3.4.17 | :106 / :13038 |
| framer-motion | `^12.34.3` | 12.34.3 | :62 / :8237 |
| @radix-ui/* | 27 declared (`:22-48`), all `^` | all at caret floor | 55 total incl. transitive |

Runtime measured in this session: **Node v22.22.2, npm 10.9.7**. CI: Node 22 (android-build.yml:56, :89), Node 20 (typecheck.yml:15, security.yml:35/:61, health.yml:49) — **one lockfile, two Node majors**. Java Temurin 21 (:91-94). Gradle **8.13** and AGP **8.12.3** exist *only* as `sed` expressions (`:242`, `:241`); `git ls-files | grep gradle` returns **zero files**.

**Pin discipline: 1 of 89 dependencies is exact-pinned.** 88 are caret-ranged. No `engines`, no `packageManager`, no `.nvmrc`.

### Capacitor versions — pinned in the workflow, absent from every lockfile

`package.json` contains **zero `@capacitor/*` entries**; `grep -c "@capacitor" package-lock.json` → **0**. All 11 native packages are installed by `.github/workflows/android-build.yml:154-162`, exact-pinned: `@capacitor/core|cli|android@8.5.0`, `share@8.0.1`, `splash-screen@8.0.2`, `filesystem@8.1.2`, `camera@8.2.2`, `app@8.1.1`, `browser@8.0.4`, `@capacitor-firebase/messaging@8.4.0`, `@capawesome/capacitor-app-update@8.0.3`. A genuinely blocking verification step follows at `:168-191`:

```bash
actual=$(node -p "require('./node_modules/$1/package.json').version")
if [ "$actual" != "$2" ]; then echo "::error::$1 resolved to $actual but this workflow pins $2"; exit 1; fi
```

### > **Can a clean CI build today resolve a different Capacitor major/minor tomorrow without a source change?**

**For the 11 named packages: NO** — the pin check is real and blocking.

**For everything else: YES → FAIL.** Three independent drift channels, all VERIFIED:

1. **`npm ci || npm install --no-audit --no-fund`** — android-build.yml:97, security.yml:62, typecheck.yml:17. Any `npm ci` failure (lock desync, registry 5xx, integrity mismatch) silently degrades to range re-resolution across all 88 caret deps, with a green step and no assertion that the exact path ran.
2. **The Capacitor transitive graph is unpinned and in no lockfile.** `@capacitor/assets@3.0.5` (`:339`) is not covered by the pin check either.
3. **`node-version: 22`** resolves to the newest 22.x at build time.

**Verdict: FAIL**, narrowly — the specific 2026-08 breakage (`@capacitor/cli` raising its Node floor) is now genuinely prevented, but the general property is not.

---

# PART B — CAPACITOR / MOBILE ARCHITECTURE

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Web app bundled locally? | **YES** | `capacitor.config.ts:9` `webDir: 'dist'` |
| 2 | `server.url` absent? | **YES — absent** | capacitor.config.ts:10-12, only `androidScheme: 'https'` |
| 3 | `server.hostname` absent? | **YES — absent** | ditto |
| 4 | Exact web build copied in? | **PARTIALLY VERIFIED** | see below |
| 5 | Android deterministic? | **NO** | Part A; plus unguarded `sed` |
| 6 | iOS present? | **NO** | no `ios/`, no `@capacitor/ios` anywhere |
| 7 | Android/iOS Capacitor versions identical? | **N/A** — no iOS | — |
| 8 | Native plugins version-compatible? | **NOT VERIFIABLE** | see below |
| 9 | Suitable for store release? | **Play: yes with caveats. App Store: no — no iOS project exists.** | |

**Q4 — the weak point. PARTIALLY VERIFIED.** Three assertions exist and they are not the ones you would want:

- `:364-383` **blocking**, but against the *synced tree*, not the artifact, and it greps for **six hardcoded feature strings from 2026-08-12** (`get_contributor_scores`, `Top Contributor`, `All categories`, `Photojournalism`, `Pinned comment`, `caretPlaced`). It proves those six features are present. It cannot prove any newer work is, and it breaks on a copy change.
- `:649-671` **blocking**, and the **only** check performed against the actual `.aab` — it verifies the *notification icon*.
- `:699-716` contains the **only** `assets/public/index.html` check, and `:700` is `continue-on-error: true`. **An AAB containing no web bundle at all would upload green.**

**Q8.** VERIFIED: there are **zero** `@capacitor/*` imports in `src/`. Every plugin is reached through the untyped `window.Capacitor.Plugins` global (`src/lib/native/push.ts:35`, `gallery.ts:55`, `saveFile.ts:86`, `appUpdate.ts:32`, `authDeepLink.ts:58`, `useAndroidBackButton.ts:71`). This is deliberate and test-enforced, and it is the only way the web build can work without the packages — but it means **no compile-time or test-time verification of any plugin contract exists**. A breaking 8.x→9.x change would compile, pass 1,336 tests, pass the pin check, and fail on a user's phone. A Gradle-wiring assertion exists for `camera` only (`:205-214`), added after that exact failure shipped.

**Zero hand-written native code. VERIFIED** — no `.java`, `.kt`, `.swift`, `.gradle`, `.plist`; no `MainActivity`. All native customisation is string surgery in the workflow. The Python injections carry `assert`s (`:330`, `:331`, `:404`); the `sed`s do not — `versionCode`/`versionName`/`minSdk`/`compileSdk` (`:231-234`, `:254`, `:260`) are unguarded literal substitutions, and the follow-up `grep` at `:262` matches whether or not the substitution took.

**Additional finding.** A second, stale, **unpinned** `android-build.yml` sits at the repo root (251 lines) — no security gate, no typecheck/test gate, Node 20, AGP 8.9.1. It is not in `.github/workflows/`, so it does not run, but it is a live trap.

---

# PART C — FEED RENDERING / MOBILE PERFORMANCE

### Virtualization — hand-rolled occlusion culling, and it works on `/feed`

**VERIFIED.** No `react-window`, `react-virtuoso`, or `@tanstack/react-virtual` in `package.json`. `src/components/feed/FeedCardWindow.tsx` is a per-card `IntersectionObserver`:

```
:79   const WINDOW_MARGIN = "1600px 0px";
:89   export const EAGER_CARDS = 3;
:123  const h = el.getBoundingClientRect().height;
:124  if (h > 0) { setPlaceholderHeight(h); setMounted(false); }
:131  { rootMargin: WINDOW_MARGIN }
:139  <div ref={ref} style={mounted ? undefined : { height: placeholderHeight ?? undefined }}>
:140    {mounted ? children : null}
```

### Memory — the arithmetic

**VERIFIED constants:** `PAGE_SIZE = 10` (`useFeedQuery.ts:14`), `maxPages = 5` (`:573`), `staleTime: 0` (`:468`), `refetchOnMount: "always"` (`:469`), `retry: 3` (`:484`). Global `gcTime: 10 min`, `refetchOnWindowFocus: true` (`App.tsx:214-215`).

Retained per feed key: **10 × 5 = 50 posts, hard ceiling.** Mounted at once: window span = viewport + 1600px above + 1600px below ≈ 3,980px on a 412×915 phone; card height 372–671px ⇒ **7–15 PostCards mounted**.

| Posts scrolled | Pages fetched | Pages retained | Posts dropped | **Max cards mounted** |
|---:|---:|---:|---:|---:|
| 100 | 10 | 5 | 50 | **7–15** |
| 500 | 50 | 5 | 450 | **7–15** |
| 1,000 | 100 | 5 | 950 | **7–15** |

**Off-screen images are genuinely released. VERIFIED** — `{mounted ? children : null}` leaves a bare `<div>`; no `<img>` survives, so decoded bitmaps become GC-eligible.

**So the headline remediation is real: 50 mounted → 7–15 mounted, on `/feed`.** Four caveats, all VERIFIED:

1. **`/profile` was never fixed.** `useUserPostsQuery.ts:180-191` sets **no `maxPages`**, and `WallPosts.tsx:1852-1874` renders `PostCard` with **no `FeedCardWindow`**. Scroll a wall 30 pages → **300 PostCards mounted, unbounded.** This is the exact pre-fix OOM condition, fully intact on a route every user visits.
2. **50 wrapper divs + 50 framer-motion nodes stay mounted regardless of scroll** (`Feed.tsx:391-418`). Cheap next to bitmaps, but the list is not virtualized in the DOM sense.
3. **`maxPages: 5` with no `getPreviousPageParam`** — dropped pages are unrecoverable, and each drop removes ~3,700–6,700px **above** the viewport with **no scroll compensation anywhere in the source**. Only the browser's default scroll anchoring prevents a jump; nothing asserts it.
4. **Windowing traded memory for network.** `PostCard.tsx:316` mounts `<ContributorScore>`, and `src/lib/contributorScore.ts:55-72` has **no cache at all** — every re-mount of a culled card fires a fresh `get_contributor_scores` RPC.

Two height defects: the placeholder is **16px short** per card (PostCard's `mb-4` collapses through the wrapper), and a re-mounted **legacy** post re-renders at 4:5 until its image decodes because `measuredAspect` resets on mount (`PostMedia.tsx:56`).

**Bonus defect.** `Feed.tsx:298` mounts `<WallPosts … composerOnly />`; `composerOnly` gates only rendering (`WallPosts.tsx:1834`) while the query fires unconditionally (`:98`). **Loading `/feed` runs a full wall fetch plus enrichment that is never displayed.**

---

# PART D — IMAGE / MEDIA ARCHITECTURE

## Upload

**VERIFIED.** Max source resolution: `imageUpload.ts:262` `const maxDimension = type === "post" ? 2560 : undefined;` — **posts only**. Competition entries, gallery, journal pass `undefined` → `Infinity` (`imageCompression.ts:32`); a 50 MP entry is stored at 50 MP. Max file size 50 MB (`fileSecurityScanner.ts:146`), server twin at `s3-presign-upload/index.ts:12`, but enforced only against the **client-declared** `size` and only `if (size > 0)`; the presigned PUT carries no `content-length-range`.

MIME acceptance is inconsistent across three lists: the composer regex allows AVIF/SVG and rejects HEIC (`WallPosts.tsx:387-388`); the scanner whitelist allows HEIC/HEIF/TIFF and omits AVIF/SVG (`fileSecurityScanner.ts:275-278`); the `<input>` is `accept="image/*"` (`:1351`).

## Derivatives — **exactly two. VERIFIED.**

| Tier | Dimensions | Format | Where | When |
|---|---|---|---|---|
| Full-res | ≤2560 long edge (posts only) | WebP q**0.92** | **Client, main thread** (`imageCompression.ts:181-191`) | Upload |
| Thumbnail | ≤600 long edge | WebP q**0.7** | **Client, main thread** (`:242-251`) | Upload |

No 1080. No 1440. No server-side generation anywhere in `supabase/functions/`. `compressThumbnail` is handed the **original** file (`imageUpload.ts:314`), so the 50 MP source is decoded a fourth time to make a 600px copy.

## Feed — **can a 2560px original still reach a normal feed card? YES. → FAIL.**

`isTransformable()` terminates in `return SUPABASE_PUBLIC_RE.test(url)` (`PostMedia.tsx:162`) requiring `/storage/v1/object/public/`. Stored URLs are `https://cdn.50mmretina.com/...` (`s3-presign-upload/index.ts:232-233`). **`transformable` is therefore always `false` on the feed path**, and `buildSrcSet`/`buildRenderUrl`/`buildLqipUrl` are dead code. The file says so itself at `:244-250`.

Everything routes through `buildThumbFirstSrcSet()` → `intrinsicFromName()` (`:257-266`), which needs `-w<W>h<H>` in the filename.

**(a) filename HAS dimensions** → `srcSet = "thumb 600w, original 2560w"`, `sizes = "(max-width: 768px) 100vw, 600px"`. **Only two candidates.** A 390 CSS px phone at DPR 3 needs 1170 device px; the only candidate ≥1170w is 2560w. **The phone downloads the 2560px original.**

**(b) filename has NO dimensions** → `srcSet = undefined`, `sizes = undefined`. **The original downloads on every device, unconditionally.**

Measured on production this session:

```
258 image slides / 210 posts
230 on cdn.50mmretina.com · 28 on Supabase storage
221 have a usable stored thumbnail
105 carry -wWhH in the filename
153 (59%) render with NO srcset at all
original widths: min 720 · p25 1080 · median 1620 · p75 2048 · p90 2560 · max 2560
```

Confirmed in a real browser on the live `www` feed: sharp slot is exactly **590 CSS px**, one value; **5 of 10 sharp images had a `srcset`, 5 had none**; one card with `600w, 2000w` in a 738-device-px slot was displaying **the 600px copy — 0.81× the slot**, i.e. visibly upscaled.

Attributes on the sharp `<img>` (`PostMedia.tsx:402-435`): `loading="lazy"` (`:408`), `decoding="async"` (`:409`), **no `fetchPriority`**, **no `width`/`height`**. Meanwhile the decorative backdrop gets `loading="eager"` + `fetchPriority="low"` (`:386-387`). The LCP image is the deprioritised one.

## CDN — **no transformation is in use. FAILED.**

VERIFIED from a live `www` page today:

| request | result |
|---|---|
| direct `cdn.50mmretina.com/...webp` | 200, 2000×1333 |
| `https://50mmretina.com/cdn-cgi/image/…` (apex) | **FAILS** |
| `https://www.50mmretina.com/cdn-cgi/image/…` | 200, 900×599 |
| `https://cdn.50mmretina.com/cdn-cgi/image/…` | 200, 900×599 |

**The transformer works.** It is simply never called. `src/lib/cdnImage.ts` has **zero non-test importers** — the only mention outside its own test is a comment at `PhotoOfTheDay.tsx:149`. And `src/lib/__tests__/cdnImage.test.ts:148` actively *forbids* its adoption:

```js
expect(code).not.toContain("cdnSrcSet");
expect(code).not.toContain("cdn-cgi");
```

**A helper with a test pinning its own non-use is not a CDN implementation.** Per your rule 10: no credit.

**New finding — `/cdn-cgi/image/` responses carry no CORS headers.** Measured: `fetch()` failed on all 7 widths while the stored original succeeded; an `<img>` with `crossOrigin="anonymous"` **fails to load entirely** on a transformed URL and succeeds (untainted canvas) on the stored one. `src/lib/imageCompression.ts:150-157` sets exactly `crossOrigin = "anonymous"` and feeds `downloadImageAsJpeg()` → the Download button. **A transformed URL must never reach the download path**, or Download silently degrades to `window.open()` (`useDownloadImage.ts:17`).

**Side finding.** The stored original as served is **335 KB** where a q82 re-encode of the same 2000×1333 pixels is **157 KB**. Originals are ~2× heavier than their own resolution requires — separate from the ladder, and it is the `webpQuality: 0.92` at `imageCompression.ts:33`.

---

# PART E — FEED DATA CONTRACT

**Live signature, read from production with `pg_get_functiondef`** — 15 columns:

`id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count, shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories`

| Required to render | In the RPC? |
|---|---|
| post id, author id | ✅ |
| author name, avatar | ✅ **fixed 2026-08-13** — this was the "names showing as ?" root cause |
| media URLs | ✅ |
| thumbnail URLs | ✅ |
| created_at, privacy, categories | ✅ |
| like/comment/share counts | ✅ |
| **image dimensions** | ❌ — parsed from the filename, absent for 59% of slides |
| **derivative URLs** | ❌ — none exist |
| **viewer's own reaction state** | ❌ — secondary query |
| **per-type reaction breakdown** | ❌ — secondary query |
| **view counts** | ❌ — secondary RPC |
| **tags** | ❌ — secondary query |
| **friendship state** | ❌ — secondary query |
| **contributor score** | ❌ — separate RPC per render batch |

**`enrichPosts()` still performs secondary fetching, but it is batched, not per-post.** `useFeedQuery.ts:198-239` is a single 7-way `Promise.all` over the whole page. One slot is now **conditionally skipped** using a genuinely elegant technique (`:214-227`): `rpcHasThumbs` is decided from the *payload shape*, not a version flag, so an old installed APK keeps making the query and a new one never does, with no coordination. That is good engineering.

**Verdict: PARTIALLY VERIFIED.** The *identity* contract is now canonical. The *media delivery* contract is not — dimensions and derivatives, the two things the image pipeline needs, are exactly what is missing.

---

# PART F — FEED REQUEST COUNT

For the first 10 posts, **VERIFIED** by reading `useFeedQuery.ts:90-239`:

| # | Request | Classification |
|---|---|---|
| 1 | `get_broadcast_feed` RPC | unavoidable |
| 2 | `fetchProfileMap(authorIds)` — batched `.in()` | parallel, often cache-hit (`profileMapCache.ts` entity cache, 5-min TTL) |
| 3 | `post_reactions .in(postIds)` | parallel, batched |
| 4 | `getAdminIds()` | parallel, cached |
| 5 | `friendships .or(...)` | parallel |
| 6 | `get_post_view_counts` RPC | parallel, batched |
| 7 | `posts.thumbnail_urls` | **SKIPPED** — payload-shape gated |
| 8 | `post_tags .in(postIds)` | parallel, batched |
| 9 | extra `fetchProfileMap` for tagged users | conditional — only if a page has approved tags |
| 10 | `get_contributor_scores` | one micro-batched call per render batch, **no cache** |
| 11 | realtime: `feed-live` **×2** (see Part J), `notif-live`, `profile-guard`, `live-admin-sync`, `profile-map-badges`, `badge-definitions-sync`, `role-display-config-sync` | 8 channel objects |

### **TOTAL: 7–9 HTTP requests for 10 posts** (+8 realtime channel subscriptions)

**No N+1. PASS.** 10 posts do not cause ~10 additional requests; every enrichment is an `.in()` over the page. This is a genuine strength and it should be preserved.

**Two caveats.** `get_contributor_scores` re-fires on every card re-mount because of the missing cache — so under scroll, request count grows with *scroll distance*, not with post count. And per Part C, `staleTime: 0` + `refetchOnWindowFocus: true` means **one tab focus refetches all 5 retained pages ≈ 35–40 requests**. The safety argument written at `App.tsx:202-205` ("a focus refetch RESPECTS staleTime") is void for the one query that sets `staleTime: 0`.

---

# PART G — DATABASE / FEED RPC

## The measured plan — `EXPLAIN (ANALYZE, BUFFERS)`, live production, 210 posts

```
Aggregate (actual time=10.341..10.348 rows=1 loops=1)
  Buffers: shared hit=1072
  CTE visible
    -> Nested Loop (actual time=0.180..1.629 rows=210 loops=1)
         Join Filter: can_view_post(me.uid, p.user_id, p.privacy)
         -> Seq Scan on posts p  (actual time=0.018..0.234 rows=210 loops=1)
  CTE unseen_ranked
    -> Sort  Sort Method: quicksort  Memory: 114kB
         -> Nested Loop Left Join (actual time=4.835..9.823 rows=207 loops=1)
              -> Aggregate (actual time=0.036..0.036 rows=1 loops=207)   ← 207 LOOPS
                   -> Bitmap Heap Scan on feed_events fe_1
                        Heap Blocks: exact=618
                        Buffers: shared hit=1032
Planning Time: 8.467 ms
Execution Time: 10.751 ms
```

**Findings, all measured, not inferred:**

1. **`Seq Scan on posts`.** The privacy predicate is a *function call in the join filter* — `can_view_post(me.uid, p.user_id, p.privacy)` — so **no index on `posts` can be used, and none is.** `idx_posts_privacy_created_at` exists and is unusable for this query shape.

2. **The `count(DISTINCT)` LATERAL executed 207 times to return 10 rows.** `loops=207`, `Heap Blocks: exact=618`, 1032 of the query's 1072 buffer hits. **Feed cost is O(total visible posts) per page view — VERIFIED, not theorised.**

3. **The whole visible set is sorted** on `COALESCE(viewers,0) + random()*6.0` — 114 kB at 207 rows. This becomes an external merge sort once the set exceeds `work_mem`.

4. **Planning time (8.467 ms) is nearly as large as execution (10.751 ms)** — a symptom of the 3-overload signature set plus wide CTEs.

## What the same data costs with a sargable predicate

```
Limit (actual time=1.264..1.295 rows=10 loops=1)
  Buffers: shared hit=10
  -> Index Scan using idx_posts_privacy_created_at on posts p
       Index Cond: (privacy = 'public'::text)
Execution Time: 1.358 ms
```

**10 buffers vs 1,072. 1.358 ms vs 10.751 ms.** A **107× reduction in buffer traffic** on identical data — the cost of the function-wrapped predicate plus the LATERAL, quantified.

**Complexity: O(P) per page view**, P = total visible posts, with a constant of ~5.1 buffer hits per post. Extrapolation (arithmetic, **not** measured — labelled as prediction): at 100k posts, one feed page ≈ 510,000 buffer hits ≈ ~4 GB of buffer traffic per request.

**Caveat, stated honestly:** this plan was captured with `auth.uid()` NULL (the anonymous path), which is the *cheapest* case — `my_events` returned 0 rows. An authenticated user with history adds a real `GroupAggregate` over their `feed_events`. And all 210 production posts are `privacy='public'`, so `are_friends()` was never invoked inside `can_view_post`. **Both make the real authenticated cost higher than measured, not lower.**

---

# PART H — PAGINATION

**Method: exclusion array. Not keyset. Not OFFSET. → FAIL for scale.**

`useFeedQuery.ts:565-571` documents that `excludeByPageRef` is deliberately never trimmed. Payload growth is exact and linear:

| Page | Posts seen | UUIDs in `_exclude_ids` | Bytes on the wire (36B + JSON quoting/commas ≈ 39B) |
|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 |
| 10 | 90 | 90 | ~3.5 KB |
| 20 | 190 | 190 | ~7.4 KB |
| 100 | 990 | **990** | **~38 KB** |

And it is uploaded **again on every one of the 5 pages** a focus-refetch re-runs.

Worse than the payload: `NOT (p.id = ANY(COALESCE(_exclude_ids,'{}')))` is evaluated per row against an array of length N, inside a query that already sequentially scans every post — so the exclusion cost is O(P × N), growing quadratically with scroll depth.

Combined with `maxPages: 5` and the absent `getPreviousPageParam`, the member at post 1,000 has uploaded 990 UUIDs and **cannot scroll back to posts 1–950 by any in-app action**.

**Preferred architecture — keyset/cursor — is not implemented.** The fairness ranking (`random()`, `viewers`, `last_seen_at`) is not a stable sort key, so a naive `created_at` cursor would change the product's ordering semantics. This is a genuine design tension, not an oversight, and it is why the fan-out path in Part I is the real answer.

---

# PART I — PRIVACY / VISIBILITY ARCHITECTURE

**The chosen architecture is: C — none of the above. The `can_view_post()` problem was NOT solved.**

Live definition, read from production:

```sql
CREATE OR REPLACE FUNCTION public.can_view_post(_viewer_id uuid, _post_user_id uuid, _privacy text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _viewer_id = _post_user_id THEN true
    WHEN _privacy = 'public' THEN true
    WHEN _privacy = 'friends' AND _viewer_id IS NOT NULL THEN public.are_friends(_viewer_id, _post_user_id)
    ELSE false
  END;
$function$
```

- **No `is_public` denormalisation.** `posts` has no such column (17 columns, verified).
- **No `feed_items` fan-out table.** It does not exist.
- **A `fan_out_new_post()` trigger DOES exist** and is SECURITY DEFINER with a `_cap constant int := 1000` — but it fans out **notifications**, not feed rows. It is not feed materialisation.

| Property | Assessment |
|---|---|
| Correctness | ✅ VERIFIED — the logic is right, and it is the single source of truth |
| RLS compatibility | ✅ 141/141 public tables have RLS enabled, 679 policies |
| **Index usage** | ❌ **FAILED — measured `Seq Scan`, no index used or usable** |
| Write cost | ✅ zero — nothing is denormalised |
| Read cost | ❌ **O(total posts) per page view, measured** |
| Consistency | ✅ perfect by construction — one function, no derived copy to drift |
| Migration safety | ⚠️ any change means DROP/CREATE on 3 overloads (trap #3) |

### > **Is this sufficient for 1M users?** **NO.**
### > **Is this sufficient for 10M users?** **NO.**

**Migration path, in order:**

1. **`is_public boolean GENERATED ALWAYS AS (privacy = 'public') STORED`** + `CREATE INDEX ON posts (is_public, created_at DESC) WHERE is_public` — makes the dominant case (100% of current posts) sargable. The measurement above says this alone is the 107× win. Generated-column means zero write-path code and zero drift risk.
2. **Kill the `count(DISTINCT)` LATERAL** — maintain `viewer_count` on `posts` via trigger, or accept an approximate count. This is the 1032-of-1072 buffers.
3. **Replace the exclusion array with a keyset cursor** over a stable ordering.
4. **Only then**, at ~500k users, `feed_items` fan-out-on-write with a worker.

Steps 1 and 2 are days of work and are worth doing before anything else in this audit.

---

# PART J — REALTIME

**26 `supabase.channel()` sites in `src/`, 0 in edge functions. 20 of 26 call `removeChannel` in cleanup; 6 are deliberate app-lifetime module singletons.**

Max simultaneous channels:

| Surface | channel objects | postgres_changes bindings |
|---|---:|---:|
| **`/feed`** | **8** | **25** |
| `/profile/:id` | 7 | 20 |
| `/profile` (own) | 6 | 15 |
| Post detail | 6 | 15 — no page-specific channel |
| `/notifications` | 6 | 15 — bell is global |

### The two defects

**1. `feed-live` is subscribed TWICE on `/feed`. VERIFIED.** `Feed.tsx:167` calls `useFeedRealtime`, and `Feed.tsx:298` mounts `<WallPosts composerOnly>`, whose `WallPosts.tsx:150` calls `useFeedRealtime` **unconditionally**. Both reach `supabase.channel("feed-live")` — a **fixed string**. Result: two channel objects on one topic, 10 bindings, every event processed twice.

This is precisely the hazard the repo already documented for the notification bell at `useIsPrimaryInstance.ts:19-22` — *"`removeChannel` on either one tears down the topic the other is still using"*. `useIsPrimaryInstance` **is** applied to `useNotificationRealtime` (`useRealtimeFeed.ts:175`) and **is not** applied to `useFeedRealtime`. The fix exists in the codebase and was not carried across.

**2. Five unfiltered bindings remain on the hottest tables.** `posts` INSERT/UPDATE/DELETE (`useRealtimeFeed.ts:72, 87, 114`) and `post_reactions` INSERT/DELETE (`:124, 134`) have **no server-side `filter:`**. Every write anywhere on the platform is broadcast to every connected client and discarded in JavaScript. The file states the cost itself at `:18-19`: *"At 500 concurrent members one reaction became 500 messages so that 499 could `return`."* Four of nine were removed; **these five are the expensive ones.**

Plus: `user_roles` is subscribed twice by two always-on global singletons (`liveAdminSync.ts:130`, `profileMapCache.ts:79`), both `event: "*"`, both unfiltered, both never removed. And `profileMapCache.ts:63-90` subscribes to `user_badges`/`user_roles` platform-wide, each callback firing `invalidateQueries(["profile-map"])` — **one admin badge grant busts every connected client's profile cache.**

**`realtimeCounts.ts` — PARTIALLY VERIFIED.** The one-writer-per-field split is real and correct. But `:37` documents `assertNoLikeCountDelta` as the enforcement mechanism, and `grep` finds **exactly one hit: that comment line**. The function does not exist. Real enforcement is a single source-text regex in a test (`realtimeCounts.test.ts:90`) that matches one historical spelling. The documentation overstates the guarantee.

**25 of 26 `.subscribe()` calls ignore the status callback** — a `CHANNEL_ERROR` or `TIMED_OUT` is invisible.

---

# PART K — UPLOAD RELIABILITY

| Capability | Status |
|---|---|
| Retry — presign call | ✅ `s3Upload.ts:46` `[300, 800]`, plus one 401/403 `refreshSession()` retry (`:62-66`) |
| **Retry — the actual PUT** | ❌ **NONE** — `s3Upload.ts:166-168` is a bare `fetch` |
| Resumability / chunking | ❌ **NONE** — no tus, no multipart, no `Range` |
| AbortController | ❌ **NONE** — zero occurrences in `src/`; a stalled PUT hangs indefinitely |
| Progress reporting | ❌ **NONE** — no `XMLHttpRequest`, no `upload.onprogress`; `fetch` cannot report it |
| Persistent pending state | ❌ **NONE** — `WallPosts.tsx:262-265`: *"⚠ CLOSING WRITES NOTHING"* |
| Duplicate prevention | ⚠️ DB trigger hashes `md5(content ‖ image_urls)`; **a retry generates fresh URLs → different hash → the guard never fires** |

**The retry logic protects the 2 KB presign call and leaves the multi-megabyte transfer bare.**

| Scenario | What actually happens |
|---|---|
| **Network loss mid-upload** | PUT rejects → toast *"Upload failed — check your connection"* (`WallPosts.tsx:1084`). `selectedImages` is **not** cleared, so the member can retry — **from byte zero, re-encoding both WebPs.** If photo 3 of 5 fails, photos 1–2 are already in R2 with no DB row: **permanently orphaned.** |
| **App backgrounded** | PARTIALLY VERIFIED — no Background Sync registered (`public/sw-image-cache.js` has only install/activate/fetch). Whether the specific WebView kills the connection is not determined by any code in this repo. |
| **App killed** | Total loss. No in-flight persistence. R2 objects orphaned. |
| **Token expiry** | ✅ Handled for the presign; the PUT is SigV4-authenticated so an in-flight PUT is unaffected. |
| **Presign expiry (300 s, `s3-presign-upload/index.ts:9`)** | Both PUTs share **one `amzDate`** (`:186`, reused at `:238-239`). A 50 MB competition entry — not downscaled, `imageUpload.ts:262` — needs ~3.3 min at 2 Mbps and **exceeds 300 s below ~1.4 Mbps** → `403 AccessDenied`, **no re-presign, no retry.** The client never reads the returned `expiresIn`. |
| **Duplicate retry** | New paths → new URLs → different hash → the 10-minute duplicate trigger does not fire. Post succeeds; the failed attempt's bytes remain forever. |

**Orphan cleanup does not cover posts.** `purge-s3-orphans` lists **only** `competition-photos/` (`:202-203`), defaults to dry-run, is admin-gated, and **has no trigger of any kind** — no cron, no `pg_cron`, no caller. `post-images/` is outside its prefix.

**Verdict: FAILED** against the stated standard. "Upload failed and the user has to start again" is exactly what happens, and it silently leaks storage each time.

---

# PART L — VIDEO

## **VIDEO STATUS: NOT SUPPORTED**

**VERIFIED exhaustively.** `<video` — 0 occurrences. `.mp4`/`.m3u8`/HLS/DASH/transcode/ffmpeg/`poster=` — exactly one repo-wide hit, a MIME lookup row in `supabase/functions/migrate-storage/index.ts:122`. Every one of 34 file inputs is `image/*` or an explicit image/PDF list. `PostMedia.tsx` renders `<img>` only.

The rule is in the code at `src/components/WallPosts.tsx:289-292`: *"⚠ THIS PRODUCT HAS NO REELS AND NO LIVE."* It is comment + doc only — **no lint rule or test enforces it.**

**Path to adding it later: clean but not free.** `posts.image_urls text[]` is media-type-agnostic in name only; every consumer assumes images. Adding video needs a media-type column, a poster/derivative pipeline that does not exist even for stills, a transcode stage with no server-side media processing to build on, and a player. The honest read: the *architecture* does not block video, but **nothing in the current media pipeline is reusable for it**, and the one place a WebView genuinely loses is a vertical video feed. Given the standing rule, this is not a gap — it is a scope decision.

---

# PART M — CACHING

`App.tsx:210-219` — the only production `QueryClient`:

```js
staleTime: 5 * 60 * 1000,   // :213
gcTime:   10 * 60 * 1000,   // :214
refetchOnWindowFocus: true, // :215
retry: 1,                   // :216
```

**197 `invalidateQueries` call sites. None passes zero arguments. There is no whole-cache nuke.** The load-bearing answers are good:

- **Does one reaction invalidate the feed? NO.** `usePostReactionMutations.ts` contains **zero** `invalidateQueries`; it uses optimistic `setQueryData` with snapshot rollback (`:116-121`).
- **Does one comment invalidate the feed? NO.** `useAddComment.ts` and `PostCommentsSection.tsx` both contain **zero** `invalidateQueries`.
- **Does a profile edit invalidate the feed? NO — and that is a bug.**

`useProfileMutations.ts:138` calls `invalidateQueries({ queryKey: queryKeys.profileMap([variables.userId]) })`. `profileMap(ids)` is `["profile-map", sortedIds]` (`queryKeys.ts:37`), so this targets a **one-element ID-set key that the app essentially never writes** — the feed always calls `fetchProfileMap` with a multi-author array. **`profileMapCache.ts:69-74` documents this exact defect as a fixed bug elsewhere**; line 138 was never migrated to `invalidateProfileMap()`. A changed name or avatar does not refresh feed author lines until the 5-minute entity TTL and a refetch coincide.

**Broad invalidations that do hit the feed** (prefix `["feed"]` → every category variant × 5 pages ≈ 35–40 requests each): `PostCard.tsx:205`, `WallPosts.tsx:753/1019/1131/1170`, `usePostDrafts.ts:260`, `MyPhotos.tsx:378`, and `AdminEngagement.tsx:175/192/201` (which uses a raw `["feed"]` literal against the registry's own rule).

**Documentation drift.** `queryKeys.ts:15` states the global contract as `refetchOnWindowFocus: false`. The actual value is `true`. The file every new hook is told to read is wrong about the one default that drives request volume.

---

# PART N — SECURITY / RLS

## The good, verified first

**RLS: 141 of 141 public tables have it enabled. 0 disabled. 679 policies.** That is genuinely excellent and rare.

`node scripts/security-audit.mjs` → **exit 0, CRITICAL 0 · HIGH 0 · MEDIUM 2 · LOW 2**, 616 files scanned. The two MEDIUMs are documented public read-only edge functions holding the service-role key (`seo-route-metadata`, `sitemap`).

## 🔴 The finding that matters — `public.enqueue_email(text, jsonb)`

Read from production:

```sql
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$
```

```
anon_can_execute   = true
authed_can_execute = true
acl = postgres=X/postgres | service_role=X/postgres | anon=X/postgres | authenticated=X/postgres
```

**SECURITY DEFINER. Two fully user-controlled parameters. Granted to `anon`. Zero authorisation check of any kind.** It is reachable at `/rest/v1/rpc/enqueue_email` with the public anon key.

Two consequences:

1. **Arbitrary message injection into any queue by name** — including whatever queue `supabase/functions/process-email-queue` drains. Whether that yields outbound mail to an attacker-chosen address depends on that consumer's validation, which I did **not** fully trace — so the *impact ceiling* is NOT VERIFIED. The *reachability* is verified.
2. **`pgmq.create(queue_name)` on any unrecognised name** — an anonymous caller can create unbounded queues, each of which is a real table. That is a catalog/storage denial-of-service with no rate limit.

**I deliberately did not exploit this against production** — calling it would enqueue a real message and possibly create a real queue. The finding rests on the definition, the ACL, and `has_function_privilege`, all read from the live database.

**Recommended immediately:** `REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated;` — then add an explicit allow-list of queue names and an `auth.uid()` check before restoring any grant.

## The surrounding surface

**300 SECURITY DEFINER functions. 248 are EXECUTE-granted to `anon`.** Supabase's own advisor independently reports the same: 248 `anon_security_definer_function_executable`, 269 `authenticated_...`.

I spot-checked the most alarming names and **the `admin_*` family does gate internally** — `admin_flag_entry_for_review`, `admin_rewind_stage`, `admin_search_users`, `admin_set_photo_rejected` all call `has_role(auth.uid(),'admin')` and raise. `claim_username` returns `ok:false` when `uid IS NULL`. So the blanket anon grant is **mostly sloppy rather than exploitable** — but 248 functions is far too large a surface to assert that about all of them from a spot check, and `enqueue_email` proves at least one is genuinely open.

Advisor totals (538 lints): **4 ERROR `security_definer_view`** (incl. `public.entry_public_status`), 8 `function_search_path_mutable`, 6 `rls_enabled_no_policy`, 1 `materialized_view_in_api` (`entry_vote_counts` selectable by anon), 1 `extension_in_public` (`plpgsql_check`), and **`auth_leaked_password_protection` is OFF**.

Dependency posture: `npm ci` reported **29 vulnerabilities (1 critical, 19 high, 6 moderate, 3 low)**. `security-audit.mjs` does not scan the dependency tree, so its 0/0 says nothing about these.

---

# PART O — DATABASE INDEXES

**QUERY → REQUIRED INDEX → EXISTS? → ACTUALLY USED?**

| Query shape | Index needed | Exists | **Used?** |
|---|---|---|---|
| Feed visibility filter `can_view_post(...)` | any on `posts` | `idx_posts_privacy_created_at (privacy, created_at DESC)` | ❌ **NO — measured Seq Scan.** Function-wrapped predicate is not sargable |
| `privacy='public' ORDER BY created_at DESC` (hypothetical) | same | ✅ | ✅ **YES — Index Scan, 10 buffers, 1.358 ms** |
| Feed LATERAL `feed_events WHERE post_id = v.id` | `(post_id)` | `idx_feed_events_post` **and** `idx_feed_events_post_id` — **exact duplicates** | ✅ used, 207 times |
| `my_events WHERE user_id = uid AND event_type IN (...)` | `(user_id, event_type)` | only `(user_id, post_id)`, `(user_id, created_at DESC)`, `(user_id, author_id)` | ⚠️ Bitmap Index Scan on `idx_feed_events_user_post`, then **filters `event_type` in the heap** |
| `_exclude_ids` anti-match | none possible | — | ❌ per-row array scan |
| Category filter `categories && $1` | GIN | `idx_posts_categories` GIN ✅ | not exercised (NULL in the measured run) |
| Wall: `posts WHERE user_id ORDER BY created_at DESC` | `(user_id, created_at DESC)` | ✅ `idx_posts_user_id_created_at` | ✅ correct |
| Reactions by post | `(post_id)` | ✅ | ✅ |
| Comments by post | `(post_id, created_at DESC)` | ✅ | ✅ |
| Notifications | `(user_id, created_at DESC)` + partial unread | ✅ both | ✅ |
| Scheduled posts due | partial `(scheduled_for) WHERE status='pending'` | ✅ | ✅ — well designed |

**Redundancy found:** `posts` has both `idx_posts_user_id` and `idx_posts_user_id_created_at` (the former is a prefix of the latter — droppable). `feed_events` has `idx_feed_events_post` and `idx_feed_events_post_id`, **identical definitions** — one is pure write overhead. `post_reactions` has three overlapping uniques: `(post_id,user_id,reaction_type)`, `(post_id,user_id)`, plus a non-unique `(post_id,user_id)`.

**The index set is broadly well-chosen. The problem is not a missing index — it is that the feed's query shape makes the right one unusable.**

---

# PART P — BUNDLE / JAVASCRIPT PERFORMANCE

Measured. `npm run build` → exit 0, **26.99 s**, 4,694 modules, **264 JS chunks**.

| Metric | Raw | gzip -9 | brotli q11 |
|---|---:|---:|---:|
| Total JS | **5.52 MB** | 1.62 MB | 1.36 MB |
| Total CSS | 196.30 KB | 30.41 KB | 23.61 KB |

**Initial critical path** (1 entry + 4 `modulepreload` + CSS from `dist/index.html`):

| file | raw KB | gzip KB | brotli KB |
|---|---:|---:|---:|
| `index-ChUzwu2X.js` | 1050.10 | 325.41 | 260.78 |
| `vendor-react` | 153.19 | 50.26 | 44.11 |
| `vendor-framer-motion` | 133.32 | 44.28 | 39.57 |
| `vendor-react-markdown` | 114.84 | 35.27 | 31.37 |
| `vendor-query` | 44.20 | 13.53 | 12.25 |
| `index.css` | 190.28 | 29.16 | 22.51 |
| **JS total** | **1495.64** | **468.74** | **388.09** |

**FAIL against the project's own gate.** `vite.config.ts:32-40` cites a `<350 KB` Lighthouse JS budget; measured initial JS is **468.74 KB gzip / 388.09 KB brotli** — 1.34× over. The `manualChunks` split isolated framer-motion and react-markdown from the entry chunk but they are then `modulepreload`ed on every page load anyway, so 79.55 KB gzip of "split" code is still on the critical path.

**Largest chunk attributed authoritatively** via a rollup `generateBundle` hook (the stats build is byte-identical, md5 verified): `index-ChUzwu2X.js`, 600 modules — **app src 754 KB**, `@supabase/*` **473.6 KB** (auth-js 235.85, realtime-js 91.28, storage-js 84.45, postgrest-js 46.50), `date-fns` 116.09, `react-day-picker` 91.85, `react-mentions` 83.09 (npm-deprecated), **`qrcode` 79.76**, `vaul` 72.99, `tailwind-merge` 70.32, `lucide-react` 63.12, `dompurify` 62.89.

**Route code-splitting: excellent.** 50 `lazyRetry()` definitions, **57 of 57 routes lazy**, 131 dynamic-entry chunks. 180 of 264 chunks are <10 KB. **Route splitting is not the problem; the entry chunk is.** `qrcode` at 79.76 KB is in the entry chunk for every visitor on every page and has one route-level consumer.

**Duplication is minimal:** only 5 packages appear in >1 chunk, ~82 KB total, of which `lucide-react` (93 chunks, 62 KB) is normal per-icon splitting. `resolve.dedupe` is working — react/react-dom duplication ≈ 0.

**`sharp` is in `dependencies` and reaches 0 of 264 chunks.** It is a build-time optional peer of `vite-plugin-image-optimizer`. Cost: `node_modules/@img` **33 MB** of native libvips binaries installed on every production install for zero client bytes. `vite-plugin-pwa` is in `dependencies` and is **never wired into the build at all** (zero references outside `node_modules`). `svgo` is missing entirely, so all 11 SVGs failed optimisation during the build.

Three "dynamically imported but also statically imported" warnings; the worst is `src/integrations/supabase/client.ts`, statically imported by ~250 modules, so its dynamic import buys nothing.

---

# PART Q — MAIN THREAD

**There is not a single Worker in the application. VERIFIED.** `new Worker(` — 0. `OffscreenCanvas` — 0. `requestIdleCallback` — 0. `createImageBitmap` appears at `imageCompression.ts:115-118` but is called on the main thread, so its entire purpose is unused.

| Operation | file:line | Thread |
|---|---|---|
| Full-res WebP encode (up to 50 MP) | `imageCompression.ts:181-189` | **MAIN** |
| Thumbnail encode (decodes the original again) | `:244` | **MAIN** |
| JPEG download conversion, full resolution | `:267-274` | **MAIN** |
| **pHash 32×32 DCT — ~65,536 `Math.cos` calls per image** | `imageHash.ts:43-99` | **MAIN** |
| EXIF parse (incl. HEIC/TIFF) | `exifExtract.ts:63` | **MAIN** |
| PDF generation (per-image canvas + `toDataURL` ×2 passes) | `generateArticlePdf.ts:139-147, 813-832, 911` | **MAIN** |
| Image/cover/avatar crop | `ImageCropModal.tsx:77-87`, `CoverImageUploader.tsx:382-399`, `OnboardingModal.tsx:94-98` | **MAIN** |
| Device fingerprint `toDataURL` (forced GPU→CPU readback) | `deviceFingerprint.ts:48-54` | **MAIN** |

**The largest offender is not on that list.** `WallPosts.tsx:408-469`: `FileReader.readAsDataURL` base64-**encodes** the entire original, then `fileFromDataUrl` (`:456`) base64-**decodes** it back — two full synchronous passes over up to 50 MB, per photo, at selection time, before compression begins. The composer permits 10 photos (`:424`).

`JSON.parse` (21 sites) and array sorts (93 sites) were checked and are **not** findings — the only hot-path parse is the localStorage feed cache, bounded to 10 posts / ~50–80 KB (`feedCache.ts:5, 26, 41`).

---

# PART R — MEMORY / RESOURCE LEAKS

**102 call sites checked across `addEventListener`, `setInterval`, `setTimeout`, `IntersectionObserver`, `ResizeObserver`, `MutationObserver`, `AbortController`. Exactly 1 leaks.**

`src/hooks/core/usePwaInstall.ts:34` — the `appinstalled` listener is an inline arrow with no retained reference, and the cleanup at `:36` removes only `beforeinstallprompt`. **Latent**, not active: `usePwaInstall` has no consumer.

Everything else is correct, including some genuinely tight teardown (`AdZone.tsx:242-269` disposes an interval, an IntersectionObserver and a visibilitychange listener in one return). 6 module-level channels never call `removeChannel` — all deliberate, all guarded against double-subscribe, all surviving sign-out by design.

**Dead code found:** `src/lib/staleChunkReload.ts:100-125` registers three permanent `window` listeners, and `installStaleChunkReload` is **never called** — the stale-chunk auto-reload that file documents is not active.

**This section is a genuine pass.** For a codebase this size, one latent leak is a very good result.

---

# PART S — ERROR HANDLING

**The known past defect is fixed. VERIFIED.** `useFeedQuery.ts:153-154`:

```ts
if (fallbackError) throw fallbackError;
return fallback || [];
```

with the reasoning at `:129-151`. An error is now retried rather than cached as an empty success. `retry: 3` with exponential backoff to 8 s (`:484-485`).

**PARTIALLY VERIFIED caveat:** the *primary* RPC failure does not throw — `:96` logs `DB-3004` and silently degrades to a chronological fallback. Members still see posts, so nobody reports it, and the fairness ordering is gone until someone reads the log. The code says this itself at `:107`.

**Two genuine silent failures remain:** `MyPhotos.tsx:138` (`if (error || !tags?.length) return []` — an RLS or timeout failure renders as "no tagged photos") and `StorageMigrationPanel.tsx:70` (admin-only).

**`src/lib/errorCodes.ts` is a real strength.** 75 unique codes, pattern-enforced client- and server-side, shape `{code, severity, description, resolution}` with `resolution` **mandatory and required to be an instruction** (`:31-33`), auto-substituted into every log (`logger.ts:337`) and persisted. `docs/error-codes.md` is generated from it and a test fails CI on drift.

| Case | What the user sees |
|---|---|
| Network failure on feed | ✅ Dedicated card: *"Couldn't load your feed… This looks like a connection problem, not an empty feed."* + Try again (`Feed.tsx:326-338`) |
| Upload failure | ✅ Connection-aware toast + structured report (`WallPosts.tsx:1083-1087`) |
| Route crash | ✅ `AppErrorBoundary` (`App.tsx:367`) + `logger.fatal(SYS-9002)` |
| **401** | ⚠️ **No generic interceptor.** Only `s3Upload.ts:56-66` handles it, upload-path only |
| **403 / RLS denial** | ⚠️ Raw Postgres message in a destructive toast (`WallPosts.tsx:1109, 1153`) |
| **429** | ⚠️ Handled **only** on Login/Signup, by string-matching (`Login.tsx:57`) |
| **5xx** | ⚠️ Renders a diagnostic like `FunctionsHttpError · status=500` |

---

# PART T — OBSERVABILITY

**Third-party SDKs: ZERO.** No Sentry, Datadog, LogRocket, PostHog, Crashlytics, Bugsnag — verified across `package.json`, `src/`, `supabase/`. No Crashlytics despite `google-services.json` being committed.

**But real first-party telemetry does exist, and it is not console-only.** `logger.ts:63` `PERSIST_FROM = "warn"` → `persist()` (`:273-299`) → `supabase.rpc("log_app_event", …)` → `public.client_errors`, with 11 structured columns, indexes on `(code, created_at)` / `(severity, created_at)` / `correlation_id`, rate limiting (40/member/hour), 30-day retention, and a read UI at `AdminAppEvents.tsx`. PII redaction is real (`logger.ts:134-167`).

| Signal | Status |
|---|---|
| JS errors / route crashes | ✅ **MEASURABLE** — `AppErrorBoundary.tsx:34-58` |
| Image load failures | ✅ **MEASURABLE** — capturing `window` error listener; records URL + `naturalWidth` so a 1×1 "success" is caught (`reportImageError.ts:68, 111-118`) |
| Post/comment failure rate | ✅ MEASURABLE |
| Upload/post latency | ✅ MEASURABLE — `durationMs` on ~9 write paths |
| **Feed latency** | ❌ **NOT MEASURED.** `logger.timed()` exists (`logger.ts:378-400`) with **0 call sites** |
| **RPC latency** | ❌ **NOT MEASURED** — no wrapper on `supabase.rpc` |
| **Network latency generally** | ❌ `networkTracer.ts` does exactly this and is **dev-gated twice** (`main.tsx:30`, `networkTracer.ts:127`) — Vite strips it from production |
| **Native crashes** | ❌ **NOT MEASURED.** A process-level Android OOM — the exact failure the windowing work was done to prevent — produces **no signal at all** |
| **Unhandled promise rejections** | ❌ no `unhandledrejection` listener anywhere |
| **`window.onerror`** | ❌ no global handler |
| **Realtime channel health** | ❌ 25 of 26 `.subscribe()` ignore status |
| Upload failure rate directly | ⚠️ `ClientErrorKind "upload"` is declared (`reportClientError.ts:47`) and **never emitted** |

**Supabase is the sole sink.** Consequences: **no alerting** (detection requires an admin to open a screen), **correlated blindness** (if Supabase is unreachable, the failure that matters cannot be reported — both senders swallow their own rejection by design), **sampling caps that bite hardest during an incident**, and `AdminHealth.tsx:110-117` measures reachability (`count >= 0`), not latency or error rate.

---

# PART U — LOAD / SCALE MODEL

Current production: **210 posts, 94 profiles, 989 feed_events, 952 reactions, 173 friendships, 294 follows.** Everything below at 10k+ is **prediction**, clearly separated from the two measured facts.

**VERIFIED CURRENT BOTTLENECK (today, at 210 posts):** none is failing. The feed RPC executes in **10.751 ms** with **1,072 buffer hits**, and the LATERAL already runs **207 times to return 10 rows**. The pathology is present and measured; the volume is not yet.

### 10,000 users (~50k posts — predicted)
**First bottleneck: the feed RPC.** Sequential scan over ~50k posts + ~50k LATERAL `count(DISTINCT)` executions per page view. At the measured ~5.1 buffers/post that is ~255k buffer hits per request. **Prediction**, extrapolated linearly from a measured constant — real behaviour will be worse once the sort spills to disk.
Second: realtime. 5 unfiltered bindings × concurrent members, doubled by the `feed-live` double-subscription.

### 100,000 users (~500k posts — predicted)
Feed RPC is unusable without change. The exclusion array at page 100 is ~38 KB uploaded per request. CDN egress becomes the dominant cost line: at 335 KB per feed image with no derivative ladder, a phone session downloads 6–8× what it needs.

### 1,000,000 users
**Not reachable on this architecture.** Requires: sargable visibility (`is_public` + partial index), the `count(DISTINCT)` LATERAL removed, keyset pagination, server-side `filter:` on the remaining realtime bindings, and a real derivative pipeline. With those, reachable — the audit's own five-year note says the same, and the measured 107× index win supports it.

### 10,000,000 users
Requires `feed_items` fan-out-on-write with a worker, a read replica, and derivative generation off the client entirely. Also a second observability vendor — running a 10M-user platform whose only telemetry sink is the database it is monitoring is not viable.

**The framework is not the limiting factor at any of these scales.** Every bottleneck above is a query, an index, an `<img>` attribute, or a missing `filter:`.

---

# PART V — INSTAGRAM-GRADE SCORECARD

| Category | Score | One-line justification |
|---|---:|---|
| Mobile architecture | **6** | Correct bundled config, `server.url` absent, plugins genuinely wired — but no iOS, untyped plugin access, and the only web-bundle-in-artifact check is `continue-on-error` |
| Feed rendering | **6.5** | `/feed` windowing is real and measured (50 → 7–15 mounted); `/profile` is unwindowed and unbounded |
| Feed database architecture | **3** | Measured Seq Scan + 207-loop LATERAL to return 10 rows |
| Pagination | **2** | Unbounded exclusion array; 990 UUIDs at page 100; O(P×N); no keyset |
| Image pipeline | **2** | Two derivatives; 2560px original reaches phones; 59% of slides have no `srcset` at all |
| CDN | **1** | Transformer works and is never called; the helper has a test forbidding its adoption |
| Upload reliability | **2** | No PUT retry, no resume, no abort, no progress, no pending state, silent orphans |
| Realtime | **5** | Halved from 9→5 bindings, but 5 unfiltered on the hottest tables and `feed-live` is double-subscribed |
| Caching | **6.5** | Reaction/comment granularity is genuinely excellent; focus-refetch storm and a dead profile invalidation |
| Security | **5** | RLS 141/141 with 679 policies is outstanding — dragged down by `enqueue_email` open to `anon` and 248 anon-executable SECURITY DEFINER functions |
| Bundle performance | **5** | 57/57 routes lazy and near-zero duplication; 468 KB gzip initial vs the project's own 350 KB gate |
| Memory management | **6** | 1 latent leak in 102 checked sites; `/profile` unbounded retention |
| Error handling | **6.5** | 75-code catalog with mandatory actionable resolutions is better than most production apps; no 401/403/429/5xx mapping |
| Observability | **4** | Real first-party pipeline — but no latency, no crash capture, no alerting, single sink |
| Scalability | **3** | Every headline bottleneck is measured and unfixed |

## CURRENT OVERALL SCORE: **4.5 / 10**

**Why 4.5 and not lower:** the foundations that are expensive to retrofit are right. RLS on every table with 679 policies, 57/57 lazy routes, a disciplined error-code catalog, one leak in 102 resource sites, batched enrichment with no N+1, and a genuinely clever payload-shape-gated migration path in `enrichPosts`. This is not a sloppy codebase — it is a careful one.

**Why 4.5 and not higher:** the four things a photography social platform is actually judged on — **image delivery, upload reliability, feed query cost, and pagination** — score 2, 2, 3 and 2. The previous remediation fixed the *client-side symptoms* of the media problem (windowing, the 14.7 MB backdrop, `maxPages`) and did not touch the *delivery* problem underneath. A phone still downloads a 2560px original for a 590px slot.

---

# PART W — FINAL GO / FIX / STOP

## 🟡 FIX

Foundation is correct. Critical engineering work remains before serious scale. Nothing found requires redesign; several things require work that has not started.

### 1. Is React + Capacitor still the correct architecture? **YES**
Every measured bottleneck is a query plan, an index, an `<img>` attribute, a missing `filter:`, or an absent retry. Not one is attributable to React or to the WebView. Per your rule 13, there is no repository evidence that the framework is the limiting factor.

### 2. Should we migrate to React Native? **NO**
It would fix none of the 15 findings above and would fork the ~100% shared codebase into two.

### 3. Should we migrate to Flutter? **NO**
Same, and it additionally discards the web product, which is load-bearing for SEO, journal, courses, competitions and admin.

### 4. Can this architecture realistically evolve to 1M users? **CONDITIONAL**
Conditional on: sargable visibility, removal of the `count(DISTINCT)` LATERAL, keyset pagination, a real derivative pipeline, server-side realtime filters, and upload retry/resume. All are additive. None requires a rewrite.

### 5. Can it realistically evolve to 10M users? **CONDITIONAL**
Additionally requires `feed_items` fan-out-on-write with a worker, a read replica, server-side image processing, and a second observability vendor. That is a different engineering organisation, not a different framework.

### 6. The 10 highest-priority remaining problems (impact × probability × urgency)

| # | Problem | Impact | Prob. | Urgency | Evidence |
|---:|---|---|---|---|---|
| **1** | **`enqueue_email` is SECURITY DEFINER, anon-executable, with zero auth check and arbitrary queue creation** | Critical | Certain (reachable now) | **Immediate** | live ACL + definition |
| **2** | **Feed RPC: Seq Scan + 207-loop LATERAL to return 10 rows; O(total posts) per page view** | Critical | Certain | High | measured `EXPLAIN ANALYZE`; sargable form is 107× cheaper |
| **3** | **59% of slides have no `srcset`; phones download 2560px originals; no CDN transform in use** | Critical | Certain | High | `PostMedia.tsx:162, 257-280`; 153/258 measured |
| **4** | **Uploads: no PUT retry, no resume, no abort, no progress; failures orphan R2 bytes with no cleanup for `post-images/`** | High | High | High | `s3Upload.ts:166-168`; `purge-s3-orphans` is competition-only and untriggered |
| **5** | **`/profile` has no windowing and no `maxPages`** — the OOM condition the feed fixed, fully intact | High | High | High | `useUserPostsQuery.ts:180-191`; `WallPosts.tsx:1852` |
| **6** | **Exclusion-array pagination: 990 UUIDs at page 100, O(P×N)** | High | Certain at depth | Medium | `useFeedQuery.ts:565-571` |
| **7** | **The blocking CI typecheck checks zero files**, hiding 2 real errors | High | Certain | **Immediate** (one-word fix: `-b`) | `--listFiles` = 0 |
| **8** | **`feed-live` double-subscribed on `/feed`**; 5 unfiltered hot-table bindings | Medium-High | Certain | Medium | `Feed.tsx:167` + `WallPosts.tsx:150` |
| **9** | **No crash, latency, `unhandledrejection` or alerting telemetry** — Android OOM is invisible | Medium-High | Certain | Medium | `logger.timed()` 0 call sites; `networkTracer` dev-gated |
| **10** | **`refetchOnWindowFocus: true` × feed `staleTime: 0`** ≈ 35–40 requests per tab focus | Medium | Certain | Medium | `App.tsx:215` vs `useFeedQuery.ts:468` |

Immediately below the line: 248 anon-executable SECURITY DEFINER functions; 1 critical + 19 high npm advisories; `useProfileMutations.ts:138` invalidating a key nothing uses; `sharp` (33 MB) and `vite-plugin-pwa` (unused) in `dependencies`; `qrcode` (79.76 KB) in the entry chunk.

### 7. What should NOT be changed

- **React + Capacitor, bundled, `webDir: 'dist'`, no `server.url`.** Correct, and provably so.
- **The 11-package Capacitor pin + the blocking pin-verification step** (`android-build.yml:168-191`). This caught a real breakage.
- **RLS on 141/141 tables with 679 policies.** Excellent; do not weaken it while fixing the function grants.
- **`can_view_post` as the single source of visibility truth.** Make it *sargable*; do not fork it into a second copy that can drift.
- **The batched `enrichPosts` `Promise.all`, and especially the payload-shape gate at `useFeedQuery.ts:214-227`** — that pattern lets the database and an installed APK evolve independently. Reuse it.
- **`errorCodes.ts`** — 75 codes with mandatory actionable resolutions, generated docs, drift test.
- **57/57 lazy routes and `resolve.dedupe`.**
- **`FeedCardWindow`'s measure-before-unmount order and its fail-open behaviour.** Extend it to `/profile`; do not replace it.
- **The standing rules: no REELS, no LIVE; `android/` not committed; owner-only Play uploads.**
- **The `noComponentDefinedInRender` allowlist staying empty.**

### 8. The next engineering phase — concrete sequence

**Phase 0 — this week, before anything else**
1. `REVOKE EXECUTE ON FUNCTION public.enqueue_email(text,jsonb) FROM anon, authenticated;` then add a queue-name allow-list and an `auth.uid()` check.
2. Change the Android workflow's typecheck to `npx tsc -b`, and fix the 2 errors it exposes.
3. Fix my `20260813190000` migration (restore explicit `VOLATILE`, single-space `feed_tier text`) so the suite is green again. Do not apply it before that.
4. Audit the other 247 anon-granted SECURITY DEFINER functions for missing `auth.uid()` gates — `enqueue_email` proves the spot check is not sufficient.

**Phase 1 — database, ~1 week. This is the highest-value work in the audit.**
5. `is_public` generated column + `CREATE INDEX ... (is_public, created_at DESC) WHERE is_public`. Re-run `EXPLAIN ANALYZE` and confirm the Seq Scan is gone.
6. Replace the `count(DISTINCT)` LATERAL with a maintained `viewer_count` column. That is 1,032 of 1,072 buffers.
7. Drop the duplicate indexes (`idx_feed_events_post` / `_post_id`; `idx_posts_user_id`).
8. Seed a 100k-post copy and re-measure before and after. **Do not skip this** — every scale number in Part U above 210 posts is extrapolation.

**Phase 2 — image delivery, ~2 weeks**
9. Apply the corrected `image_meta` migration; backfill the 105 from filenames, then the 153 by byte-read using `backfill-thumbnails` as the model.
10. Generate 1080 and 1440 derivatives. Server-side or in a Worker — **not** on the main thread, which already does 2 encodes and 4 decodes per photo.
11. Wire a four-candidate `srcset` and delete the dead `buildSrcSet`/`buildRenderUrl` path. Add the non-test-importer assertion.
12. Test from the **Android WebView origin** before shipping. Guard the download path against transformed URLs (no CORS).
13. Lower `webpQuality` from 0.92 — originals are ~2× heavier than their resolution needs.

**Phase 3 — upload reliability, ~1 week**
14. Retry with backoff on the PUT; `AbortController` with a timeout; re-presign on 403.
15. `XMLHttpRequest` for real progress.
16. Extend orphan purge to `post-images/` and give it a schedule.

**Phase 4 — the rest**
17. Window `/profile` and give `useUserPostsQuery` a `maxPages`.
18. `useIsPrimaryInstance` on `useFeedRealtime`; server-side `filter:` on the 5 remaining bindings.
19. Keyset pagination.
20. Latency instrumentation (`logger.timed()` has 0 call sites), `unhandledrejection` capture, and one external alerting sink.

**Cut ONE Android build, after Phase 2 — not before.** Nothing in Phase 0 or 1 requires an app build; the database work is backwards-compatible with every installed APK.

---

# THE MOST IMPORTANT QUESTION

> **"If I were investing serious money into 50mm Retina today, would I trust this architecture as the foundation for an Instagram-level photography platform?"**

## **YES, BUT** — and the "but" is roughly two months of specific, known, additive work.

**Why yes.** The expensive-to-retrofit decisions are right, and I can point at the evidence for each. Row-level security is enabled on every one of 141 tables with 679 policies — most projects at this stage have it on half. Every route is lazy. One resource leak in 102 checked sites. No N+1 anywhere in the feed: ten posts cost seven to nine requests, all batched. The error catalog requires every code to carry an actionable instruction, and a test fails CI if the docs drift from it. And the codebase argues with itself in writing — `PostMedia.tsx` still contains the exact code that broke every photo for four days, quoted, with the date and the owner's own words, so the next person cannot repeat it. That habit is worth more than any single fix in this document.

The framework question is settled by the evidence, not by preference: not one measured bottleneck is attributable to React or to the WebView. They are a function-wrapped predicate defeating an index, a LATERAL running 207 times, an `<img>` with two candidates, a missing `filter:`, and a `fetch` with no retry. Migrating to React Native or Flutter would fix none of them and would fork a codebase that is currently ~100% shared between web and Android.

**Why "but", and I would not soften this.** Four things a photography platform lives or dies on score 2, 2, 3 and 2 out of 10. A phone downloads a 2,560-pixel original into a 590-pixel slot — and for 59% of photographs it has no alternative offered at all, because the dimensions are parsed out of a filename that most files do not have. The CDN transformer works when called and is never called; the helper written to call it has a test **forbidding** its adoption. An upload that fails at photo three of five leaves the first two in storage forever with nothing pointing at them, and there is no cleanup job that covers post images. The feed's privacy check is a function call in a join filter, so the index built for it cannot be used — I measured the same data at 1,072 buffers with it and 10 buffers without.

And one finding is not a scale problem at all: `enqueue_email` is `SECURITY DEFINER`, takes a queue name and a JSON payload straight from the caller, has no authorisation check of any kind, and is granted to `anon`. It creates a new queue for any name it does not recognise. That is reachable today with the public key. It should be revoked before anything else in this document is discussed.

**The investment case.** I would fund this — but I would fund it as *"the foundation is sound and the delivery layer was never built"*, not as *"the remediation is complete."* The previous round fixed the client-side symptoms of the media problem — windowing, the 14.7 MB backdrop, page retention — and every one of those fixes is real and verified in this audit. It did not touch the delivery problem underneath them, and the status document is honest that the derivative pipeline is still open. What concerns me more is the gap between what the documentation claims and what runs: the "full gate" includes a typecheck that checks zero files, `realtimeCounts.ts` names an enforcement function that does not exist, and `queryKeys.ts` documents a caching default opposite to the one in force. Each is small. Together they mean the project's own account of itself cannot be taken at face value — which, on a codebase this disciplined, is the most surprising thing in this audit and the cheapest to fix.

Two months of the sequence in Part W gets this to a genuine 7.5–8. The architecture will not be what stops you.
