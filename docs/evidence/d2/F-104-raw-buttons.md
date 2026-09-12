# F-104 — 216 files create controls outside the design system

**Not a footnote. Its own piece of work, days rather than hours, with the real
number in it so nobody rediscovers this in three weeks and files it as new.**

## The measurement

`tools/uishot/tap-targets.mjs`, every interactive element on every harness
scene, at 360 × 800 DPR 3 in a mobile context, hit area measured (the union of
the element's rect and its `::after`, because a 28px icon inside a 44px target
is correct and must pass):

**1212 interactive elements across 48 scenes. 244 under 44px.**

| Scene | under 44 | of |
|---|---|---|
| screen-dashboard | 29 | 57 |
| screen-feed | 20 | 71 |
| journey-create-from-feed | 20 | 71 |
| screen-friends | 11 | 24 |
| screen-notifications | **9** (was 15) | 63 |
| every not-found variant | 7–8 | — |
| mention-list-over-comment-box | 1 | 1 |

Site-wide, and **years old** — nothing tonight created it.

## The cause

**`tap-44` lives in `src/components/ui/button.tsx` and nowhere else. 216 files
under `src/` use a raw `<button>`.**

Measured, not asserted: removing `tap-44` from the shared component moved the
total from 250 to 254. **Four controls.** The shared-component fix — which is
correct, costs nothing, and means every control born from here on is right —
reaches **four of two hundred and fifty**. Every control the Owner cannot tap is
a raw element that never goes near it.

`Notifications.tsx` Back (line ~252), Delete (~149) and Follow back (~123) are
all raw. They carry `tap-44` by the Auditor's explicit ruling — his page, three
controls, `Delete` on every row — and **not as a pattern to copy 216 times.**

## The permanent fix, and why it is not tonight

A lint rule forbidding a raw `<button>` in `src/`, so a control **cannot be
created outside the design system**, and then paying down the 216 files behind
it.

Attempting that tonight would be the largest *build one, damage a hundred* event
of the day: 216 files, every page, at three in the morning, inside a change
already being held for other reasons. The Auditor would block it and he is right
to.

## What holds the line meanwhile

`tools/uishot/tap-targets.baseline.json` — per-scene counts, and the guard fails
only when a scene gets **worse**. A check that fails every scene blocks every PR
for ever and is switched off within a week, and then there is neither the check
nor the fix.

**The baseline is a debt, not a standard.** Every number above zero is a control
somebody cannot reliably tap. Lowering them is the work; a baseline raised to
fit a regression is Standing Rule 19 in reverse.

C-34 — PLANT R1, `tap-44` stripped from one control:

```
WORSE screen-notifications   10 under 44px, baseline 9 — REGRESSION
         28 x 28   button.p-1.-ml-1   Back
```

## Open question, deliberately not decided here

**136 of the 244 are `<a>` text links** — member names, footer links, nav items.
WCAG 2.5.8 exempts a link inline in a sentence from the target-size rule, and
forcing 44px on them would redesign the app *and* fight F-98, which spent today
making every member name a link. The ratchet neither demands nor forgives them;
it only refuses to let the number grow. The rule for text links is the
Auditor's and the Owner's to set.
