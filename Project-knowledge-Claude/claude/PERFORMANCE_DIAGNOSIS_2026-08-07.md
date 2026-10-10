# PERFORMANCE — measured diagnosis + Instagram-grade plan. 2026-08-07.

The owner reported the app extremely slow: pages not opening, profile taking
~5 minutes, skeletons never resolving. Two handset screenshots showed a feed
with an empty body and a Journal list stuck on skeletons, at **0.53 KB/s**.

**This was diagnosed with three parallel expert (fable) audits against the real
code at `245d5e5`, grounded in live database measurements. Nothing here is
guessed.**

---

## VERDICT: it is NOT the deleted-account security change

Measured on production:
- Writes are landing fine — last comment 78 min ago, reactions and activity
  logs flowing at the time of measurement, ~11 h AFTER the policies were applied.
- Largest hot table is **652 rows**; every hot table is well-indexed.
- The RESTRICTIVE policies are `insert/update/delete` only — they **cannot**
  touch a SELECT, and every screenshot symptom is a read.

The policy is still worth fixing (null-uid refusal + ~3ms un-indexed
`auth.users` lookup per write) but it is housekeeping, not the cause.

## THE THREE REAL CAUSES

### 1. Images — the biggest. The feed loads FULL originals. (image audit)
`uploadImageWithThumbnail()` already creates a 600px `-thumb.webp` for every
post and stores it in `posts.thumbnail_urls`. **Nothing ever reads it** — only
writers reference the column. In `PostMedia.tsx` `ProgressiveImage`,
`isTransformable()` only matches Supabase URLs, so for `cdn.50mmretina.com`
(where post images actually live since R2) the "LQIP" layer becomes the full
2560px original AND it is `loading="eager"` — so every mounted feed card, even
off-screen, downloads its full original. A ~3-5 MB first screen that should be
a few hundred KB. **10× win, client-side URL derivation, no CDN transform, no
RPC change.** (Do NOT widen `get_broadcast_feed` — flagged in-repo as riskiest;
do NOT touch /cdn-cgi/ — it broke builds 1035-1051.)

### 2. Bundle — 6.1 MB before first paint. (load audit)
Entry chunk ~2 MB. Two eager imports dominate:
- `Navbar.tsx:16` `import * as LucideIcons from "lucide-react"` → **500 KB**,
  all ~1,500 icons, defeats tree-shaking. Used to render admin-config icons by
  name.
- `i18n/I18nContext.tsx:11-12` statically imports all 7 language dictionaries →
  **322 KB**.
Plus `src/index.css:1-3` three render-blocking Google-Fonts `@import`s — a live
network dependency at every cold boot of the bundled "offline" app, a plausible
blank-page/stall cause. Route splitting itself is already good (jspdf, recharts,
html2canvas all lazy).

### 3. Data orchestration — the 5-minute profile. (data audit)
- `useFriendFollow.ts` fires **5 sequential awaited requests with no cache**,
  and `PublicProfile` mounts it **twice** = 10 requests, two 5-deep chains,
  ~20 s at 2 s RTT. This is the "profile takes 5 minutes".
- React Query cache is **memory-only** with `gcTime: 10 min` — every app open
  and every 10-min idle is a cold load. No persistence except the feed's own
  localStorage snapshot.
- **No fetch timeout** anywhere — a hung request on a bad connection stays
  `pending` forever. This is the "skeletons never resolve".
- `refetchOnWindowFocus:false` + `staleTime:5min` are already set — "bug 3" is
  largely already fixed; do not chase it further.
- Do NOT touch `useFeedQuery`'s `staleTime:0`/`refetchOnMount:"always"` — owner
  spec, test-enforced.

## THE PLAN — staged, safe-first

**Phase 1 (biggest wins, low-risk, client-only):**
1. Feed/grids use the existing 600px `-thumb.webp` for CDN images; original only
   in the lightbox. `onError` → original for pre-thumbnail posts.
2. Stop the eager full-size backdrop; lazy/IO-gate off-screen cards.
3. Add a 15 s fetch timeout to the Supabase client + `networkMode:"offlineFirst"`
   — kills "skeletons never resolve".
4. Persist the React Query cache (localStorage) + `gcTime:24h`, build-version
   busted, cleared on sign-out — the "Instagram feel" of instant re-navigation.

**Phase 2 (bundle):** curated lucide icon map; per-language lazy i18n;
self-host the 3 fonts. Entry ~2 MB → ~1 MB, no boot-time font network.

**Phase 3 (profile chain):** rewrite `useFriendFollow` as one cached parallel
`useQuery`; `ProfileLink` hover-prefetch on `PostCard`; seed profile header from
the entity cache. ~20 s → ~2 s. The `get_profile_bundle` RPC consolidation is
the only RISKY item — do it last, behind verification.

**Housekeeping:** make `account_is_live()` null-safe
(`auth.uid() IS NULL OR account_is_live()`) and narrow the locked-table list to
member-content tables only.

Each step measured/tested before the next. No bulk blind changes.
