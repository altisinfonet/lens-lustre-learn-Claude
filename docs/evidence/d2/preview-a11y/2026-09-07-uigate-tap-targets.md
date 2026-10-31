# PR #216 — the UI gate's two tap-target findings — D2, 2026-09-07

**Branch:** `d2/ui-gate-tap-targets-20260907`, ONE commit on top of `d5ff9bad`. The five approved commits (`c96e9c6`, `6bc9d2f`, `23f0332`, `f3260d0`, `d5ff9bad`) are untouched — not amended, not rebased; `d5ff9bad`'s tree is byte-identical to the `ea0911d` this lane produced.
**Classification:** VERIFIED — reproduced and cleared with **the gate itself** (`tools/uishot/capture.mjs`, unmodified), plus a geometry probe for the F-109 question the gate does not answer.
**The instrument was not touched.** `capture.mjs` is read and quoted here; the floor did not move.

---

## 1. What the gate reported, reproduced locally before anything was changed

```
✗ screen-discover            android-360 / iphone-390 / app-360
    tap targets too small (12): button.inline-flex.items-center 107x29,
                                button.inline-flex.items-center 71x29, …
✗ screen-feed                android-360 / iphone-390 / app-360
    tap targets too small (2): a.shrink-0.tap-44 36x36, a.shrink-0.tap-44 36x36
✗ journey-create-from-feed   android-360 / iphone-390 / app-360
    tap targets too small (2): a.shrink-0.tap-44 36x36, a.shrink-0.tap-44 36x36
```

`desktop-1280` passes in all three, which is the rule doing what it says: the check runs only when `isMobile`.

The floor, quoted from the gate rather than restated (`capture.mjs:409-412`):

```js
const r = el.getBoundingClientRect();
const long = Math.max(r.width, r.height);
const short = Math.min(r.width, r.height);
if (long < 44 || short < 32) small.push(…);
```

---

## 2. The correction you asked me to make, and one I have to make back

You wrote: *"Ideally use the tap-44-down pattern … rather than the tap-44::after pseudo-element pad, which getBoundingClientRect() (what the gate uses) can't see."*

**`.tap-44-down` is also a `::after` pseudo-element.** `index.css:794-808`:

```css
.tap-44-down { position: relative; }
.tap-44-down::after { content: ""; position: absolute; … min-width: 44px; min-height: 44px; }
```

The two utilities differ only in their anchor — `top: 0` versus `top: 50%` — which is the whole of F-109 and is about *direction*, not about visibility to a rect. Neither is in `getBoundingClientRect()`.

Measured rather than argued. `tap-44-down` was swapped onto the birthday anchor and the sweep re-run:

| what the anchor wore | what the gate reported |
|---|---|
| `tap-44` | `a.shrink-0.tap-44 36x36` — **FAIL** |
| `tap-44-down` | `a.shrink-0.tap-44-down 36x36` — **FAIL** |
| `grid h-11 w-11 place-items-center` | `a.shrink-0.grid 44x44` — **pass** |

So the utility cannot satisfy this gate, whichever of the two is used, and the answer is a **genuinely painted box**. That is not moving the floor; it is meeting it with a real rectangle instead of one only a thumb can find. It does revisit the trade-off `.tap-44`'s own header records — padding "changes the box, so it changes flex/grid sizing around every control it touches" — and the gate is the tie-breaker.

---

## 3. Fix 1 — `/discover`, 12 buttons

`src/components/discover/DiscoverCard.tsx` — `btnBase` gains **`min-h-9`** (36px). The long side was never the problem (107 and 71 both clear 44); `py-1.5` around 11px type gives 29, three under the 32 short-side floor.

**36 rather than 32:** 32 sits exactly on the floor, where one font metric or a sub-pixel rounding puts it back under. Four pixels of margin costs one step of vertical rhythm in a list row and buys a check that stays green for a reason rather than by a hair.

**Pre-existing, and I have not treated it as mine to hide.** The classes predate every commit on this branch; what changed is that `f3260d0` added the `screen-discover` scene, so the sweep photographed the page for the first time. That is the precedent already written into `SummaryTriggerTapTarget.test.ts` — becoming visible is what surfaced the defect, not what caused it — and reverting the scene would put the blindfold back on.

