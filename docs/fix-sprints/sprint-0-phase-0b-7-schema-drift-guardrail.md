# Sprint 0 — Phase 0B-7: Migration / Schema Drift Guardrail

> **Status:** ✅ GUARDRAIL ACTIVE — non-runtime, detection only.
> **Mandate:** Forensic Engineering Mandate (Rules 1–5) fully enforced.
> Zero migrations executed, zero schema edits, zero RPC modifications.

---

## 1. VERIFIED FINDINGS

A read-only forensic scan of every SQL file under `supabase/migrations/**`
(466 files at scan time) was executed via
`scripts/audits/schema-drift-scan.mjs`. The scanner enforces nine forbidden
migration patterns and produces two frozen baselines.

| # | Pattern | Type token | Existing count |
|---|---|---|---:|
| 1 | DROP COLUMN on protected table | `DROP_PROTECTED_COLUMN` | included in 8 |
| 2 | ALTER COLUMN ... TYPE on protected col | `ALTER_PROTECTED_COLUMN_TYPE` | 0 |
| 3 | RENAME COLUMN on protected table | `RENAME_PROTECTED_COLUMN` | included in 8 |
| 4 | Destructive enum mutation (DROP/RENAME VALUE) | `DESTRUCTIVE_ENUM_MUTATION` | 0 |
| 5 | Drop of `status` / `current_round` / `progression_decision` / `placement` | `DROP_STATUS_COLUMN` | included in 8 |
| 6 | New SECURITY DEFINER function not in baseline | `SECDEF_NEW` | n/a (213 frozen) |
| 7 | DISABLE ROW LEVEL SECURITY on protected table | `RLS_DISABLED_PROTECTED` | 0 |
| 8 | DROP POLICY on protected table | `DROP_POLICY_PROTECTED` | included in 8 |
| 9 | RPC signature change / removal vs baseline | `RPC_SIGNATURE_CHANGED` / `RPC_REMOVED` | n/a (224 frozen) |

**Schema baseline totals:** 8 destructive findings · 213 SECDEF functions ·
2 enums · 224 RPC signatures.

A clean re-run after seeding returns `✅ 0 NEW schema drift events`.

---

## 2. NOT VERIFIED ITEMS

- **Live database state** was not queried — baselines are derived from the
  migration source-of-truth only. Drift between live DB and migrations is
  out of scope for 0B-7.
- **Per-finding intent classification** for the 8 pre-existing destructive
  entries (legitimate refactor vs accidental drop) is NOT performed — this
  phase freezes the status quo only.
- **PR-level "show only the diff" mode** is intentionally absent. CI gates
  on the *full-tree* delta vs baseline; new violations are flagged regardless
  of which migration introduced them. This is more conservative than a
  diff-only scanner.

---

## 3. FILES TOUCHED

| File | Action |
|---|---|
| `scripts/audits/schema-drift-scan.mjs` | **created** (~290 lines, read-only scanner) |
| `scripts/audits/baselines/schema-contract-baseline.json` | **created** (8 destructive + 213 SECDEF + 2 enums) |
| `scripts/audits/baselines/rpc-contract-baseline.json` | **created** (224 RPC signatures) |
| `.github/workflows/audit-forbidden.yml` | **edited** (+12 lines: new step "Migration / Schema drift guardrail (Phase 0B-7)") |
| `docs/fix-sprints/sprint-0-phase-0b-7-schema-drift-guardrail.md` | **created** (this report) |

**No** SQL migration was created or modified. **No** ESLint config, runtime
code, hook, edge function, RLS policy, or RPC was touched.

---

## 4. RULE IMPLEMENTED

`scripts/audits/schema-drift-scan.mjs` enforces the nine patterns above.
Detection is regex-based over CREATE/ALTER/DROP statements. The
`PROTECTED_TABLES` / `PROTECTED_COLUMNS` arrays at the top of the scanner are
the single oracle for what counts as "sensitive" — extending coverage is a
one-line edit.

The scanner runs in three modes:

```bash
node scripts/audits/schema-drift-scan.mjs           # CI mode (exit 1 on new drift)
node scripts/audits/schema-drift-scan.mjs --write   # regenerate both baselines
node scripts/audits/schema-drift-scan.mjs --json    # raw findings for tooling
```

