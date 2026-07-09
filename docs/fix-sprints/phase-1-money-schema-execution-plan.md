# Phase 1 — Money & Schema — Forensic Execution Plan

> **Mode:** PLANNING ONLY. No DB writes, no migrations, no edge-function deploys, no wallet mutations performed in producing this document.
> **Source of truth:** Current repo state + live DB inspection (read-only) on 19 May 2026.
> **Governing mandate:** `docs/forensic-engineering-mandate.md` (Rules 1–5).
> **Predecessor:** Phase 0 — Freeze & Guardrails (CLOSED, see `phase-0-completion-report.docx`).

---

## 1. Verified Current State (Read-Only DB + Repo Probe)

### 1.1 What is ALREADY completed from earlier wallet/RLS work
Evidence: `information_schema` probes + `docs/fix-sprints/phase-1a-*` artifact set.

| # | Item | Evidence | State |
|---|------|----------|-------|
| A | Single canonical `wallet_transaction()` RPC exists | `pg_proc` row present | ✅ shipped (Phase 1A) |
| B | Shadow-mode `wallet_ledger_apply_v2` RPC exists | `pg_proc` row present | ✅ shipped (Phase 1A shadow infra) |
| C | Shadow / diff infra tables: `wallet_ledger_shadow_log`, `wallet_ledger_v2_rows`, `wallet_ledger_v2_diff_log`, `wallet_ledger_idempotency`, `wallet_ledger_audit_log` | `information_schema.tables` | ✅ shipped |
| D | Reconciliation infra: `wallet_reconciliation_log`, gift/referral drift RPCs, atomic backfill fixers, admin UI | mem://features/wallet/reconciliation-phase2.3 | ✅ shipped |
| E | Unvote 2× penalty UX + atomic `cast-photo-vote` enforced; legacy vote fns deleted | mem://features/wallet/unvote-penalty-ux + reconciliation-phase2.2 | ✅ shipped |
| F | `status_legacy` column already dropped project-wide | `information_schema.columns` returns 0 | ✅ shipped |
| G | Diff parity migration (Path A, fix-3) executed; 72h shadow diff monitor + cron | phase-1a-step-c-fix-3 + step-b-cron-diff | ✅ shipped |
| H | Live gift/refund canary executed | phase-1a-step-c-live-gift-refund-canary-execution.md | ✅ shipped |
| I | Wallet write guardrail (ESLint `no-direct-wallet-ledger-writes`) + baseline | `eslint-rules/` + sprint-0-phase-0b-2 | ✅ shipped (Phase 0) |
| J | RLS authority scan + schema drift scan wired into CI | `.github/workflows/audit-forbidden.yml` | ✅ shipped (Phase 0) |
| K | Shadow-ledger `42501` triage documented as expected (Phase 0 closure) | phase-1a-wallet-authority-backlog.md | ✅ closed |

### 1.2 What is STILL pending for Phase 1 closure

| # | Item | Why it's pending | DB-touching? |
|---|------|------------------|--------------|
| P1 | **Cutover**: route all writers (edge fns + RPCs) exclusively through `wallet_transaction()` and retire `wallet_ledger_apply_v2` shadow path | RPC exists but shadow mode still active per `phase-1a-step-3-wallet-cutover-plan.md` | YES (deploy + REVOKE) |
| P2 | **REVOKE direct DML** on `wallets` + `wallet_transactions` from all non-`service_role` roles; force all writes through RPCs | `role_table_grants` audit needed live; ESLint guardrail blocks *new* writes but DB still permits | YES (REVOKE) |
| P3 | **`competition_entries.current_round_int`** generated column + backfill + dual-read; eventually drop the text column | Live probe confirms column does NOT exist; current_round still TEXT (`'round2'`/`'r3'`/`'4'`) — see mem://judging/current-round-text-format | YES (ALTER + backfill) |
| P4 | **Type regen + remove `as any` in wallet hooks** (Phase 2 prep, but starts here for hook surfaces touching `wallet_transaction`) | Baseline freeze in place; cleanup not started | NO (frontend only) |
| P5 | **72-hour post-cutover shadow-diff window** at zero drift, then drop shadow tables | Cutover gate | YES (DROP, after window) |
| P6 | **Doc refresh + memory update**: retire `wallet_ledger_apply_v2` references | follow-up | NO |

### 1.3 Verified state probes captured for this plan
- `wallet_transaction` and `wallet_ledger_apply_v2` both present in `pg_proc`.
- `wallets` + `wallet_transactions` grants currently show only sandbox + standard Supabase roles (no `anon`/`authenticated` DML observed in this probe — needs full per-grantee enumeration in P2 audit).
- `competition_entries.current_round_int` → does NOT exist.
- `status_legacy` → does NOT exist (already retired).

---

## 2. Phase 1 Sub-Steps (Execution Order)

