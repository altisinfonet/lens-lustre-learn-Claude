# STAGES runner — status

Updated: 2026-10-29 19:50 UTC · runner branch `status/stages-runner` · never merged.

## Done per stage

| Stage | % | State |
|---|---|---|
| S0 | 95 | Server half PASS, re-checked live today. Only the Owner's phone test ("Video OK") is left. |
| S2 Observability | 95 | Live: telemetry SQL, client telemetry, outside monitor + alert, Admin → Health page, and now native crash / OOM / ANR per build (code + SQL live). Left: the reader is inside the app only from the S9 build (its build-file change #562 waits on staging for the S9 bump); Owner reads the page. |
| S3 Media | 70 | Staging: 0100/0101/0102 applied; PROBE 0100 PASS (40936252035), PROBE 0101 PASS (40937039503), coverage 0 % (40936941432 — backfill not run). PROBE 0102 fixture fixed (#567, follow-up #571 in CI). Click-to-run backfill workflow #569 in CI. Next: carry S3 code + production SQL with both switches OFF. |
| S8 Live debt | 40 | Inventory blocked: SUPABASE_ACCESS_TOKEN not set (run 40941744672, Owner item). Sitemap root cause found (below). |
| S11 Reliability | 0 | Not started. |
| S10 remainder | 0 | Waits for PR #538 (supervisor). |
| S12 / S5 | — | Confirm only (switches stay OFF). |
| S9 Release | 0 | Last. |

## Units

| Stage | Unit | PR | Merged staging / main | SQL runs | Live check |
|---|---|---|---|---|---|
| S0 | Live video config answers the app | — | — | — | 2026-10-29 17:16 UTC: `/config/site-settings` 200 (video_conversion = "device"); OPTIONS `/config/site-settings` and `/api/video/play-token` with Origin `https://localhost` → 204 + ACAO `https://localhost`; POST play-token with no id → 400 VID-REQ-002 (correct refusal). PASS |
| S2 | Native crash / OOM / ANR per build (code + SQL 20261031_0100) | #552 → carry #561 | staging a1c82e0 · main b205854 | staging: PROBE FAIL 40929047458 (18:15) → apply 40932015585 (18:34) → PROBE PASS 40932223847 (18:35). production: PROBE FAIL 40934153573 (18:47) → apply 40935836835 (18:58) → PROBE PASS 40935949028 (18:59) | 18:48 UTC live bundle carries it; home + /feed 200 in Chromium, Firefox, WebKit, same text, 0 new console errors. PASS |
| S2 | Android build installs + proves the exit reader | #562 | staging 6ebf245 · main: rides the S9 version bump (a push of android-build.yml on main starts an app build) | — | — |

| S3 | PROBE 0102 builds its own rolled-back fixture | #567 (+ #571) | staging 26a1c0c | staging 40941214184 FAIL (constraint: ready media needs 'original') → #571 | — |
| S3 | Click-to-run backfill workflow | #569 | CI | — | — |

## Findings recorded

- **S8 sitemap #504 "0 vs 12":** not a defect. Staging's static sitemap is empty on purpose (staging tells crawlers to stay out, `scripts/generate-seo-assets.mjs`), and the dynamic route returns the static file when it is empty. Live static has 12 URLs on `50mmretina.com`; live upstream `functions/v1/sitemap` returns 729 URLs on the same host, so on main the dynamic route would serve 729. Carry needs a production-shaped proof, not a staging one.
- **Other open PR to main:** #305 (head = `staging` itself, never mergeable by rule) and #103 (Sept). Not treated as collisions.

## Gate reports

**S2 native crash / OOM / ANR** — claim: crash rate per app build now counts native crashes and out-of-memory kills, not only script errors · instrument: PROBE_20261031_0100 (7 fixture events → admin read) · before: "starts = 6 (want 2), crashes/oom/anr = null" on both lanes · after: PROBE PASS on both lanes (2 starts, 2 crashes, 1 OOM, 1 ANR, 150.00 per 100) · PASS · regressions: typecheck 0, vitest 4,632 passed, build 0, security 0 critical / 0 high, CI 33/33 · not verified: a real crash on a real phone (needs the S9 app build).

## Owner list (plain words, click-only)

1. **S0 phone test.** On your phone open the 50mm Retina app, open the feed, scroll to any video, let it play with sound. If it plays, reply "Video OK".
2. **S2 look (after the S9 app update is on your phone):** Admin → Health → "App health". You should see: feed p95 yesterday, upload failure %, the "Crash rate per build" table (with Crashes, OOM, ANR columns), and "Egress per 1,000 feed views". Reply "Health OK" or send a screenshot.
3. **S3 decision O-1:** old app versions (1.2.24/1.2.25) still show friends-only photos from their old public address. Do you want the app to force an update 2–3 weeks after the new version is in the Play Store, so those addresses can be closed? Reply "O-1 yes" or "O-1 no".
4. **S3 decision O-2:** a signed photo link for friends-only photos stays valid for 1 hour (someone you unfriend can still see an already-opened photo for up to 1 hour). Reply "O-2 keep 1 h" or name a shorter time.
5. **S3 backfill (one time, 2 minutes):** GitHub → repository Settings → Environments → **staging** → Add environment secret: name `MEDIA_WORKER_EMAIL`, value = the converter account's e-mail; again `MEDIA_WORKER_PASSWORD` = its password (the same two the video converter machine uses). Repeat on **production**. Then tell me "secrets added".
6. **S3 Cloudflare (staging first):** Cloudflare → Workers & Pages → the staging Pages project → Settings → Bindings → Add R2 bucket binding: name `PHOTOS`, bucket = the staging photo bucket → Save → redeploy. Same on the production project later (only when you want to switch photos on).
7. **S8 edge functions (one time):** Supabase → Account → Access Tokens → Generate new token (name "github-functions"). Then GitHub → Settings → Environments → **staging** → Add environment secret `SUPABASE_ACCESS_TOKEN` = that token; repeat on **production**. Tell me "token added".
