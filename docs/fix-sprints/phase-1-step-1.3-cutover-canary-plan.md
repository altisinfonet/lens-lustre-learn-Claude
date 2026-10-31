# Phase 1 — Step 1.3 — `wallet_transaction()` Cutover Canary Plan

**Mode:** PLAN ONLY. No DB writes, no migrations, no edge-fn deploys, no `p_dry_run` flips, no canary execution.
**Status:** SINGLE FORENSIC AUTHORITY for wallet cutover sequencing from this date forward (per Mandate Rule 5).
**Predecessors:** Step 1.1 grants snapshot; Step 1.2 writer inventory delta.

---

## 1. SUPERSESSION NOTICE — RETIRED DOCUMENTS

The following Phase 1A documents are **RETIRED** as authority sources for cutover sequencing. They remain in-repo as historical evidence ONLY. Any conflict between them and this document is resolved in favor of this document.

| Retired doc | Reason |
|---|---|
| `docs/fix-sprints/phase-1a-step-3-wallet-cutover-plan.md` | Pre-Phase-0 cutover plan; predates `wallet_ledger_apply_v2` shadow infra and HOTFIX-5 deposit RPC. |
| `docs/fix-sprints/phase-1a-step-c-live-canary-plan.md` | Superseded by gift-refund-specific execution plan, then by this consolidated plan. |
| `docs/fix-sprints/phase-1a-step-c-live-gift-refund-canary-execution-plan.md` | Scope limited to gift refund only; this doc covers all four flows. |
| `docs/fix-sprints/phase-1a-step-c-gift-refund-canary-preflight.md` | Preflight only; subsumed into §5 below. |
| `docs/fix-sprints/phase-1a-step-c-gift-refund-canary-preflight-rerun.md` | Same — superseded. |
| `docs/fix-sprints/phase-1a-step-c-path-2-synthetic-gift-refund-probe-plan.md` | Synthetic probe variant — subsumed into §6 dry-run ladder. |
| `docs/fix-sprints/phase-1a-step-c-live-gift-refund-canary-execution.md` | Execution log of a single flow — historical only. |
| `docs/fix-sprints/phase-1a-step-c0-canary-blocker-resolution-plan.md` | Specific blocker resolution — no longer applies post-HOTFIX-5. |
| `docs/fix-sprints/phase-1a-step-c0-canary-blocker-resolution-execution.md` | Same — historical only. |

> **DO NOT** treat any retired doc as live guidance. Open this file instead.
> **DO NOT** edit retired docs to "fix" them — they are evidence.

Live companions (NOT retired): `phase-1a-wallet-authority-backlog.md` (backlog inventory), `phase-1-money-schema-execution-plan.md` (phase plan), `phase-0-rollback-runbook.md` (rollback authority).

---

## 2. SCOPE — FOUR FLOWS

