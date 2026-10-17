# VID-1 part 2 · the feed video player (D2) · 2026-10-10

Unit: feed player — 9:16 card (R-105), muted autoplay while in view, pause out of view, 240p on a slow network.

## What shipped
- `functions/api/video/play-token.ts` — POST {video_id}, as the VIEWER (JWT or anon), reads `videos`/`video_versions` through RLS; ready + visible → a 15-min PREFIX token for `video/<owner>/<id>/v<n>/`; anything else → 404 (never 403). 503 until `VIDEO_DELIVERY_PRIVATE=1` (F-D3-18). New Pages env: `MEDIA_TOKEN_KEY` (base64 32 bytes, same value as the Worker), `MEDIA_CDN_HOST`.
- `src/lib/video/shared/playToken.ts` — the ONE token contract; the `media-authz` Worker's `video/` branch imports `verifyPlayToken` from it, so signer and verifier cannot drift.
- `src/lib/video/postVideoRead.ts` — one read per feed page on the existing Promise.all; a post linked to a video that is not visible+ready is DROPPED (never shown as a text post, VID-1 §4.4).
- `src/lib/video/playback.ts` + `src/components/video/FeedVideoCard.tsx` — rules and card. hls.js 1.7.3 (Apache-2.0, exact pin, both lockfiles) is a lazy chunk; Safari/iOS plays HLS natively.
- `scripts/web-bundle-budget.json` — named ceiling `hls.js` 611328 B (measured 592559 + 3 %, rounded up to a KiB). Entry 1679978/1700864 and initial 2214739/2250752 unchanged in kind; hls.js is not in index.html.

## Evidence (2026-10-10 UTC)
- 77 new tests (playToken 26, playback 23, FeedVideoCard 16, postVideoRead 12); full vitest 3171 passed / 0 failed; `tsc -b` 0.
- `mutants.txt`: 18/18 mutants killed (tab visibility, hysteresis, 240p cap, one-at-a-time, token prefix/exp/aud/lifetime/escape, non-ready token, 403-vs-404, delivery guard, non-ready post shown, crop, missing fill, 9:16, sound, early fetch).
- Staging-lane `npm run build` + `web-bundle-budget.mjs`: 258 checks, 0 failures; OFF-2 outbox guard PASS.
- Declared test-adjacent change: none weakened. PostCard keeps the `{imageUrls.length > 0 && (` anchor (video posts get `imageUrls = []`).

## Not proven here (needs the live system)
- Real playback needs the `media-authz` Worker `video/` branch + R2 + `VIDEO_DELIVERY_PRIVATE=1` (Owner/Auditor). No device measurement yet (real mid-range Android): waits for the Owner's phone.
- ui:gate not run locally (no browser harness here); CI runs it. The card is not yet in the uishot fixtures.

## CI correction (2026-10-10 ~03:25 UTC)
First push (77455fd): "Staging lane build" FAILED — `verify-bundle-isolation` R8: the production CDN host name appeared in a header comment of `functions/api/video/play-token.ts` (the guard scans `functions/` too). Fixed by removing the literal host from the comment (the host is a per-lane Pages env value, never written in the repo). Reproduced and re-run locally with the CI lane env: build 0, `verify-bundle-isolation` PASS (404 assets, 3 roots), bundle budget PASS (258 checks, 0 failures). I had run the budget but not the isolation guard before pushing.
