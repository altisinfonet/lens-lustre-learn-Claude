# F-60 — the stale typecheck assertion · evidence

**Branch** `d2/F60-typecheck-assertion-20260903` off `origin/staging` @ `69a7f87` · D2 · 2026-09-03

**Finding (register rev 4):** `src/__tests__/typecheckIsNotVacuous.test.ts:59` asserted the CI workflow matches `/tsc --noEmit -p tsconfig\.app\.json/`. The workflow was widened to `tsc -b tsconfig.json` (F-52, both projects). **The test was stale, not the workflow.**

**Cause, not symptom:** the assertion pinned a *spelling* instead of the *property* the test exists to protect — that the typecheck cannot be vacuous. Fixed by asserting the property: build mode over the solution file (the only form that follows references), no `-p`/`--project` (never narrowed), and the solution file still references both projects.

| Step | File | Result |
|---|---|---|
| Reproduce on pristine `69a7f87` | `01-before-fix.txt` | **1 failed \| 8 passed** — 07:58:58Z |
| After the fix, real workflow | `02-after-fix.txt` | **9 passed** — 07:59:30Z |
| Planted workflow A — narrowed to one project (`-p tsconfig.app.json`) | `03-planted-workflows.txt` | **fails** — 07:59:46Z |
| Planted workflow B — vacuous (`-p tsconfig.json`, `files: []`) | same | **fails** |
| Planted workflow C — bare `tsc --noEmit` (the 2026-08-15 fault) | same | **fails** |
| Workflow restored to `origin/staging` bytes after the plants | — | `git diff --quiet` clean |

Nothing under `.github/workflows/` is changed by this unit; the three plants were temporary and reverted. `package.json` untouched (window closed): test 2 still accepts the script's own `-p tsconfig.app.json`, which is the script, not CI.
