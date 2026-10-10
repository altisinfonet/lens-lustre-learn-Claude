# 50mm Retina World — Technology & Architecture Forensic Audit

**Date:** 2026-08-13 · **Commit audited:** `962570d` · **Method:** repository inspection only. Every claim below cites a file and line. Nothing is inferred from the UI.

---

## 1. ACTUAL TECHNOLOGY STACK

| Layer | What it actually is | Evidence |
|---|---|---|
| Frontend framework | **React 18.3.1** | `package.json` |
| Language | **TypeScript 5.8.3** | `package.json` (devDep) |
| Build tool | **Vite 7.3.6** with `@vitejs/plugin-react-swc` | `vite.config.ts` |
| UI library | **Radix UI** — 26 primitive packages, shadcn-style wrappers | `package.json:10-36` |
| CSS | **Tailwind CSS 3.4.17** | `package.json` |
| State / server cache | **TanStack Query 5.62.0** (exact pin, no caret) | `package.json`; `src/App.tsx:210` |
| Routing | **react-router-dom 6.30.1**, `BrowserRouter`, 60 `<Route>` tags / 50 page components, **all 50 lazy** | `src/App.tsx:352`, `:120-169` |
| Backend | **Supabase** (project `jtdtehuqtinjxropkkcn`) + **~68 Deno edge functions** | `supabase/functions/` |
| Database | **Postgres** via Supabase, ~598 migrations, RLS + **281 distinct `SECURITY DEFINER` functions** | `supabase/migrations/` |
| Auth | **Supabase Auth**; OAuth on mobile via system browser + custom-scheme deep link | `src/lib/native/authDeepLink.ts:58,75,89` |
| Storage | **Cloudflare R2** via browser presigned PUT (primary) with **Supabase Storage** as the legacy/fallback backend, selected at runtime by a DB flag | `src/lib/storageUpload.ts:37-49`; RPC `is_s3_storage_enabled` |
| Image CDN | **`cdn.50mmretina.com`** = R2 custom domain. Configured **outside this repo** — it comes from `site_settings.s3_storage_settings.public_url` | `supabase/functions/s3-presign-upload/index.ts:232` |
| Image transforms | **NONE ACTIVE.** Two transform layers exist in code; both are dead. See §6. | `src/components/post/PostMedia.tsx:157-163`; `src/lib/cdnImage.ts` (zero importers) |
| Edge/server functions | **7 Cloudflare Pages Functions** (SEO `<head>` injection + an asset cache-header fix) + **1 separate Cloudflare Worker** (`cloudflare/seo-edge-injector/worker.js`) | `functions/` |
| Web deployment | **Cloudflare Pages**, SPA + `_headers` / `_redirects`; no `wrangler.toml` in repo | `public/_headers` |
| PWA | `public/manifest.json` (standalone, 4 icons) + a **hand-written image-only service worker** (`sw-image-cache.js`, LRU 200 entries, caches **only** images from 4 buckets). **`vite-plugin-pwa` is declared in `package.json:86` and used nowhere** — no workbox, no app-shell precache | `src/main.tsx:93-140` |
| Mobile | **Capacitor** | `capacitor.config.ts` |
| Capacitor version | **Not pinned anywhere.** Zero `@capacitor/*` entries in `package.json` or either lockfile. CI runs a bare `npm install @capacitor/core @capacitor/cli @capacitor/android …` — **it floats to whatever is latest on the day of the build** | `.github/workflows/android-build.yml:105-111` |
| Android build | Gradle 8.13, AGP 8.12.3, Java 21 (temurin), NDK 27.1.12297006, minSdk 24 / compile 36 / target 36, R8 on (`minifyEnabled`, `shrinkResources`), R8 full mode deliberately off. AAB → Play (`track: production`, `status: draft`) + a sideloadable debug APK | `.github/workflows/android-build.yml:151-235, 402-703` |
| iOS build | **DOES NOT EXIST.** No `ios/` directory, `@capacitor/ios` appears nowhere in the repo, no Xcode project, no workflow | verified by grep |
| Native plugins | 11 installed in CI; **8 actually called** at runtime — `App`, `Browser`, `Camera`, `FirebaseMessaging`, `AppUpdate`, `Filesystem`, `Share`, (`SplashScreen` config-only) | see §7 table |
| WebView/wrapper | Bundled Capacitor WebView. `webDir: 'dist'`, **`server.url` NOT set** | `capacitor.config.ts` |
| React Native / Flutter / native code | **NONE.** `git ls-files | grep -E "\.(java|kt|swift|m|mm|gradle)$"` returns **empty**. `MainActivity` does not exist in this repository | verified |

### Which of the six is it?

