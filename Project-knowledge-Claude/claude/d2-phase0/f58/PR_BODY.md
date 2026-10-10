# F-58 — `typecheck.yml`: read the Node pin from `.node-version`, stop hard-coding 20

**Unit:** F-58 · **Branch:** `d2/F58-typecheck-node-version-20260903` off `staging` @ `69a7f87` · **Target:** `staging` · **Commit:** `53c8d52`

**Finding (verbatim, register rev 4 §F-58):** `typecheck.yml`, `security.yml` and `health.yml` pin `node-version: 20`; `.node-version` reads `22.22.2`. Found independently by two D2 passes; verified by the Auditor on `main`. D2's file, its own PR.

**Cause, not symptom:** two sources of truth for the Node version. The fix removes one — the workflow now reads `node-version-file: .node-version`, so there is nothing left to drift. Changing `20` to `22` would have been the symptom fix.

## Paths touched
- `.github/workflows/typecheck.yml` — `actions/setup-node@v4` `with:` block only: `node-version: 20` → `node-version-file: .node-version`, plus a dated F-58 comment. **The `tsc` step is untouched:** `run: npx tsc -b tsconfig.json`.
- `docs/evidence/d2/f58/f58-node-pin.md` — new

**Reported, not touched:** `.github/workflows/security.yml` line 40 (D1's file) and `.github/workflows/health.yml` line 54 (Auditor's file) carry the same `node-version: 20`. Their owners' PRs.

Nothing under `supabase/**`, `package*.json`, `scripts/lane-config.*`, `docs/gates/**`, ledger. No other change rides here — not F-60, not the inventory.

## Proof the unchanged command still checks BOTH projects
Run locally under `node v22.22.2` (= `.node-version`), 2026-09-03T07:58Z:

```
npx tsc -b tsconfig.json --listFiles   → 2,459 files · 873 under src/ (app project)
                                          strict project present: vite.config.ts, scripts/lane-config.d.mts · exit 0
npx tsc -p tsconfig.json --listFiles   → 0 files   (control: the solution file has files: [] — without -b it checks nothing; F-52)
```

## Evidence
`docs/evidence/d2/f58/f58-node-pin.md` — VERIFIED (local). **CI run on this PR: pending** — the workflow can only prove it resolves `.node-version` once it runs on origin; the run ID goes in the evidence file the moment the PR has a check. `setup-node` reads the file with the F-47 rule intact (no `${{ }}` in any `run:`).

## Push authority
None on this side (proxy refuses; re-tested 2026-09-03). Delivered as a `git am`-able patch through the transfer channel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017fdB5mybV9pixsM7n9b9Tf
