# P13 — Binding byte ceiling on the entry bundle and per-route chunks

**Gate (GATE_REGISTER, verbatim):** "a byte ceiling on the entry bundle and per-route chunks; a build that
exceeds it **fails, it does not warn**, in the same style as M11."
**Proof type (R-82):** structural — an enforced build step, shown failing first on a real source change.

## The ceiling
- Instrument: `scripts/web-bundle-budget.mjs` (reads `dist/` after `npm run build`; entry/preload/stylesheets are
  resolved from `dist/index.html` by `web-baseline.mjs`'s `resolveEntryFromHtml`, never guessed).
- Contract: `scripts/web-bundle-budget.json` — raw bytes (parse cost on the device; transfer is P15).
- Wiring: `.github/workflows/web-build.yml`, **both** lane jobs, right after the build:
  `--self-test` then the check. Exit 1 over budget. There is no warn mode, no `|| true`, no `continue-on-error`
  (asserted by `src/__tests__/bundleBudget.test.ts`).

| check | measured (origin/staging 64a0d66, staging-lane build, reading 2026-10-04 08:51:16 UTC) | ceiling |
|---|---|---|
| entry `index-*.js` | 1,650,878 B | 1,700,864 B |
| initial = entry + 4 modulepreloads + `index-*.css` | 2,185,034 B | 2,250,752 B |
| any other chunk (.js/.css), default | largest: `index.es` 158,303 · `CinemaJudgeView` 156,157 | 163,840 B (160 KiB) |
| `translations.rest.js` | 498,263 | 514,048 |
| `AdminAnalytics.js` | 413,108 | 425,984 |
| `jspdf.es.min.js` | 385,165 | 397,312 |
| `html2canvas.esm.js` | 201,041 | 207,872 |
| `index.css` | 207,880 | 215,040 |

Ceiling = measured + ~3 %, rounded up to a KiB: a ratchet. Lowering is free; raising is its own reviewed PR.
248 checks in total, 0 failures (`budget-reading-staging-64a0d66.json`). The local build used a placeholder
publishable key; CI's real key is ~200 B longer, inside the 49,986 B entry headroom.

A stale named ceiling (a chunk that no longer exists) **fails** too. That is deliberate: when P12 splits
`translations.rest` per language, that PR must replace the ceiling, not leave one that checks nothing.

## Fail-first (C-34)
| shape | result | UTC |
|---|---|---|
| `--self-test`: 7 temp `dist/` trees (clean, entry over, initial over with every part under, default over, named over, stale named, CSS over) + absent `dist/` | PASS — each failing shape failed, the clean one passed | 2026-10-04 ~08:49 |
| **real source mutant**: a 66 KB string literal appended to `src/main.tsx`, rebuilt | **exit 1** — `entry: assets/index-CAFNESoR.js is 1716888 B, ceiling 1700864 B (over by 16024 B)` and initial over | 2026-10-04 08:51:55 |
| mutant reverted, rebuilt | 248 checks, 0 failures, PASS | 2026-10-04 08:52:25 |
| `src/__tests__/bundleBudget.test.ts` | 12/12 | 2026-10-04 ~08:53 |

## "In the same style as M11"
M11 is not defined in the repository (it appears only inside the P11/P13/P16 gate sentences). Taken here as
what the sentence says around it: a byte budget that is a build failure. **Ask:** Auditor confirms or supplies M11.

## Findings
- **F-D2-10** (from P15): the entry chunk is 1.65 MB raw / ~480 KB Brotli — 76 % of the initial payload. This
  ceiling stops it growing; making it smaller is a separate unit (route-level splitting of what the entry pulls in).
