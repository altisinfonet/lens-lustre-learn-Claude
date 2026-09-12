# D2 — Comment section redesign (post comments sheet)

Branch `d2/comments-sheet-redesign-20260912` → `staging`.
Owner's spec: the two reference screenshots, six numbered pieces, plus
"more premium than the reference, in this app's own tokens".

---

## What was already there, and what was not

Measured by reading the five files that draw the surface, before any edit:

| # | Piece | State before this unit |
|---|---|---|
| 1 | Sheet over the post, handle, "Comments" title | **Partly.** vaul Drawer, swipe-dismiss and handle were there. But `h-screen` — full height, so the post was NOT visible behind it — and the title was `sr-only`, i.e. invisible. |
| 2 | Search within the comments | **Absent.** No search anywhere in the comment code. |
| 3 | Row: avatar · name · badge · age · text · Reply · heart + count | **Different shape.** A chat bubble (`bg-popover rounded-2xl`) with the age and actions BELOW it, the count floating on the bubble's corner, and "Like" as a word plus a `▾` caret. No right-hand heart rail. |
| 4 | Indented replies, inline reply box | **Already correct.** Only spacing moved. |
| 5 | Quick-tap emoji row above the input | **Absent as specified.** A per-comment reaction popover existed behind the `▾` caret, with a different set — that is a different feature, not this one. |
| 6 | Composer: avatar · owner-handle placeholder · image · GIF | **Partly.** Pinned composer, avatar and safe-area were there. Placeholder was the generic `"Write a comment..."`. No image or GIF control. |

---

## Not done, and why — image attach and GIF

`post_comments` is `id · post_id · user_id · content · parent_id · created_at ·
updated_at · is_pinned`. **There is no media column and no comment-media
table.** A working image or GIF comment needs a schema change, and `supabase/**`
is D1's lane.

Both controls were therefore **left out rather than shipped dead**. A greyed
"coming soon" button, or a URL smuggled inside `content`, would each have been
a hidden operation — and the second would invent an encoding a real column
would later have to undo.

**For the Auditor:** this needs a D1 unit (a media column or join table on
`post_comments`, plus its RLS) before the client half can be built. The client
work behind it is small; the schema is the gate.

---

## Before / after

Captured with `tools/uishot/capture.mjs` against the real components at a real
Chromium viewport, fixed fixture data, no network.

| File | What it is |
|---|---|
| `before--app-360.png`, `before--iphone-390.png` | Scene `comments-panel-thread-only` with `CommentThread`, `CommentComposer` and `PostCommentsSection` checked out from `origin/staging`. |
| `after--app-360.png`, `after--iphone-390.png` | Scene `comments-panel` — the panel as this branch ships it. |
| `after-row-only--app-360.png` | Scene `comments-panel-thread-only` on this branch: the same scene as the "before", so the ROW change is isolated from the search row. |

The `comments-panel-thread-only` scene passes no prop newer than this unit,
which is the point — it renders on the previous revision and on this one, so
the pair is one scene photographed twice rather than two different scenes
photographed once each.

**Visible in the before image, beyond the six pieces:** the floating count
badge overlaps the bubble it sits on and covers the tail of the last line —
"…is superb." is partly behind the "4". The flat row has no such collision,
because the count is in the margin and not on top of the text.

---

## A defect the screenshot caught that the tests did not

The first capture at 360px showed the composer placeholder **wrapping to a
second line and being clipped** by the bottom of the sheet. `MentionInput`
renders a textarea; its placeholder wraps like any other text, and the field
here is narrower than the reference's — an avatar on the left, and the send
button occupying 44px INSIDE the field on the right.

`HANDLE_PLACEHOLDER_MAX` went 14 → 10 and was re-measured in the harness. The
unit test was wrong in the same direction and was corrected with it. No test
would have found this: jsdom does not lay text out.

---

## Tap targets — and a wrong answer corrected before it shipped

`tools/uishot`'s sweep, same scene, same viewport:

| | flagged under 44px |
|---|---|
| before (`comments-panel-thread-only` on `origin/staging`) | **17** — including the `▾` reaction caret at **6×17** |
| after, first capture | 17 — the new heart measured **32×32**, under the floor |
| after, heart fixed | 12 |
| **after, final** | **0** |

These controls are not new — `Reply`, the overflow menu, the sort selector and
the reply avatar carry identical geometry on `staging`. This unit is the first
thing to PHOTOGRAPH the comments panel, and `capture.mjs` counts a new scene's
tap-target errors toward its exit code (`process.exit(problems > 0 ? 1 : 0)`)
even though it skips new scenes in the baseline diff. Measuring them made them
ours to clear.

### The first answer was wrong, and the instrument was wrong about it

`.tap-44-down` was chosen from a half-measurement. `elementFromPoint` 8px above
each control returns the comment body — text `RichContentRenderer` fills with
@mention links — so a symmetric `.tap-44` was correctly ruled out by F-109. The
other direction was not checked, and `.tap-44-down` grows 44px **downward**
while `Reply` is the last thing in its row.

It passed the sweep. `capture.mjs` measures SIZE and never overlap, so it would
have shipped green. What caught it was fixing `tap-target-geometry.mjs` first:

