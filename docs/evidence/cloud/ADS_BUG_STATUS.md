ADS BUG — IN PROGRESS (Bug 1 not yet live)

# Ads bug runner — status

Updated: 2026-10-29 (UTC). Runner branch for Bug 1: `claude/ads-engagement-bar-fix-eskg4k`.

## Bug 1 — sponsored feed card lost its like + comment bar

**Root cause (found):**
- `src/lib/ads/adCreatives.ts` (`fetchAdCreatives`, catch at ~line 108 on staging/main 89f75cc / c027545) answered `[]` for ANY
  failed read (no network, weak-link timeout, any PostgREST error) and cached that `[]` for 60 s.
  `[]` means "this zone has no picture library".
- `src/components/ads/AdZone.tsx` read the library once on mount (lines ~176–204) and never asked again, so after a
  failed read the card used the zone's **single picture** (`ad_zones_v2` own.image_url), which has no ad_creatives row,
  so the like/comment bar (line 596, `zone === "story-card" && chosen && <AdEngagementBar …/>`) is not drawn.
- Production data (read 2026-10-29, public read-only): 1 active library picture (`df204c88…`, sort_order 1) AND the
  zone's own single picture `…/ads/1793264162768-…webp` ("AUGUST GALLERY CONTEST 2026"), uploaded 2026-10-29 08:56 UTC,
  36 s before the library picture. So since today a failed library read shows a real-looking ad with no bar.
- **No breaking code commit**: AdZone/adCreatives are unchanged between main 1.2.25-era and c0275456 (and staging = main
  for all ad code). The defect dates from the library's introduction (2026-08-01); it became visible on 2026-10-29 when
  the zone's single picture was filled in, on a phone that was being tested on poor / no network (#546, offline work).

**Fix (PR pending):** a failed library read is "unknown", never "empty"; AdZone reads through React Query (retry,
refetch on reconnect / return to app); the single picture is used only when the library is known to be empty.

**Fail-first:** `src/components/ads/__tests__/adLibraryReadFailure.test.tsx` — 2 of 5 fail on the old code
("the zone's single picture (no like / comment) was drawn after a failed read"; "expected [] to be null"), 5/5 pass after.
Browser check: nav harness journeys "sponsored card: …" (Chromium/Firefox/WebKit + https://localhost app origin).

## Bug 2 — no network

- **Posts missing offline:** cause = the persisted feed keeps its FIRST page only (`queryPersistence.ts` `trimForStorage`),
  and the feed query pauses offline. **Covered by S7b PR #548** (~200 posts saved, offline paging). Photos: **#547**.
  Not touched by this runner.
- **Ad missing offline:** ad flag/settings/library are not persisted; follow-up PR after Bug 1 (persist the ad-zone
  query via queryPersistence). The ad picture lives in the `journal-images` bucket, which the photo worker (even with
  #547) does not keep — to be coordinated with #547.

## PRs / merges / live / app build
- Bug 1 PR: pending
- Merged staging sha: —
- Carry to main: —
- Live check: —
- Android build run ID: —

## For the Owner (plain words)
The like and comment buttons disappeared when the phone could not load the ad list for a moment (weak or no network).
The app then showed the other ad picture saved in the "Story Card" zone settings, which has no likes or comments, and
never tried again. We are fixing it so the app keeps trying and only ever shows the ad with its like and comment buttons.
