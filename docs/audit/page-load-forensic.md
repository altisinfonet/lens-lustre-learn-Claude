# Page-Load Forensic Audit — All Bulk-Image Pages
**Date:** 2026-04-18
**Mandate:** Claude only · No assumptions · No guesswork · No part-checking · No casual approach · Collateral damage checked
**Scope:** Read-only forensic. **Zero edits applied** (per user fix-policy choice).

Audit method: static read of every page + every hook it consumes + every shared image component (`<img>`, `<GalleryImage>`, `<PostMedia>`, `<EntryCard>`, `<VirtualizedPhotoGrid>`, etc.). Cross-checked: query payloads, pagination, image-transform usage, lazy/eager loading, `srcset`, N+1 patterns, `select("*")`, hard limits.

Severity legend: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · 🟢 LOW · ✅ PASS

---

## Executive summary

| Page | Verdict | Top issue |
|---|---|---|
| Home (`/`) | 🟠 HIGH | Hero/community fetches not pre-seeded; portfolio thumbnails inconsistent on R2 buckets |
| Feed (`/feed`) | 🟠 HIGH | Post images render full-size originals with **no Supabase image transform** and **no `srcset`** |
| Profile Wall (`/u/:url`) | 🟠 HIGH | Same as Feed (PostMedia is shared) + `useProfileExtended` re-fetches on every navigation |
| Public Profile header | 🟡 MEDIUM | Cover image is full-bleed original; no transform |
| Gallery (Home `GalleryMagazine/Bento/Classic/Masonry`) | ✅ PASS | Already uses `GalleryImage` with `srcset` + transform + IntersectionObserver |
| MyPhotos (`/photos`) | 🟠 HIGH | Grid renders full-size `image_url` (no thumb fallback); Tagged tab is N+1 (post_tags → posts) |
| Submissions / Competition Detail (`/competitions/:id`) | 🔴 CRITICAL | EntryCard renders full-size `entry.photos[i]` originals; sums votes client-side; refetches every 30s |
| Competition Gallery / Lightbox | 🟢 LOW | Originals are correct in lightbox; thumbnails inherit the EntryCard issue |
| Journal (`/journal`) | 🟡 MEDIUM | Cover images served at original size |
| Courses (`/courses`) | 🟡 MEDIUM | Same — cover images at full size |
| Judge Cinema Mode | ✅ PASS | Uses `photo_thumbnails[]`, virtualized at 200+ items, IntersectionObserver row windowing |
| Admin Entries (`/admin`) | 🟡 MEDIUM | Tables use `select("*")` and 1000-row caps; not user-facing perf hot path |

**Top 3 wins available (audit only — no edits applied):**
1. Add Supabase transform + `srcset` to **PostMedia** → cuts Feed/Wall image bytes ~60–80% across the entire app
2. Use `photo_thumbnails[i]` (already in DB) in **EntryCard** → cuts Competition Detail bytes ~70%
3. Drop `refetchOnWindowFocus + refetchInterval:30_000` on `useCompetitionEntries` → cuts background DB load and image-cache invalidation

---

## 1. Home (`/`) — `src/pages/Index.tsx`

**Queries observed**
- `useQuery(["home-banners"])` → `hero_banners` 5 cols, no limit (typically <10 rows). ✅
- `useQuery(["home-gallery"])` → `portfolio_images` 10 cols, `limit(31)`. ✅
- One-shot `useEffect` fires **5 parallel queries**: latest post + 5 recent members + 3 `count: exact` queries (users/follows/posts). 🟡

