# Build 1069 — the three things I got wrong in 1068. 2026-08-10, night.

`main` = **`32244ab`** · Android Build **#69 ✅** = **versionCode 1069** · web live.
Supersedes 1062–1068. Run: https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31415361555

The owner asked, after a long night of UI changes: *"what you damaged ?? What bad
and garbage code imposed in this build ??"* — a fair question. Three of the
answers were real defects and are fixed here. The rest of that audit is at the
bottom, because the ones that are NOT fixed still matter.

---

## 1. A computer could no longer refresh the feed. My error, and I asserted the opposite.

When the refresh button was removed I wrote: *"Nothing is lost by removing the
button. This whole screen is already wrapped in `<PullToRefresh>`."*

**`PullToRefresh` listened to `onTouchStart` / `onTouchMove` / `onTouchEnd` and
nothing else.** On a desktop it did literally nothing, and had done nothing for
as long as it has existed — which was invisible while a button was there. So a
desktop member was left with no way to refresh but reloading the page.

Fixed by adding a wheel handler to the same component: overscrolling **upward**
at the very top of the feed refreshes it. That adds no control to the screen,
which is what he required. Guards:

* only arms while `window.scrollY === 0` and only on negative `deltaY`;
* needs **260px** of sustained upward travel — far more than THRESHOLD, because
  a trackpad emits much more travel than a finger and reaching the top with one
  hard flick must not fire it;
* forgets everything after 500ms of stillness or any downward scroll;
* **never calls `preventDefault`**, so normal scrolling and text selection are
  untouched. The worst case of a false trigger is one extra feed fetch.

**Proved on the live site**, not in a test: calling the deployed handler four
times at the top of the feed puts `animate-spin` on the spinner, which only
happens once `onRefresh()` has actually been called.

> Known and NOT introduced tonight: the little pull-progress indicator's height
> stays at 0 rather than growing as you pull. It behaves identically on the
> touch path, so it predates all of this. The refresh itself fires. Cosmetic,
> and worth a look another day.

## 2. I removed more than was asked on the reactions.

He said keep the emoji reactions. I kept the picker but deleted the two emoji
faces that sat in front of the like count, because at 15px they were what made
the icon row's spacing uneven. That was my call, not his instruction.

They are back, at **13px** — the same size as the number beside them rather than
larger — capped at the two most-used, `gap-0.5`. Measured live afterwards:
`👍 13px · 😮 13px`, and all three action buttons still on the same y.

## 3. "Edit caption" opened in the wrong place.

The caption moved below the action row in the Instagram re-order. The editor did
not — it was still above the photograph, so tapping Edit made the text jump the
height of the picture. Editor and caption are now **the two halves of one
ternary in one slot**, so the editor cannot be left behind if the caption ever
moves again. The markup moved verbatim; the diff shows no other change to it.

---

## Gates run on this change
typecheck clean · **1066 pass / 2 fail** (the judging pair, P10 — 3+ means
something broke) · `npx vite build` ✅ · security audit CRITICAL 0 · HIGH 0 ·
**three mutations**, one per fix, each turning exactly one test red · every file
byte-verified against `origin/main` after upload.

## The rest of that audit — still true, still open

* **The no-capitals rule is the biggest blast radius in the app.**
  `[class*="uppercase"] { text-transform: none }` hits **1,637 places**. I
  measured the feed and looked at the home page. Admin, competitions, judging,
  certificates, Journal and the wallet are **unverified**. One block to delete
  if it turns out wrong.
* **The ad header hardcodes "50mm Retina World" and its verified tick.** Correct
  while every creative is placed by the owner. The day a slot is sold to a third
  party their ad will carry the platform's verified name. Landmine, not yet a
  bug — the fix is a per-creative advertiser field.
* **P7 (`refetchOnWindowFocus: true`) is shipped and unwatched.** It respects
  the 5-minute `staleTime` so it cannot storm the database, but nobody has
  looked at request volume since it went live.
* **Nobody has watched a real account deletion** since the N4 change, though the
  mechanism was verified on production first.
* Everything else on the pending list is unchanged: N3, P4, P12, P10, P9,
  home TTFB, gallery tiles, hosting 404.
