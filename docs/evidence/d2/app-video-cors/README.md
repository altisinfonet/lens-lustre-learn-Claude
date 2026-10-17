# App video CORS — evidence (D2, 2026-10-17)

Live bug: Android app 1.2.22 (versionCode 1125) shows "This video can't play right now" on every video post; uploads cannot start.

Cause: the client asked our Pages Functions with RELATIVE URLs (`fetch("/api/video/play-token")`, `d.api("/api/video/upload-urls")`, `fetch("/config/site-settings")`). Inside the app the page origin is `https://localhost` (capacitor.config.ts `androidScheme: "https"`), so those went to the phone. The Functions also had no CORS: live `OPTIONS https://www.50mmretina.com/api/video/play-token` with `Origin: https://localhost` → 405.

## Files

| File | What it shows |
|---|---|
| `journey-before-7f3dcf89.json` / `.png` | Journey on unfixed staging 7f3dcf89: the page asks `https://localhost/api/video/play-token` and `/config/site-settings`; the card says "This video can't play right now". **FAIL** — the live bug, reproduced. |
| `journey-client-fix-only.json` / `.png` | New client and OLD Functions: requests reach the site, `OPTIONS /api/video/play-token` → **405**, no ACAO, so the browser blocks it. **FAIL**. This shows both halves are needed. |
| `journey-fixed.json` / `.png` | This PR: OPTIONS 204 + POST 200 with `ACAO: https://localhost`, the player asked the CDN for the granted master playlist with no tap, site-settings read from the site edge. **PASS** |
| `unit-fail-first-7f3dcf89.txt` | The three new test files run on 7f3dcf89: **57 failed / 25 passed (82)**. On this PR: 82/82 pass. |

## How the journey works (`tools/uishot/app-video-cors-journey.mjs`)

- It builds `tools/uishot/app-video-cors/appvideoharness.html` with `vite build` for the staging lane. The page holds the real `FeedVideoCard` and the real `siteSettingsCache` read, and the Capacitor bridge is present.
- It serves that bundle at `https://localhost`. The API is `https://staging.50mmretina.com`, which runs the REAL `functions/api/video/play-token.ts` and `functions/config/site-settings.ts`, loaded through Vite. Supabase is faked only where the Functions call it.
- One local HTTPS server answers all of these hosts, reached through Chromium's `--host-resolver-rules`. There is **no `page.route()`**: Playwright answers CORS preflights itself whenever interception is on, and that would hide the very check being made. The browser makes the real preflight.
- Run it with `node tools/uishot/app-video-cors-journey.mjs --json <file>`. It needs `openssl`. Exit code = verdict.

The Chromium build used here plays HLS natively, so `<video>.currentSrc` is the granted master URL. The Android WebView uses hls.js (`blob:`). The check accepts either. Both paths start from the same `ensureSource()`, which is called by the in-view autoplay rule (no tap).

Not measured here: playback on a real phone. That needs a 1.2.23 build from this PR's merge.
