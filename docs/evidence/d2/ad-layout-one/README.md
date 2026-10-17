# Bugs 4 + 7 — one ad layout, "Sponsored" once, CTA only for https; the look-alike UI check (Owner list, 15 Oct 2026)

D2, branch `d2/ad-layout-one-20261015`, from `origin/staging` e41afb46, **stacked on #435**
(merge commit 5a29f48d) because bug 7's check also covers the comments box that #435 fixes.

## Bug 4 — cause
`src/components/ads/AdZone.tsx` (story card):
- the video ad's CTA bar title fell back to `"Sponsored"` (when no headline / alt / advertiser),
  under a header that already says "Sponsored" → twice;
- `cr.click_url` was used as-is: any non-empty text drew "Learn more ›" (video) or wrapped the
  picture in `<a href="Hideaway Resort and Hotel">` (a relative, broken link);
- pictures printed headline/CTA on the image (CreativeOverlay); videos used a bar under the media
  → two layouts. `src/pages/AdDetail.tsx` repeated the same fallback and raw link.
- the admin box "Website to open when clicked" accepted any text.

## Fix (client only, no SQL)
- `src/lib/ads/adLink.ts`: one rule — a link is a full `https://` address with a real host, else none.
  Existing bad rows simply show no CTA; nothing is rewritten.
- AdZone story card: header (the only "Sponsored") → media (picture or video) → the SAME caption
  bar for both (headline/subtext; CTA "… ›" only with a valid link; title falls back to the link's
  host, never "Sponsored"). Sidebar/lightbox picture frames keep the overlay, CTA only with a link.
- AdDetail and FullscreenAdShell use the same rule.
- Admin: `AdLinkInput` (creative library) refuses to save a non-https value and says why under the
  box; zone settings (AdminAdsV2) show the same message and block Save for an own-mode zone.

## Bug 7 — the UI check
`src/components/ads/__tests__/OneAdLayoutUiCheck.test.tsx` renders the REAL AdZone story card for
picture / video × valid https link / the Owner's plain text, and the REAL comments box for a post and
for each ad (opened via AdEngagementBar → CommentsOverlay); only the network is faked. It fails if
"Sponsored" appears more than once, an ad links anywhere but a valid https address or shows a CTA
without one, a picture and a video ad with the same link lay out differently, or an ad's comments box
differs from the post's (search row, emoji row, placeholder words). jsdom: structure and words, not pixels.

## Fail-first (`failfirst-vitest.txt`, on e41afb46)
UI check: **8 of 9 fail** (vid-text "Sponsored" 2×, pic-text opens "Hideaway Resort and Hotel",
picture ≠ video layout, all 4 ad comment boxes ≠ post box; vid-link passes). `adLink.test.ts`
fails to load (module absent). On this branch: 9/9 and 11/11 pass.

## Bundle (P13)
Entry, same env, built locally: 1,704,848 B (staging) → 1,706,485 B (#435) → **1,707,488 B** (this branch): **+1,003 B** for this PR's own changes, +2,640 B with #435; ceiling 1,754,112 B.

## Local
`npx tsc -b tsconfig.json` clean. Full `npx vitest run`: no failures beyond the pre-existing Windows-only set on e41afb46 (the `notificationPreferenceWiring` suite times out at 5 s here on both).