```
OVERLAP with "Framo Grapher" over 49.4x12.0
OVERLAP with "Somnath Roy"   over 43.7x10.0
two hit regions intersect    over 32.0x10.0, 32.0x9.0
```

The enlarged region reached into the **next comment's author-name link** —
F-109 happening again, one direction over.

### Two instrument faults, both fixed here

`tap-target-geometry.mjs` judged everything on `getBoundingClientRect()`, and
its header claimed that was "the box the GATE reads, and the only one it can
read". **That stopped being true at F-103**: `capture.mjs:429-435` reads the
`::after` min-width/min-height and counts it as the hit region. The two
instruments disagreed and this one was the stale half — Standing Rule 21.

1. It now measures the **hit region** (painted ∪ `::after`, anchored per
   utility: `.tap-44` centres, `.tap-44-down` pins to the top).
2. Its self-clash check counted only boxes **stacked vertically at the same
   `left`** — which could never see two controls side by side growing toward
   each other across a flex gap, the exact case the comment row presents. It is
   now a true pairwise intersection in both axes.

### The fix that shipped

Real `h-11` controls. A real box **reserves** its space, so it cannot take a
pixel from a neighbour — the same conclusion `TodaysBirthdayStrip` reached on
2026-09-07, where `h-11 w-11` replaced a `.tap-44` that "satisfied a thumb and
was invisible to the instrument". `Reply` needs only the height (32.7px wide
already clears the 32px short side); the menu needs both axes; the reply avatar
link gets a 32px minimum, leaving the picture untouched.

**The cost is real and was accepted knowingly:** the action row goes from 16px
to 44px, so a comment is ~28px taller and roughly four fit a 360px screen where
five did. `gap-6` was reverted to `gap-4` — the widened gap existed only to keep
two invisible regions apart, and there are none now.

Final state, measured:

```
sweep     8 screenshots, 0 problem(s) reported
geometry  PASS every painted box clears the gate's floor
          PASS no box overlaps a neighbouring link (0)
          PASS no two hit regions intersect each other (0)
```

The two remaining `tap-target-geometry.mjs` failures — "birthday-strip avatar
link: the controls rendered" and "/discover row buttons: the controls rendered"
— are `count == 0`: those scenes need data a placeholder Supabase env cannot
supply locally. Verified pre-existing by running the **committed** version of
the tool, which fails both identically.

## Tests

29 new: 13 in `src/lib/__tests__/commentSearch.test.ts` (the filter's rules),
16 in `src/components/comments/__tests__/CommentSheetStructure.test.tsx` (the
assembled panel).

**They can fail.** Run with the six source files stashed:

```
Tests  13 failed | 16 passed (29)
```

13 of the 16 panel tests failed against the previous revision. The 3 that
passed are regression guards for behaviour that was already correct (the reply
box, the fallback placeholder, the signed-out composer) and are expected to
pass on both sides.

Two of my own assertions were wrong when first written and the code was right
both times — a reply count (`4`, not `5`) and the handle truncation
(`villagesquarei…` is 14 characters, the code's limit was already correct).
Recorded because a test suite that never contradicts its author is not being
run honestly.

## Whole-suite comparison

|  | test files |
|---|---|
| `origin/staging`, clean | 12 failed, 186 passed, 1 skipped (199) |
| this branch | 12 failed, 188 passed, 1 skipped (201) |

Same 12 failing files on both sides — all in the SQL/grants and push-catalog
area (`securityDefinerGrants`, `newTableGrants`, `pushCatalogParity`,
`PreviewA11yFourItems`, …), none of them touched by this unit.
`PreviewA11yFourItems` asserts a `rolling`/`setRolling` state in
`PostCommentsSection` that the component has not had since it became a
two-band layout; it is stale on `staging` and is stale here.

### The UI gate on this PR

`Every control reachable, nothing regressed` is red, and **18 of its 24
problems are not this PR's**. The same check is already red on `staging` at
`7a64cea` — the exact commit this branch is cut from (runs
[#524](https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/34700818601)
and [#525](https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/34700820312))
— with an identical failure list. Staging uploaded 192 screenshots, this PR 200;
the 8 extra are this PR's two new scenes.

Root cause of those 18: a **stale baseline**. `TodaysBirthdayStrip.tsx` records
in its own header, dated 2026-09-07, that its avatar link was deliberately
changed from `.tap-44` to a real `h-11 w-11` box; the anchor is now
`a.shrink-0.grid` and `baseline.json` still names `a.shrink-0.tap-44`. The
control got BETTER and the diff reads the selector change as "gone".

Proposed fix, deliberately not made here: re-record `tools/uishot/baseline.json`
(`--baseline-write`, as capture.mjs prescribes) in its own unit off `staging` —
a baseline must be written from a run confirmed correct, not from whichever
branch reached it first. Raised for the Auditor.

The other 6 were this PR's and are fixed above; the sweep now reports 0 on
these scenes.

`npm run typecheck` (`tsc -b tsconfig.json`, both projects) passes.
`eslint` on the ten touched files: **0 errors**, 10 warnings, all pre-existing
(`REACTIONS` colours, the online dot, react-refresh). The one new warning I
introduced — a raw `fill-red-500` on the heart — was removed by using
`fill-primary`, which is what `REACTIONS[0]` already declares a like's colour
to be.
