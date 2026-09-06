# F-105 — three holes in the guards I shipped tonight, plus one question nobody asked

Found by the Auditor by **reading the source of all three instruments**, not my
description of them, immediately before merging #196. None blocks the merge —
he checked each against the measurement he was about to run and each answers no,
recorded below. All are follow-ups with D2's name on them.

## I-1 — `tap-targets.mjs`: a scene that renders nothing reads as BETTER

The settle wait returns as soon as two polls agree. On a scene with zero
interactive elements the first two samples are `0` and `0`, so it settles
instantly and scores **0 under 44px**. Against a baseline of 15 that prints

```
BETTER screen-notifications   0 under 44px, baseline 15 — ratchet down
```

and the script then tells the operator to re-record **so the gain is locked in**.
**A crashed scene would be written into the baseline as the standard.**

This is the silent-zero shape the file's own header says it exists because of. I
wrote that header and then rebuilt the hole underneath it.

**Fix:** fail when `found.total` is 0, or materially below a recorded per-scene
total. The baseline must carry the total control count per scene, not only the
failure count — a count of failures cannot distinguish "fixed" from "gone".

**Could not mislead today:** the Auditor re-measures `/notifications` by hand.

## I-2 — `tap-targets.mjs`: measures whether the box is 44px, never whether it can be hit

Nothing reads `after.pointerEvents`. A `::after` with `pointer-events: none` is
a 44px box **no finger reaches**, and this guard calls it compliant.

**Fix:** one line — treat a hit region with `pointer-events: none` as absent.

**Could not mislead today:** `src/index.css` `.tap-44::after` declares no
`pointer-events`, so the area is live. The guard is passing by luck, not by
check, and that is the whole objection.

## I-3 — `mention-overflow.mjs`: an EMPTY list passes

```js
const rowH = items.length ? items[0].rowH : 0;
```

With zero `<li>`: `wholeRowsInBand` null, `capIsWholeRows` null, `slicedCount` 0,
so `sliced` is false and it prints **"on screen, whole rows ✓"**. The overlay
element still exists, so `NOT FOUND` never fires either.

**A regression that renders no names is green.** Third time in one day a zero
has read as a pass — and this one is inside the instrument built for that exact
failure mode, two hours after PLANT M2 proved the same point about the fixture.

**Fix:** require a minimum row count. The fixture serves 7 members and the query
is `.limit(6)`, so **fewer than 4 rows is a failed render, not a pass.**

**Could not mislead today:** the Auditor measured 176/44 = 4 whole rows, 0
sliced, 7 names, by hand on staging.

---

## The question nobody asked: what else does an 8px hit-area overhang touch?

`.tap-44::after` extends up to 8px past the button on every side.

**(a) Clipping.** If any ancestor has `overflow: hidden`, the overflowing part is
clipped and the finger cannot land there — and `getComputedStyle` on a
pseudo-element cannot see that, so the guard would still report 44×44.
**Not answerable by computed style.** `elementFromPoint` at the hit box's
corners is a real check: it asks what a tap at that coordinate actually reaches.

**(b) Overlap.** Where two `.tap-44` controls sit closer than 44px apart, their
hit areas intersect and the later-painted one wins the overlap. **On
`/notifications` the neighbour is DELETE, which is destructive.** A member
aiming at one control and hitting delete is a worse outcome than the small
target this fix was for.

**(b) is cheap and belongs in the ratchet.** Every rect is already collected, so
it is an O(n²) intersection pass per scene, and the ratchet then answers it for
free on every future run rather than once. **This is a question a guard should
keep asking, not a thing to assert once and forget.**

The Auditor measures both on the deployed page after the build ships. If either
is real it is a new red raised by him, not a footnote in mine.

---

# F-106 — `path()` identifies a control by its first two class names. THE AUDITOR'S FINDING.

**Raised by the Auditor, on the register under his name, not a footnote in mine.
Separate item — NOT this PR.**

`tools/uishot/capture.mjs:234` builds a control's identity as
tag + id + **the first two class names**. That is not an identity; it is a
coincidence of authoring order.

**It cannot tell "this control is gone" from "this control's first two class
names changed."** He measured it across 48 combinations — four size variants ×
twelve caller shapes — against the pre-`tap-44` string the baseline holds:

