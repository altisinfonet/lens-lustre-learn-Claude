# F-108b — the Friends tabs shipped still clipped, because the padding was a constant fitted to one font

## What shipped and what it did

#207 (`34c683b`) put `py-[7px] -my-[7px]` on the Friends tab scroll container and
claimed `cutPx = 0`. The Auditor measured the deployed build
(`index-fu3kMWyk.js`, staging, 1536x639, signed in, real page) and found
**all five tabs at `cutPx = 1.9`** — container 42.1px tall against a 44px
requirement.

## Why my reading disagreed with his

I measured the tab at **31.4** and sized the padding against it: 31.4 + 7 + 7 =
45.4, which clears 44, so `0.0` was an honest reading of a wrong question.
The deployed tab is **28.1**: 28.1 + 7 + 7 = 42.1, short by exactly 1.9.

**I measured one width.** The original A/B ran at 360px only. Asked at 1536 the
same harness reproduces the defect without any change to the app:

```
vw=1536 native   container h=42.5  pad 7/7  margin -7/-7
   Awaited    painted h=28.5   region=44   cutPx=1.5   <<< CLIPPED
   (identical on Friends, Followers, Following)
```

28.5 here against his 28.1 deployed — the same mechanism at a slightly
different font metric, not a number to reconcile by argument.

**This is the third instrument tonight that agreed with itself and disagreed
with the deployed page.** The common shape is not a bad measurement; it is a
measurement taken in the one condition where the answer comes out right.

## The fix — a declared floor, not arithmetic

```
flex items-center min-h-[44px]  overflow-x-auto scrollbar-hide ... py-[7px] -my-[7px]
```

- `min-h-[44px]` — the padding box can never be under 44, **whatever the tab
  measures**. Overflow clips at the padding box, so this is the guarantee.
- `flex items-center` — **not decoration, and the fix fails without it.**
  `.tap-44`'s region is *centred* on its control, reaching `(44 − tabH)/2`
  above and below. A 44px box with the tab at its top still clips 0.75px off
  the top at a 28.5 tab. The floor needs the symmetry to be worth anything.

Bumping 7 to 9 was rejected: it re-fits a constant to today's font and breaks
on the next line-height change.

## Proof — the tab height is FORCED, not trusted

`[role="tab"] { height: N !important; line-height: N !important; padding: 0 }`
at 24, 28, 34 and native, at 360 and 1536. Measured in the **Tabs root frame**,
not viewport coordinates: an avatar settling above the tabs moves every absolute
number below it, and that noise is indistinguishable from the design moving. A
first pass reported a 1.2px shift that was exactly this artefact.

| vw | tabH | cutPx before → after | occupied before → after | tab offset before → after |
|---|---|---|---|---|
| 360 | 24 | 6 → **0** | 36 → 42 (+6.0) | 7 → 10 |
| 360 | 28 | 2 → **0** | 40 → 42 (+2.0) | 7 → 8 |
| 360 | 34 | 0 → **0** | 46 → 46 | 7 → 7 |
| 360 | native 31.4 | 0 → **0** | 43.4 → 43.4 | 7 → 7 |
| 1536 | 24 | 6 → **0** | 48 → 54 (+6.0) | 7 → 10 |
| 1536 | 28 | 2 → **0** | 52 → 54 (+2.0) | 7 → 8 |
| 1536 | 34 | 0 → **0** | 58 → 58 | 7 → 7 |
| 1536 | **native 28.5** | **1.5 → 0** | 52.5 → 54 (+1.5) | 7 → 7.8 |

`cutPx = 0` at every forced height and both widths, including the native 1536
case that reproduces the deployed defect.

## What it costs, stated rather than buried

Where the tab is **under 30px** the floor makes the row 30px, so content below
moves down by `30 − tabH`: **+1.5px at the deployed 28.5**, +6px at a forced 24.
**Nothing moves at 30px or taller** — 360-native (31.4) and forced-34 are
byte-identical before and after.

Guaranteeing a 44px clip window while keeping a sub-44 layout box is not
possible without a negative margin that scales with the shortfall — which is
the same fitted constant wearing a different hat. `overflow-y: clip` with
`overflow-clip-margin` would do it with no layout change at all, but it is
unsupported in Safari and would degrade **silently** back to this bug on
iPhone. The 1.5px is the honest price of a guarantee that holds everywhere.

## Not claimed

- **The deployed reading is the Auditor's**, as before. The proxy denies this
  session `staging.50mmretinaworld.com` (403, org policy), so every
  after-reading here is the harness.
- **Acceptance is unchanged**: five tabs, `cutPx = 0`, on the deployed build,
  measured by him.
- The `pending` tab still does not render in the harness (it is conditional on
  `sentRequests.length > 0`), so four triggers are measured here, not five.
