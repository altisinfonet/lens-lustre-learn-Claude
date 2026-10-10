# F-58 — typecheck.yml node pin, evidence — 2026-09-03T07:58:17Z

origin/staging @ 69a7f87: .node-version=22.22.2; typecheck.yml pinned node-version: 20 (line 19); security.yml line 40 and health.yml line 54 carry the same pin — D1's and the Auditor's files, reported not touched.

Change: node-version: 20 -> node-version-file: .node-version. The tsc step is untouched: 'npx tsc -b tsconfig.json'.

Proof the unchanged command checks BOTH projects, run locally under node v22.22.2 (= .node-version):
  npx tsc -b tsconfig.json --listFiles -> 2459 files; app project (src/**) 873; strict project (vite.config.ts, scripts/lane-config.d.mts) 3; exit 0
  control: npx tsc -p tsconfig.json --listFiles -> 0 files (the solution file has files: [] — without -b it checks nothing; F-52)

Strict-project files seen by -b:
  scripts/lane-config.d.mts
  scripts/lane-config.d.mts
  vite.config.ts

CI run on this PR: pending push (no push authority on this side).
