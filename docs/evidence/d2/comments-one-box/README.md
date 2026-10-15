# Bugs 3 + 5 — one comments box; comments load slowly (Owner list, 15 Oct 2026)

D2, branch `d2/comments-one-box-20261015`, from `origin/staging` e41afb46.

## Bug 5 — measured first

**Instrument:** `tools/uishot/comments-load-timing.mjs` (added in this PR). Real
Chromium (Playwright), anonymous reader of a public post (`/post/:id` is public),
fresh browser context per run. t0 = the click on the post's comments button
(capture-phase listener); end = the first comment's text appears in the dialog
(MutationObserver); requests from Resource Timing — all on the page's own clock.
Post `f1263897-…` on staging (2 comments; staging has 4 post comments readable
in all, so this is the whole staging data set).

| reading | where | median click → first comment | API requests before it |
|---|---|---|---|
| `before-staging-post.json` | https://staging.50mmretina.com (deployed e41afb46-era code) | **582 ms** (516–623, 7 runs) | 2, in series |
| `before-local-build.json` | origin/staging built locally, staging backend | **592 ms** (504–617, 7 runs) | 2, in series |
| `after-local-build.json` | this branch built locally, staging backend | **357 ms** (280–492, 7 runs) | **1** |
| `before-local-build-rtt300.json` | as before-local, +300 ms CDP latency per request | 793 ms | 2 |
| `after-local-build-rtt300.json` | as after-local, +300 ms CDP latency per request | 483 ms | 1 |

**Cause (client-side):** a request staircase. `usePostComments` read
`post_comments`, waited for it, and only then read `post_comment_reactions`
with `.in()` on the ids it got back. Each request is ~230–290 ms of network on
its own — a trivial `site_settings` read on the same warm connection measured
233 ms, `post_comments` 287 ms, the reactions read 214 ms, the embedded read
298 ms (curl, same connection) — so **the database is not slow; the wait was two
round trips in series** (three for a signed-in member, whose author names come
from a profile read that started only after both). Nothing for D1: no SQL, no
index.

**Fix:** reactions embedded in the comments request
(`post_comment_reactions(user_id, reaction_type)` through
`post_comment_reactions_comment_id_fkey`, same RLS), `getAdminIds()` beside it,
two-step fallback if the embed is ever refused; a per-session cache of threads
already opened, so a second open draws at once and the reload after posting no
longer replaces the list with "Loading comments…". Ads: the same cache; the ad
read was already one request (with admin ids in parallel).

Not measured here: a signed-in member's run (the instrument signs nothing in)
and the ad thread on staging (no ad comments are readable anonymously). The
unit tests hold both code paths.

## Bug 3 — one box

`CommentsBox` (in `src/components/PostCommentsSection.tsx`) is the only box:
search row, sorting, emoji row, block-author, `commentPlaceholderFor(owner)`
("Add a comment for …"), one empty line (`COMMENTS_EMPTY_LABEL`).
`PostCommentsSection` and `AdComments` only supply data; an ad leaves out
exactly what its tables lack (comment reactions, pinning, report item) by not
passing the callback. The ad's owner name and headline come from the card's own
header (`src/lib/ads/adThreadSubject.ts`, filled by AdZone).
CommentsOverlay / CommentsOverlayContext / AdEngagementBar are untouched (#434).

## Fail-first

`failfirst-vitest.txt`: the two new test files run on origin/staging code (with
only `src/lib/ads/adThreadSubject.ts` copied in so the test can import it):
**5 of 6 fail** (the 6th is the embed-refused fallback, which IS the old
behaviour). On this branch: 6 of 6 pass.

Existing tests changed to follow the one box, none weakened:
`StoryCardComments.test.tsx` (the ad's empty line is now the post's, word for
word); `noComponentDefinedInRender.test.ts` "both render CommentThread" (the ad
draws the shared `CommentsBox` imported from the post adapter, which draws
`CommentThread`).

## Bundle (P13)

Entry chunk, same env, built locally: 1,704,848 B (origin/staging) →
1,706,485 B (**+1,637 B**), ceiling 1,754,112 B.