| | before | after |
|---|---|---|
| painted | 107.3×29.4 and 70.7×29.4 | **107.3×36.0** and **70.7×36.0** |
| gate | 12 too small, three viewports | **0** |

## 4. Fix 2 — the birthday strip, 2 anchors

`src/components/feed/TodaysBirthdayStrip.tsx` — the `ProfileLink` wrapper becomes `shrink-0 grid h-11 w-11 place-items-center`. **The avatar is unchanged at 36px**; the box around it is a real 44×44, and a test pins that the picture did not grow.

**Why it fails only now, and it is not a shrink.** With no handle, `ProfileLink` renders a `<span>`, and the gate selects only `button, a[href], [role="button"], input, select, summary`. `c96e9c6` gave these rows a handle, so the wrapper became an `<a href>` — a control — and was measured for the first time. F-103's original fix (`tap-44`, 2026-08) satisfied a thumb and was never visible to this instrument.

| | before | after |
|---|---|---|
| painted | 36.0×36.0 | **44.0×44.0** |
| gate, `screen-feed` + `journey-create-from-feed` | 2 too small each, three viewports | **0** |

---

## 5. The F-109 question the gate does not ask

Enlarging a control is how a neighbouring name loses part of its target. `tools/uishot/tap-target-geometry.mjs` (new) measures at 390×844: the painted box against the gate's own floor, `elementFromPoint` 4px outside each edge, rect intersection against every link **in the same flow**, and whether two enlarged boxes intersect each other.

```
birthday-strip avatar link   44.0x44.0  floor ok   above/below/left: div   right: a -> "Avijit Sheel"
                             top-to-top gaps 69px against a 44px box → 25px clear, 0 self-intersections
/discover row buttons        107.3x36.0 / 70.7x36.0  floor ok  every edge probe returns the row
                             0 overlaps with any link, 0 self-intersections
```

F-103's old note asserted 31px of separation and 23px of clear space with the *36px* box; that arithmetic does not survive a 44px box, so it was re-measured rather than inherited — 69px top-to-top, 25px clear.

**One measurement I am reporting rather than acting on.** The first run flagged three overlaps on `/discover` between the last card's buttons and `MobileBottomNav`'s tabs. Re-measured against the *unchanged* 29px buttons, the same three are there at 19.8px deep instead of 36 — a fixed bar sitting over scrollable content at scroll 0, predating this change, and not the F-109 question (content scrolls out from under a fixed bar; two regions in the same flow do not). The probe now excludes `position: fixed` layers, with that measurement written into the code beside the exclusion so it is not a convenient blind spot.

---

## 6. Everything else, unchanged

- **Full gate sweep:** `node tools/uishot/capture.mjs` — **156 screenshots, 0 problems reported, baseline diff clean against 148 recorded scene/viewport keys.**
- **`src/components/__tests__/TapTargetsArePaintedBoxes.test.ts`** (new) — 5 assertions, **2 red on the unfixed sources**, 5 green after. It reads the floor out of `capture.mjs` rather than restating it, so if the gate's rule ever changes these assertions stop claiming to answer it. Its job is to catch the tidy-up that swaps a painted box back for a pseudo-element pad, which looks like the house pattern and is invisible to CI's own measurement.
- **Whole suite:** 185 files passed, 1 skipped, **2549 passed, 0 failed**. **`tsc -b tsconfig.json`:** exit 0. **ESLint:** 5 problems on the two touched files before and after — none added.
- **Out of scope, as ruled:** the 13 other `.select()` calls missing `custom_url`, and the `dashboard-init/index.ts` server-side fix assigned to D1. Not folded in.
- **Paths touched:** `src/components/discover/DiscoverCard.tsx`, `src/components/feed/TodaysBirthdayStrip.tsx`, `src/components/__tests__/TapTargetsArePaintedBoxes.test.ts` (new), `tools/uishot/tap-target-geometry.mjs` (new), this doc and its two transcripts. **`tools/uishot/capture.mjs` is not modified.** Nothing under `supabase/**`, `scripts/**`, `docs/gates/**`, the ledger or `package*.json`.
- **Push authority:** none on this side. Delivered as a patch; no push attempted.