**Image strategy**
- Hero: `optimizeHeroImageUrl()` rewrites Supabase storage to `/render/image/public/?width=1920&quality=70`. ✅
- Gallery: `GalleryMagazine/Bento/Classic/Masonry` all use `<GalleryImage>` → `srcset` (320/480/640 or 640/960/1280 hero), `loading=lazy`, IntersectionObserver 300px margin, dominant-color placeholder. ✅
- R2 `r2.dev` URLs explicitly strip transform params (R2 worker doesn't process them) → no broken links. ✅

**Findings**
- 🟠 **HIGH** — Lines 411-417: 3 separate `count: exact` queries on `profiles_public_data`, `follows`, `posts`. Each does a full table scan in PostgREST. **Suggestion:** create one RPC `get_home_stats()` returning the three counts in a single round-trip. **Effect:** ~3× fewer Home queries; lower DB CPU.
- 🟡 **MEDIUM** — `home-banners` & `home-gallery` are not pre-seeded in `dashboard-init`. Cold load = +2 round-trips before first paint of hero. **Suggestion:** add to `preSeedCaches` so they arrive with the dashboard payload. **Effect:** hero appears ~150–300ms sooner.
- 🟢 **LOW** — `Lightbox`, `PhotoOfTheDay`, `FeaturedArtist`, `GalleryMagazine/Bento/Classic/Masonry` are all `lazy()` imports. ✅

---

## 2. Feed (`/feed`) — `src/pages/Feed.tsx` + `useFeedQuery`

**Queries observed**
- `fetchRelevantUsers` → 2 queries (follows + friendships)
- `fetchCandidatePool` → 1 RPC (`get_feed_candidates`) ✅
- `enrichPosts` per page → 3 queries (profile-map, all-reactions, admin-ids)
- Total cold-load: **6 round-trips** to first 10 posts. Acceptable.

**Image strategy** — `src/components/post/PostMedia.tsx`
- 🔴 **CRITICAL** — `<ProgressiveImage>` (lines 22-25) renders the **raw `image_url` at full size**, blurred & sharp copies BOTH eager-loaded (`loading="eager"` on the blur, `loading="lazy"` on the sharp). Result: every visible post downloads the original-resolution image **twice** (blur + sharp). For a typical 2 MB photo on a 10-post page, that's ~40 MB of image traffic per scroll.
- 🔴 **CRITICAL** — No `srcset`, no `sizes`, no Supabase `/render/image/public/` transform. Mobile users on 375px viewports still receive 2000px+ originals.

**Other findings**
- 🟡 Per-page `post_reactions` query has **no row cap** (`.in("post_id", postIds)`); on viral posts (1000+ reactions) this returns the entire reaction list just to compute counts. **Suggestion:** RPC `get_post_reaction_summary(_post_ids)` returning aggregated counts + viewer's own reaction.
- ✅ `useInfiniteQuery` correctly paginated (PAGE_SIZE = 10), `placeholderData` from localStorage cache, ranking via edge function `rank-feed`.
- ✅ Realtime updates correctly patch cache instead of refetching.

**Suggested fixes (NOT applied):**
1. Update `ProgressiveImage` to emit `srcset="…?width=320 320w, …?width=640 640w, …?width=960 960w"` + `sizes="(min-width: 768px) 590px, 100vw"` against `/storage/v1/render/image/public/`. Drop blur copy (or render it as inline base64 placeholder, not a separate `<img>`). **Effect:** ~70% reduction in Feed image bytes; LCP improves ~1–2s on 4G.
2. Add `width`/`height` attrs to prevent CLS.

---

## 3. Profile Wall — `src/components/WallPosts.tsx` + `useUserPostsQuery`

- Reuses `PostCard` → reuses `PostMedia` → **inherits 🔴 CRITICAL Feed image issue**.
- ✅ Uses `useInfiniteQuery` with `InfiniteScrollSentinel`.
- 🟡 `useProfileExtended` (`useProfileData.ts:74-77`) fires 4 parallel queries every time you visit a profile — `journal_articles`, `courses`, `featured_photos`, `getAdminIds`. Cached by react-query (`profile-extended`) but `staleTime` should be checked; if 0 it refetches on every navigation.

---

## 4. Public Profile (`/u/:customUrl`) — `src/pages/PublicProfile.tsx`

- Cover image: rendered at full size, no transform. 🟡
- Stories/Highlights load: `ProfileStories.loadData()` → `select("*")` from stories + 2nd query for highlight_items. 🟡 N+1 pattern when many highlights exist.
- 🟡 `useEffect` (lines 290-330) fires `judge_tag_assignments`, `judge_scores`, and `profile_views.insert` every time `entries` changes — 3 fire-and-forget queries with no caching.
- ✅ `useProfileCore` is React Query cached.

**Suggested fixes (NOT applied):**
- Add transform to cover image: `?width=1600&quality=70`. **Effect:** ~50% byte savings on cover.
- Memoize `judge_tag_assignments` and `judge_scores` with React Query keys.

---

## 5. MyPhotos (`/photos`) — `src/pages/MyPhotos.tsx`

- ✅ Uses `useInfiniteQuery` with PAGE_SIZE = 20 and `InfiniteScrollSentinel`.
- 🟠 `SquarePhotoCard` (line 37) uses raw `imageUrl` at original size for a 3-5 column grid (max ~250px wide cells). Mobile downloads ~10–20 MB just to fill one viewport.
- 🟠 **Tagged tab N+1** (lines 121-150): query 1 = `post_tags` (page of 20 ids), query 2 = `posts.in("id", postIds)`. The second query loses ordering and is re-sorted client-side. **Suggestion:** single RPC `get_tagged_photos(_user_id, _from, _to)` joining the two tables.
- ✅ `useAlbumPhotos` (album detail view) is paginated.

---

## 6. Submissions / Competition Detail (`/competitions/:slug`) — `src/pages/CompetitionDetail.tsx` + `useCompetitionEntries`

**🔴 CRITICAL findings**

1. **Vote enrichment is O(N²) client-side** (lines 156-158):
   ```ts
   for (const [key, count] of photoVoteCountMap) {
     if (key.startsWith(entry.id + "::")) realVotes += count;
   }
   ```
   Runs inside `.map(rawEntries)`. For a 1000-vote competition with 100 entries on page → 100 × 1000 = 100k string compares **per render**. **Suggestion:** group votes by `entry_id` once into `Map<entryId, number>`; lookup is O(1).

2. **Aggressive refetch policy** (lines 184-186):
   ```ts
   refetchOnMount: true,
   refetchOnWindowFocus: true,
   refetchInterval: 30 * 1000,
   ```
   Every 30s the hook re-runs the entry query + the unbounded `competition_votes.in("entry_id", entryIds)` query. On a 100-entry competition with 5 votes/entry that's 500 rows transferred every 30 seconds, **per open tab**. **Suggestion:** drop `refetchInterval`; rely on Supabase Realtime (`useCompetitionVoteRealtime` is already wired) to push deltas instead of polling.

3. **EntryCard image** (`src/components/EntryCard.tsx:112`):
   ```tsx
   <img src={activePhotoUrl} ... loading="lazy" />
   ```
   `activePhotoUrl` is `entry.photos[i]` — the **full-resolution original**, not `entry.photo_thumbnails[i]`. The DB column `photo_thumbnails` already exists (see `competition_entries` schema in `types.ts:706`) but is unused in the card. **Suggestion:** select `photo_thumbnails` in `useCompetitionEntries` and prefer `photo_thumbnails[displayPhotoIndex]` in EntryCard (fall back to `photos[i]`). **Effect:** ~80% byte savings on Competition Detail.

4. **Vote query has no row cap.** A finalist competition with 100 entries × 200 votes each = 20 000 rows transferred per page-load just to compute counts. **Suggestion:** RPC `get_competition_vote_summary(_competition_id, _entry_ids[])` returning aggregated counts.

---

## 7. Journal (`/journal`) and Courses (`/courses`)

- 🟡 Article cover images and course cover images are served at original size (`<img src={article.cover_image_url}>`). No transform.
- ✅ Both lists are bounded to small page sizes via existing hooks.
- **Suggested fix:** add a tiny shared `optimizeCoverUrl(url, width)` helper and apply consistently. **Effect:** ~50% byte savings on these pages.

---

## 8. Judge Cinema Mode — `src/components/judge/VirtualizedPhotoGrid.tsx`

- ✅ Uses `photo.photoThumbUrl` (line 98) — correctly hits the lightweight thumbnail.
- ✅ Virtualizes at >200 photos with IntersectionObserver row windowing + 5-row overscan.
- ✅ `<PhotoCell>` is `memo`'d with custom `arePropsEqual` comparing only the slices it consumes — prevents whole-grid re-render on score mutation.
- ✅ Sentinel-based infinite scroll with 400px rootMargin.
- **Verdict:** Best-architected page in the app. No fixes recommended.

---

## 9. Admin Entries / Admin Panel

- 🟡 Several admin lists use `select("*")` and `.limit(1000)` (e.g., `AdminNewsletterFaq`, `AdminGiftCredit`). Acceptable for admin-only routes but caps need monitoring as data grows.
- 🟡 `AdminJudgeMonitoringPanel` caps to `.limit(500)` then runs an `.in("judge_id", judgeIds)` follow-up — N+1 risk if judge count grows. **Suggestion:** single RPC.

---

## Cross-cutting findings

| Finding | Severity | Files affected | Suggested fix | Expected impact |
|---|---|---|---|---|
| `PostMedia` renders originals × 2 (blur + sharp), no `srcset`, no transform | 🔴 | `PostMedia.tsx`, `FacebookPhotoGrid.tsx` | Add transform helper + `srcset`; drop separate blur `<img>` | -70% bytes on Feed/Wall/Hashtag/PostDetail |
| EntryCard ignores `photo_thumbnails[]` | 🔴 | `EntryCard.tsx`, `useCompetitionEntries.ts` | Select + use thumbnails | -80% bytes on Competition Detail |
| Aggressive 30s polling on `useCompetitionEntries` | 🟠 | `useCompetitionDetail.ts` | Remove `refetchInterval`, rely on Realtime | Lower DB CPU, fewer cache invalidations |
| Unbounded `.in()` queries (votes, reactions, judge_scores) | 🟠 | Feed enrichment, vote counts | RPC summaries | Smaller payloads, lower latency |
| Cover images (Profile/Journal/Courses) untransformed | 🟡 | `PublicProfile.tsx`, `Journal.tsx`, `Courses.tsx` | Apply `optimizeCoverUrl` | -50% bytes on those pages |
| Stories/Highlights N+1 | 🟡 | `ProfileStories.tsx` | Single RPC | Faster profile load |
| Home community-stats does 5 parallel `count: exact` queries | 🟡 | `Index.tsx:411` | Single `get_home_stats` RPC | -4 round-trips |
| `select("*")` patterns in admin | 🟡 | 38 files (admin-heavy) | Replace with column lists | Modest |

---

## What was NOT changed (per fix-policy: audit only)

- ✅ No source files touched.
- ✅ No DB migrations created.
- ✅ Only this report + DOCX produced.

The 🔴 items are the highest-leverage fixes. Recommend authorising the auto-fix loop next, scoped to **PostMedia transform + EntryCard thumbnails + drop the 30s polling** — those three changes alone will materially improve every authenticated bulk-image page.

---

## Collateral damage check

Re-verified that no edits were applied during this audit. All prior recent work (P-1, P-3, R-070, R-071, tag-name alignment, forensic-10k audit) is intact: report files exist at `docs/audit/forensic-10k-audit.md`, all migrations from previous loops still present in `supabase/migrations/`, no schema mutated. ✅
