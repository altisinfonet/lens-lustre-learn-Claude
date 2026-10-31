VIDEO + A11Y COMPLETE — S7 100% and P23 S10-a gate clauses met (Owner steps left: the Owner list below).

# Video + accessibility runner — status

Started 2026-10-30 01:47 UTC. Third restart 2026-10-31 ~03:55 UTC (Owner RESUME). Last update: 2026-10-31 14:52 UTC. Final live check: run 41209256390 on main ab2f29a1, success.

## Summary (31 Oct)
**S7 "Video complete" — 100% (Owner steps left).**
1. VID-6 cost alarms (#724 / #726, SQL 0702): an ALARM issue opens when a lane's video files reach 8 GB, and when a member waits over 6 h for the music check. PROBE FAIL→PASS on staging and production.
2. Privacy text (#727 / #730, SQL 0703): the live Privacy Policy page now has Videos / Music recognition / Video removal paragraphs; Play + Apple click-only steps written. PROBE FAIL→PASS both lanes.
3. S7 gate table (#732 / #733, docs/evidence/d2/S7/S7-GATE.md): every video PROBE re-run on staging AND production — 30/30 PASS.
4. Android 1.2.33 (#734 / #735): android-build.yml run **41178510127 SUCCESS**.

**P23 (S10-a) accessibility — gate clauses met with evidence.**
- Clause 1 (WCAG level): WCAG 2.2 AA (S10a-1, #538).
- Clause 2 (automated checks in CI): A–E ratchet (S10a-2, #699) + counts lowered in S10a-3 (#736 / #738 / #745): axe nodes on the ten surfaces **87 → 7**, focus findings **2 → 0**, each lowering shown RED first.
- Clause 3 (walkthrough), scripted half: S10a-4 (#751 / #763) — Tab order + screen-reader tree + findings, Chromium + WebKit, docs/evidence/d2/phase5/P23/WALKTHROUGH.md (44 walks, 0 unnamed controls). The hands-on half (TalkBack / NVDA / VoiceOver) is the Owner/D2 item named in the decision note.
- Left, needing decisions (not done on a guess): 4 nodes on the Notifications rows (Owner item 7), 3 contrast nodes on Admin → Health (a second red colour token), an intermittent focus loss on the phone-width feed's category chips (own fix unit).

## Units
| Unit | PR | State | Merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| CI fix: app-origin check reads the routes staging serves (blocks #541) | #619 | MERGED 08:10 UTC (25/25 checks green; review nothing blocking) | staging 5f8c8d5e / main 7359701a (carry #675, 11:30 UTC, 24/24 green, review nothing blocking) | none | live run 41048271236: 6/6 pages 200, same text, no new console errors |
| S10a-1 P23 decision note | #538 | MERGED 08:48 UTC (22/22 checks green; review nothing blocking) | staging a0e8d849 / main bb2ac7a5 (carry #676, 11:47 UTC, 22/22 green, review nothing blocking) | none | live run 41050004521: 6/6 pages 200, same text, no new console errors |
| S10a-2 P23 CI checks A–E (red first) | #699 | MERGED 15:07 UTC (26/26 green incl. the new P23 check; RED-FIRST run 41073429903; review BLOCKING → fail-first 305a1c70 → fix → re-review nothing blocking) | staging fd2077f9 / main d682ae66 (carry #701, 15:24 UTC, 25/25 green incl. P23 check on main, review nothing blocking) | none | live run 41080648000 (main d682ae66): 6/6 pages 200, same text, no new console errors |
| S7-f converter runs the purge hourly (own refreshing sign-in) | #695 | MERGED 14:37 UTC (24/24 green incl. converter aarch64 + x86_64; review nothing blocking) | staging 3919424b / main b6437294 (carry #697, 14:37 UTC, 24/24 green after re-running the flaky ads job; review nothing blocking) | none | — |
| S7 VID-6 video alarms (8 GB storage, 6-h music wait) | #724 | MERGED 04:19 UTC (31/31 green; review nothing blocking) | staging 4baaad6c / main 3847d8e4 (carry #726, 04:37 UTC, 31/31 green, review nothing blocking) | 0702 STAGING: PROBE-before 41168073468 FAIL G1 (expected) · apply 41168141107 COMMIT 04:20 · PROBE-after 41168213981 **PASS** 04:22 UTC. PRODUCTION: PROBE-before 41169320539 FAIL G1 (expected) · apply 41169419504 COMMIT 04:39 (78 MB stored, no alarm) · PROBE-after 41169465209 **PASS** 04:39 UTC | live run 41169503323 (main 3847d8e4): 6/6 pages 200, same text, no new console errors |
| S7 privacy policy + Play/Apple text | #727 | MERGED 05:02 UTC (31/31 green; review BLOCKING → fail-first PROBE check → fix af75e5da → re-review nothing blocking) | staging e30488c9 / main 2df93201 (carry #730, 05:19 UTC, 31/31 green, review nothing blocking) | 0703 STAGING: PROBE-before 41170946339 FAIL G1 (expected) · apply 41171040971 COMMIT 05:03 · PROBE-after 41171073798 **PASS** 05:05. PRODUCTION: PROBE-before 41172170215 FAIL (expected; no block, md5 9e2488be) · apply 41172262187 COMMIT 05:21 (md5 51a87720) · PROBE-after 41172309529 **PASS** 05:22 UTC | live run 41172366566: 6/6 pages 200, same text, no new console errors; /page/privacy-policy in Chromium shows the new paragraphs |
| S7 gate table + rollout steps (docs) | #732 | MERGED 06:09 UTC (23/23 green; review nothing blocking, 44 run IDs verified) | staging 9594c00e / main eca7e268 (carry #733, 06:23 UTC, 23/23 green, review nothing blocking) | 30/30 video PROBEs PASS (staging + production, 05:26–05:42 UTC) — table in docs/evidence/d2/S7/S7-GATE.md | — |
| Android 1.2.33 (carries S7) | #734 | MERGED 06:40 UTC (23/23 green; review nothing blocking) | staging 550a9171 / main 2f13f196 (carry #735, 06:55 UTC, 23/23 green, review nothing blocking) | none | android-build run **41178510127 SUCCESS** 07:15 UTC |
| P23 S10a-3 (A) sidebar / Discover avatar links (−56 axe nodes) | #736 | MERGED 07:49 UTC (26/26 green incl. P23 + UI gate; RED-first 41180210560; review nothing blocking; review note fixed with fail-first test 01241d71; re-review nothing blocking) | staging 7d339442 / main 6c996b1a (carry #737, 08:05 UTC, 25/25 green, review nothing blocking) | none | live run 41183379027: 6/6 pages 200, same text, no new console errors |
| P23 S10a-3 (B) progress value, icon buttons, selects (−13) | #738 | MERGED 09:49 UTC (26/26 green; RED-first 41183915257; review BLOCKING ×2 fixed with fail-first tests, then the row change withdrawn; final review nothing blocking) | staging 0dd783c8 / main ad430baa (carry #744, 10:03 UTC, 25/25 green, review nothing blocking) | none | live run 41191774877: pages 200 |
| P23 S10a-3 (C) underlined links in sentences, comment-box focus (−11, −2 focus) | #745 | MERGED 10:58 UTC (27/27 green; RED-first 41191775892; UI-gate root cause fixed 6e3008cf; reviews nothing blocking) | staging 8195639e / main 87f6a47c (carry #746, 11:14 UTC, 26/26 green, review nothing blocking) | none | live run 41196082671 (main 87f6a47c): pages 200 |
| P23 S10a-4 scripted keyboard + screen-reader walkthrough (Chromium + WebKit) | #751 | MERGED 13:45 UTC (24/24 green; self-test shown failing on a mutant; review BLOCKING ×2 (YAML-quoted names) fixed with fail-first self-test cases; final review nothing blocking) | staging 4f6da7a4 / main ab2f29a1 (carry #763, 14:14 UTC, 24/24 green, review nothing blocking) | none | WALKTHROUGH.md from CI run 41202252213: 44 walks, 0 unnamed controls |
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

## Progress (detail)
- S7: **100% (Owner steps left — see the Owner list).** All VID gates PASS on staging and production (S7-GATE.md), VID-6 alarms + privacy text live, Android 1.2.33 built (run 41178510127). Short clips dropped by the Owner.
- P23: S10a-1, S10a-2, S10a-3 (A, B, C) and S10a-4 live on main. Gate clauses 1, 2 and the scripted half of 3 met; the hands-on half of 3 is Owner item 8.

## For the S7b offline runner
(a line is added here after each S7 PR merges on staging)
- 09:10 UTC: S7-a purge-queue deleter (#539) merged on staging as 75f78f67. SQL 0700 not applied yet.
- 09:45 UTC: S7-e encoder harness fixtures (#540) merged on staging as 9e943369 (test-only).
- 10:06 UTC: S7-b takedown (#541) merged on staging as c36726ba. Copyright report switch stays OFF. SQL 0701 not applied yet.
- 10:24 UTC: S7-c video ad (#542) merged on staging as d1e71689. All five S7 PRs are now on staging.
- 11:12 UTC: SQL 0700 + 0701 applied on STAGING, both PROBEs PASS. Production after the carry to main.
- 12:33 UTC: SQL 0700 (purge worker) applied on PRODUCTION, PROBE PASS. S7-a is fully live.
- 13:34 UTC: SQL 0701 (takedown) applied on PRODUCTION, PROBE PASS. S7-b is fully live (copyright report switch OFF).
- 31 Oct 05:22 UTC: SQL 0703 (privacy policy video text) applied on PRODUCTION, PROBE PASS; on main 2df93201.
- 31 Oct 05:05 UTC: S7 privacy policy (#727) merged on staging as e30488c9; SQL 0703 PASS on staging (policy page text only).
- 31 Oct 04:39 UTC: SQL 0702 (VID-6 video alarms) applied on PRODUCTION, PROBE PASS; carried to main 3847d8e4. VID-6 is fully live.
- 31 Oct 04:22 UTC: S7 VID-6 video alarms (#724) merged on staging as 4baaad6c; SQL 0702 PASS on staging (no app code).
- 13:44 UTC: S7-c video ad carried to main (fd903b69). Switch 'Video ads' stays OFF on live. ALL S7 code from this runner is on main; S7b-6 offline videos may build on it.

## Follow-ups (non-blocking review notes)
- S10a-4 finding: screen-feed @ iphone-390 (Chromium): Tab onto a category chip re-mounts it and focus falls back to <body> (focus loss, WCAG 2.4.3). Intermittent: 5 in CI run 41200055747 and 4 locally, 0 in 41202252213. Needs its own fix unit (feed category chips).
- Admin → Health contrast (3 nodes): dark-mode --destructive is both text-on-dark (4.36:1) and a button background under light text (3.43:1); needs a second token.
- #738: notification-row nested-interactive (4 axe nodes) needs a design decision (Owner item 7). Four new labels are English-only (not t()). For a deleted actor the visible notification text is headless (only the screen-reader name of the bell/row says 'A member'), same as before.
- Local harness: screen-feed @ iphone-390 sometimes reports 51 B:tab-unreached locally only (different local Chromium); CI never shows it.
- #724: no hysteresis on the 8 GB line (could reopen every 15 min if storage hovers at it); file name 0702 sorts before 20261103_0300 (precondition refuses on a filename-order rebuild); G5 can false-FAIL if ops-monitor-tick commits during the PROBE (rerun).
- #540: Android fixture is Constrained Baseline (ultrafast overrides High); orientation checked on source size, not output pixels; fixture properties not ffprobe-asserted; iPhone file is MP4 bytes named .MOV.
- #538: 4 wording notes go into S10a-2.
- FLAKY TEST (ads area, not mine): src/components/ads/__tests__/OneAdLayoutUiCheck.test.tsx:138 waits for the ad card's picture with testing-library's default 1 s waitFor; on a loaded CI runner it timed out (carry #697 run 41071311990, 4 tests, each ~1000-1100 ms) while passing 3/3 locally and on main. Re-ran the failed job. Fix belongs to the ads bug runner (give that waitFor an explicit timeout).
- #542: backing out leaves a switched-off picture-only ad (manual delete); videoAd not cleared after handover; no component tests for the button / initialFile.
- #541: copyright reason gated in UI only (server check would make it strict); revoked-list KV key is per video (future re-upload must clear it); owner notice mentions a re-upload flow that doesn't exist yet; 0701 precondition doesn't check the dedup_key unique index.

## Owner list (plain steps, click-only)
1. **Install Android 1.2.33** when Play shows it, then test in the app: post a video, play it in the feed and on your profile, delete it; and **Upload resume**: start a photo upload, turn Wi-Fi off 10 s, back on — it should carry on.
2. **Google Play — Data safety** (~3 min): Play Console → 50mm Retina World → Policy and programs → App content → Data safety → Manage → Next to "Data types" → under "Photos and videos" tick **Videos** → Next → pencil on the Videos card → **Collected** (not shared) · not processed ephemerally · "Users can choose whether this data is collected" · purpose **App functionality** only → Save → Next to the end → Save → Send for review.
3. **Apple — App Privacy** (~2 min): App Store Connect → Apps → 50mm Retina World → App Privacy → Edit next to Data Types → tick **Photos or Videos** if not ticked → Save → Set Up Photos or Videos → **App Functionality** only → Linked to the user: **Yes** → Used for tracking: **No** → Save → **Publish**.
4. **Video rollout** (buttons read Off / Selected / All). Today on live: Video Posts = Selected (6 people), Video Ads = Selected (1). Admin → Video Feature → Video Posts → look at the 6 people (to test alone: tick everyone except yourself → Remove) → keep **Selected** → note → **Save** → test on your phone and in Chrome, Firefox, Safari (post a video, play it, delete it) → add a few members (search → tick → Add) → a day later **All** → Save. Undo any time: **Off** → Save. Video Ads works the same way. Leave Copyright music check **Off**.
5. Please don't edit Admin → Pages → Privacy Policy for a day; if you do, keep the new video paragraphs.
6. Live video converter is set up and polling. When YOU decide: Admin → Video Feature → Video Conversion → "server". I will not change it.
7. **DECIDE (accessibility, no hurry):** on the Notifications page each row is one big button, but people's names inside it are also links (your earlier rule). Screen readers cannot use links inside a button. Reply either "names plain text in the row (like the bell)" or "keep names as links; the row is not one big button any more". Until then it stays as it is.
8. **Hands-on accessibility check (when convenient, ~20 min):** on your Android phone turn on TalkBack (Settings → Accessibility → TalkBack) and swipe through Feed, a post, your profile and Login; note anything that is read wrongly or skipped. This is the part a script cannot do.
