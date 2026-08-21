# PHASE 3 — OFFLINE RESILIENCE AUDIT

**Date:** 2026-08-21 · **READ-ONLY** — no code changed, no percentage changed, no phase started
**Repo audited:** `main` = `9160b75` · Phase 3 spec traced to `claude/ENGINEERING_PLAN_TO_PRODUCTION_GRADE.md` (2026-08-14)

---

## THE ANSWER FIRST

> **"After Phase 3, will 50mm actually behave like Facebook/Instagram when the network disappears?"**
>
> **No.** Phase 3, as written, is *upload* reliability — retry/backoff on the PUT,
> AbortController, re-presign on 403, XHR progress, IndexedDB *pending-upload* state, orphan
> sweep, worker-thread encoding. Its acceptance gate is "kill the network at 50% of a 5-photo
> upload, force-quit, relaunch completes the same post." That is the **write** direction.
> The behaviour you observed — Facebook/Instagram still *showing* a feed offline — is the
> **read** direction, and it appears **nowhere** in Phases 0–5 as an implementation item.
> The nearest thing is one row in the design review's disaster track (D2: "R2 unreachable →
> feed degrades to cached/placeholder, no blank page") — a gate criterion with no
> engineering item behind it, and it describes a storage outage, not a device offline.
> This is a **category-D gap**: not included in Phase 3, required for the UX you described.

---

## 1. CURRENT BEHAVIOUR (observed and confirmed by code trace)

Online: feed loads via `get_broadcast_feed` RPC, first page is written to a localStorage
cache. Network lost: after retries exhaust, the app shows the WifiOff card — *"Couldn't
load your feed / This looks like a connection problem, not an empty feed."* — and **no
photographs**. Cold restart offline: same card after a spinner. The card itself is honest
and deliberate (`Feed.tsx:320-355`, added 2026-08-12 so a dropped request stops reading as
an empty platform) — the gap is that it has almost nothing cached to fall back on.

## 2. EXACT TECHNICAL REASON THE FEED GOES BLANK OFFLINE

Five links in the chain, each proven at file:line:

1. **The only feed persistence is one page with a 30-minute suicide clause.**
   `src/lib/feedCache.ts`: localStorage key `feed_cache_v1`, **first 10 posts only**,
   `MAX_AGE_MS = 30 min` — and `getCachedFeed` **deletes** the entry when expired. Open
   the app 31+ minutes after last use, offline, and the cache is not just stale, it is
   *erased on read*.

2. **The cache is only a `placeholderData`, and placeholders die on error.**
   `useFeedQuery.ts:451-469` feeds the cached page in as React Query `placeholderData`.
   In TanStack Query v5 placeholder data is surfaced **only while the query is pending**;
   when the fetch fails (retry 3 with 2s/4s/8s backoff, `useFeedQuery.ts:515-516`), status
   becomes `error`, `data` reverts to `undefined`, and `Feed.tsx:319`'s
   `isError && posts.length === 0` renders the error card. So even *within* the 30-minute
   window, offline cold-start shows the cached posts for ~15–20 seconds and then
   **replaces them with the error card**. (The graceful "stale feed + banner" path at
   `Feed.tsx:372` only holds when the query has real in-memory data from a success in the
   same session — `gcTime` 10 min, memory only, gone on restart.)

3. **The image-cache service worker never runs in the app.**
   `src/main.tsx:120-124`: `isPreviewHost` includes `hostname === "localhost"` — and the
   Capacitor app serves from `https://localhost` (`androidScheme: 'https'`). In the app
   the code takes the *unregister* branch: any SW is removed and `sw-image-cache.js` is
   **never registered**. Web-only, exactly as the 2026-08-13 architecture audit recorded.

4. **Even where the SW runs, it cannot cache a single live image.**
   `public/sw-image-cache.js:38-52` matches Supabase Storage paths and `*.r2.dev` hosts.
   **`cdn.50mmretina.com` — the host every current image is served from — matches
   neither pattern.** The LRU-200 image cache is live code guarding an empty set.

