# Step 22 — Visual QA Matrix Report

**Date**: 2026-04-18
**Viewport**: 1920 × 1080 (devicePixelRatio: 1)
**Harness route**: `/qa/watermark-matrix` (`src/pages/qa/WatermarkQAMatrix.tsx`)
**Methodology**: Component-level harness — renders `<PhaseWatermark>` against the same
mock photo across the full (phase × surface × round) cube. Removes all live-data
variability so the watermark contract itself is the only thing under test.

## Matrix dimensions

| Axis      | Values                                                 | Count |
|-----------|--------------------------------------------------------|-------|
| Phase     | submission_open · voting · judging · result            | 4     |
| Surface   | card · lightbox · cinema                               | 3     |
| Round     | 1 · 2 · 3 · 4 · null                                   | 5     |
| **Total** |                                                        | **60 cells** |

## Gate

> 100% of judging-phase surfaces show overlay; 0% of other phases show it.

## Result: ✅ PASS

| Phase             | Watermark expected | Observed                                                       | Verdict |
|-------------------|--------------------|----------------------------------------------------------------|---------|
| submission_open   | NO                 | 0 / 15 cells render the watermark                              | ✅ PASS |
| voting            | NO                 | 0 / 15 cells render the watermark                              | ✅ PASS |
| judging           | YES                | 15 / 15 cells render the diagonal overlay with correct labels  | ✅ PASS |
| result            | NO                 | 0 / 15 cells render the watermark                              | ✅ PASS |

Round-specific labels in the judging phase observed:
- round=1 → "Round 1 · Scoring"
- round=2 → "Round 2 · Shortlisting"
- round=3 → "Round 3 · Finals"
- round=4 → "Round 4 · Winners"
- round=null → "Judging in Progress"

## Screenshots

- [01-submission_open.png](./01-submission_open.png) — clean grid
- [02-voting.png](./02-voting.png) — clean grid
- [03-judging.png](./03-judging.png) — diagonal overlay on every cell
- [04-result.png](./04-result.png) — clean grid

## Defence-in-depth

This visual gate sits on top of three earlier guards:

1. **Step 19** — single source-of-truth component (`PhaseWatermark`) that
   short-circuits when `phase !== "judging"`.
2. **Step 20** — watermark mounted on all 14 competition photo surfaces; phase
   sourced canonically from `resolvePhase()`.
3. **Step 21** — custom ESLint rule (`competition-watermark/require-phase-watermark`)
   + Vitest snapshots + static surface-coverage guard (CI fails if any of the 13
   tracked surface files stops importing `PhaseWatermark`).

## Reproduction

```bash
# 1. Start preview, navigate to:
#    /qa/watermark-matrix  (viewport 1920×1080)
# 2. Visually verify: only the "PHASE = JUDGING" section shows overlays.
# 3. Run the unit guard:
bunx vitest run src/components/competition/__tests__/PhaseWatermark.test.tsx
# 4. Run the lint guard:
npx eslint src/
```