---

## 5. BASELINES CREATED

### `scripts/audits/baselines/schema-contract-baseline.json`
- `protected_tables` — 33 entries (wallet, judging, notifications, roles, etc.)
- `protected_columns` — 22 entries (`amount`, `balance`, `status`,
  `current_round`, `progression_decision`, `placement`, etc.)
- `enums` — 2 frozen enum value sets
- `secdef_functions` — 213 frozen `(name, signature)` pairs
- `destructive_findings` — 8 pre-existing destructive statements (frozen as
  legacy; new ones beyond this set fail CI)

### `scripts/audits/baselines/rpc-contract-baseline.json`
- 224 RPC signatures (latest `CREATE OR REPLACE FUNCTION` per name).
  Signature normalization keeps the *positional argument types* only, so
  arg-name renames are permitted but *type/arity* changes are caught.

Both files are sorted by stable keys to keep diffs reviewable.

---

## 6. PROTECTED CONTRACTS

The full lists are in the baseline JSON; key entries below.

**Protected tables (subset):** `wallet_transactions`, `wallet_balances`,
`wallet_reconciliation_log`, `transactions`, `payouts`, `gifts`, `referrals`,
`earnings`, `orders`, `judge_decisions`, `judge_scores`, `judge_sessions`,
`judge_assignments`, `competition_entries`, `competitions`,
`photo_verification_requests`, `v3_stage_catalog`, `notifications`,
`user_notifications`, `notification_emit_log`, `email_queue`, `user_roles`,
`db_audit_logs`, `activity_logs`, `certificates`, `entry_public_status`.

**Protected columns:** `amount`, `balance`, `currency`, `status`,
`current_round`, `progression_decision`, `placement`, `user_id`, `judge_id`,
`competition_id`, `entry_id`, `decision`, `score`, `tier`, `stage_key`,
`tag_label_canonical`, `verification_status`, `auto_expired`, `declared_at`,
`locked_at`, `indexing_disabled`, `is_active`.

**Frozen RPC contract (224 functions):** sample includes
`current_phase(uuid)`, `get_per_photo_consensus(uuid,text)`,
`emit_notification(...)`, `get_progression_drift_admin(...)`,
`get_placement_drift_admin(...)`, `cast_photo_vote(...)`,
`backfill_judging_notifications(...)`, `has_role(uuid,app_role)`, etc.

---

## 7. SYNTHETIC FAILURE TEST RESULT

A throwaway migration `99999999999997_synthetic_phase0b7_fail.sql` planted
five high-impact patterns. Scanner output:

```
[schema-drift-scan] ❌ 5 NEW schema drift event(s):
  HIGH     DROP_PROTECTED_COLUMN        ...:2  → public.wallet_transactions.amount
  CRITICAL DROP_STATUS_COLUMN           ...:3  → public.competition_entries.status
  CRITICAL DESTRUCTIVE_ENUM_MUTATION    ...:4  → public.app_role
  CRITICAL RLS_DISABLED_PROTECTED       ...:5  → public.judge_decisions
  HIGH     DROP_POLICY_PROTECTED        ...:6  → public.wallet_transactions::some_policy
```

Exit code: **1**. Synthetic file removed; clean re-scan returned `✅ 0 NEW`.
All five patterns proven detectable end-to-end.

---

## 8. APPROVED MIGRATION TEST RESULT

A throwaway migration `99999999999996_synthetic_phase0b7_pass.sql` performed
**only additive, non-destructive operations**:
- `CREATE TABLE IF NOT EXISTS public.something_new_unrelated`
- `ALTER TABLE ... ADD COLUMN created_at`
- `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'newrole_test'`

Scanner output:

```
[schema-drift-scan] ✅ 0 NEW schema drift events. baseline { destructive=8, secdef=213, enums=2, rpcs=224 }
EXIT=0
```

Approved additive migration correctly **not flagged**. File removed.

---

## 9. FINAL LINT/CI RESULT

- `node scripts/audits/schema-drift-scan.mjs` → exit 0 on clean tree.
- New CI step wired into `.github/workflows/audit-forbidden.yml` immediately
  after the Phase 0B-6 RLS authority step and before the v3 Stage Catalog
  parity step. YAML parses cleanly (`yaml.safe_load` OK). The job already
  runs on every push and PR.