| `tap-44` position | kept by twMerge | signature shifts |
|---|---|---|
| third | 48/48 | **20/48** |
| last | 48/48 | **0/48** |

twMerge keeps the *last* of two conflicting utilities, so an ordinary caller
override deletes the base's copy and everything after it slides forward:

| caller | was | becomes |
|---|---|---|
| `inline-flex items-center` | `button.justify-center.gap-2` | `button.tap-44.justify-center` |
| `flex flex-col` | `button.items-center.justify-center` | `button.items-center.tap-44` |
| `items-start` | `button.inline-flex.justify-center` | `button.inline-flex.tap-44` |
| `flex items-center gap-2` | `button.justify-center.whitespace-nowrap` | `button.tap-44.justify-center` |

**Those are overrides that exist all over this codebase** — `w-full
justify-start`, `flex items-center gap-2`, `items-start`. So the identity
already moves under ordinary cosmetic edits that remove no control at all.

**Why it matters more than the class-order bug it exposed:** a gate that shouts
*"is gone"* at a cosmetic class edit gets re-baselined the third time it cries
wolf — and the run in which somebody finally re-baselines it is the run a real
removal walks through.

**The fix:** a stable key — `data-testid` where one exists, otherwise
tag + accessible name + ordinal — with the class list kept as a **detail beside
the key** rather than being the key.

**And the evidence that it is the real problem, not the class order:** it took
two attempts to place ONE class where the gate would not misread it, and the
second attempt was only known to be wrong because caller shapes were enumerated.
A key that requires that much care to avoid tripping is the wrong key.

---

# F-108 — A HIT REGION CAN CLAIM A NEIGHBOUR'S CENTRE WITHOUT ANY TWO REGIONS INTERSECTING

**Observed, not predicted. One variable, `screen-voting-lightbox`:**

```
STATE A   Close HAS tap-44       button.inline-flex.min-h-11  painted by button.absolute.top-5
STATE B   Close WITHOUT tap-44   button.inline-flex.min-h-11  painted by svg
```

Nothing else changed. Growing Close from 40 → 44 took over a neighbouring
control's centre point.

**The control was already unreachable either way, so the COUNT never moved and
the log looked identical in total. What changed is the CAUSE — and the cause is
now us.** That is the framing the Auditor adopted, and it is why a count is a
poor instrument: it cannot distinguish a defect from a different defect.

## The rule, which is bigger than this button

`.tap-44::after` extends up to **8 px past the control on every side**, so it can
take over a **neighbour's centre point** even when:

- the two painted boxes are nowhere near each other, and
- **no two hit regions intersect at all.**

**The gap table checked hit-region against hit-region. This is hit-region against
a neighbour's CENTRE — a different and weaker condition.** Close passed the first
while failing the second. The gap table was necessary and **not sufficient**.

*Recorded at the Auditor's instruction as his: "I asked for the wrong test. That
is mine, not yours."*

## The second half of the rule, which the same experiment also shows

Whether it *matters* depends on **what was already covering that point.**

In this instance the neighbour was the site nav's search button (`GlobalSearch.tsx:509`),
sitting on the page **behind** a `fixed inset-0` overlay. Both painters — `svg`
before, `button.absolute.top-5` after — were the modal covering the page behind.
**The practical consequence here was nil.**

The mechanism's teeth are elsewhere: on `/notifications`, Delete grows 8 px into
**dead space** with no modal above anything, and the wrong target **destroys
something**.

**So the follow-up check must report the PAINTER, not merely the collision.**
A collision count would have flagged this harmless case and said nothing useful
about the dangerous one.

## The follow-up (not tonight)

`tap-targets.mjs` should ask, for every element carrying a hit region, whether
that region contains any **other control's centre point** — the same loop
already planned for overlaps, with the neighbour's *centre* substituted for the
neighbour's *box*, and reporting **which element actually paints that point.**

It would have caught this before CI did.

---

# F-109 — THE HIT REGION ATE THE LINK WE HAD JUST CREATED

**Measured by the Auditor by hand, on the deployed build, by opening the
lightbox rather than sweeping a screenshot.** `/competitions/monsoon-light-staging-test`
→ a real entry → `/entry/0cdcdfca…/photo/0`.