| # | Flow | Entry points | Canonical RPC target |
|---|---|---|---|
| F1 | **Deposit** (Razorpay + PayPal) | `submit-deposit` → `create_pending_deposit`; `razorpay-verify-payment`, `paypal-capture-order` → today: `wallet_transaction` + shadow `wallet_ledger_apply_v2` | future: `complete_deposit()` (Phase 1B) — interim: keep `wallet_transaction` canonical |
| F2 | **Gift send / refund** | `send-gift-credit` → `admin_wallet_credit`; `expire-gift-credits` → `wallet_transaction` (+shadow) | `admin_wallet_credit` (send), `wallet_transaction` (refund/expiry) |
| F3 | **Vote / Unvote** | `cast-photo-vote` → `wallet_transaction` (4 sites) + shadow `wallet_ledger_apply_v2` | `wallet_transaction` |
| F4 | **Admin withdrawal** | `admin-process-withdrawal` → `wallet_transaction` (2 sites) + shadow | `wallet_transaction` (interim) — future: `request_withdrawal` for user-side initiation (backlog #2) |

All four flows are **already** routed through canonical RPCs as their primary path. The cutover work is therefore:
(a) **retire the shadow v2 path** (drop the `wallet_ledger_apply_v2` parallel call) only after drift = 0 for the soak window, and
(b) **close the remaining direct-table writes** identified in Step 1.2 §5 (Δ-A through Δ-D).

---

## 3. EXIT CRITERIA (per flow)

A flow is "cutover-complete" only when ALL of the following hold:

1. Zero direct DML on `wallets` / `wallet_transactions` / `withdrawal_requests` / `gift_credits` / `gift_announcements` from the flow's entry points (verified by `rg` scan).
2. All money mutations traverse one of: `wallet_transaction`, `admin_wallet_credit`, `create_pending_deposit`, `approve_deposit`, or (when shipped) `request_withdrawal` / `complete_deposit` / `admin_reject_wallet_transaction`.
3. `wallet_ledger_v2_diff_report('72 hours')` returns zero non-`ok` rows for the flow's reference types.
4. `wallet_reconciliation_log` has zero non-zero drift rows for affected users in the soak window.
5. `db_audit_logs` shows one audit row per money mutation; no orphans.

---

## 4. CANARY LADDER (sequential — no parallelism)

Each step requires explicit user `GO` before execution. No step auto-chains.

```
L0  Pre-flight probe (read-only)            ── 0 risk
L1  Dry-run synthetic (p_dry_run=true)      ── 0 risk; shadow only
L2  Single-row staging canary               ── 1 row, refundable
L3  10-row staging canary                   ── 10 rows, refundable
L4  Production canary, single user, $1     ── reversible via paired refund
L5  Production canary, 1 % traffic, 24 h    ── monitored against drift report
L6  Production cutover, 100 % traffic      ── shadow v2 still ON
L7  Retire shadow v2 path                   ── only after 72 h of L6 with 0 drift
```

**Per-flow assignment:**

| Flow | Where it sits today | Next ladder step |
|---|---|---|
| F1 Deposit (live) | L6 (canonical primary; shadow ON) | L7 candidate after Step 1.5 drift verdict |
| F2 Gift send/refund | L6 (canonical primary; shadow ON) | L7 candidate after Step 1.5 drift verdict |
| F3 Vote/Unvote | L6 (canonical primary; shadow ON) | L7 candidate after Step 1.5 drift verdict |
| F4 Admin withdrawal | L6 (canonical primary; shadow ON) | L7 candidate after Step 1.5 drift verdict |
| Δ-A `AdminTransactions` reject | L0 — RPC not built | L1 after `admin_reject_wallet_transaction` ships |
| Δ-B `request_withdrawal` cutover | L0 — RPC not built | L1 after RPC ships |
| Δ-C Bulk gift cutover | L0 — bulk path not extended | L1 after `send-gift-credit` bulk extension ships |
| Δ-D Hard-delete soft-void | L0 — patch not built | L1 after soft-void patch ships |

---

## 5. PRE-FLIGHT GATES (must all be GREEN before any L≥1 step)

1. **Phase 0 guardrails still active** — `audit-forbidden.yml` wallet/RLS globs present; ESLint `no-as-any-in-protected-dirs` passes on `src/hooks/wallet/**`. Re-verify via CI run, not by inspection.
2. **HOTFIX-5 48 h soak verdict = SAFE** — confirm in `docs/security-hotfixes/hotfix-5-48h-soak-monitor.md`.
3. **HOTFIX-6 status** — required GREEN before L7 of any flow (legacy `"System can insert *"` policies must be dropped).
4. **`wallet_reconciliation_log` zero drift** for the prior 24 h — read-only check.
5. **Backup confirmed** — Lovable Cloud daily backup exists within last 24 h.
6. **Rollback runbook open** — `phase-0-rollback-runbook.md` in chat / current view.

If ANY gate is red → STOP. Do not advance.

---

## 6. ROLLBACK PER LADDER STEP

| Step | Rollback |
|---|---|
| L0 | None needed (read-only). |
| L1 | None needed (`p_dry_run=true` writes nothing). |
| L2 / L3 | Manual reversal `wallet_transaction` with negated amount + paired reference; verify reconciliation log zero. |
| L4 | Same as L2 + refund the $1 + post-mortem entry in `wallet_reconciliation_log`. |
| L5 | Disable canary flag (server-side env var); existing rows reconciled via L4 procedure. |
| L6 | Revert deploy to prior edge-fn version (Lovable Cloud rollback); shadow path remains as fallback. |
| L7 | Re-enable shadow v2 path (revert the single migration that REVOKEs / disables it). Drift report should immediately resume populating. |

---

## 7. WHAT THIS PLAN EXPLICITLY DOES NOT DO

- Does **NOT** authorize execution of any ladder step. Every step requires an explicit `GO PHASE 1 STEP 1.3 L<n> FLOW <Fx>` command.
- Does **NOT** modify any RPC, table, policy, or edge function.
- Does **NOT** flip any `p_dry_run` flag.
- Does **NOT** retire the shadow v2 infrastructure (that is Step 1.5 work).
- Does **NOT** drop the legacy RLS policies (that is HOTFIX-6).
- Does **NOT** ship `request_withdrawal`, `complete_deposit`, or `admin_reject_wallet_transaction` (those are separate per-RPC plans).

---

## 8. AUTHORITY CHAIN

```
Mandate (forensic-engineering-mandate.md)
   └── Phase 1 plan (phase-1-money-schema-execution-plan.md)
         └── Step 1.1 grants snapshot         [evidence]
         └── Step 1.2 writer inventory delta  [evidence]
         └── Step 1.3 cutover canary plan     ◀── THIS DOC (authority for sequencing)
         └── Backlog (phase-1a-wallet-authority-backlog.md)  [per-item detail]
```

Retired Phase 1A canary/cutover docs (§1) sit OUTSIDE this chain.

---

## 9. VERIFIED / NOT VERIFIED / RISKS / ROLLBACK / NEXT

**VERIFIED:** Current writer routing (§2) confirmed by Step 1.2 §3 live `rg` scan. Canonical RPC presence (§2) confirmed by Step 1.1 §4.
**NOT VERIFIED:** Current `wallet_ledger_v2_diff_report` drift count; HOTFIX-5 final verdict timestamp; HOTFIX-6 status.
**FILES TOUCHED:** This doc only.
**RISKS:** None — plan only, no execution.
**DIFF SUMMARY:** +1 markdown file; supersession notice retires 9 prior docs as authority sources (files NOT deleted).
**VERIFICATION PROOF:** Cross-reference to Step 1.1 §3/§4 and Step 1.2 §3.
**ROLLBACK:** `rm docs/fix-sprints/phase-1-step-1.3-cutover-canary-plan.md` restores prior (retired) docs to default authority — explicitly NOT recommended.
**NEXT RECOMMENDED STEP:** Await user `GO` on first L0 pre-flight for a specific flow, OR proceed to ship one of Δ-A / Δ-B / Δ-C / Δ-D (each requires its own plan doc before execution).