- No existing CI step renamed, removed, or reordered.

---

## 10. DIFF SUMMARY

```
A scripts/audits/schema-drift-scan.mjs                                 (~290 lines)
A scripts/audits/baselines/schema-contract-baseline.json               (8 destructive + 213 secdef + 2 enums)
A scripts/audits/baselines/rpc-contract-baseline.json                  (224 RPCs)
A docs/fix-sprints/sprint-0-phase-0b-7-schema-drift-guardrail.md       (this file)
M .github/workflows/audit-forbidden.yml                                (+12 lines, 1 new step)
```

---

## 11. RISKS

| # | Risk | Mitigation |
|---|---|---|
| R1 | False positive when a future migration *intentionally* drops a deprecated column on a protected table | `--write` regenerates baseline; reviewer must approve the JSON diff in the PR |
| R2 | RPC signature normalization may treat `text` vs `varchar` as different | Both forms are stored verbatim; if drift is benign, baseline regen accepts it |
| R3 | The 213-entry SECDEF baseline is large; reviewers may rubber-stamp regenerations | Each `--write` prints counts; PR diff shows exact `+name(signature)` lines |
| R4 | Scanner is regex-based and does not understand SQL semantics (e.g. `IF EXISTS`, transactions) | Conservative-by-design — flags any match; whitelisting is explicit |
| R5 | A migration that drops then re-adds a column in the same file would produce one detected `DROP_*` finding | Acceptable: human reviewer confirms intent before regen |

**No runtime risk.** Scanner is read-only, runs only in CI, and never
executes SQL or touches DB state.

---

## 12. ROLLBACK PLAN

```bash
rm scripts/audits/schema-drift-scan.mjs
rm scripts/audits/baselines/schema-contract-baseline.json
rm scripts/audits/baselines/rpc-contract-baseline.json
rm docs/fix-sprints/sprint-0-phase-0b-7-schema-drift-guardrail.md
# In .github/workflows/audit-forbidden.yml: remove the
# "Migration / Schema drift guardrail (Phase 0B-7)" step
# (12-line contiguous block immediately above the v3 Stage Catalog parity step).
```

Zero DB / runtime / policy / RPC state to revert. No migrations to roll back.

---

## 13. PHASE 0 COMPLETION STATUS

| Phase | Title | Status |
|---|---|---|
| 0A | Freeze guardrails inventory | ✅ |
| 0B-1 | `no-as-any-in-protected-dirs` | ✅ |
| 0B-2 | Wallet/ledger write guardrail | ✅ |
| 0B-3 | Entry status source-of-truth guardrail | ✅ |
| 0B-4 | Realtime channel filter guardrail | ✅ |
| 0B-5 | Edge function authority guardrail | ✅ |
| 0B-6 | RLS / SECURITY DEFINER authority guardrail | ✅ |
| **0B-7** | **Migration / Schema drift guardrail** | ✅ (this phase) |

**Phase 0 (freeze + guardrail wave) is now COMPLETE.** Every protected
subsystem (wallet, judging, RLS, edge authority, realtime, schema/RPC,
entry status, types) has a CI-enforced "fail on new drift" gate with a
frozen baseline and proven synthetic-fail detection. The codebase is now
ready for Phase 0C remediation work without risk of additional regressions
sneaking in alongside fixes.

---

## 14. NEXT RECOMMENDED STEP

Two options:

1. **GO 0C-1** — Begin first remediation under the freeze: migrate the
   `AdminTransactions.tsx` direct `wallet_transactions` UPDATE (highest
   severity from 0B-2 baseline) behind a server-side edge function with
   audit log + idempotency. Strict diff-captured, single-target, all 7
   guardrails active.

2. **GO 0C-PLAN** — Produce a single consolidated remediation roadmap that
   ranks every entry across the 6 baselines (wallet, RLS, schema, edge,
   realtime, entry-status) by severity × subsystem-criticality, and
   proposes the safe ordering for Phase 0C/0D fix sprints.

Recommended: start with **GO 0C-PLAN** so each subsequent fix lands in the
optimal order rather than ad-hoc per-finding. Awaiting explicit go-signal.