**Answer: #2 — React + Capacitor with meaningful native integration.** Not #1, and provably not a PWA-in-a-box.

**Proof it is not a WebView pointing at your website (#1):**

- `capacitor.config.ts` sets `webDir: 'dist'` and **does not set `server.url` or `server.hostname`**. The web build is compiled into the APK.
- CI asserts this independently: `android-build.yml:287` verifies assets exist at `android/app/src/main/assets/public`, and `:625` verifies `assets/public/index.html` is **inside the APK binary**.
- Real native surfaces are wired, not decorative: FCM push with server-side token registration (`src/lib/native/push.ts:42-132` → RPC `register_push_token`), OAuth through the system browser returning via an `app.fiftymmretina://` intent-filter injected into the manifest (`android-build.yml:237-255`), Google Play in-app updates (`src/lib/native/appUpdate.ts:39`), native multi-select gallery (`src/lib/native/gallery.ts:56`), native share sheet with file attachment (`src/lib/saveFile.ts:86-150`), Filesystem writes to `Directory.Documents`, and hardware Back handling (`src/hooks/core/useAndroidBackButton.ts`).
- App-only UI exists and is gated at runtime by `isNativeCapacitorApp()` — e.g. the `+ Create` button.

**But with two serious qualifications:**

1. **The native project is not an artifact you own.** `android/` is not committed and not in `.gitignore` — it simply never exists locally. CI creates it fresh with `npx cap add android` and then patches it with ~20 `sed`/`python3` rewrites of generated files. You cannot add a line of Kotlin without editing a shell script inside a YAML file. There is no native codebase to grow into.
2. **Capacitor versions are unpinned.** A Capacitor 8 → 9 major release lands in your next build with no PR, no diff, no review. This is the single largest uncontrolled risk in the build system.

---

## 2. WEB ↔ MOBILE ARCHITECTURE

```
WEB
Browser
  └─ Cloudflare Pages (SPA: index.html + ~264 hashed chunks, 5.58 MB raw)
       ├─ Pages Functions  functions/journal/[slug].ts, competitions/[id].ts,
       │    courses/[slug].ts, featured-artist/[slug].ts, page/[slug].ts
       │    → fetch row from Supabase REST → rewrite <head> for crawlers
       └─ functions/assets/[[path]].ts → forces immutable cache headers; 404s stale chunks
  └─ React 18 SPA (BrowserRouter, 50 lazy routes)
       ├─ @supabase/supabase-js ──► Supabase Postgres (RLS + 281 SECURITY DEFINER fns)
       ├─ @supabase/supabase-js ──► Supabase Realtime (7 concurrent channels)
       ├─ supabase.functions.invoke ──► ~68 Deno edge functions
       └─ presigned PUT ──────────► Cloudflare R2 ──► cdn.50mmretina.com
  └─ Service worker: sw-image-cache.js (images only, LRU 200)

ANDROID
Android OS
  └─ APK/AAB  com.fiftymmretina.app  (versionCode 1000+run_number)
       └─ Capacitor WebView (androidScheme: https)
            └─ assets/public/  ← THE SAME dist/ BUILD, byte-identical
                 └─ same React SPA, same Supabase client, same R2 uploads
            └─ Capacitor bridge ──► App · Browser · Camera · Filesystem ·
                                     Share · FirebaseMessaging · AppUpdate
       └─ FCM ──► Firebase ──► supabase/functions/send-push-*

iOS
  (does not exist)
```

**Shared between web and Android: everything above the bridge.** One `dist/` build, one React tree, one Supabase client, one storage path, one set of edge functions. The `npm run build` that Cloudflare Pages deploys is the same command CI runs before `npx cap sync`.

**Android-only:** the 8 plugin call sites, and any UI behind `isNativeCapacitorApp()`.
**Web-only:** the SEO Pages Functions, the service worker, the Facebook-style composer row.

Code sharing is effectively **100% of the application layer**. That is the strongest property this architecture has, and it is why migrating away is expensive.

---

## 3. AM I ON THE RIGHT SHIP?

**Yes — but the ship is not the problem, and it never was.**

React + Capacitor is a legitimate foundation for an Instagram-like photography platform at 10k–1M users. Capability-by-capability against your list:

**Already solved or trivially solvable (the WebView is not the constraint):**
profiles · follow/follower · likes/comments/saves/shares · search · explore/discovery · notifications · push notifications (FCM, live) · camera/gallery access (native picker, live) · photo upload · EXIF handling (competitions) · deep links (live) · app lifecycle (live) · Play Store distribution (live, versionCode 1073 in production) · stories (`get_feed_stories_bar` RPC + `FeedStoriesBar`, live)

**Genuinely constrained by the current *implementation*, not by Capacitor:**
infinite scrolling feed · hundreds/thousands of photos · fast image loading · image preloading · lazy loading · smooth scrolling · memory usage · Android performance · offline/poor-network behaviour · large-scale traffic

**Genuinely constrained by the WebView itself:**
native gestures (no gesture recogniser; you have a deliberate **300 ms tap delay** at `PostMedia.tsx:410-442` to disambiguate double-tap-to-like — a native app would not need it) · haptics (no plugin) · background upload (impossible in a WebView without a native plugin; see §6) · battery under sustained video

**Does not exist at all:**
**video posts — zero support**, proven at four independent layers (`fileSecurityScanner.ts:238` does not even have `video` in its `AllowedFileType` union) · **Reels-style vertical video** — same · full-screen media viewer exists but is `<img>`-only · file compression exists but runs on the main thread · iOS

> **Note on Reels:** your standing instruction, recorded in `WallPosts.tsx` and in `claude/PENDING_AND_APP_BUILD_2026-08-12.md`, is **"NO REELS, NO LIVE."** Your audit brief asks me to evaluate Reels-style vertical video. I am flagging the contradiction rather than silently choosing one. If Reels is now in scope, that is a strategy change and it is the one item on your list that would genuinely stress this architecture.

---

## 4. ARCHITECTURE COMPARISON

| | **A. React Web + Capacitor** *(current)* | **B. React Native** | **C. Flutter** | **D. Fully native** |
|---|---|---|---|---|
| Performance | WebView JS + DOM; good, not native | Native views, JS logic | Native-compiled, own renderer | Ceiling |
| Feed smoothness | Needs virtualization to match; achievable | `FlashList` gives it for free | `ListView.builder` gives it for free | Best |
| Image-heavy | **Weakest point** — no native image cache, bitmaps live in WebView heap | `FastImage`, native decode budget | Native decode + cache | Best |
| Video | Poor. `<video>` in a WebView is the wrong tool for a scroll-feed | Good | Good | Best |
| Native capabilities | Plugin-mediated; ~80% coverage | Broad, plus easy bridging | Broad | Total |
| Development speed | **Fastest** — one codebase covers web + Android | Fast for mobile, web is a separate build | Fast for mobile, web is weak | Slowest |
| Code sharing | **~100% web↔mobile** | ~60-70% (logic only) | ~0% with an existing React web app | 0% |
| Maintenance | One tree | Two trees (web + mobile) | Two trees | Three trees |
| Web support | **Native — it IS the web app** | Separate React web build | Flutter Web is not competitive for SEO content | Separate |
| SEO | **Working today** — 7 Pages Functions inject per-page `<head>` for crawlers | Requires keeping the React web app anyway | Effectively no | Separate |
| Scalability | Backend-bound, not client-bound | Same backend | Same backend | Same backend |
| Ecosystem | Enormous (React + npm) | Large | Large, smaller for web | Platform-specific |
| Long-term cost | **Lowest** | ~2× | ~2× | ~3× |
| Migration difficulty *away from* | — | 6-12 months, keep web anyway | 9-18 months, lose web | 18+ months |
| **Score for an Instagram-like photography platform** | **7 / 10** | **8 / 10** | **8 / 10** | **9.5 / 10** |
| **Score for *your* situation** | **8.5 / 10** | 5 / 10 | 3.5 / 10 | 2 / 10 |

The gap between the two score rows is the whole decision. B/C/D win on raw capability. They lose badly for you because **your web product is load-bearing** — SEO, journal, courses, competitions, certificates, admin — and every alternative forces you to keep the React web app *and* build a second thing. You would double your maintenance to fix problems that are 80% in Postgres.

---

## 5. VERDICT: **YELLOW**

Correct foundation. Specific, identified, fixable architectural work is required before scale — and almost none of it is about Capacitor.

The exact technical reasons follow.

---

## 6. ARCHITECTURAL BOTTLENECKS IN YOUR ACTUAL CODE

### CRITICAL — the database will fail first

**6.1 The feed RPC computes a distinct-viewer count over *every visible post* to return 10.**
`supabase/migrations/20260812070000_post_categories.sql:396-410`. The `unseen_ranked` CTE runs a `LEFT JOIN LATERAL` doing `count(DISTINCT fe.user_id)` over `feed_events` for every row in `visible`, and the `row_number()` window must materialise across the whole set before the outer `LIMIT 10` picks anything. At 10,000 posts this counts distinct viewers 10,000 times to return 10 rows. **This is the single most expensive operation in the product and it gets worse every time anyone posts.**

**6.2 `visible` is a sequential scan of `posts`, and no index can fix it.**
Same file, line 373: the privacy filter is `public.can_view_post(me.uid, p.user_id, p.privacy)` — a `SECURITY DEFINER` function wrapping a `CASE`. It is **not sargable**, so `idx_posts_privacy_created_at` cannot be used. Every feed page for every member seq-scans the whole `posts` table. Meanwhile the schema carries **four redundant indexes** (`idx_posts_user_id`, one of the duplicate `(user_id, created_at DESC)` pair, one of the duplicate `(privacy, created_at DESC)` pair, `idx_feed_events_user_created`) paying write cost on the busiest table for zero read benefit.

**6.3 Missing the one index that matters.**
`feed_events` has six indexes and none is `(post_id, event_type, user_id)` — the exact shape used by both the `unseen_ranked` LATERAL and `get_post_view_counts`. Postgres index-scans `idx_feed_events_post` then **heap-fetches every event row of that post** to read `event_type` and `user_id`. This composite would turn the hottest operation in the feed into an index-only scan.

**6.4 Pagination is an unbounded client-supplied exclude-list.**
`src/hooks/feed/useFeedQuery.ts:467-470` — pure concatenation, no cap. **On page 20 the client uploads 200 UUIDs (~7.6 KB) with the request**, and the server does a linear array scan per candidate row. Cost is O(visible × exclude_len), **both factors growing**. The error fallback is worse: `useFeedQuery.ts:118` interpolates those ids into a **URL query string**, approaching proxy URL limits on the exact path that only runs when the network is already failing.

**6.5 A shipped SQL regression, hidden by a test that passes vacuously.**
`20260805040000_broadcast_feed_null_exclude_guard.sql:72` fixed a NULL trap with `ANY(COALESCE(_exclude_ids, '{}'))`. **Both later definitions reverted to bare `ANY(_exclude_ids)`.** The guard test `src/hooks/feed/__tests__/feedFreshness.test.ts:78-81` asserts the fix is present — but line 31 pins it to the **superseded file by hardcoded path**, so it has been green against a definition that is not deployed.

**6.6 Realtime fans every write on your four busiest tables to every client.**
`src/hooks/feed/useRealtimeFeed.ts:42-134` — the `feed-live` channel has **9 bindings and zero server-side filters** on `posts`, `post_reactions`, `post_comments`, `post_shares`. With 500 concurrent members, one reaction is broadcast to 500 sockets so 499 can `return` in JavaScript. `filter:` is available and is used correctly on the notifications channel — it simply was not applied here. Separately, `profileMapCache.ts:63` subscribes unfiltered to `user_badges` and `user_roles` and, on any event, calls `invalidateQueries(["profile-map"])` — **one badge granted to one stranger invalidates the profile map of every open session on the platform.**

### CRITICAL — the client will OOM on mid-range Android

**6.7 No virtualization, and no `maxPages`.**
`src/pages/Feed.tsx:393-441` is a plain `.map` over every loaded post. `useFeedQuery.ts:379-490` sets no `maxPages`, so React Query retains every page forever. **Ten scroll-loads = 100 live `PostCard`s**, each with 2-3 `<img>`, a Radix dropdown, an `IntersectionObserver` and framer-motion nodes. Nothing is ever unmounted. The codebase even contains a comment referring to "the feed's virtualiser" (`PostMedia.tsx:56`) — it does not exist.

**6.8 `loading="eager"` on a full-resolution original. This is the worst single line in the app.**
`src/components/post/PostMedia.tsx:349-362`, with the fallback at `:340`. When a post has no usable stored thumbnail, the blurred backdrop layer eagerly fetches the **2560px original, ignoring the viewport**, for every card mounted. A decoded 2560×1440 bitmap is **~14.7 MB of RAM**. Three common paths produce a missing thumbnail — realtime-inserted posts never get `thumbnail_urls` set (`Feed.tsx:90-110`), any length mismatch drops thumbnails for *all* slides (`PostCard.tsx:131-134`), and every scheduled post (see 6.10). Combined with 6.7, this is the OOM path.

**6.9 The entire responsive-image system is unreachable dead code.**
`PostMedia.tsx:157-163` gates transforms on `SUPABASE_PUBLIC_RE` — a `/storage/v1/object/public/` URL shape. **Every stored post image is on `cdn.50mmretina.com`.** So `isTransformable` is always false, `buildRenderUrl`/`buildSrcSet` never run, and `srcSet` falls to two rungs: `thumb 600w, original 2560w`. On a 412 px viewport at DPR 2.6 the slot needs ~1,070 device px — the browser skips the 600w and **downloads the 2560w original**. `src/lib/cdnImage.ts` is a fully written, fully tested, correctly-fixed transform layer with **zero importers**.

> **Read `PostMedia.tsx:89-130` before touching this.** The 2026-08-01 `/cdn-cgi/image/` rollout cut bandwidth 89% and simultaneously **broke every photo for every `www` and Android user for four days** (builds 1035-1051), because the transformer only served from the apex origin. It survived that long because any test from the apex passed. `cdnImage.ts` fixes the root cause (address the image's own host, never the apex) — it just was never wired in.

**6.10 Scheduled posts lose their thumbnails permanently.**
`scheduled_posts` has no thumbnail column (`20260701111436_...sql:6-11`), so `WallPosts.tsx:898-911` and `publish-scheduled-posts/index.ts:225-245` both omit it. The thumbnails **are generated and uploaded**, then orphaned in R2 — paid for, unreferenced. Every scheduled post serves full-size originals in the feed forever.

### HIGH

**6.11 Thirteen network round-trips per feed page, across four serial barriers.**
`useFeedQuery.ts`. Barrier 1: `fetchRelevantUsers` (2 queries) — awaited *before* the RPC is even issued, and used only to set an `is_suggested` boolean. Barrier 2: the RPC. Barrier 3: `enrichPosts` (7 entries, one fanning to 4). Barrier 4: a conditional second `fetchProfileMap` for tagged users. Plus: the `friendships` table is queried **twice** in one page load with the same predicate; a hardcoded **10 ms `setTimeout`** (`profileMapCache.ts:123`) sits on the critical path and fires twice on a page with tags; and `posts` is re-queried (`:190`) for `thumbnail_urls` because the RPC does not return them.

**6.12 The RPC returns no author identity — which is the bug you caught twice.**
`get_broadcast_feed` returns 11 columns and **joins nothing to profiles**. No name, no avatar. That is precisely why a post can render while its author's name is missing, and why `enrichPosts` needs four extra queries to reassemble the author line. **This is the root cause of "names showing as ?"** — not a retry problem.

**6.13 `refetchOnWindowFocus: true` re-fires everything on every alt-tab.**
`src/App.tsx:215`, combined with `useFeedQuery`'s `staleTime: 0` + `refetchOnMount: "always"`. For an infinite query React Query refetches **every loaded page** — a member five pages deep pays ~5 × 13 requests on each tab focus. (`src/lib/queryKeys.ts:15` documents this setting as `false`. It is `true`.)

**6.14 Two security findings in `SECURITY DEFINER` functions.**
`get_post_view_counts` (`20260731170000:1-20`) is granted to `authenticated` and queries `posts` with **no privacy predicate at all** — any member can pass arbitrary post ids and learn that a private post exists and how many distinct viewers it has. No array-length cap either. `get_contributor_scores` (`20260811160000:255-285`) is granted to **`anon`**; the migration explicitly REVOKEs its helper to prevent enumeration, but the wrapper takes an unbounded caller-supplied `uuid[]` and reaches that helper as DEFINER — giving an anonymous caller exactly the enumeration the REVOKE was written to prevent, at full-table-aggregate cost per call.

**6.15 Uploads are single unchunked PUTs with no retry and no queue.**
`src/lib/s3Upload.ts:124` — one `fetch` PUT of the whole blob, no multipart, no progress, no `AbortController`. Retry covers **only the presign call** (`:45-97`), never the PUT. The presigned URL expires in **300 s** (`s3-presign-upload/index.ts:9`), so resume is impossible in principle. Multi-photo posts upload **sequentially** (`WallPosts.tsx:569-656`); a failure on photo 3 orphans photos 1-2 in R2 with no row referencing them, and pressing Post again orphans another full set. Backgrounding the app mid-upload kills the post.

**6.16 Two full main-thread decode+encode cycles per photo.**
`src/lib/imageCompression.ts` — `canvas.toBlob`, no worker anywhere in `src/` (`new Worker`, `OffscreenCanvas`, `comlink`: zero matches). `imageUpload.ts:266` and `:314` each independently re-decode the original file. On a mid-range phone posting four photos this is eight main-thread image encodes.

**6.17 EXIF stripping is a side effect, and it silently inverts on the fallback path.**
Nothing calls a strip routine — EXIF is removed incidentally because the canvas re-encode emits pixels only. But `imageUpload.ts:273-288` (`FULL_RES_ENCODE_FELL_BACK`) uploads the **untouched original into the public `post-images` bucket, GPS intact**. The log message says "only larger" and does not flag the privacy change.

**6.18 ~484 KB gzip on the critical path before any route code.**
`index` 338.2 KB gz + `vendor-react` 50.2 + `vendor-framer-motion` 46.2 + `vendor-react-markdown` 35.3 + `vendor-query` 13.8. Two specific faults: the Supabase client and generated `types.ts` leak into the 1.1 MB entry chunk (77 `supabase` references) rather than being split; and naming `react-markdown` in `manualChunks` **promoted it into the entry graph**, so it is `modulepreload`ed on `/feed` where nothing renders markdown — the opposite of the config comment's stated intent.

### MEDIUM

**6.19 `PostCard` is not memoized** (`PostCard.tsx:673`), and `handleReact` has unstable identity (`Feed.tsx:185-191`, deps include `posts` and a `useMutation` object). One inbound realtime reaction on any post re-renders all N cards. **Fixing either alone does nothing** — it needs both.

**6.20 A real N+1 with a comment that says otherwise.** `src/pages/Friends.tsx:139-165`: `[otherIds].map(...)` is a one-element array, so the "batch" loop runs once and the inner loop issues `mutual_friends_count` **per user id** — 50 friends ⇒ up to 100 RPCs. Same shape in `MutualFriends.tsx:29-30` and `DiscoverCard.tsx:38`.

**6.21 `get_contributor_scores` aggregates the whole platform to answer for 8 users.** `contributor_points_since(NULL)` aggregates every public post and every comment row for every eligible member, *then* filters with `WHERE c.uid = ANY(_user_ids)`. The predicate is not pushed into the CTE. One request, full-table cost, on every feed screen.

**6.22 `profileBatch.ts` was never migrated off the ID-SET cache key** (`:67,79`) — the exact anti-pattern `profileMapCache.ts:5-26` documents as having caused 52 requests per feed load. `profileMapCache` was rewritten to an entity cache; this file was left behind and still misses across callers.

**6.23 `entry-originals` (public=false) is missing from all four `PRIVATE_BUCKETS` lists** (`storageUpload.ts:13`, `imageUpload.ts:9`, `s3-presign-upload/index.ts:25,35`). Any future route through `storageUpload` would return a **public URL for private RAW competition originals**.

**6.24 When the S3 flag is on, every Postgres RLS policy on `storage.objects` is inert.** `storageUpload.ts:41` turns the bucket name into a **key prefix inside one R2 bucket**. The privacy of `national-ids` rests entirely on string matching in the presign function and R2's external configuration — not on any policy in this repository.

**6.25 Two independently-expiring 60-second caches of the same S3 flag** (`storageUpload.ts:15` vs `s3Upload.ts:12`) can disagree mid-flip, splitting one post's full-res and thumbnail across two backends — the exact split that caused the 2026-08-07 broken-image incident.

**6.26 A stale duplicate workflow at repo root.** `/android-build.yml` is git-tracked and differs from the live `.github/workflows/android-build.yml` by **503 diff lines** (AGP 8.9.1, versionName 1.2.0, track: internal). It does not execute. It is a decoy.

**6.27 Three dead files statically import `@capacitor/*`** — `src/lib/native/share.ts`, `camera.ts`, `platform.ts`. They have zero importers and would **fail to resolve if anyone ever imported them**, because `@capacitor/core` is not in `package.json`. They are harmless only because tree-shaking never reaches them.

### Verified healthy — do not "fix" these

Route code-splitting (50/50 lazy, with genuinely well-designed stale-chunk healing in `lazyRetry`). Listener/interval/realtime cleanup discipline — I checked all 8 count imbalances and every one is an intentional module-level singleton; **there are no per-mount leaks**. Heavy work correctly kept off the render path. CLS handled via `aspectRatio`. `InfiniteScrollSentinel` itself. Query-key centralisation. The presign path-ownership gate. The batching in `contributorScore.ts` and `adEngagement.ts`.

---

## 7. IS CAPACITOR MERELY WRAPPING MY WEBSITE?

**No — the edges are properly native. The middle is still a web page.**

**Evidence of real mobile design:**

| Plugin | Call site | What it does |
|---|---|---|
| `App` | `useAndroidBackButton.ts:72` | hardware Back: close overlay → history → exit |
| `App` | `authDeepLink.ts:75` | `appUrlOpen` for the OAuth callback |
| `App` | `useEngagementHeartbeat.ts:96` | `appStateChange` lifecycle |
| `Browser` | `authDeepLink.ts:58,89` | OAuth in a system browser tab, not the WebView |
| `Camera` | `gallery.ts:56` | native permission check + `pickImages()` multi-select |
| `FirebaseMessaging` | `push.ts:42-132` | permissions, token, tap-through routing |
| `AppUpdate` | `appUpdate.ts:39` | Google Play in-app update prompt |
| `Filesystem` + `Share` | `saveFile.ts:86-150` | write to Documents, then native share sheet |

Plus: a manifest intent-filter for `app.fiftymmretina://`, FCM notification icon/colour meta-data, an app-only UI branch behind `isNativeCapacitorApp()`, and a documented rule — enforced by a test (`saveFile.test.ts:85`) — that native code must go through `window.Capacitor.Plugins` rather than a static import, so the web build cannot break.

**Evidence it is still web-shaped where it counts:**

- **The feed is a plain unbounded DOM list.** That is a website's feed. An app's feed recycles.
- **No native image cache.** Every decoded bitmap lives in the WebView heap and is subject to WebView memory limits, not Android's.
- **No background upload**, no upload queue, no resumability.
- **No haptics, no native gesture recogniser** — hence the 300 ms tap delay.
- **Zero owned native code**, and `android/` is not even a repository artifact.
- **No iOS.**

So the honest framing: the *shell* is a real app; the *feed* is a web page. Instagram's feel comes almost entirely from the feed. That is where the gap is, and it closes with virtualization + image discipline — not with a migration.

---

## 8. INSTAGRAM-SCALE REALITY CHECK

**Bottleneck order, first to fail:**

**1. DATABASE — fails first, around 10k-50k users / ~100k posts.**
Not Supabase the product. Your feed RPC. The `count(DISTINCT)` LATERAL over every visible post (6.1) plus the non-sargable `can_view_post` seq scan (6.2) mean feed cost is O(total_posts) per page view, and the exclude-array makes it O(posts × page_depth). At 100k posts this is seconds per feed page. **Nothing else in the stack will get a chance to fail first.**

**2. REALTIME — fails at roughly the same scale, for a different reason.**
The unfiltered `feed-live` channel (6.6) makes broadcast volume O(concurrent_users × global_write_rate). At 5,000 concurrent members and 10 writes/second, that is 50,000 messages/second delivered so that 49,990 can be discarded client-side.

**3. CLIENT / WEBVIEW — already failing today on mid-range Android.**
No virtualization + eager full-res decode (6.7, 6.8) is an OOM in a long scroll session **right now**, at your current user count. This is the one your members feel today.

**4. STORAGE EGRESS / CDN — becomes a cost problem, not an outage.**
Serving 2560px originals to phones (6.9) is roughly a 6-8× bandwidth multiplier. The `/cdn-cgi/image` experiment measured **89%** savings before it was rolled back. At 1M users that is the difference between a manageable R2 bill and a crisis.

**5. IMAGE PROCESSING — a UX problem that becomes a support problem.**
Main-thread compression (6.16) and non-resumable uploads (6.15) produce a rising rate of "my post failed" reports as your user base shifts toward weaker devices and networks.

**6. NOTIFICATIONS / EDGE FUNCTIONS / API — comfortable to ~1M** if the above are fixed.

**7. VIDEO PROCESSING — not on the list, because video does not exist.** If it becomes a requirement, it is a new subsystem (transcode, HLS packaging, adaptive delivery) and the WebView is the wrong renderer for a vertical scroll-feed of it.

**Honest scale summary:**
**100k users** — reachable with fixes 1-5 below. **1M users** — reachable, but the feed must be precomputed/fan-out-on-write rather than computed per request, and you will need a read replica. **10M users** — a different company with a different backend; no architecture you pick today survives that unchanged, and choosing Flutter now would not change it.

---

## 9. CTO VERDICT

**CURRENT STACK:**
React 18.3.1 + TypeScript 5.8.3 + Vite 7.3.6 (SWC) · Tailwind 3.4.17 + Radix UI · TanStack Query 5.62.0 · react-router-dom 6.30.1 (BrowserRouter, 50 lazy routes) · Supabase Postgres + Auth + RLS + Realtime + ~68 Deno edge functions · Cloudflare R2 storage behind `cdn.50mmretina.com` via browser presigned PUT · Cloudflare Pages + 7 Pages Functions + 1 SEO Worker · manifest + an image-only service worker (`vite-plugin-pwa` declared, never used).

**MOBILE ARCHITECTURE:**
Capacitor, **bundled** (`webDir: 'dist'`, no `server.url`) — the `dist/` build is compiled into the APK. Android only. `android/` is **not committed**; CI regenerates it with `npx cap add android` and patches generated files by `sed`. **Zero hand-written native code. No iOS. Capacitor versions unpinned.** 8 native plugins genuinely integrated (App, Browser, Camera, FirebaseMessaging, AppUpdate, Filesystem, Share, SplashScreen-config).

**VERDICT:**
**YELLOW**

**SHOULD I MIGRATE NOW?**
**NO**

**WHY:**
1. Your top five bottlenecks are all in Postgres and image delivery. **A migration fixes none of them** and delays fixing them by a year.
2. Your web product is load-bearing — SEO, journal, courses, competitions, certificates, admin. Every alternative forces you to keep the React web app *and* build a second thing.
3. You share ~100% of the application layer between web and Android today. RN drops that to ~60%; Flutter to ~0%.
4. Capacitor is not what is making the feed slow. **No virtualization** and an **eager full-resolution image fetch** are, and both are days of work.
5. The native integration you already have is real and non-trivial — FCM push, deep-link OAuth, Play in-app updates, native picker, native share. That is months of work you would rebuild.
6. You are already shipping to Play (versionCode 1073 in production). You would restart distribution.
7. Instagram-class *feel* on a photography feed is achievable in a WebView. It requires recycling and correct image sizing, which is exactly what you are missing.
8. Video is the one place a WebView genuinely loses — and you have **zero** video today and a standing "NO REELS, NO LIVE" rule. There is nothing to migrate for.
9. Your build system is already the fragile part. Adding a second toolchain to an unpinned, uncommitted native project makes it worse, not better.
10. The cost of the *fixes* is roughly 4-6 weeks. The cost of a *migration* is 6-18 months, and you would still have to do most of the fixes.

**WHAT I MUST FIX BEFORE SCALE:**
1. **Rewrite the feed RPC.** Precompute `view_count` on `posts` (trigger or periodic job) — stop the `count(DISTINCT)` LATERAL over all visible posts. Replace the unbounded exclude-array with **keyset pagination** on `(created_at, id)`.
2. **Make the privacy filter sargable** — a `visibility` column or a materialised per-viewer visibility set — so the feed stops seq-scanning `posts`.
3. **Add `idx_feed_events (post_id, event_type, user_id)`** and drop the four redundant indexes on `posts` / `feed_events`.
4. **Return `author_name`, `author_avatar`, `thumbnail_urls`, `categories` from `get_broadcast_feed`** (join `profiles_public_data`). Kills 5 of 13 requests per page **and** permanently fixes the "names showing as ?" bug.
5. **Virtualize the feed** and set `maxPages` on the infinite query.
6. **Fix `loading="eager"` on the backdrop**, never let the LQIP fall through to the original, and **wire `cdnImage.ts`** so a real responsive ladder exists. Read `PostMedia.tsx:89-130` first.
7. **Add server-side `filter:` to the `feed-live` realtime channel**, and stop `profileMapCache` invalidating every session on any user's badge change.
8. **Fix `get_post_view_counts`** (add the privacy predicate + an array cap) and **`get_contributor_scores`** (revoke from `anon`, push the predicate into the CTE).
9. **Add a thumbnail column to `scheduled_posts`** and carry it through the publisher.
10. **Make uploads resumable** (multipart or chunked), add an upload queue with orphan cleanup, and **move compression to a Web Worker**.
11. **Pin the Capacitor versions** in `package.json` and **commit `android/`**. Delete the stale root `android-build.yml`.
12. **Fix the vacuous guard test** (`feedFreshness.test.ts:31` pins a superseded migration) and restore the `COALESCE(_exclude_ids, '{}')` guard.

**WHAT I SHOULD NOT WASTE TIME CHANGING:**
1. React → React Native / Flutter. **Do not.**
2. The UI kit. Radix + Tailwind is a correct, boring, maintainable choice.
3. TanStack Query. The problem is two cache-key shapes and one default, not the library.
4. Supabase → self-hosted Postgres. You have not hit a Supabase limit; you have hit a query-design limit.
5. R8 full mode. Micro-gain, real crash risk. You already deferred it — stay deferred.
6. Route code-splitting. It is already 50/50 lazy with better stale-chunk handling than most production apps.
7. The Cloudflare Pages Functions SEO layer. It works and it is why you have SEO at all.
8. Adding iOS *before* fixing the feed. iOS will inherit every one of these problems.

**5-YEAR ARCHITECTURE RECOMMENDATION:**

Stay on React + Capacitor. Spend the next two months on §"must fix" items 1-7 — that is where your product quality actually lives.

Then, in order: **(a)** pin and commit the native project so you can write Kotlin when you need to; **(b)** add iOS through the same Capacitor project once the feed is fast, because it costs you one workflow rather than a codebase; **(c)** as you approach ~500k users, move the feed from computed-per-request to **fan-out-on-write** — a `feed_items` table populated by a worker — which is the change every social platform eventually makes and which is independent of your client stack; **(d)** if vertical video ever becomes core strategy, build **that one screen** natively via a Capacitor plugin rather than migrating the app — a WebView renders a video scroll-feed badly, and it is the only screen where that is true.

The thing to internalise: **you did not pick the wrong ship. You are sailing it with the anchor down.** Every genuinely serious problem in this audit is a query, an index, an `<img>` attribute, or a missing `filter:` — not a framework.