5. **The stored objects carry no HTTP caching contract.**
   The R2 upload PUT sends **only `Content-Type`** (`src/lib/s3Upload.ts:147`) — no
   `Cache-Control` on any post image. The WebView's HTTP cache falls back to heuristic
   freshness; offline, a heuristic entry revalidates, the revalidation fails, and the
   image errors (then `installImageFallback` swaps in the branded placeholder). Cached
   display offline is luck, not design. (`fix-cache-headers/index.ts` exists to repair
   exactly this — for **Supabase** storage, admin-triggered, never for R2.)

Supporting facts: **zero network-state detection** in app code (no `navigator.onLine`
listener, no Capacitor Network plugin; React Query's default `networkMode: 'online'` is
the only implicit check, and Android WebView's `onLine` is unreliable — the observed error
card proves fetches were attempted and failed). **Zero IndexedDB** outside a test.
`vite-plugin-pwa` is a declared dependency used nowhere. `runCacheBuster`
(`cacheBuster.ts`) purges *all* Cache Storage and service workers on version bump.

## 3. EXISTING CACHE MECHANISMS (complete inventory)

| # | Mechanism | File | Caches | Lifetime | Survives restart | Survives force-close | Works offline | Images | Feed metadata | Privacy-safe |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Feed first-page cache | `src/lib/feedCache.ts` (write: `useFeedQuery.ts:565`) | 10 enriched posts + networkIds | **30 min, deleted on expiry read** | yes (localStorage) | yes | **partially** — dies when the query errors (§2.2) | no | yes (page 1 only) | user-bound on read; cleared on logout (`useAuth.tsx:529`) |
| 2 | React Query memory cache | `App.tsx:210-216` | all query data | `gcTime` 10 min, **memory** | **no** | **no** | shows stale data only if fetched this session | no | yes | dies with process — safe |
| 3 | Image SW LRU-200 | `public/sw-image-cache.js` | image responses | until evicted/`cacheBuster` | yes | yes | yes *in theory* | **matches 0 live URLs** (§2.4) and **not registered in the app** (§2.3) | no | no auth binding — moot while empty |
| 4 | WebView/browser HTTP cache | (no repo config) | responses per headers | heuristic — **no Cache-Control set on R2 objects** | OS-managed | OS-managed | unreliable | incidental | no | OS-level |
| 5 | Supabase auth session | supabase-js localStorage | tokens | until logout | yes | yes | yes (identity survives offline) | — | — | yes |
| 6 | Misc localStorage | theme, i18n, consent, trusted device, judge resume, ad frequency, dismissed announcements, recent searches, cache_buster version | tiny scalars | varies | yes | yes | yes | no | no | fine |

That is the whole list. **No query persister, no IndexedDB, no app-shell cache, no
pagination cache, no image prefetch-to-disk.** Nothing else in `src/` caches feed or media.

## 4. EXISTING IMAGE-CACHE MECHANISMS

Exactly one built (`sw-image-cache.js`) and it is doubly dead in the app: never registered
(localhost guard) and pattern-blind to `cdn.50mmretina.com`. Ironically its Supabase
pattern *does* match the 27 permanent-legacy thumbnails (D-006) — on web, the only images
it can cache are the ones we just declared permanently legacy. Image *retry* exists as
`installImageFallback` (broken `<img>` → branded placeholder) and `PostMedia`'s
thumb→original `onError` fallback — both need the network to succeed.

## 5. PHASE 3 COVERAGE (traced, not assumed)

From `ENGINEERING_PLAN_TO_PRODUCTION_GRADE.md` §2 — the plan the "do not start Phase 3"
instruction refers to:

| Phase | Scope | Offline-feed relevance |
|---|---|---|
| 0 | security, CI, seeded harness | none |
| 1 | feed database (sargable, deterministic ranking) | enabler only — deterministic ordering makes feed *cacheable* (§1.2: "non-deterministic ordering forecloses caching permanently") |
| 2 | media pipeline (content-addressing, derivatives) | **§2.2 is the one real brick**: immutable `Cache-Control: max-age=31536000, immutable` on content-addressed objects — that makes images *HTTP-cacheable offline* as a side effect |
| **3** | **upload reliability** (retry, abort, resume, IndexedDB pending-*upload*, orphan sweep, worker encode) | **write-direction offline only.** Nothing about displaying a feed offline |
| 4 | pagination + realtime | none |
| 5 | observability | none |
| Disaster track (design review) | D2 "R2 unreachable → feed degrades to cached/placeholder, no blank page"; D4 "Supabase unreachable → connection state shown" | the closest *requirement* anywhere — a gate with **no implementation item in any phase** |

**Verdict: offline-first read resilience is ABSENT from Phase 3 and from every phase.**
Phase 1 and Phase 2 §2.2 are prerequisites that would make it *possible*; no phase builds it.

## 6. MISSING ENGINEERING (category D — the honest gap list)

1. **Persistent feed store** — the last N usable pages (posts + author lines + reaction
   state), IndexedDB (localStorage's ~5 MB and synchronous API are wrong for this), owner-
   bound, no 30-minute TTL for *display* (staleness is a label, not a deletion criterion).
2. **Error-state fallback that prefers stale over blank** — when refetch fails and a
   persisted feed exists, render it with the existing "saved posts" banner; the error card
   only when there is genuinely nothing. (Smallest single fix in this list: the banner UI
   at `Feed.tsx:372` already exists; today it just can't fire after a restart.)
3. **An image cache that actually matches the CDN** — fix the SW pattern to include
   `cdn.50mmretina.com`, register it in the Capacitor app (drop the `localhost` blanket
   guard in favour of an explicit Capacitor check), or use a Cache Storage layer the app
   controls directly.
4. **`Cache-Control` on stored objects** — today's objects are immutable-in-practice
   (unique timestamped keys, never overwritten except avatar/cover): they can carry
   `max-age=31536000, immutable` *now*, without waiting for Phase 2's content-addressing.
   Avatar/cover (the mutable pair) keep short TTLs.
5. **Network-state awareness** — Capacitor Network plugin (or `online`/`offline`
   listeners): label the offline state, pause refetch hammering, refresh on reconnect.
6. **Session-bound purge** — one function that wipes feed store + image cache on logout
   and account switch (feedCache already does its part; nothing covers an image cache).

## 7. PRIVACY / SECURITY RISKS (per the hard requirement)

- **The elephant: D-002.** Today the CDN serves every image to anyone with the URL,
  authenticated or not. Any offline image cache is currently *less* exposed than the live
  CDN. But D-002 will close — and an image cache built without session binding would then
  silently reopen it on-device. **Cache design must assume D-002 closed.**
- **Current feedCache**: correctly owner-bound on read, cleared on logout — but the raw
  localStorage value (post text, author names, friends-only post URLs) sits readable on
  the device regardless of who logs in next; the guard is app code, not encryption. A
  friends-only post's metadata can persist 30 min past logout if `clearFeedCache` never
  runs (crash, uninstall-reinstall keeps WebView data on some restores).
- **Required rules for any future cache** (the audit's answer, not an implementation):
  cache keys namespaced by `user_id`; wipe on `SIGNED_OUT` and on `user_id` change;
  deleted/privacy-changed posts reconciled out on every successful refresh; image cache
  keyed per-account or wiped on account switch; no cache of another member's
  private/friends bytes beyond what that session could fetch anyway; bounded size so the
  device never accumulates a shadow archive.
- **Deleted posts:** any stale-display design will briefly show deleted posts offline —
  FB/IG accept this; it must be a stated decision, not an accident.

## 8. RECOMMENDED ARCHITECTURE (for when it is scheduled — nothing built today)

Stale-while-revalidate, three layers, all session-bound:
**(1) Feed store** in IndexedDB: last ~3 pages of enriched posts per user, written on every
successful fetch, displayed instantly on open (online or not), refreshed in background,
reconciled (new/changed/deleted) on success, labelled "saved" when the refresh fails.
**(2) Image cache**: Cache Storage, thumb-first (600px `-thumb.webp` ≈ 15–50 KB — 30 posts
≈ ~1 MB), originals only on view; LRU bounded (~50–100 MB); purged on logout/switch.
**(3) Network state** via Capacitor Network plugin driving an offline chip, refetch
suppression, and reconnect refresh. Prerequisites already in the plan: deterministic
ordering (Phase 1) makes cached pages coherent; immutable Cache-Control (Phase 2 §2.2, or
the early version in §6.4) makes the image layer mostly free.

## 9. REQUIRED TEST MATRIX

| # | Scenario | Pass |
|---|---|---|
| 1 | Feed loaded → airplane mode → scroll | cached posts + images remain; offline label; no error card |
| 2 | Offline → cold app restart | last feed renders from disk; no blank |
| 3 | Offline > 30 min → open | same as 2 (no TTL suicide) |
| 4 | Reconnect | background refresh; new posts appear; deleted posts leave; cache updated |
| 5 | Logout → login as another account | zero posts/images from account A visible or on disk |
| 6 | Privacy flip while cached (public→private) | reconciled out on next successful refresh |
| 7 | Flaky 2G | no request storm (backoff, no focus-refetch hammering) |
| 8 | Cache full | LRU eviction; app functional; bounded disk |
| 9 | `cache_buster` bump | app cache purged once, then repopulates (existing behaviour preserved) |
| 10 | Offline compose attempt | clear failure or queued draft — never a silent loss (meets Phase 3's own upload gate) |

## 10. SHOULD THIS BE A MANDATORY PHASE 3 GATE?

**It cannot honestly be *added into* Phase 3 as written** — that phase is upload
reliability with its own gate, and stuffing read-side offline into it would blur both.
My recommendation, as an owner decision (not made for you): adopt it as its own item —
**"Phase 3R — Read-side offline resilience"** — gated by matrix rows 1–5, sequenced after
Phase 1's deterministic ordering, alongside Phase 3 (both are "the app on a bad network",
one per direction). The disaster-track D2 row already *implies* this requirement; today it
is a gate with no work item, which is exactly how it stayed invisible until a member
compared 50mm to Facebook in an elevator with no signal.

### Classification (the exact A–E requested)

| Class | Items |
|---|---|
| **A — already implemented** | error-vs-empty distinction (`Feed.tsx`); stale-feed banner *within a session*; image→placeholder fallback; first-page localStorage cache with owner binding + logout clear; cache-buster hygiene |
| **B — partially implemented** | feed persistence (1 page, 30-min TTL, dies on query error, dies on restart-then-error); image SW (built, never effective: wrong hosts + not registered in app); HTTP image caching (possible, no headers set) |
| **C — in Phase 3 but not implemented** | *upload-side* offline: PUT retry, abort/timeout, resumable pending-upload state (IndexedDB), progress — the whole of Phase 3 §3.1–3.7 |
| **D — NOT in Phase 3 (any phase) but required for the FB/IG UX** | persistent multi-page feed store; display-stale-over-blank on cold start; CDN-matching, app-registered image cache; Cache-Control on stored objects (early version); network-state detection; reconnect reconciliation; session-bound cache purge |
| **E — not required** | full offline PWA/app-shell precache (the app is bundled — its shell is already offline by construction); offline posting/queueing beyond Phase 3's upload resume; offline search/discover/competitions; workbox adoption for its own sake |

Phase 2 stays **96%**. Phase 3 percentage untouched. Nothing implemented.
