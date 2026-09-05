# F-88 · "Add Friend" wrapped onto two lines while "Follow" sat on one

Instrument: real Chromium **141.0.7390.37** (the container's pinned build), driven by Playwright
against the repository's own UI harness scene **`screen-wall-visitor`** — the scene that exists
precisely because the Owner once asked *"Where is add frind Follow button ??"* and no screenshot
could answer him. That scene renders the real `PublicProfile` for another member, so
`FriendFollowButtons` renders on its real page rather than in isolation.

`measure-wrap.prepared.mjs` and `measure-overflow.prepared.mjs` are the exact scripts used.

## How the wrap is measured

Not by eye, and not by element height — a wrapped label inside a **fixed `h-9` box** does not make
the box taller, which is exactly why every existing check was blind to this. The measurement takes
the button's own text node, builds a `Range` over it, and counts `getClientRects()`:
**one rect = one line.** Two rects is a wrap, stated as a number.

The probe also skips rows whose bounding box is zero-width. At phone widths the desktop copy of
this row is still in the DOM with no box, and measuring it would have reported "no wrap" for a row
nobody can see.

## BEFORE — `flex-1` alone

```
desktop-1280  english   "Add Friend"           lines=2  wrapped=YES  w=103  ws=normal  basis=0%
desktop-1280  english   "Follow"               lines=1  wrapped=no   w=103  ws=normal  basis=0%
iphone-390    english   "Add Friend"           lines=1  wrapped=no   w=170
iphone-390    telugu    "స్నేహితుడిని జోడించు"  lines=2  wrapped=YES  w=170
android-360   telugu    "స్నేహితుడిని జోడించు"  lines=2  wrapped=YES  w=158
```

The English wrap shows on **desktop, not on the phone** — because the two-column shell squeezes
this column to 103px per button while a 360px phone gives it 158px. A reviewer who only checked a
narrow viewport would have called this fixed.

`screenshots/BEFORE-desktop-1280-english.png` — the Owner's case, "Add" over "Friend".

## AFTER — `whitespace-nowrap` + `min-w-fit`, `flex-1` retained

Every label, every width, single line, nothing overflowing:

```
desktop-1280  english        "Add Friend"    lines=1  w=118  ws=nowrap
desktop-1280  telugu         …               lines=1  w=174
desktop-1280  "Request Sent"                 lines=1  w=133
desktop-1280  "Accept" / "Unfriend" / "Following"   lines=1  w=91 / 102 / 109
iphone-390    all of the above               lines=1
android-360   all of the above               lines=1
```

## The silent-overflow check, because `whitespace-nowrap` alone would have caused one

A no-wrap label on a zero flex-basis stops wrapping and starts overflowing — the same defect, now
invisible. So overflow was measured explicitly rather than assumed away, at every width and for the
widest labels:

```
w=360   english      pageOverflow=0  rowW=324  rowScrollW=324  rowOverflowing=false
w=360   telugu       pageOverflow=0  rowW=324  rowScrollW=324  rowOverflowing=false
w=360   tamil        pageOverflow=0  rowW=324  rowScrollW=324  rowOverflowing=false
w=360   RequestSent  pageOverflow=0  rowW=324  rowScrollW=324  rowOverflowing=false
w=390   (all four)   pageOverflow=0  rowW=348  rowScrollW=348  rowOverflowing=false
w=1280  (all four)   pageOverflow=0  rowW=214→270              rowOverflowing=false
```

`min-w-fit` grows the Telugu button to 174px at 360px — wider than the 158px equal share — and the
row still fits in 324px with `Follow` beside it. Zero horizontal page overflow anywhere.

## Every sibling label checked, at the same widths

`Add Friend`, `Request Sent`, `Accept`, `Unfriend`, `Follow`, `Following` — all six literals in the
component, all single-line after the fix.

**C-79 against the brief:** the labels named there as *"Respond"* and *"Friends"* do not exist in
this component. `friendStatus === "pending_received"` renders **`Accept`** (`:185`) and
`friendStatus === "accepted"` renders **`Unfriend`** (`:196`). "Friends" appears only as a count
noun in the legacy `FriendFollowActions` wrapper, never on a button. The instruction — check every
sibling, not just Add Friend — is followed against the six labels the file actually holds.

## Item (3): `ReactorFriendAction` does NOT have this defect

`ReactorFriendAction.tsx:69` already carries **`whitespace-nowrap shrink-0`** in its base class and
its buttons are not in a `flex-1` row, so nothing forces them to a shared width. No change needed
there, and none made.

## F-88-OBS · hardcoded English vs `t()` — reported, not fixed here

Every label in `FriendFollowActions` is a bare English literal, while `DiscoverCard.tsx:129`
renders the same concept through `t("fr.addFriend")`, which ships in six languages. A member using
another language sees this row untranslated beside a translated Discover card.

Switching these to `t()` changes what members see and was not asked for, so it is **recorded as an
observation and left alone**. The layout is sized for the translated strings regardless — measured
above against the widest of them — so that switch, when it is asked for, cannot reintroduce the
wrap.

## The repository's own UI gate — unmoved by this change, and RED before it

`npm run ui:gate` was run twice, differing **only** in `src/components/FriendFollowActions.tsx`:
once with that file byte-identical to `origin/staging`, once with the fix.

```
BASE : 152 screenshots, 24 problem(s) reported.
BASE : baseline diff: clean against 148 recorded scene/viewport keys.
FIXED: 152 screenshots, 24 problem(s) reported.
FIXED: baseline diff: clean against 148 recorded scene/viewport keys.

✗ rows — baseline 12, fixed 12, sets diffed: IDENTICAL
screen-wall-visitor  android-360 / iphone-390 / desktop-1280 / app-360   ✓ in both runs
```

## F-88-OBS-2 · the local UI gate is RED on clean `staging` while CI reports it green

Stated because it was measured, and because it is not this PR's to fix.

`npm run ui:gate` exits **1** on `origin/staging` with **no changes at all**. The 24 problems are
12 scene/viewport combinations × the same 2 warnings, in three dialog scenes only —
`crop-modal-behind-dialog`, `hashtag-list-in-dialog`, `screen-account-sheet`:

```
warning: Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}.
```

A Radix accessibility warning, in dialog scenes, unrelated to this row. **But CI's `UI gate`
reports success on the same code** — run **352** on the `main` promotion push and run **360** on
PR #178, both green.

The gate's own header says: *"A gate that is invoked one way locally and another way in CI is a
gate with two behaviours, and the one that matters is whichever nobody checked."* That is the
present state. The likeliest axis is dependency resolution — this container could not reach the
repository's private npm mirror and several packages were fetched from `registry.npmjs.org`
directly, so a Radix version may differ from the one `npm ci` installs in CI — **but that is a
hypothesis, not a measurement, and it is recorded as such.** Either the warnings are real and CI is
not seeing them, or the local environment is generating them spuriously; either way one of the two
is lying, and that is worth its own unit.
