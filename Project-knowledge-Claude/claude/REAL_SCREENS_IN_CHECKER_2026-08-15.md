# The REAL screens in the visual checker — shipped 2026-08-15

**Status: on origin/main, all 20 files byte-identical, trees match, build still ON HOLD.**

Owner: *"gap if found then why kept ?? solve like the pro product"*. The gap was
kept because I stopped to report, not because it was hard. Closed.

## What exists now

A deterministic fake backend (`src/uiharness/fakeBackend.ts`) replaces `fetch`
and `WebSocket` **before any app module is evaluated**, and `AppShell.tsx`
mounts the REAL pages inside the REAL `Layout` with the real providers. Five
screens now photograph at 360/390/1280 — **login, feed, my wall, post detail,
notification settings**. 57 screenshots per sweep, up from 42.

**The rule that makes it honest:** an unmatched request is LOUD — a console
error (which fails the sweep) plus a red banner painted into the picture. A
table is either fixtured with rows, or in `EMPTY_BY_DESIGN` **with a written
reason**, or reported. Never a quiet `[]`.

**And the harness lied anyway, within the hour.** The write rule matched
`POST /rest/v1/…`; an RPC *is* a POST to `/rest/v1/rpc/<name>`. The feed's RPC
was answered `[]`, the feed photographed a tidy "No posts yet", and the sweep
reported **zero problems**. Caught by looking at the picture. RPC is now matched
first by name; the test **calls** the routes rather than grepping them, because
the grep version let the `() => []` mutation escape.

## Four faults found, all live for weeks

1. **Caption could not break a word** — `whitespace-pre-wrap` without
   `break-words`. A one-token caption (filename, pasted url) ran **178px** past
   the card at 360px, sliced mid-word, no ellipsis, no "See more".
2. **`AnimatePresence` handed `<Fragment>` children** — it attaches a ref to
   measure each child; a Fragment cannot hold one. React 19 logged an error per
   post per render. On the **wall** the `exit` animation never ran: a deleted
   post vanished instead of fading. On the **feed** the wrapper was pure cost.
3. **Reach/views cut in half at 360px** — `943 reached 👁 66` on a busy post.
4. **In the tests themselves** — two long-green source-pin tests stripped
   comments with a regex that read `accept="image/*"` as the start of a block
   comment and deleted **~400 lines** of the file they then asserted on. They
   had been passing for a reason unconnected to their claim.
   `src/test-utils/sourceText.ts` fixes it. ⚠ **~30 other test files still carry
   the naive stripper — open work, not done.**

## Gates

typecheck 0 · vitest 0 (**1,805 passing**) · build 0 · `ui:shot` **1, and
correctly so**: 12 genuine findings on real screens (tap targets under 44px on
feed/wall/post/settings, one base64 avatar that does not decode). **Not yet
triaged.** The gate is red because the app is.

## Owner decisions taken 2026-08-15, NOT yet implemented

The engagement row is being redesigned, in his words: *"Viewed by and reached by
will show on mouse over or on 1st touch on the image and emoji will show on the
right side… web and app both"*, *"emoji mean love and like icons of likes post
posts like fb"*.

- **First tap on the photo shows the numbers only; a second tap opens it.**
- **Right side: reaction icons with a count per reaction** (👍 9.1K ❤️ 3.7K),
  **total on the left, as Facebook does now.**

This supersedes the `hidden sm:inline` fix shipped above, which stays as the
correct intermediate state until the redesign lands.

## Still open

- Triage the 12 real findings from the sweep.
- Migrate the remaining test files off the naive comment stripper.
- The plain-language test worksheet for the owner.
- **No build until the owner says so.**
