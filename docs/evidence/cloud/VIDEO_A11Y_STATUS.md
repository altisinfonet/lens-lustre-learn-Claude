# Video + accessibility runner — status

Started 2026-10-30 01:47 UTC. Replaces the earlier supervisor session (no GitHub trace after 2026-10-29 14:19 UTC).
Last update: 2026-10-30 09:29 UTC.

SECOND RESTART 2026-10-30 ~07:15 UTC: the run stopped silently again at ~05:15 UTC. New rule: ONE PR at a time (#619 → #538 → #539 → #540 → #541 → #542), heartbeat at least every 20 minutes. Checked GitHub 07:15 UTC: nobody pushed to or merged #538-#542 or #619 since 02:00 UTC; each is 21 commits behind staging.

RESTART 2026-10-30 ~05:05 UTC: the previous run stopped silently at ~02:00 UTC. A new run took over at 05:05 UTC. Checked GitHub: nobody else pushed to or merged #538-#542 or #619 since 02:00 UTC.

## Now
09:29 UTC — #540: fix pushed (f6890cce), local harness 7/7 PASS; re-review and CI running.

## Units
| Unit | PR | State | Merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| CI fix: app-origin check reads the routes staging serves (blocks #541) | #619 | MERGED 08:10 UTC (25/25 checks green; review nothing blocking) | staging 5f8c8d5e / main: not yet | none | — |
| S10a-1 P23 decision note | #538 | MERGED 08:48 UTC (22/22 checks green; review nothing blocking) | staging a0e8d849 / main: not yet | none | — |
| S7-a purge-queue deleter | #539 | MERGED 09:10 UTC (36/36 checks green; re-review nothing blocking) | staging 75f78f67 / main: not yet | 0700: not run yet (after all 6 merges) | — |
| S7-e encoder harness fixtures | #540 | review 09:15: BLOCKING ×3, each confirmed in code: (1) ±0.5 s length check read the SOURCE length (webEncoder.ts:197,414), so a short output passed; (2) iPhone/Android fixtures could be swapped undetected; (3) comments called 3 min the 'member limit' (there is no cap). Fail-first test f6723b2b (4 red); fix written, 6/6 green; fix f6890cce: 6/6 green, local harness 7/7 PASS; pushed; re-review + CI running | — | none | — |
| S7-b VID-4 takedown | #541 | rebased (PostCard conflict resolved); 2 red checks root-caused + fixed; review: nothing blocking; CI running | — | 0701: not run yet | — |
| S7-c VID-5 video ad | #542 | rebased; review found BLOCKING (new ad went live before its video was checked) → fixed, test seen failing first; re-review running | — | none | — |

### Root causes found (#541's two red checks)
1. "Unit tests pass (vitest)": `src/lib/video/takedown.ts:32` called the route with a literal path instead of `SITE_API.videoTakedown`, and the route list in `src/lib/net/__tests__/siteApi.test.ts` was not updated (commit 1999911). Fixed in #541.
2. "App origin journey (https://localhost)": the over-the-wire step checked the PR's NEW route against staging BEFORE the merge; staging answers a route it never had exactly like a made-up one (405). `scripts/app-origin-check.mjs:22-24`. Fixed in #619 (checks the routes of the build staging serves).

## Progress
- S7: 1 of 5 waiting S7 PRs merged on staging (S7-a). SQL, carry to main, rest of S7 still to do.
- P23: 1 of 4 S10-a parts merged on staging (decision note, about 25%). Stages runner may start S10 rest now.

## For the S7b offline runner
(a line is added here after each S7 PR merges on staging)
- 09:10 UTC: S7-a purge-queue deleter (#539) merged on staging as 75f78f67. SQL 0700 not applied yet.

## Owner list
1. Nothing needed yet.
