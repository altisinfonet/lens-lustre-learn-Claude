# F-101 — the @mention list sliced a row. C-34 register.

The Owner, on Android 1.2.18, typed `@s` in a comment and sent a screenshot: the
suggestion list opens above the input and the entries are cut. *"you damaged all
mention light box which was fix in earlier version."*

**It is not a regression and not a revert of F-53.** `MentionInput.tsx` on `main`
and on `staging` differ by exactly one line — the `custom_url` select widening.
Nothing about size, position or z-index. It has been wrong since the cap was
written; nothing could see it.

## The arithmetic, measured rather than prescribed

| | |
|---|---|
| row height | **44px** — `w-7` avatar (28) + 8px padding top + 8px bottom |
| rows the query can return | **6** (`.limit(6)`) |
| old cap | `maxHeight: 200px` |
| **content band under the old cap** | **198px** — Tailwind preflight is `border-box`, so the list's own 1px border is inside the cap |
| **rows that fit** | **198 / 44 = 4.5** |

Four whole rows and **half a fifth**, sliced through the middle. That is his
screenshot.

### The Auditor's correction, in his words, recorded at his instruction

> "I told you 176px for four rows. That is 4 × 44 and it ignores the box model…
> the list's own 1px border is INSIDE the 176 and the content band is 174, and
> four 44px rows do not fit in 174. That is my mistake and it is the same class
> as every other one I have made today — I did arithmetic on a number without
> reading the box it lives in."

**The prescribed 176 was two pixels short.** The probe caught it on the first run
after the fix: `rowH 44, bandH 176, capIsWholeRows true` — and one row still 1px
out. The cap is **178 = 4 × 44 + 2 × 1**, so the content band is exactly 176.

## Plants

| Plant | State | Result |
|---|---|---|
| CONTROL | 178px cap, 7-member fixture | **all 4 cases: on screen, whole rows ✓** |
| **M1** | cap back to a flat `200px` | **4 cases FAILED** — `4.5 rows fit in the box`, `SLICED Rafael Santos (22px outside)` |
| **M2** | `200px` cap **and** the original 3-member fixture | **ALL CASES ON SCREEN AND EVERY ROW WHOLE** ✗ |
| RESTORED | — | all 4 green |

### M2 is the finding

M2 puts the Owner's exact defect back **with the new whole-row assertion already
in place** and the probe still passes:

```
rows rendered   : 3
scrollable      : False
wholeRowsInBand : 3   capIsWholeRows: True
slicedCount     : 0
==== ALL CASES ON SCREEN AND EVERY ROW WHOLE ====
```

Three members render three rows; three rows are 132px; 132 < 198, so the list
**never scrolls** and the row that gets cut is one that cannot exist. A correct
assertion, structurally unreachable. **Third instance of that shape today** —
after the empty sidebar arrays and the empty `milestones`/`birthdays`/`winners`/
`voting_thumbnails`. The fixture is raised to seven members, all matching `"a"`,
because `.limit(6)` means six is the most rows that can appear and the harness
must be able to reach six.

## Three instrument failures, all found before the fix was believed

1. **The old probe was GREEN on the build the Owner is complaining about** — and
   correctly so. It only ever asked *does the box leave the screen*. A row sliced
   inside a scrolling list is on screen. It now carries a second, independent
   verdict: **is every row wholly inside the list box**, and is the band a whole
   multiple of the row.
2. **A dead measurement inside a live instrument.** Per-item output reported
   `scrollW 0, clientW 0` for every row in real Chromium — because it read
   `scrollWidth`/`clientWidth` off `span[class*=display]`, and a non-replaced
   **inline** element has `clientWidth === 0` by definition. Those numbers could
   never fail. Nobody noticed because the verdict only read the overflow
   figures. Found by the Auditor by accident. Replaced with
   `getBoundingClientRect()`.
3. **The probe's own band was the border box.** Measuring rows against
   `getBoundingClientRect()` said "4 whole rows fit" while the fourth was cut by
   1px — the probe would have blessed a list that still slices. The band is
   `clientTop`/`clientHeight` now: the content box.

The Auditor separately walked every ancestor of the overlay for `overflow` or
`contain` that could clip it. **The list came back empty — nothing above it cuts
it.** The cap was simply not a multiple of the row.