| Control | painted | hit region |
|---|---|---|
| `Lena Petrov` (the photographer's name) | 68 × 15 | **68 × 15 — NONE. It is an inline link.** |
| `Copy Photo Link` | 111 × 17 | **111 × 44** — grew 13.5 px up and 13.5 px down |

They intersect over **68 × 4 px**. `elementFromPoint` at the centre of that
intersection returns **BUTTON `Copy Photo Link`**.

**So the bottom 4 pixels of the photographer's name now copy a link instead of
opening his profile. The name is 15 px tall. That is 27 per cent of it.**

Read plainly: **we spent the night making that name a link, and then took a
quarter of its target away with the button underneath it.** The harm is small —
a copy instead of a navigation, nothing destroyed — but it is a **measured
regression caused by tonight's work, on the exact element tonight's work
created**, and it is the second time in one night that an enlarged hit region
has cost something.

## THE RULE, IN THE AUDITOR'S WORDS

**A symmetric hit region is the wrong default next to text.**

Text is short and inline links have no region of their own, so **any button that
grows symmetrically next to a name will eat into the name.** Growth should be
**biased into whitespace**.

And `tap-targets.mjs` should ask, for every enlarged region, **both**:

- whether an **ancestor clips it** — F-108; `getComputedStyle` on a
  pseudo-element cannot see an ancestor's `overflow: hidden`, so this needs
  `elementFromPoint` at the region's corners;
- whether it **contains another control's centre, or covers another control's
  box** — F-109.

**Two checks, one walk, and between them they would have caught everything the
Auditor found by hand tonight.**

## The fix (direction, not size)

Grow `Copy Photo Link` **downward only**, or put enough vertical margin between
the caption line and the button that a 44 px region clears the name. **Do NOT
shrink the button back below 44** — the answer is direction, not size.

Proof required after: `elementFromPoint` at the old intersection returns the
**NAME**, or the intersection is gone.

## The lightbox score, so the good news does not bury it

**66 controls, 52 under 44 px, 2 with hit regions, 0 clipped, 1 overlap.**

Item 4 is closed on the names and **wide open on the touch targets**.

---

## C-34 on the two checks, and a fifth fixture gap found doing it

**PLANT F1 — the symmetric region restored on `Copy Photo Link` — did NOT fire
the check at first, and it was right not to.** I had built only the
centre-containment half of what the Auditor asked for. The arithmetic shows why
that misses this defect entirely:

- the name's bottom sits **8 px** above the button (`mt-2`);
- the symmetric region reaches **13.5 px** up — 5.5 px past the name's bottom;
- the name's centre is **7 px** up.

**So it ate the name's bottom pixels without ever reaching its centre.** The
centre test cannot see F-109. The box-overlap half was added, and only reports a
fault when *we* win the contested pixels — if the neighbour still wins them its
target is intact and nothing was stolen.

**Then the completed check stayed silent too, and that is a FIXTURE GAP, not a
passing check.** Measured in `screen-voting-lightbox` with the plant in place:

```
region      top=525  bottom=569   (symmetric, 106x44)
A "Avijit Sheel"  box top=493  bottom=507   vOverlap = 0     ← 18px clear
```

On staging the Auditor measured a **4 px overlap**. The harness has an **18 px
gap** — different entry title, different name length, different line count — so
**the defect cannot occur in this scene.** Fourth time tonight a scene could not
contain the fault it was meant to catch, after the empty sidebar arrays, the
three-name mention fixture, and the missing notifications route.

So the checks were proven **synthetically, on the Auditor's staging geometry** —
a 14 px inline link with a 17 px button 8 px beneath it:

```
PLANT  symmetric .tap-44   →  STEALS 76x5px of the name (28% of its height) and WINS them
FIXED  .tap-44-down        →  no overlap
```

**28% against the 27% he measured by hand.** The check fires on the real
geometry and goes quiet when the direction changes.

**Open, and honestly so: the harness scene still cannot reproduce F-109.** Until
a scene carries the staging spacing, this check is proven in the small and
unexercised in the sweep. That is written here rather than left for the next
person to discover as a silent pass.

### Why these two are NOT ratcheted

The size debt is hundreds of controls old and needs a baseline to stop the
bleeding without demanding an impossible repair. A region that clips, or claims
a neighbour's pixels, is different: **it can only exist where somebody has ADDED
a hit region**, which is new work by definition. There is no legacy to
grandfather. Every one of these is ours and every one fails the run.
