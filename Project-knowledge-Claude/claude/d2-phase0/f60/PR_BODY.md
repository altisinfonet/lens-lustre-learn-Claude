# F-60 — `typecheckIsNotVacuous.test.ts`: assert the property, not the spelling

**Unit:** F-60 · **Branch:** `d2/F60-typecheck-assertion-20260903` off `staging` @ `69a7f87` · **Target:** `staging` · **Commit:** `c821c18`

**Finding (verbatim, register rev 4 §F-60):** `src/__tests__/typecheckIsNotVacuous.test.ts` fails on `staging` today. It expects `typecheck.yml` to contain `tsc --noEmit -p tsconfig.app.json`; the workflow was deliberately widened to `tsc -b tsconfig.json` (F-52), which checks **both** projects. **The test is stale, not the workflow.** Found by D2 while landing OWNER-01, and **reproduced by the Auditor on pristine `staging` with all changes stashed** — `1 failed | 8 passed` both with and without D2's changes. Correctly kept out of #132. D2's file, its own PR, its own unit.

**Cause, not symptom:** the assertion at `:59` pinned a *spelling* (`--noEmit -p tsconfig.app.json`) rather than the *property* the test exists to protect — that CI's typecheck cannot be vacuous or narrowed. Loosening the regex to also accept `-b` would have been the symptom fix and would have weakened the control. Instead the test now asserts the property directly: exactly one `tsc` `run:` line in `typecheck.yml`; it is build mode over the solution file (`-b`/`--build tsconfig.json`, the only form that follows `references`); it carries no `-p`/`--project` (never narrowed); and `tsconfig.json` still references **both** `./tsconfig.app.json` and `./tsconfig.node.json`. This is *stronger* than before: the old regex would have passed a workflow that ran only the app project.

## Paths touched
- `src/__tests__/typecheckIsNotVacuous.test.ts` — header sentence corrected; test 3 (`:59`) replaced. Tests 1, 2 and 4–9 untouched.
- `docs/evidence/d2/f60/01-before-fix.txt`, `02-after-fix.txt`, `03-planted-workflows.txt`, `README.md` — new

`.github/workflows/typecheck.yml` is **not changed** by this unit; the three planted copies below were temporary and restored byte-identical (`git diff --quiet` clean). `package.json` untouched (window closed). Nothing under `supabase/**`, `scripts/lane-config.*`, `docs/gates/**`, ledger.

## Shown failing before it was accepted as a control
| Step | Result | UTC |
|---|---|---|
| Pristine `69a7f87`, no edits | **1 failed \| 8 passed** — the F-60 failure reproduced | 07:58:58Z |
| Fixed test, real workflow | **9 passed** | 07:59:30Z |
| Planted workflow A — narrowed: `tsc --noEmit -p tsconfig.app.json` | **1 failed \| 8 passed** | 07:59:46Z |
| Planted workflow B — vacuous: `tsc --noEmit -p tsconfig.json` (`files: []`) | **1 failed \| 8 passed** | same run, after A |
| Planted workflow C — bare `tsc --noEmit` (the 2026-08-15 fault) | **1 failed \| 8 passed** | same run, after B |

Each plant is the *unfixed* input of a different kind; the new assertion rejects all three and accepts only the F-52 form. C-34 satisfied — this green could have failed, and did.

## Evidence
`docs/evidence/d2/f60/` — VERIFIED (local vitest, jsdom). Full-suite consequence: the one pre-existing red on `staging` (`typecheckIsNotVacuous › CI runs the same command…`) turns green with no other test touched.

## Push authority
None on this side (proxy refuses; re-tested 2026-09-03). Delivered as a `git am`-able patch through the transfer channel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017fdB5mybV9pixsM7n9b9Tf
