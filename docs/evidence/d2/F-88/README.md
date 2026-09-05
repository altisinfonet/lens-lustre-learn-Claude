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

---

# Round 2 — C-34 red/green, light + dark, and the ReactorFriendAction question

## C-34 · the check, planted red then green

`f88check.prepared.mjs` exits **1** if any label in the row wraps or overflows, at either theme and
either width. It was run twice with the **same command**; the only thing that changed between them
is `btnBase` in `src/components/FriendFollowActions.tsx`.

**Defect planted** (file restored byte-identical to `origin/staging`):

```
  FAIL desktop-1280  dark   english  "Add Friend"   lines=2 wrapped=true  w=103
  FAIL desktop-1280  dark   telugu   …              lines=2 wrapped=true  w=131
  FAIL desktop-1280  light  english  "Add Friend"   lines=2 wrapped=true  w=103
  FAIL desktop-1280  light  telugu   …              lines=2 wrapped=true  w=131
  FAIL android-360   dark   telugu   …              lines=2 wrapped=true  w=158
  FAIL android-360   light  telugu   …              lines=2 wrapped=true  w=158

F-88 CHECK: FAIL — 6 wrapped/overflowing label(s).
```

**Defect removed** (the fix):

```
  ok  … 16 of 16 rows …
F-88 CHECK: PASS — nothing wrapped, nothing overflowed.
TRUE EXIT CODE = 0
```

Note `android-360 / english` is **ok in both runs**. It is not a wrap case at that width, and it is
kept in the check deliberately: a check that only contains cases which fail is a check that cannot
tell you when you have broken something that used to work.

## Light and dark, desktop and 360

Eight new screenshots, `{BEFORE,AFTER}-{desktop-1280,android-360}--{dark,light}--{english,telugu}.png`.
Theme is set by seeding `localStorage.theme` before the page loads, which is the mechanism
`useTheme.tsx:14` actually reads — the app defaults to **dark**, so the original round of
screenshots was dark-only. The defect and the fix are identical in both themes; only the palette
moves.

## Which language, and why it is the longest — measured, not assumed

All six shipped `fr.addFriend` translations rendered in the real stylesheet and measured by
**rendered width**, not by character count (Devanagari, Bengali, Tamil and Telugu do not compare by
length):

| lang | string | rendered px |
|---|---|---|
| **te** | స్నేహితుడిని జోడించు | **145** |
| ta | நண்பரைச் சேர் | 113 |
| en | Add Friend | 97 |
| bn | বন্ধু যোগ করুন | 87 |
| gu | મિત્ર ઉમેરો | 83 |
| mr | मित्र जोडा | 75 |
| hi | मित्र जोड़ें | 72 |

**Telugu is the widest, by 32px over the next.** That is why it is the string the layout is sized
against. Bengali — the example named in the brief — is in fact narrower than English.

## C-80 · `ReactorFriendAction` does NOT carry this defect, and changing it would be wrong

The instruction was "fix both or neither". Measured, there is nothing to fix, so the correct answer
is **neither**, and this is the measurement rather than a reading of the class string.

`ReactorFriendAction.tsx:69` — `base`, verbatim — contains **`whitespace-nowrap shrink-0`**, has
**no `flex-1`**, and has **no fixed height** (`py-0.5`, not `h-9`). All three of the ingredients of
F-88 are absent. Its two call sites put it in the correct arrangement, and both are identical:

```jsx
<div className="flex items-center gap-2">
  <Link>…avatar…</Link>
  <div className="flex-1 min-w-0"> …name, truncate… </div>   ← the NAME yields
  <ReactorFriendAction … />                                   ← the ACTION does not
</div>
```

That is the *opposite* of the F-88 arrangement: there the two buttons both took `flex-1` and fought
over the row; here the name takes `flex-1 min-w-0` and truncates, and the action keeps its natural
width. Rendered in the real stylesheet inside that exact container at 360px and 1280px, for all
seven labels:

```
  360px  en/hi/bn/mr/gu/ta/te   RFA-as-shipped   lines=1  wrapped=false  rowOverflow=false
 1280px  en/hi/bn/mr/gu/ta/te   RFA-as-shipped   lines=1  wrapped=false  rowOverflow=false
```

Zero wraps, zero overflows, including Telugu at 145px inside a 360px row. Adding `min-w-fit` there
would change nothing; adding `flex-1` would *introduce* F-88 into a component that does not have it.

**Scope limit, stated rather than glossed:** that probe injects the real class strings into the real
harness stylesheet inside a replica of the call-site container. It is a faithful measurement of the
CSS contract, and it is **not** a render of the live component with its own data — which would need
its providers and a Supabase session this container cannot reach. The same probe does **not**
reproduce the F-88 wrap, because a synthetic full-width row is not the squeezed 103px profile
column; the F-88 numbers in this document all come from the real `screen-wall-visitor` scene, and
none of them come from the probe.
