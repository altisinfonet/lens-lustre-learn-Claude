# Video + accessibility runner — status

Started 2026-10-30 01:47 UTC. Replaces the earlier supervisor session (no GitHub trace after 2026-10-29 14:19 UTC).
Last update: 2026-10-30 11:50 UTC.

SECOND RESTART 2026-10-30 ~07:15 UTC: the run stopped silently again at ~05:15 UTC. New rule: ONE PR at a time (#619 → #538 → #539 → #540 → #541 → #542), heartbeat at least every 20 minutes. Checked GitHub 07:15 UTC: nobody pushed to or merged #538-#542 or #619 since 02:00 UTC; each is 21 commits behind staging.

RESTART 2026-10-30 ~05:05 UTC: the previous run stopped silently at ~02:00 UTC. A new run took over at 05:05 UTC. Checked GitHub: nobody else pushed to or merged #538-#542 or #619 since 02:00 UTC.

## Now
11:50 UTC — #538 decision note LIVE on main (bb2ac7a5), live check clean. Carry S7-a → PR #681: review nothing blocking, CI running.

## Units
| Unit | PR | State | Merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| CI fix: app-origin check reads the routes staging serves (blocks #541) | #619 | MERGED 08:10 UTC (25/25 checks green; review nothing blocking) | staging 5f8c8d5e / main 7359701a (carry #675, 11:30 UTC, 24/24 green, review nothing blocking) | none | live run 41048271236: 6/6 pages 200, same text, no new console errors |
| S10a-1 P23 decision note | #538 | MERGED 08:48 UTC (22/22 checks green; review nothing blocking) | staging a0e8d849 / main bb2ac7a5 (carry #676, 11:47 UTC, 22/22 green, review nothing blocking) | none | live run 41050004521: 6/6 pages 200, same text, no new console errors |
| S7-a PROBE fix: admin read lane-proof | #673 | MERGED 11:08 UTC (33/33 green; review nothing blocking ×2) | staging 9b4e0201 / main: in carry PR #681 | — | — |
| S7-a purge-queue deleter | #539 | MERGED 09:10 UTC (36/36 checks green; re-review nothing blocking) | staging 75f78f67 / main: carry PR #681 (with #673) open (73a28377), review nothing blocking, CI running | 0700 STAGING: PROBE-before 41040556611 FAIL G1 (expected) · apply 41040769034 SUCCESS 10:27 · PROBE-after 41042014241 ERROR (PROBE bug → #673) · PROBE-after 41045879133 **PASS** 11:10 UTC. Production: after main | — |
| S7-e encoder harness fixtures | #540 | MERGED 09:45 UTC (25/25 checks green incl. encoder harness; review BLOCKING ×3 → fixed with fail-first test f6723b2b → re-review nothing blocking) | staging 9e943369 / main: not yet | none | — |
| S7-b VID-4 takedown | #541 | MERGED 10:06 UTC (36/36 checks green incl. vitest + app-origin journey, which were red before #619; review nothing blocking) | staging c36726ba / main: not yet | 0701 STAGING: PROBE-before 41042307096 FAIL G1 (expected) · apply 41046205913 SUCCESS 11:11 · PROBE-after 41046275090 **PASS** 11:11 UTC. Production: after main | — |
| S7-c VID-5 video ad | #542 | MERGED 10:24 UTC (25/25 checks green; earlier blocking fix verified; re-review nothing blocking) | staging d1e71689 / main: not yet | none | — |

### Root causes found (#541's two red checks)
1. "Unit tests pass (vitest)": `src/lib/video/takedown.ts:32` called the route with a literal path instead of `SITE_API.videoTakedown`, and the route list in `src/lib/net/__tests__/siteApi.test.ts` was not updated (commit 1999911). Fixed in #541.
2. "App origin journey (https://localhost)": the over-the-wire step checked the PR's NEW route against staging BEFORE the merge; staging answers a route it never had exactly like a made-up one (405). `scripts/app-origin-check.mjs:22-24`. Fixed in #619 (checks the routes of the build staging serves).

## Live baseline (before my carries)
d2-live-check run 41046580661 on main 36c895d1 (11:16 UTC): home + /feed 200 in Chromium, Firefox, WebKit, same text both loads. Console errors already present: X-Frame-Options in <meta>; Cloudflare beacon blocked by CSP; 401 on profiles_public_data (home); Firefox __cf_bm cookie notice.

## Progress
- S7: 5 waiting PRs merged on staging + SQL 0700/0701 PASS on staging. Next: carry each unit to main (one PR each), then production SQL, then rest of S7. Roughly 35% of S7 (code + staging SQL for purge, takedown, ad, encoder tests; live converter, cost alerts, short clips, rollout not started).
- P23: decision note merged on staging AND live on main (bb2ac7a5). About 25% of S10-a. Next P23 work (S10a-2..4) after S7 carries.

## For the S7b offline runner
(a line is added here after each S7 PR merges on staging)
- 09:10 UTC: S7-a purge-queue deleter (#539) merged on staging as 75f78f67. SQL 0700 not applied yet.
- 09:45 UTC: S7-e encoder harness fixtures (#540) merged on staging as 9e943369 (test-only).
- 10:06 UTC: S7-b takedown (#541) merged on staging as c36726ba. Copyright report switch stays OFF. SQL 0701 not applied yet.
- 10:24 UTC: S7-c video ad (#542) merged on staging as d1e71689. All five S7 PRs are now on staging.
- 11:12 UTC: SQL 0700 + 0701 applied on STAGING, both PROBEs PASS. Production after the carry to main.

## Follow-ups (non-blocking review notes)
- #540: Android fixture is Constrained Baseline (ultrafast overrides High); orientation checked on source size, not output pixels; fixture properties not ffprobe-asserted; iPhone file is MP4 bytes named .MOV.
- #538: 4 wording notes go into S10a-2.
- #542: backing out leaves a switched-off picture-only ad (manual delete); videoAd not cleared after handover; no component tests for the button / initialFile.
- #541: copyright reason gated in UI only (server check would make it strict); revoked-list KV key is per video (future re-upload must clear it); owner notice mentions a re-upload flow that doesn't exist yet; 0701 precondition doesn't check the dedup_key unique index.

## Owner list
1. Nothing needed yet.
