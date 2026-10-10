# Project prune record — 2026-09-03

## Prune 1 (earlier session) — see previous revision of this file
Duplicate plan document removed (`PHASE_WISE_DEVELOPMENT_PLAN_2026-09-02.md`, duplicate of `PHASEWISE_DEVELOPMENT_PLAN_2026-09-02.md`).

## Prune 2 — Auditor, 10:50Z — reopen the patch courier
Store was 1,998,984 / 2,000,000 tokens; D1's and D3's `format-patch` writes were refused. Deleted 16 docs, every one an exact duplicate of a file already on origin (branch or `staging`) or of content carried inside a `.patch` doc that was kept. Origin is the record for all of them.

| Deleted | Where the bytes live on origin |
|---|---|
| `claude/d2-phase0/fix-04/web-baseline-2026-09-02T12-27-35-946Z-1319760d.ndjson` | PR #133 evidence (D2 lane) |
| `claude/d2-phase0/fix-04/web-baseline.mjs`, `web-baseline.test.mjs`, `fix-04.diff` | `staging` `ca8e989` (#133) |
| `claude/d1-phase0/db-seed-staging.mjs`, `db-seed-staging.test.mjs` | `origin/d1/P0-db-seed-staging-20260902` |
| `claude/d1-phase0/db-baseline.mjs`, `db-baseline.test.mjs`, `db-lane-guard.mjs` | `origin/d1/P0-db-baseline-20260902` |
| `claude/d2-owner-01/source-only.diff` | `staging` `5cd5ba6` (#132) |
| `claude/d2-phase0/p0-inv/d2-P0-client-inventory-20260903.patch`, `client-inventory.md` | `staging` `da9d7d2` (#136), blob `0e0ca8b` |
| `claude/GATE_REGISTER_2026-09-02.md` | `staging/docs/gates/GATE_REGISTER.md` (Rev 6, `08373ba`) |
| `claude/d2-phase0/f60/01-before-fix.txt`, `typecheckIsNotVacuous.test.ts` | inside kept `d2-F60-typecheck-assertion-20260903.patch` |
| `claude/d2-phase0/fix-05/fix-05.diff` | `origin/d2/P0-web-vitals-20260903` (#137) |

After: 1,875,084 / 2,000,000. Kept: every `.patch`, every PR_BODY/MANIFEST, both unlanded baseline `.ndjson` files, all reports.

Rule going forward: a landed artefact's Project copy may be deleted once its PR is merged and the blob id/sha256 is recorded in the register or landing note. Patches are deleted only after `git am` + blob-id verification on origin.
