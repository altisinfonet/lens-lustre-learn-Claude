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

## Tap targets

`tools/uishot`'s own sweep, same scene, same viewport:

| | flagged under 44px |
|---|---|
| before (`comments-panel-thread-only` on `origin/staging`) | **17** — including the `▾` reaction caret at **6×17** and the "Like" word at 24×16 |
| after, first capture | 17 — the new heart measured **32×32**, under the floor |
| after, current | **12** |

The heart was fixed to a real **44×44 button with the 32px circle drawn on a
span inside it**, rather than by adding the app's `.tap-44` region. F-109
(recorded in `src/index.css`) is why: a symmetric region next to text took 27%
of a photographer's name in the lightbox. A button that genuinely occupies its
space cannot take a pixel from anything.

**The remaining 12 are pre-existing and are NOT this unit's work** — they carry
the same geometry on `staging`:

- sort selector `93×16`
- `Reply` `33×16` (×4 rows)
- overflow menu `18×18` (×4 rows)
- avatar `ProfileLink` `24×84` (24 wide)

Raised for the Auditor rather than absorbed here. Fixing them means choosing
between `.tap-44` and `.tap-44-down` per control, and F-109 says that choice is
a measurement, not a preference.

---

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

`npm run typecheck` (`tsc -b tsconfig.json`, both projects) passes.
`eslint` on the ten touched files: **0 errors**, 10 warnings, all pre-existing
(`REACTIONS` colours, the online dot, react-refresh). The one new warning I
introduced — a raw `fill-red-500` on the heart — was removed by using
`fill-primary`, which is what `REACTIONS[0]` already declares a like's colour
to be.