Each step is independently shippable and independently reversible. **Never run two steps in the same PR.**

### Step 1.1 — Pre-Cutover Live Grants Audit (READ ONLY, no risk)
- **Action:** Enumerate every grant on `wallets`, `wallet_transactions`, `wallet_ledger_*` for `anon`, `authenticated`, `service_role`, plus every SECURITY DEFINER caller.
- **Output:** `docs/fix-sprints/phase-1-step-1-1-grants-snapshot.md`.
- **DB writes:** none. **Risk:** 0. **Rollback:** n/a.
- **Audits required first:** none (this IS the audit).

### Step 1.2 — Edge-Function Writer Inventory (READ ONLY)
- **Action:** `rg -n "wallet_ledger_apply_v2|from\\(.?wallet_transactions.?\\)|from\\(.?wallets.?\\)" supabase/functions/` and classify each hit as: (a) shadow-only, (b) legitimate via RPC, (c) direct write to retire.
- **Output:** `docs/fix-sprints/phase-1-step-1-2-writer-inventory.md`.
- **DB writes:** none. **Risk:** 0. **Rollback:** n/a.

### Step 1.3 — Synthetic Cutover Canary Plan (PLAN ONLY)
- **Action:** Re-use the proven `phase-1a-step-c-live-gift-refund-canary-execution.md` harness; design a `wallet_transaction()`-only canary for: deposit, gift send, gift refund, vote, unvote-penalty, admin withdrawal.
- **Output:** `docs/fix-sprints/phase-1-step-1-3-cutover-canary-plan.md`.
- **DB writes:** none. **Risk:** 0.

### Step 1.4 — Cutover Migration (P1, FIRST DB-TOUCHING STEP)
- **Action:** Single migration that (a) routes each writer edge fn to call only `wallet_transaction()`, (b) deprecates `wallet_ledger_apply_v2` to raise NOTICE + dual-write for 72h.
- **Pre-step audits:**
  1. Step 1.1 grants snapshot signed off
  2. Step 1.2 writer inventory signed off
  3. Step 1.3 canary plan signed off
  4. Latest 72h drift report from `wallet_ledger_v2_diff_log` = **zero non-equivalent rows**
  5. `wallet_reconciliation_log` shows zero open orphans
- **Rollback:** Re-deploy previous edge fn bundle (Lovable History one-click) + restore `wallet_ledger_apply_v2` direct path by reverting the deprecation NOTICE; no data restore needed because shadow log is still live.
- **Verification:** Re-run canary harness post-deploy; diff_log must remain zero for 72h.

### Step 1.5 — REVOKE Direct DML (P2)
- **Action:** `REVOKE INSERT, UPDATE, DELETE ON wallets, wallet_transactions FROM anon, authenticated` (and any non-RPC role surfaced by Step 1.1). RLS already in place; this hardens defence-in-depth.
- **Pre-step audits:** Step 1.4 must be green for ≥24h with zero drift.
- **Rollback:** `GRANT INSERT ON ... TO authenticated` (single SQL line; reversible in <60s).
- **Verification:** Re-run `scripts/audits/rls-authority-scan.mjs`; expect zero new wallet write permissions.

### Step 1.6 — `current_round_int` Generated Column (P3)
- **Action:** `ALTER TABLE competition_entries ADD COLUMN current_round_int int GENERATED ALWAYS AS (NULLIF(regexp_replace(current_round, '\\D', '', 'g'), '')::int) STORED;` + index. Dual-read in hooks. Defer text column DROP to Phase 2.
- **Pre-step audits:**
  1. Enumerate every regex/cast of `current_round` in repo and edge fns.
  2. Confirm zero NULL/non-numeric values: `SELECT count(*) FROM competition_entries WHERE current_round IS NOT NULL AND regexp_replace(current_round,'\\D','','g') = '';`
- **Rollback:** `ALTER TABLE ... DROP COLUMN current_round_int;` — generated column, no data loss.
- **Verification:** `SELECT current_round, current_round_int FROM competition_entries LIMIT 50;` matches expectation.

### Step 1.7 — 72-Hour Zero-Drift Window
- **Action:** Watch `wallet_ledger_v2_diff_log` + `wallet_reconciliation_log` for 72 consecutive hours, zero non-equivalent rows.
- **DB writes:** none.

### Step 1.8 — Retire `wallet_ledger_apply_v2` + Shadow Tables (P5)
- **Action:** `DROP FUNCTION wallet_ledger_apply_v2(...)`. Mark shadow tables READ-ONLY but **do not drop** until Phase 6 (Decommission). This preserves forensic trail.
- **Rollback:** `CREATE OR REPLACE FUNCTION wallet_ledger_apply_v2 ...` from the most recent migration source-controlled in `supabase/migrations/`.

