# Video + accessibility runner — status

Started 2026-10-30 01:47 UTC. Replaces the earlier supervisor session (no GitHub trace after 2026-10-29 14:19 UTC).
Last update: 2026-10-30 ~03:00 UTC.

## Now
All five waiting PRs rebased on staging, reviewed again by an independent reviewer, fixes pushed. Waiting for CI.

## Units
| Unit | PR | State | Merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| CI fix: app-origin check reads the routes staging serves (blocks #541) | #619 | review: nothing blocking; CI running | — | none | — |
| S10a-1 P23 decision note | #538 | rebased; review: nothing blocking (doc fixes applied); CI running | — | none | — |
| S7-a purge-queue deleter | #539 | rebased; old blocking finding was already fixed; review: nothing blocking; CI running | — | 0700: not run yet | — |
| S7-e encoder harness fixtures | #540 | rebased; review: nothing blocking; CI running | — | none | — |
| S7-b VID-4 takedown | #541 | rebased (PostCard conflict resolved); 2 red checks root-caused + fixed; review: nothing blocking; CI running | — | 0701: not run yet | — |
| S7-c VID-5 video ad | #542 | rebased; review found BLOCKING (new ad went live before its video was checked) → fixed, test seen failing first; re-review running | — | none | — |

### Root causes found (#541's two red checks)
1. "Unit tests pass (vitest)": `src/lib/video/takedown.ts:32` called the route with a literal path instead of `SITE_API.videoTakedown`, and the route list in `src/lib/net/__tests__/siteApi.test.ts` was not updated (commit 1999911). Fixed in #541.
2. "App origin journey (https://localhost)": the over-the-wire step checked the PR's NEW route against staging BEFORE the merge; staging answers a route it never had exactly like a made-up one (405). `scripts/app-origin-check.mjs:22-24`. Fixed in #619 (checks the routes of the build staging serves).

## Progress
- S7: 0% merged (6 PRs in review/CI)
- P23: 0% merged (decision note in CI)

## For the S7b offline runner
(a line is added here after each S7 PR merges on staging)

## Owner list
1. Nothing needed yet.
