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

**Fix — PR #556 (merged to staging as `fc3ceea`, 2026-10-29 ~18:07 UTC):** a failed library read is "unknown", never "empty"; AdZone reads through React Query (retry,
refetch on reconnect / return to app); the single picture is used only when the library is known to be empty.

**Fail-first:** `src/components/ads/__tests__/adLibraryReadFailure.test.tsx` — 2 of 5 fail on the old code
("the zone's single picture (no like / comment) was drawn after a failed read"; "expected [] to be null"), 5/5 pass after.
Browser check: nav harness journeys "sponsored card: …" (Chromium/Firefox/WebKit + https://localhost app origin).

## Bug 2 — no network

- **Posts missing offline:** cause = the persisted feed keeps its FIRST page only (`queryPersistence.ts` `trimForStorage`),
  and the feed query pauses offline. **Covered by S7b PR #548** (~200 posts saved, offline paging). Photos: **#547**.
  Not touched by this runner.
- **Ad missing offline:** ad flag/settings/library were not persisted → PR #558. The ad picture lives in the `journal-images` bucket, which the photo worker (even with
  #547) does not keep — to be coordinated with #547.

## PRs / merges / live / app build
- Bug 1: PR #556 → staging, all CI green on d652e31 (incl. Back-returns-to-feed chromium/firefox/webkit with the
  new "sponsored card" journeys, and App origin journey https://localhost 13/13), independent diff-only review
  "nothing blocking" → **merged staging `fc3ceea`**.
- Bug 1 carry to main: PR #559 (cherry-pick of fc3ceea only onto main c027545; diff byte-identical to #556),
  26/26 checks green, independent diff-only review "nothing blocking" → **merged main `f09dbee`**
  (2026-10-29 ~18:31 UTC). Live bundle carries the fix (index-ChXD_VgF.js contains the new code) within ~2 min.
- Bug 2 (ads offline): #558 (ad data persisted; unreadable settings ≠ "ads off") → **staging `a02fda9`**;
  #560 (photo worker keeps journal-images/ads pictures; worker still behind `app_image_sw`, default OFF,
  not switched on) → **staging `07b72b8`**. Both: CI green, independent reviews "nothing blocking", fail-first.
- Bug 2 carry to main: PR #565 (cherry-picks of a02fda9 + 07b72b8 only) → 26/26 green, reviewed →
  **merged main `ffebce1`** (~19:12 UTC); live bundle index-BbC-6DOG.js + live sw-image-cache.js carry it;
  live re-check on the new build: Chromium/Firefox/WebKit × normal/weak network — 6/6 PASS.
- Posts missing offline: covered by the S7b runner (#547 → main #557; #548 → main carry #563 open). Not touched.
- Android bump: PR #568 → staging (1.2.30 → 1.2.31; 1.2.30 = versionCode 1133, run 133, spent).
- **Live check (2026-10-29 ~18:35–18:41 UTC, www.50mmretina.com, the deployed bundle, REAL production ad data):**
  Chromium 153, Firefox 153, WebKit 26.5 — `/` 200, `/feed` 200, the sponsored card shows the real library ad
  `1793264198326-0v8kgqyk809o.webp` WITH Like + Comment in all three; also PASS with the ad library made
  unreadable for 4 s (weak network): the card arrives with Like + Comment, never the bar-less picture.
  Method: Playwright; sign-in and the feed's post list faked inside the test browser only (no real account),
  every write answered locally (21–26 blocked, nothing reached production), reads forwarded with the public key.
  Console: no new errors from the ad code. Seen: X-Frame-Options-in-meta and Cloudflare beacon CSP (both
  present before this deploy), 401s from the public key on signed-in reads (test setup), a Dialog a11y warning
  (not in this diff), WebKit "access control checks" on the test's own faked feed replies (test setup).
- Android build run ID: —

## For the Owner (plain words)
The like and comment buttons disappeared when the phone could not load the ad list for a moment (weak or no network).
The app then showed the other ad picture saved in the "Story Card" zone settings, which has no likes or comments, and
never tried again. We are fixing it so the app keeps trying and only ever shows the ad with its like and comment buttons.
