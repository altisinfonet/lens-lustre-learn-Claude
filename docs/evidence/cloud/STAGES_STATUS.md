# STAGES runner — status

Updated: 2026-10-29 23:05 UTC · runner branch `status/stages-runner` · never merged.

## Done per stage

| Stage | % | State |
|---|---|---|
| S0 | 95 | Server half PASS, re-checked live today. Only the Owner's phone test ("Video OK") is left. |
| S2 Observability | 95 | Live: telemetry SQL, client telemetry, outside monitor + alert, Admin → Health page, and now native crash / OOM / ANR per build (code + SQL live). Left: the reader is inside the app only from the S9 build (its build-file change #562 waits on staging for the S9 bump); Owner reads the page. |
| S3 Media | 85 | Code live on main (03004ff, 20:32 UTC) and SQL 0100/0101/0102 applied on staging and production, both switches OFF. All PROBEs PASS on both lanes. Left (Owner): backfill secrets (then 1-click backfill to 100 %), PHOTOS binding + Worker route, decisions O-1/O-2, then switch-on and the phone test. |
| S8 Live debt | 65 | DONE before: F-REV4-2 (prod), one SEO renderer (#508), F-D3-8 SQL 0201 (main #515, prod 40819037088). Today: sitemap root cause fixed (#577, #585 both on staging), carry #580 updated with #585 and in CI/review; F-AUD-8 rotation SQL on main (#581, nothing run); inventory tools on main (#582); PROBE for places the rotation misses (#586 on staging, carry #599). Old PRs: #323, #130 closed as superseded. Blocked on Owner: SUPABASE_ACCESS_TOKEN (function inventory/deploy, send-push), Vault entries for the rotation, converter password. F-REV4-6: finding text not in the repo (Owner/supervisor to paste it). |
| S11 Reliability | 40 | On staging: #589 stale-chunk recovery, #590 competition single encode, #591 upload size+type signed (edge deploy needs item 7). Reviewed, in CI: #592 profile/Tagged, #593 tap targets, #594 error messages, #595 qrcode lazy, #596 app-build guards, #597 upload type lists + GPS guard on support replies. Already fixed before today (re-verified): `npm ci` has no `npm install` fallback; the AAB web-bundle check is blocking. Left: deps, react-mentions, doc drift, judging items, drafts purge, carries; drills D1–D9 and M2 need the Supabase token (item 7). |
| S10 remainder | 0 | Waits for PR #538 (supervisor). |
| S12 / S5 | 50 | Switch-state PROBE on staging (#588), carry #600; runs on both lanes next. Switches stay OFF. |
| S9 Release | 0 | Last. |

## Units

| Stage | Unit | PR | Merged staging / main | SQL runs | Live check |
|---|---|---|---|---|---|
| S0 | Live video config answers the app | — | — | — | 2026-10-29 17:16 UTC: `/config/site-settings` 200 (video_conversion = "device"); OPTIONS `/config/site-settings` and `/api/video/play-token` with Origin `https://localhost` → 204 + ACAO `https://localhost`; POST play-token with no id → 400 VID-REQ-002 (correct refusal). PASS |
| S2 | Native crash / OOM / ANR per build (code + SQL 20261031_0100) | #552 → carry #561 | staging a1c82e0 · main b205854 | staging: PROBE FAIL 40929047458 (18:15) → apply 40932015585 (18:34) → PROBE PASS 40932223847 (18:35). production: PROBE FAIL 40934153573 (18:47) → apply 40935836835 (18:58) → PROBE PASS 40935949028 (18:59) | 18:48 UTC live bundle carries it; home + /feed 200 in Chromium, Firefox, WebKit, same text, 0 new console errors. PASS |
| S2 | Android build installs + proves the exit reader | #562 | staging 6ebf245 · main: rides the S9 version bump (a push of android-build.yml on main starts an app build) | — | — |

| S3 | PROBE 0102 builds its own rolled-back fixture | #567 (+ #571) | staging 26a1c0c | staging 40941214184 FAIL (constraint: ready media needs 'original') → #571 | — |
| S3 | Click-to-run backfill workflow | #569 | staging e1028f4 | — | — |
| S3 | PROBE 0102 setup writes without member claims | #573 | staging 9a0f9e1 | staging PROBE 0102 PASS 40946796937 (20:11) | — |
| S3 | **Carry S3 to main** (#496–#501, #567, #569, #571, #573) | #576 | main 03004ff | production: 0100 PROBE FAIL 40949645431 → apply 40951365749 → PASS 40951832115 · 0101 FAIL 40951913183 → apply 40951975386 → PASS 40952048358 · 0102 FAIL 40952139141 → apply 40952199347 → PASS 40952288920 · coverage 0 % of 507 (40952365255) | 20:32 UTC live; Chromium/Firefox/WebKit home + /feed 200, same text, 0 new console errors. Anonymous GET of a private photo path on the live CDN → 404 (fails closed). PASS |

| S8 | Sitemap: survives a slow generator | #577 | staging fbdb644 | — | carry #580 (with #585) |
| S8 | Sitemap: held ETag / Range no longer pin the thin file; nosniff + CSP | #585 | staging 77ee4e4 · carry #580 (cherry-pick 6282674) | — | after #580 |
| S8 | F-AUD-8 rotation SQL to main (files only) | #581 | main b891559 | not run (Owner Vault step first) | — |
| S8 | F-REV4-1 inventory tools to main | #582 | main cb21960 | PROBE runs: see below | — |
| S8 | PROBE: credentials the rotation does not scan | #586 → carry #599 | staging 1703ac4 | staging: running | — |
| S8 | Old open PRs | #323, #130 closed (superseded, comment left) | — | — | — |

| S11 | Stale-chunk recovery installed | #589 | staging 52878b6 | — | carry next |
| S11 | Competition photo encoded once (WebP proof) | #590 | staging 78bf997 | — | carry next |
| S11 | Photo presign signs size + type | #591 | staging a0dbdd5 | — | edge deploy needs SUPABASE_ACCESS_TOKEN (item 7) |
| S11 | Admin profile edit refresh; Tagged photos errors | #592 | review nothing blocking; CI (sweep test updated for the moved query) | — | — |
| S11 | Judge tap targets ≥ 44 px | #593 | review nothing blocking; CI | — | — |
| S11 | Plain member messages for 401/403/429/5xx/offline | #594 | review nothing blocking (3 rounds); CI | — | — |
| S11 | qrcode out of the entry chunk (−25 KB) | #595 | review nothing blocking; CI | — | — |
| S11 | App build: every template edit proven; synced app = this commit; stale root file removed | #596 | review nothing blocking; CI | — | goes to main with the S9 bump |
| S11 | One upload type list; support reply photos GPS-guarded; honest "couldn't check" copy | #597 | review nothing blocking (3 rounds); CI | — | — |
| S12/S5 | Switch-state PROBE (confirm OFF) | #588 → carry #600 | staging 584b305 | staging: running | `photo_upload_resume` has no row on live = OFF |

## Findings recorded

- **S11 re-verification (staging fbdb644):** still true — photo presign signs no size/type; competition photos encoded twice at full size; accepted-file lists disagree; no 401/403/429/5xx member messages; stale-chunk reload never installed; judge tap targets 20–40 px; admin profile edit invalidates the wrong key; Tagged photos hides errors; qrcode in the entry chunk; trackPosition / PlacementBoard not wired; 6 hard-coded AAB marker strings; unguarded sed in the app build; stale root android-build.yml; sharp / vite-plugin-pwa in dependencies; deprecated react-mentions; doc drift (queryKeys, realtimeCounts). Already fine: get_broadcast_feed ambiguity (fixed 2026-08-14), native gallery picker wired, refetch storm (staleTime 5 min). Drafts: marked at 7 days but never purged (no purge function in git).

- **F-AUD-8 before production:** the rotation scans Vault, cron.job, cron history and function bodies, not webhook trigger arguments, database settings or the pg_net queue (#586 counts these). Its cron-secret rollback only works if the Edge secret CRON_SECRET is also reverted; keep the time between the Owner's step 1 and the run short.
- **F-REV4-1 inventory:** the DB-caller PROBE does not see Vault-held cron URLs or webhook triggers — never use it alone to remove a function.

- **S8 sitemap #504 "0 vs 12":** not a defect. Staging's static sitemap is empty on purpose (staging tells crawlers to stay out, `scripts/generate-seo-assets.mjs`), and the dynamic route returns the static file when it is empty. Live static has 12 URLs on `50mmretina.com`; live upstream `functions/v1/sitemap` returns 729 URLs on the same host, so on main the dynamic route would serve 729. Carry needs a production-shaped proof, not a staging one.
- **S11 support attachments (#597):** reply attachments on Help & Support and Admin → Support were uploaded with no location (GPS) check, and their picker hid PNG screenshots. Fixed on staging after merge; the app's main photo paths were already guarded.
- **S11 app build (#596):** Capacitor 8.5.0's template already ships AGP 8.13.0 / Gradle 8.14.3; the build pins them down to 8.12.3 / 8.13 (the set that built 1028 onward). Recorded, not changed.
- **Other open PR to main:** #305 (head = `staging` itself, never mergeable by rule) and #103 (Sept). Not treated as collisions.

## Gate reports

**S2 native crash / OOM / ANR** — claim: crash rate per app build now counts native crashes and out-of-memory kills, not only script errors · instrument: PROBE_20261031_0100 (7 fixture events → admin read) · before: "starts = 6 (want 2), crashes/oom/anr = null" on both lanes · after: PROBE PASS on both lanes (2 starts, 2 crashes, 1 OOM, 1 ANR, 150.00 per 100) · PASS · regressions: typecheck 0, vitest 4,632 passed, build 0, security 0 critical / 0 high, CI 33/33 · not verified: a real crash on a real phone (needs the S9 app build).

**S3 carry** — claim: S3 code + SQL live with switches OFF, nothing members see changed · instrument: PROBEs 0100/0101/0102 + 3-browser live check · before: PROBEs FAIL on production (objects missing) · after: PASS on both lanes; live pages unchanged · PASS · regressions: typecheck 0, vitest 4,705 passed, build 0, security 0/0, CI 34/34 · not verified: the phone part of the S3 gate (≤ 1440 px, 0 originals, ≥ 70 % fewer bytes) needs backfill + switch-on (Owner).

## Owner list (plain words, click-only)

1. **S0 phone test.** On your phone open the 50mm Retina app, open the feed, scroll to any video, let it play with sound. If it plays, reply "Video OK".
2. **S2 look (after the S9 app update is on your phone):** Admin → Health → "App health". You should see: feed p95 yesterday, upload failure %, the "Crash rate per build" table (with Crashes, OOM, ANR columns), and "Egress per 1,000 feed views". Reply "Health OK" or send a screenshot.
3. **S3 decision O-1:** old app versions (1.2.24/1.2.25) still show friends-only photos from their old public address. Do you want the app to force an update 2–3 weeks after the new version is in the Play Store, so those addresses can be closed? Reply "O-1 yes" or "O-1 no".
4. **S3 decision O-2:** a signed photo link for friends-only photos stays valid for 1 hour (someone you unfriend can still see an already-opened photo for up to 1 hour). Reply "O-2 keep 1 h" or name a shorter time.
5. **S3 backfill (one time, 2 minutes):** GitHub → repository Settings → Environments → **staging** → Add environment secret: name `MEDIA_WORKER_EMAIL`, value = the converter account's e-mail; again `MEDIA_WORKER_PASSWORD` = its password (the same two the video converter machine uses). Repeat on **production**. Then tell me "secrets added".
6. **S3 Cloudflare (staging first):** Cloudflare → Workers & Pages → the staging Pages project → Settings → Bindings → Add R2 bucket binding: name `PHOTOS`, bucket = the staging photo bucket → Save → redeploy. Same on the production project later (only when you want to switch photos on).
7. **S8 edge functions (one time):** Supabase → Account → Access Tokens → Generate new token (name "github-functions"). Then GitHub → Settings → Environments → **staging** → Add environment secret `SUPABASE_ACCESS_TOKEN` = that token; repeat on **production**. Tell me "token added".
8. **S8 credential rotation (after item 7):** follow `docs/evidence/d1/F-AUD-8/README.md` steps 1–2 (Supabase → Edge Functions → Secrets → new `CRON_SECRET`; Vault → add `faud8_new:cron_secret`), then tell me "vault ready" — I run the rotation within minutes.
9. **S8 converter password:** Supabase → Authentication → Users → the converter account → Reset password; put the new one in the converter machine's credentials file and in GitHub secret `MEDIA_WORKER_PASSWORD` (item 5).
10. **S8 F-REV4-6 (award stamps / judge badge):** the finding text is in your claude.ai Project, not in the repository. Paste it to me (or say "skip").
11. **GitHub (security, 1 minute):** Settings → Environments → **production** → Deployment branches → "Selected branches" → add `main` only. Same for **staging** with `staging`.

