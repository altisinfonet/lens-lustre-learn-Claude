# Video + accessibility runner — status

Started 2026-10-30 01:47 UTC. Replaces the earlier supervisor session (no GitHub trace after 2026-10-29 14:19 UTC).
Last update: 2026-10-31 04:25 UTC.

THIRD RESTART 2026-10-31 ~03:55 UTC: previous run stopped silently after its 18:23 UTC heartbeat (S10a-4 never pushed; will be rebuilt fresh later). PAUSE cancelled by Owner RESUME. Order now, one PR at a time: 1 VID-6 cost alerts → 2 privacy text → 3 S7 gate table → 4 Android 1.2.33 → 5 S10a-3, S10a-4.

SECOND RESTART 2026-10-30 ~07:15 UTC: the run stopped silently again at ~05:15 UTC. New rule: ONE PR at a time (#619 → #538 → #539 → #540 → #541 → #542), heartbeat at least every 20 minutes. Checked GitHub 07:15 UTC: nobody pushed to or merged #538-#542 or #619 since 02:00 UTC; each is 21 commits behind staging.

RESTART 2026-10-30 ~05:05 UTC: the previous run stopped silently at ~02:00 UTC. A new run took over at 05:05 UTC. Checked GitHub: nobody else pushed to or merged #538-#542 or #619 since 02:00 UTC.

## Now
04:25 UTC — VID-6 #724 MERGED on staging (4baaad6c); SQL 0702 staging PASS. Carry PR #726 to main open (CI + review). Then production SQL 0702.

## Units
| Unit | PR | State | Merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| CI fix: app-origin check reads the routes staging serves (blocks #541) | #619 | MERGED 08:10 UTC (25/25 checks green; review nothing blocking) | staging 5f8c8d5e / main 7359701a (carry #675, 11:30 UTC, 24/24 green, review nothing blocking) | none | live run 41048271236: 6/6 pages 200, same text, no new console errors |
| S10a-1 P23 decision note | #538 | MERGED 08:48 UTC (22/22 checks green; review nothing blocking) | staging a0e8d849 / main bb2ac7a5 (carry #676, 11:47 UTC, 22/22 green, review nothing blocking) | none | live run 41050004521: 6/6 pages 200, same text, no new console errors |
| S10a-2 P23 CI checks A–E (red first) | #699 | MERGED 15:07 UTC (26/26 green incl. the new P23 check; RED-FIRST run 41073429903; review BLOCKING → fail-first 305a1c70 → fix → re-review nothing blocking) | staging fd2077f9 / main d682ae66 (carry #701, 15:24 UTC, 25/25 green incl. P23 check on main, review nothing blocking) | none | live run 41080648000 (main d682ae66): 6/6 pages 200, same text, no new console errors |
| S10a-4 P23 scripted keyboard + screen-reader walkthrough (Chromium + WebKit) | — | NOT STARTED (earlier local build lost; restart after S7) | — | none | — |
| S7-f converter runs the purge hourly (own refreshing sign-in) | #695 | MERGED 14:37 UTC (24/24 green incl. converter aarch64 + x86_64; review nothing blocking) | staging 3919424b / main b6437294 (carry #697, 14:37 UTC, 24/24 green after re-running the flaky ads job; review nothing blocking) | none | — |
| S7 VID-6 video alarms (8 GB storage, 6-h music wait) | #724 | MERGED 04:19 UTC (31/31 green; review nothing blocking) | staging 4baaad6c / main: carry #726 open | 0702 STAGING: PROBE-before 41168073468 FAIL G1 (expected) · apply 41168141107 COMMIT 04:20 · PROBE-after 41168213981 **PASS** 04:22 UTC. Production: after carry | — |
| S7-a PROBE fix: admin read lane-proof | #673 | MERGED 11:08 UTC (33/33 green; review nothing blocking ×2) | staging 9b4e0201 / main 50a1ff9f (in #681) | — | — |
| S7-a purge-queue deleter | #539 | MERGED 09:10 UTC (36/36 checks green; re-review nothing blocking) | staging 75f78f67 / main 50a1ff9f (carry #681 with #673, 12:07 UTC, 35/35 green, review nothing blocking) | 0700 STAGING: PROBE-before 41040556611 FAIL G1 (expected) · apply 41040769034 SUCCESS 10:27 · PROBE-after 41042014241 ERROR (PROBE bug → #673) · PROBE-after 41045879133 **PASS** 11:10 UTC. Production: PROBE-before 41053131761 FAIL G1 (expected, 12:25) · apply 41055299050 COMMIT 12:31 · PROBE-after 41056104158 **PASS** 12:33 UTC | live run 41053135653 (main 50a1ff9f): 6/6 pages 200, same text, no new console errors | — |
| S7-e encoder harness fixtures | #540 | MERGED 09:45 UTC (25/25 checks green incl. encoder harness; review BLOCKING ×3 → fixed with fail-first test f6723b2b → re-review nothing blocking) | staging 9e943369 / main 628ddea9 (carry #685, 12:50 UTC, 24/24 green, review nothing blocking) | none | live run 41058422608: 6/6 pages 200, same text, no new console errors |
| S7-b VID-4 takedown | #541 | MERGED 10:06 UTC (36/36 checks green incl. vitest + app-origin journey, which were red before #619; review nothing blocking) | staging c36726ba / main 2b37be47 (carry #689, 13:15 UTC, 35/35 green, review nothing blocking) | 0701 STAGING: PROBE-before 41042307096 FAIL G1 (expected) · apply 41046205913 SUCCESS 11:11 · PROBE-after 41046275090 **PASS** 11:11 UTC. Production: PROBE-before 41061699789 FAIL G1 (expected, 13:22) · apply 41062722350 COMMIT 13:3x · PROBE-after 41064251129 **PASS** 13:33 UTC | live run 41061704420 (main 2b37be47): 6/6 pages 200, same text, no new console errors |
| S7-c VID-5 video ad | #542 | MERGED 10:24 UTC (25/25 checks green; earlier blocking fix verified; re-review nothing blocking) | staging d1e71689 / main fd903b69 (carry #691, 13:44 UTC, 24/24 green, review nothing blocking) | none | live run 41064479457 (main fd903b69): 6/6 pages 200, same text, no new console errors |

### Root causes found (#541's two red checks)
1. "Unit tests pass (vitest)": `src/lib/video/takedown.ts:32` called the route with a literal path instead of `SITE_API.videoTakedown`, and the route list in `src/lib/net/__tests__/siteApi.test.ts` was not updated (commit 1999911). Fixed in #541.
2. "App origin journey (https://localhost)": the over-the-wire step checked the PR's NEW route against staging BEFORE the merge; staging answers a route it never had exactly like a made-up one (405). `scripts/app-origin-check.mjs:22-24`. Fixed in #619 (checks the routes of the build staging serves).

## Live baseline (before my carries)
d2-live-check run 41046580661 on main 36c895d1 (11:16 UTC): home + /feed 200 in Chromium, Firefox, WebKit, same text both loads. Console errors already present: X-Frame-Options in <meta>; Cloudflare beacon blocked by CSP; 401 on profiles_public_data (home); Firefox __cf_bm cookie notice.

## Progress
- S7: purge worker, takedown, video ads, encoder phone tests, converter purge tick are LIVE (code on main, SQL 0700/0701 PASS both lanes). Short clips DROPPED by the Owner (out of scope). Open: VID-6 cost alarms (#724), privacy/store text, S7 gate table + rollout steps, Android 1.2.33. Estimate: ~70% of S7.
- P23: S10a-1 (decision note) live on main; S10a-2 (CI checks A–E over the ten surfaces, ratchet) merged on staging — clauses 1 and 2 of the gate have evidence. Left: S10a-3 (lower the counts: 87 axe nodes + 2 focus findings), S10a-4 (scripted keyboard + screen-reader walkthrough, Chromium + WebKit). About 50% of S10-a.

## For the S7b offline runner
(a line is added here after each S7 PR merges on staging)
- 09:10 UTC: S7-a purge-queue deleter (#539) merged on staging as 75f78f67. SQL 0700 not applied yet.
- 09:45 UTC: S7-e encoder harness fixtures (#540) merged on staging as 9e943369 (test-only).
- 10:06 UTC: S7-b takedown (#541) merged on staging as c36726ba. Copyright report switch stays OFF. SQL 0701 not applied yet.
- 10:24 UTC: S7-c video ad (#542) merged on staging as d1e71689. All five S7 PRs are now on staging.
- 11:12 UTC: SQL 0700 + 0701 applied on STAGING, both PROBEs PASS. Production after the carry to main.
- 12:33 UTC: SQL 0700 (purge worker) applied on PRODUCTION, PROBE PASS. S7-a is fully live.
- 13:34 UTC: SQL 0701 (takedown) applied on PRODUCTION, PROBE PASS. S7-b is fully live (copyright report switch OFF).
- 31 Oct 04:22 UTC: S7 VID-6 video alarms (#724) merged on staging as 4baaad6c; SQL 0702 PASS on staging (no app code).
- 13:44 UTC: S7-c video ad carried to main (fd903b69). Switch 'Video ads' stays OFF on live. ALL S7 code from this runner is on main; S7b-6 offline videos may build on it.

## Follow-ups (non-blocking review notes)
- #724: no hysteresis on the 8 GB line (could reopen every 15 min if storage hovers at it); file name 0702 sorts before 20261103_0300 (precondition refuses on a filename-order rebuild); G5 can false-FAIL if ops-monitor-tick commits during the PROBE (rerun).
- #540: Android fixture is Constrained Baseline (ultrafast overrides High); orientation checked on source size, not output pixels; fixture properties not ffprobe-asserted; iPhone file is MP4 bytes named .MOV.
- #538: 4 wording notes go into S10a-2.
- FLAKY TEST (ads area, not mine): src/components/ads/__tests__/OneAdLayoutUiCheck.test.tsx:138 waits for the ad card's picture with testing-library's default 1 s waitFor; on a loaded CI runner it timed out (carry #697 run 41071311990, 4 tests, each ~1000-1100 ms) while passing 3/3 locally and on main. Re-ran the failed job. Fix belongs to the ads bug runner (give that waitFor an explicit timeout).
- #542: backing out leaves a switched-off picture-only ad (manual delete); videoAd not cleared after handover; no component tests for the button / initialFile.
- #541: copyright reason gated in UI only (server check would make it strict); revoked-list KV key is per video (future re-upload must clear it); owner notice mentions a re-upload flow that doesn't exist yet; 0701 precondition doesn't check the dedup_key unique index.

## Owner list (plain steps, click-only)
1. Nothing to decide right now. Your 30 Oct decisions are in force: short clips DROPPED; video frame stays 9:16; cost alarm at 8 GB (being built, PR #724); converter worker 1.3.0 on both lanes (done by the local session).
2. Live video converter is set up and polling. When YOU decide the live site should convert videos on the server: Admin → Video Feature → Video Conversion → "server". Until then phones convert videos themselves ("device"). I will not change it.
3. Feature switches stay OFF on live. The step-by-step rollout list comes with step 3 of today's order (S7 gate table).
