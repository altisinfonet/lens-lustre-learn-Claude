# P23 clause 2 · axe-core ratchet inside the UI gate — evidence

**Unit:** P23 clause 2 ("automated checks in CI") · **Lane:** D2 · **Date:** 2026-10-05 (UTC) · **Decision:** `../DECISION.md` §1 (WCAG 2.2 AA), §3 C1–C6.

## What runs
- `npm run ui:gate` → `tools/uishot/capture.mjs` runs **axe-core 4.13.0** (exact devDependency; package-lock.json and bun.lock) once per harness scene at **iphone-390**, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, `resultTypes: violations`, **no rule disabled**.
- `tools/uishot/axe-ratchet.mjs` `compareAxe()` judges per-scene/per-rule node counts against `tools/uishot/axe.baseline.json`. The gate FAILS on: count up · new rule · clean (`{}`) scene dirty · new scene dirty · count down without the baseline lowered · baseline scene not run (full sweep) · axe threw.
- `--lower <axe-current.json>` only lowers; it refuses a raise, a new rule, a new dirty scene. `--self-test` (17 cases) runs as its own step in `ui-gate.yml`.
- `src/__tests__/axeRatchetWired.test.ts` asserts the pin, tags, viewport, that axe's verdict reaches the exit code, and that the workflow never lowers the baseline.
- Every run writes `/tmp/shots/axe-current.json` (counts + every failing node's selector and HTML), uploaded with the screenshots artefact.

## Baseline = DECISION.md §2A, re-measured by the gate itself
`axe-measured-20261005T0747Z.json`: **37 nodes in 11 of 50 scenes**, rule-for-rule equal to §2A (button-name 15, link-name 11, label 4, aria-required-children 2, link-in-text-block 2, nested-interactive 2, color-contrast 1).

## Shown failing first (C5)
| step | where | result |
|---|---|---|
| 0 · no baseline committed | local, 2026-10-05 07:47 UTC | RED — `axe baseline has no scenes object — refusing to pass against nothing` (`local-0-no-baseline-RED.txt`) |
| 1 · mutant: `<button>` with only an `<svg>` added to `calendar-plain` (commit 4d2074d) | local 07:48–08:02 UTC | RED — `calendar-plain: CLEAN scene now has 1 button-name violation(s)` + the node (`local-1-mutant-RED.txt`) |
| 1 · same commit | **CI run 37281480621, job 111670338657**, finished 08:18 UTC | **RED**, same line, exit 1 — https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/37281480621/job/111670338657 |
| 2 · mutant reverted | local 08:06–08:20 UTC | GREEN — 37 in 11, `axe ratchet: clean against the baseline`, tsc 0, vitest 3027/0 (`local-2-reverted-GREEN.txt`) |
| 2 · same | CI | see PR checks on the revert head |

The ratchet's judge was also mutated by hand while writing it (removing the "went DOWN" branch makes the self-test report `✗ count down, baseline not lowered → fail`); the 17 self-test cases are the standing proof.

## Not covered here
Production routes (C7) are a report-only monitor, not part of this gate. Clause 3 (ten-surface keyboard + screen-reader walkthrough) is hands-on and not started.
