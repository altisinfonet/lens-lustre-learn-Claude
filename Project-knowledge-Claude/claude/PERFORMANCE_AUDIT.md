# Performance Audit — why the app feels slow (2026-08-01)

> Measured on production (`50mmretina.com/feed`, logged in, desktop Chrome,
> build `2026-08-01-11`). Every number below was read from the browser's
> Performance API on a real page load, not estimated.
>
> **Headline: the network is fine. The request COUNT is the problem.**

---

## 0. The one-paragraph answer

A single feed load fires **106 requests to Supabase**. Median round-trip to
Supabase from this browser is **206 ms**, so the connection is healthy — but 106
of them at 206–1000 ms each saturate the browser's connection pool and the main
thread. Everything else the user complains about (reactions, comments, scroll)
is *downstream of that*: those code paths are already optimistic and already
batched, they are simply starved. **~85 of the 106 requests are avoidable and
collapse to about 5.**

---

## 1. The measurement

| Metric | Value |
|---|---|
| Requests on one feed load | **162** total, **106** of them Supabase API |
| Distinct API endpoints | 23 |
| Median Supabase round-trip (isolated, warm) | **206 ms** |
| Average round-trip under feed load | **~480 ms** (2.3× baseline — contention) |
| TTFB (HTML) | 1,612 ms |
| DOM ready | 2,075 ms |
| JS shipped | 0.67 MB over 18 files |

### The 106 API calls, by endpoint

| Endpoint | Calls | Distinct URLs | Pure duplicates | Cumulative request time |
|---|---|---|---|---|
| `profiles_public_data` | 31 | 29 | 2 | **14.0 s** |
| `site_settings` | 23 | 8 | **15** | **10.0 s** |
| `user_badges` | 13 | 13 | 0 | 6.0 s |
| `rpc:get_public_roles_for_users` | 13 | 1 (POST) | see note | 5.6 s |
| `profiles` | 5 | — | — | 3.2 s |
| `rpc:app_has_role` | 5 | 1 (POST) | see note | 1.2 s |

> **Correction, made after reading the callers.** An earlier draft of this
> document counted the two `rpc:` rows as "12 and 4 pure duplicates" because
> they show a single distinct URL. That reading is **wrong**: RPCs are POSTs and
> their parameters live in the request BODY, so identical URLs do not mean
> identical requests. Those 18 calls are not duplicates — they are one call per
> fragmented ID set (§2b) and one call per suggested user (§2c). The only
> genuinely repeated-identical requests are the 15 in `site_settings`.

"Cumulative request time" is the sum of every call's duration. It overlaps in
wall-clock because requests run in parallel — but it is the load the browser and
the database are actually being asked to carry, and it is why individual
requests degrade from 206 ms to 480 ms.

---

## 2. Root cause — there are two, and they are different bugs

### 2a. `site_settings` — the same request, repeated

23 calls across only **8 distinct URLs**: **15 requests that are byte-for-byte
the same request repeated**, with no cache between them. These are GETs, so the
distinct-URL count is meaningful here.

`site_settings` has **77 direct `from("site_settings")` call sites** across the
codebase and no shared accessor at all. Every component that wants a setting
asks the network itself.

### 2b. The profile cache is keyed by the ID SET, not by the ID

`profiles_public_data` shows **31 calls across 29 distinct URLs** — almost no
repeats, because each caller asks for its own slice of user IDs.

`src/lib/profileMapCache.ts` and `src/lib/profileBatch.ts` *do* batch and *do*
cache — through React Query, keyed on the sorted ID array:

```ts
queryKeys.profileMap([a, b, c])   // one cache entry
queryKeys.profileMap([a])         // a DIFFERENT entry — refetches `a`
queryKeys.profileMap([b, c])      // a THIRD entry — refetches b and c
```

So a feed of ~10 posts by ~8 distinct authors generates 29 separate profile
queries instead of one. The batching layer works perfectly *within* a call and
never *across* calls. `user_badges` (13 calls / 13 distinct URLs) has the same
shape.

**And each miss costs four requests, not one.** `rawFetchProfileMap` issues
`profiles` + `user_badges` + `get_public_roles_for_users` + a second
`profiles` call for presence, every time. So 13 fragmented calls = **52
requests**, which is exactly where the 31 `profiles_public_data`, 13
`user_badges` and 13 `get_public_roles_for_users` come from.

**The fix for this class is an entity-level cache**: store each profile under
its own key, and on each request fetch only the IDs not already in cache,
coalescing everything requested within one tick into a single query (the
DataLoader pattern). 52 requests become ~4.

### 2c. `app_has_role` — one role check per suggested user

`FeedRightSidebar` calls `supabase.rpc("app_has_role", { _user_id: s.id })`
inside a loop over the suggested-people list — a textbook N+1. `getAdminIds()`
in `src/lib/adminBrand.ts` already returns every admin in a single call; the
sidebar should use it. 5 requests become 0 (it is already being fetched
elsewhere on the page).

---

## 3. The other symptoms, and which are separate problems

| Symptom | Verdict |
|---|---|
| **Feed loads slowly** | The root cause above. Directly explained. |
| **Reactions feel slow** | **Not a separate bug.** `useReactToPost` already patches the cache in `onMutate` with no invalidation — the UI is optimistic and should be instant. It feels slow because the main thread and connection pool are saturated by the request storm. Fixing §2 fixes this. |
| **Scrolling is slow** | Same starvation, plus §4 below — full-resolution images decoding on the main thread. |
| **Comments are slow to open** | **Partly separate.** `PostCommentsSection.loadComments` runs **3 sequential waves**: `post_comments` → then `Promise.all([getAdminIds, reactions, userReactions])` → then `useProfileMap(authorIds)` fires on the next render. ~3 round trips (≈600–1000 ms) before a single comment appears. Collapsible to one RPC. |
| **Uploading from the app is slow** | **Separate.** Two full canvas decode+encode passes per photo on the main thread (`compressImageToFiles` at ≤2560 px, then `compressThumbnail` at 600 px), plus an `isS3Enabled()` round trip and a presign call, then a 1–3 MB upload. On a mid-range Android webview a 12 MP photo is seconds of blocked UI. |

