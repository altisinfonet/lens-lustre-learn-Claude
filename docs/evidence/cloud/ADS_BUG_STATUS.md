ADS BUG FIXED

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
- Android bump: #568 → staging `ac4981c` (1.2.30 → 1.2.31; 1.2.30 = versionCode 1133, run 133, spent);
  carry #570 → **main `4a84a7e`** (main re-read right before: still 1.2.30). Both: CI green, independent
  reviews "nothing blocking". The push fired **Android Build run ID 40943931632** (run #134 → versionCode 1134).
  That main also carries the S7b runner's #563 (posts offline), #557 (photo worker, switch OFF) and #561.
- **Live check (2026-10-29 ~18:35–18:41 UTC, www.50mmretina.com, the deployed bundle, REAL production ad data):**
  Chromium 153, Firefox 153, WebKit 26.5 — `/` 200, `/feed` 200, the sponsored card shows the real library ad
  `1793264198326-0v8kgqyk809o.webp` WITH Like + Comment in all three; also PASS with the ad library made
  unreadable for 4 s (weak network): the card arrives with Like + Comment, never the bar-less picture.
  Method: Playwright; sign-in and the feed's post list faked inside the test browser only (no real account),
  every write answered locally (21–26 blocked, nothing reached production), reads forwarded with the public key.
  Console: no new errors from the ad code. Seen: X-Frame-Options-in-meta and Cloudflare beacon CSP (both
  present before this deploy), 401s from the public key on signed-in reads (test setup), a Dialog a11y warning
  (not in this diff), WebKit "access control checks" on the test's own faked feed replies (test setup).
- Android build run ID: 40943931632 — **attempt 1 FAILED** (20:12 UTC) in its unit-test gate: 4661/4661 tests
  passed but Vitest caught 1 unhandled error, `ReferenceError: sessionStorage is not defined` from
  `linkReferral` ← a `setTimeout` in `useAuth.tsx:405` firing after `signOutWipeWiring.test.tsx` tore down.
  Not caused by the version bump or the ads code; intermittent (the Unit tests job PASSED on the same commit,
  run 448). Root cause: AuthProvider's six deferred sign-in timers were never cleared on unmount.
  → re-ran the failed job once (allowed: same check passed on this exact commit): **attempt 2 SUCCEEDED**
    (20:33 UTC) — typecheck, full test suite, UI gate, security gate, release bundle (signed), debug APK.
    **Android Build run ID 40943931632 (attempt 2) = 1.2.31, versionCode 1134, main 4a84a7e.**
  → root-cause fix PR #578 (timers cleared on unmount; fail-first test; full vitest 4706 passed, 0 errors;
    independent review "nothing blocking"; CI 27/27 green) → **merged staging `1084573`** (2026-10-30);
    carry #636 (cherry-pick only, CI 26/26 green, reviewed) → **merged main `610467a`**.

## For the Owner (plain words)
**Like and comment are back on the sponsored card.** They vanished when the phone could not load the list of
ads for a moment (weak or no network): the app then showed the other picture saved in the Story Card zone
settings ("AUGUST GALLERY CONTEST 2026"), which has no likes or comments, and never tried again. Now the app
keeps trying and only ever shows the ad with its like and comment buttons. This is live on the website now
(checked in Chrome, Firefox and Safari's engine, also with a bad connection) and in Android app 1.2.31.

**With no network**, the ad you saw last is now kept on the phone and shown with its like and comment buttons.
Its picture also stays on the phone, but only once the "save photos on the phone" switch (app_image_sw) is
turned on — it is OFF, and switching it on is your decision. The missing posts with no network were fixed by
the offline work (S7b runner), which is also in 1.2.31.

Tip: the Story Card zone still has its own single picture (AUGUST GALLERY CONTEST 2026) in its settings. It is
no longer shown while you have pictures in the ad library; if you do not want it, you can clear it in
Admin → Advertisements.