### Step 1.9 — Phase 1 Completion Report
- **Action:** Produce `phase-1-completion-report.docx` mirroring Phase 0 format.

---

## 3. Risk Ranking

| Step | Risk | Blast Radius | Reversibility |
|------|------|--------------|---------------|
| 1.1 / 1.2 / 1.3 / 1.7 / 1.9 | **None** | n/a | n/a |
| 1.4 Cutover | **HIGH** | Every wallet writer | One-click Lovable History + shadow path intact |
| 1.5 REVOKE | **MEDIUM** | Defence-in-depth; runtime should be unaffected if 1.4 is clean | Single GRANT line |
| 1.6 current_round_int | **LOW** | Read additions only; generated column | DROP COLUMN, no data loss |
| 1.8 DROP shadow RPC | **LOW** (only after 72h zero drift) | Removes safety net | Re-create from migration history |

---

## 4. Required Audits BEFORE Each DB-Touching Step

| Step | Required audits |
|------|-----------------|
| 1.4 | 1.1 + 1.2 + 1.3 signed off; 72h diff_log zero; reconciliation orphans zero; full grants snapshot |
| 1.5 | Step 1.4 ≥24h green; `rls-authority-scan.mjs` re-run; no edge fn relies on direct DML |
| 1.6 | Full repo grep of `current_round` regex/cast paths; zero non-numeric values in column |
| 1.8 | 72h post-cutover zero-drift window proven; reconciliation orphans zero |

---

## 5. Rollback Plan Summary (Per Step)

| Step | Rollback action | Time-to-restore |
|------|-----------------|-----------------|
| 1.4 | Lovable History revert edge fn bundle + revert deprecation NOTICE migration | < 5 min |
| 1.5 | `GRANT INSERT,UPDATE,DELETE ON wallets, wallet_transactions TO authenticated;` | < 60 sec |
| 1.6 | `ALTER TABLE competition_entries DROP COLUMN current_round_int;` | < 60 sec |
| 1.8 | Recreate function from migration source | < 5 min |

All steps preserve `wallet_ledger_shadow_log` until Phase 6 — forensic trail intact even on full rollback.

---

## 6. Acceptance Criteria

1. Every wallet writer in the repo calls `wallet_transaction()` exclusively (verified by ESLint guardrail + grep).
2. `wallets` + `wallet_transactions` direct DML denied for `anon` + `authenticated` (verified by `rls-authority-scan.mjs`).
3. `competition_entries.current_round_int` populated for 100% of rows where `current_round IS NOT NULL`; dual-read live in code.
4. 72 consecutive hours of zero entries in `wallet_ledger_v2_diff_log` after cutover.
5. `wallet_ledger_apply_v2` dropped; shadow tables retained read-only.
6. Phase 1 completion report produced and acknowledged.

---

## 7. What Must NOT Be Touched (Frozen Surfaces)

- `wallet_reconciliation_log` (Phase 2.2/2.3 forensic trail).
- `wallet_ledger_shadow_log` (until Phase 6).
- `cast-photo-vote` action contract (unvote penalty UX is locked — see mem://features/wallet/unvote-penalty-ux).
- Notification triggers + emit log (Phase 5 notification backbone is the only legal email path).
- Judging vocabulary / progression_decision / v3_stage_catalog.
- Per-photo consensus RPC contract.
- `auth.*`, `storage.*`, `realtime.*`, `supabase_functions.*`, `vault.*` schemas.
- Anything outside `wallets`, `wallet_transactions`, `wallet_ledger_*`, `competition_entries.current_round*`.

---

## 8. GREEN / HOLD Recommendation

### Recommendation: **GREEN — proceed to Step 1.1 (read-only grants audit) ONLY.**

Rationale:
- Phase 0 guardrails are live (ESLint + CI + baselines).
- `wallet_transaction()` already exists and `wallet_ledger_apply_v2` is in proven shadow mode.
- Step 1.1 is read-only and zero-risk.
- All DB-touching steps (1.4 / 1.5 / 1.6 / 1.8) **remain HOLD** until their predecessor read-only audits are complete and explicitly approved by the operator with a written GO command per step.

**HOLD conditions that would block Step 1.4:**
- Any non-zero entries in `wallet_ledger_v2_diff_log` over the latest 72h.
- Any open row in `wallet_reconciliation_log` not classified as expected/legacy.
- Any writer surfaced in Step 1.2 that cannot be routed through `wallet_transaction()` (e.g., bulk admin tool).
- Any operator change to the unvote penalty contract or notification backbone.

---

## 9. Next Recommended Operator Command

`GO PHASE 1 STEP 1.1` — triggers the read-only grants snapshot. No DB writes. No edge fn changes. No risk.

Subsequent steps require an explicit per-step `GO PHASE 1 STEP 1.X` command. No step auto-chains.