---

## 4. Images: the bandwidth optimisation is dead code on production

`PostMedia.isTransformable()` only matches
`…supabase.co/storage/v1/object/public/…`. Production post images are served
from **`cdn.50mmretina.com`** (R2/S3), so `buildRenderUrl`, `buildLqipUrl` and
`buildSrcSet` **all no-op**.

Measured live: no `srcset` attribute, no `?width=` query, `naturalWidth 2560`.

So every feed card downloads the **full 2560 px WebP**, there is no 32 px
placeholder, and there is no responsive `srcset`. The blurred backdrop is that
same full image blurred — the same single request, so no *extra* bandwidth, but
not the ~1 KB placeholder the code was written for. This is why a card can sit
as a large blur for seconds.

---

## 5. Fix order, by impact per unit of risk

1. **Entity-level profile/badge cache** (§2b). DataLoader-style: cache per ID,
   fetch only the misses, coalesce per tick. **This is the big one — it removes
   roughly 48 of the 106 requests** and is contained to `profileMapCache.ts` /
   `profileBatch.ts` and their hooks.
2. **A shared cached accessor for `site_settings`** (§2a), plus the
   `app_has_role` N+1 in `FeedRightSidebar` (§2c). Removes ~20 more.
3. **One RPC for a comment thread** (§3). Comments open in one round trip
   instead of three.
4. **Real image sizing** (§4). Either route R2 through a resizing endpoint
   (Cloudflare Images or a Worker) or generate the responsive sizes at upload.
   Biggest bandwidth win available; also the biggest scroll-smoothness win.
5. **Move image encoding off the main thread** for uploads — a Web Worker with
   `OffscreenCanvas`, or `createImageBitmap` + worker encode.

Steps 1 and 2 together take the feed from **106 requests to roughly 30**, with
no change to what the user sees.

Both were approved by the owner on 2026-08-01; the image decision (step 4) was
deliberately deferred until the request work is measured.

---

## 5b. RESULT — measured on production after PR #33 (2026-08-01)

Same page, same browser, same method. Build `2026-08-01-12`.

| | Before | After |
|---|---|---|
| **Supabase API calls per feed load** | **106** | **46** |
| `profiles_public_data` | 31 calls · 14.0 s | **7 calls · 1.6 s** |
| `site_settings` | 23 calls · 10.0 s | **7 calls · 1.7 s** |
| `user_badges` | 13 calls · 6.0 s | **2 calls · 0.45 s** |
| `get_public_roles_for_users` | 13 calls · 5.6 s | dropped out of the top 8 |
| `app_has_role` | 5 calls · 1.2 s | **0** |

Cumulative request time across those top offenders: **35.6 s → ~3.8 s, a ~90%
reduction in the load the browser and database are asked to carry.**

Two bugs were found while writing the tests for this and fixed in the same PR:

- A failed profile batch used to cache blank placeholders for the full 5-minute
  TTL, so one transient error blanked a name and avatar with no retry. A query
  ERROR is now distinguished from "no such row": errors are not cached at all,
  genuinely-missing rows are cached for 30 s only.
- The realtime badge/role subscription invalidated `profileMap([oneId])` — an
  ID-set key of exactly one user, which nothing in the app ever uses — so badge
  and role changes silently never invalidated anything.

### Step 4 done — images through Cloudflare Transformations (PR #34, live)

Transformations was **Disabled** on the zone; enabled for `50mmretina.com` only.
`PostMedia` now emits `/cdn-cgi/image/…` for `cdn.50mmretina.com` sources.
Measured on the live feed, five real photos:

| Original | Served |
|---|---|
| 832 KB | 181 KB |
| 204 KB | 50 KB |
| 276 KB | 27 KB |
| 912 KB | 607 KB |
| 1,226 KB | 48 KB |
| **3,450 KB** | **913 KB — 74% less** |

Fetched with an AVIF-accepting header the same set is **383 KB (89% less)**; the
74% figure is what a normal browser session actually pulled, including one photo
that compresses badly. Served width is 600 px instead of 2,560 px. Every photo
ever posted got lighter with no re-upload.

**A bug shipped and was hotfixed within minutes — worth keeping.** The first
version built the option string with literal commas
(`width=800,quality=70,format=auto`). `srcset` is a COMMA-SEPARATED list, so the
browser could not parse the attribute at all: `currentSrc` came back empty and
**no photo loaded** — cards showed only their blurred backdrop. Cloudflare
accepts `%2C` just as happily, and that is what ships. Pinned by a test that
asserts no transformed URL contains a raw comma.

Diagnosing it was slowed by §12.14 again: in a background tab, lazy-loading is
suspended, so `complete: false` on a visible image proves nothing. A `computer`
screenshot to activate the tab is what made the recovery observable.

Steps 3 and 5 (comments in one RPC, off-main-thread encoding) are still open.

---

## 6. What was NOT the cause — don't chase these

- **The network.** 206 ms median round-trip, consistently, five samples.
- **Database query cost.** Individual queries are fast; they degrade only under
  the self-inflicted concurrency.
- **The feed RPC.** `get_broadcast_feed` is one call and is not in the top six.
- **Reaction mutations.** Already optimistic, no invalidation, no refetch.
