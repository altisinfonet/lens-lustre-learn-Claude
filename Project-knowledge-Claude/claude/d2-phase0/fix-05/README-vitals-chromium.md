# fix-05 · d2-web-vitals.yml — install Chromium (F-2 guard follow-up)

**D2 · 2026-09-03T11:15Z · patch on the #137 head `3435636` · commit `a30866b`**

| | |
|---|---|
| Patch | `d2-vitals-chromium-install.patch` — 6,073 B · sha256 `650f6edb63dbc52ed36e50bb518c414e50d7c589a2f6214c29b25abf4bffa545` |
| File blob after | `bb9e17a37b6920bee5af0f0922e6df5dcb91cb51` |
| File blob before (`3435636`) | `abd4c49492935063a5928a060537bf6bbaeadb9f` |
| Applies | `git am` clean on `origin/pr137` (`3435636`) → reproduces blob `bb9e17a3` |
| Diff | `.github/workflows/d2-web-vitals.yml` only — 50 insertions, 5 deletions |

## What changed
1. **Deleted** `PLAYWRIGHT_BROWSERS_PATH: /opt/pw-browsers` and the three comment lines above it that asserted "nothing new is installed here" — the false instructing comment (Standing Rule 21). Playwright now uses its default cache.
2. **Added**, between `Clean install` and `Build the staging lane`, `ui-gate.yml`'s existing pair of steps: `Cache the Playwright browser` (`actions/cache@v4`, `~/.cache/ms-playwright`, key `playwright-chromium-${{ hashFiles('package-lock.json') }}`) and `Install Chromium for Playwright` (three-attempt `npx playwright install chromium`, hard `::error::` and `exit 1` after three). **The two YAML steps are byte-identical to ui-gate.yml's**; only the surrounding comment differs, and it carries the same reasons (cache; retry; no `--with-deps`, because apt hung builds 1107 and 1109 past the job budget).

Nothing else in the file is touched: the guard, the report-only wording, the routes, the artifact upload all stand. No `${{ }}` inside any `run:` (F-47 — checked). YAML parses; step order verified. No dependency change — Playwright is already a devDependency, window closed.

## Before / after
| | Where | Result |
|---|---|---|
| **Before** | CI run **33746276312** (PR #137, head `3435636`), 10:53Z | Guard step `The harness measured something (a malfunction is not a value)` **exit 1** — `::error::the harness did not run: chromium would not launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1234/…` · **0 measured samples** |
| **After** | Local, on this commit, 11:10–11:14Z | `npx playwright install chromium` with the pin removed lands `chromium-1234` **and `chromium_headless_shell-1234`** in `~/.cache/ms-playwright` — precisely the binary the failing run could not find. Harness exit 0; the guard's own node script run **verbatim** against its output: **"6 measured sample(s) … the harness ran"**, exit 0 |

The failing run is the before, per the Auditor — no planted failure needed.

**Observation, not fixed here:** locally, `/feed` produced no measurement (`page.evaluate: Execution context was destroyed, most likely because of a navigation`) while `/` and `/wall` measured 3 runs each. Report-only, and the guard is satisfied by any measurement; raising it as a separate question about the `/feed` route rather than widening this unit.

## State
Workflow-path, so it lands with the F-58/F-60 batch when a push-authorised session exists. Until then **#137 stays open with the guard red — the honest state**, and this patch is the fix waiting on a courier.
