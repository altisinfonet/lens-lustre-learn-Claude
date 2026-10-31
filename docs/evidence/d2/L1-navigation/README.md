# L1 navigation — evidence (PR #434)

REV4 plan §6 Stage L1: Back never loops on a post's comments (F-REV4-7), and
"Feed scroll position restored exactly when returning".

Instruments:

- **Unit:** vitest. The files are named in each raw log.
- **Browser:** `tools/uishot/nav-harness.mjs`. It drives the real Feed and PostDetail on
  `navharness.html` against the harness fake backend, uses the page's real history
  stack, and presses the browser's own Back. CI runs it in chromium, firefox and webkit
  (`.github/workflows/d2-nav-harness.yml`).

## Layout

| Path | What it is |
|---|---|
| `fail-first/` | F-REV4-7 (the Back loop), run on a04742ac with only the tests and harness added (`tree-under-test.txt`). Unit and browser runs (chromium, chrome, msedge, firefox) fail on the loop journeys. |
| `fixed/` | The same journeys after the fix. `browser-FIXED-webkit.*` was replaced on 2026-10-14. The old file recorded 15/18, with three scroll journeys failing on "the page never stopped changing height". The new file is the green 18/18 run at the B1 fix: local WebKit 26.5, `"at"` in the JSON. |
| `b1/fail-first/`, `b1/fixed/` | Review item B1, described below. |

## Why the feed's scroll position needs the app's help (WebKit)

`src/hooks/core/useScrollRestoreOnReturn.ts` explains this in its header. In short:
before L1, "feed → a post → Back" was restored by the browser itself in Chromium,
Chrome, Edge and Firefox. WebKit (Safari's engine, and the iOS app's WebView) did not
restore it. The member left at 1313 px and came back at 1085 px, at a 390 px wide
viewport, measured 13 Oct 2026.

That WebKit reading is quoted from the hook's header. No raw WebKit file from that
run was committed (the PR #434 review noted this).

## B1 — the same posts, not only the same offset

Review comment:
https://github.com/altisinfonet/lens-lustre-learn-Claude/pull/434#issuecomment-6174143494

**The fault.** `/feed` and `/post/:id` are sibling routes, so Back remounts the feed.
`refetchOnMount: "always"` re-dealt page 0 with a new session seed, and the new deal
replaced every page. The scroll restore then put the member at the right height over
posts they had never seen. The harness could not see this, because its fake feed
ignored the seed and the scroll journeys asserted only `scrollY`.

**The fix:**

- `useFeedQuery` takes the router's navigation type from Feed.tsx. A POP (Back or
  Forward) over this running app's own deal makes no request and shows the same pages.
- Any other mount still deals new. That covers a PUSH or REPLACE visit, a cold start,
  pages restored from the device, a different member and a failed query.
- Pull-to-refresh, the "N new posts" pill and the refresh after posting are unchanged
  (`useFeedRefresh`).
- The session (seed, watermark, exclude lists, last author) moved from per-mount refs
  to `src/lib/feedSessions.ts`. "Load more" after Back therefore continues the same
  deal.
- A different member, a sign-out (`wipeMemberDataOnSignOut`) and a fresh visit all
  start the session over.

**Tests:**

- **Unit:** `src/hooks/feed/__tests__/feedFreshness.test.ts`, describe block "a fresh
  visit deals a new hand; Back keeps the hand on screen (B1)". It replaces the old text
  pin `refetchOnMount: "always"`.
- **Browser:** `nav-harness.mjs`. The fake `get_broadcast_feed` now deals by seed and
  honours `_exclude_ids`, in this harness only. The two "feed → a post → Back" journeys
  now also assert three things after Back:
  - the same `data-post-id` is at the top of the viewport;
  - the cards are in the same order;
  - no new seed was asked for.
- **Fresh-visit control:** this journey now also asserts that a fresh visit asks for a
  new deal.

**Results:**

| Run | Before the fix (`b1/fail-first`, tree in `tree-under-test.txt`) | After the fix (`b1/fixed`) |
|---|---|---|
| unit, feedFreshness | 2 failed / 18 passed (20): (b) and (c) | 20/20 |
| chromium 151 | 16/18: the two B1 journeys fail | 18/18 |
| firefox 153 | 16/18: the two B1 journeys fail | 18/18 |
| webkit 26.5 | 16/18: the two B1 journeys fail | 18/18 |

**Not proven here:**

- A real device.
- The staging RPC. The harness deals with a fake. The real function's seed behaviour
  is proven on PGlite in `docs/evidence/d1/L2-feed-freshness`.
