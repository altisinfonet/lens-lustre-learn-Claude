# Phase 1A · Step C · Fix 5b — Path B Quarantined Probe Execution Report

**Date:** 2026-05-18
**Verdict:** 🛑 **HOLD — Path B not executed.** See §7 for forced-stop reason.
**Live `gift_refund` canary:** 🛑 **STILL ON HOLD** — not authorised.

---

## 1. Why Path B is lower safety than Path A (Rule-2 honest disclosure)

| Dimension                         | Path A (psql + BEGIN/ROLLBACK)                            | Path B (Lovable-run)                                        |
|-----------------------------------|------------------------------------------------------------|--------------------------------------------------------------|
| Transaction boundary              | True `BEGIN ... ROLLBACK;` — Postgres-level guarantee      | None — Lovable's `migration` tool **auto-commits per call** |
| Rollback guarantee                | Mathematical (WAL-level)                                   | Manual `DELETE` of probe rows (logical, not transactional)  |
| Side-effect window                | Zero — never visible outside the txn                       | Probe rows visible & committed for ~seconds before cleanup  |
| Cleanup failure mode              | Impossible — txn never commits                             | If cleanup `DELETE` fails, rows persist in production tables|
| Authority level needed            | Operator with DB credentials                               | Lovable's service-role DB access                            |

**Conclusion:** Path B can be made *very* safe but **cannot be made equal to Path A**. Anyone claiming "Path B = Path A safety" is guessing. I am not making that claim.

---

## 2. Forensic discovery (read-only — no writes performed)

I read the **live source of `public.wallet_ledger_apply_v2`** (full 157 lines) via `pg_get_functiondef` and verified the following:

### 2.1 The function has ZERO direct financial impact — even with `p_dry_run = false`

Exact source quotes (lines 55–62, 105–107):

```
-- MIRROR MODE (Phase 1A · C.fix-3 · Option A):
-- Legacy wallet_transaction() is the authoritative balance writer.
-- Therefore v_balance_before already reflects the post-legacy authoritative
-- balance. Do NOT re-apply p_amount here; p_amount is preserved as a
-- column in wallet_ledger_v2_rows for downstream reconciliation.
v_balance_after := v_balance_before;
...
-- F. LIVE PATH — append-only insert into wallet_ledger_v2_rows ONLY.
--    NO update on wallets. NO insert into wallet_transactions.
```

**Translation in plain English:**
- The function **NEVER updates `wallets.balance`**.
- The function **NEVER inserts into `wallet_transactions`** (the real money ledger).
- In live mode it only appends rows to three **internal shadow/audit tables**:
  1. `wallet_ledger_v2_rows`
  2. `wallet_ledger_idempotency`
  3. `wallet_ledger_audit_log`
- In dry-run mode it appends to `wallet_ledger_shadow_log` + `wallet_ledger_audit_log` only.

### 2.2 Triggers on those tables: **ZERO**
Verified live via `information_schema.triggers` for `wallet_ledger_v2_rows`, `wallet_ledger_idempotency`, `wallet_ledger_audit_log`, `wallet_ledger_shadow_log`. Empty result set. **No async fan-out possible** (no pg_net, no NOTIFY, no email).

### 2.3 Implication
The probe — whether dry-run or live — would have caused **exactly $0.00 of financial impact**, even without any rollback or cleanup. The only "footprint" is rows in 3 internal log tables.

---

## 3. Proposed probe design (NOT executed)

If executed, the design would have been:

### 3.1 Quarantined synthetic user (no real account, no wallet, no profile)
- `probe_user_id = '00000000-5b5b-4b5b-8b5b-cfix5bpathb01'::uuid` (synthetic, deterministic, has no row in `wallets`, no row in `auth.users`, no row in `profiles`)
- Because no `wallets` row exists, `v_balance_before = 0` (handled by function line 54), so even the read path is a no-op.
- **No real user, admin, or customer wallet touched.**

### 3.2 Idempotency keys (all prefixed)
- `cfix5b_pathb_probe_p1_dry_<uuid>`
- `cfix5b_pathb_probe_p2_live_<uuid>`

### 3.3 Pre-state queries (read-only — SAFE to run, would have been run)
```sql
SELECT COUNT(*) FROM wallet_ledger_v2_rows      WHERE idempotency_key LIKE 'cfix5b_pathb_probe_%';
SELECT COUNT(*) FROM wallet_ledger_idempotency  WHERE idempotency_key LIKE 'cfix5b_pathb_probe_%';
SELECT COUNT(*) FROM wallet_ledger_audit_log    WHERE idempotency_key LIKE 'cfix5b_pathb_probe_%';
SELECT COUNT(*) FROM wallet_ledger_shadow_log   WHERE idempotency_key LIKE 'cfix5b_pathb_probe_%';
SELECT user_id, balance FROM wallets WHERE user_id = '00000000-5b5b-4b5b-8b5b-cfix5bpathb01';
-- All expected to return 0 / no row.
```

### 3.4 Probe steps
- P1: `wallet_ledger_apply_v2(..., p_dry_run := true)` — writes 1 row to `wallet_ledger_shadow_log` + 1 row to `wallet_ledger_audit_log`.
- P2: `wallet_ledger_apply_v2(..., p_dry_run := false)` — writes 1 row each to `wallet_ledger_v2_rows`, `wallet_ledger_idempotency`, `wallet_ledger_audit_log`.
- P4: `SELECT … FROM wallet_ledger_v2_diff_log ORDER BY ran_at DESC LIMIT 5;` (read-only)
- P5: `SELECT wallet_ledger_v2_diff_report('1 hour'::interval);` (read-only — function body verified SELECT-only)

### 3.5 Cleanup (the blocking step — see §7)
```sql
DELETE FROM wallet_ledger_v2_rows      WHERE idempotency_key LIKE 'cfix5b_pathb_probe_%';
DELETE FROM wallet_ledger_idempotency  WHERE idempotency_key LIKE 'cfix5b_pathb_probe_%';
DELETE FROM wallet_ledger_audit_log    WHERE idempotency_key LIKE 'cfix5b_pathb_probe_%';
DELETE FROM wallet_ledger_shadow_log   WHERE idempotency_key LIKE 'cfix5b_pathb_probe_%';
```

### 3.6 Post-state proof
Re-run the §3.3 counts → all must be 0. Re-confirm `wallets` row for synthetic UUID still does not exist.

---

## 4. Pre-state table

**NOT CAPTURED** — execution stopped before any DB calls were made (see §7).

## 5. Probe execution results

**NOT EXECUTED.**

## 6. Post-state / cleanup proof

**NOT APPLICABLE.**

---

## 7. Forced STOP — why this returns HOLD

Your mandate stated, verbatim:

> *"If Lovable cannot guarantee cleanup/reversal without unsafe direct writes, then STOP and return HOLD."*

The cleanup step (§3.5) requires **four `DELETE` statements against production tables**, even though:
- The rows are clearly tagged (`cfix5b_pathb_probe_%`)
- The tables are internal audit/shadow, not financial
- No triggers exist on them
- The synthetic user owns zero financial state

A `DELETE` against any production table is a **direct write**. The probe rows would also be **committed for ~2–5 seconds** between the P2 write and the cleanup DELETE — during which any concurrent process scanning these tables (the cron diff at HH:00, an admin opening `/admin/wallet-health`, the `wallet_ledger_v2_diff_report` RPC) **would see them**.

Path A (`BEGIN ... ROLLBACK`) makes that visibility window structurally impossible. Path B cannot. **Per your own mandate, this is the HOLD condition.**

---

## 8. Per-gate verdict

| Gate | Status | Reason                                                                                   |
|------|--------|------------------------------------------------------------------------------------------|
| P1   | HOLD   | Not executed — Path B halted before any DB call                                          |
| P2   | HOLD   | Not executed — Path B halted before any DB call                                          |
| P4   | HOLD   | Not executed *(safe to read, but withheld for clean per-gate ledger)*                    |
| P5   | HOLD   | Not executed                                                                              |
| P6   | GREEN  | Previously verified (function shape) — unchanged                                          |
| Cron-5h diff | GREEN | Previously verified — 5/5 rows clean, no alerts — unchanged                          |

**Live `gift_refund` canary: 🛑 HOLD.** No authorisation.

---

## 9. What was changed in the project

**NOTHING.** Verified scope:
- ✅ No DB writes performed
- ✅ No migrations created
- ✅ No edge functions modified
- ✅ No `p_dry_run` flags flipped anywhere
- ✅ No cron jobs altered
- ✅ No broad audits added
- ✅ Only one new file created: this report

---

## 10. Your three honest options to unblock

**Option α — Authorise the targeted DELETE cleanup explicitly (downgrades safety contract).**
Reply: *"I authorise Path B with targeted DELETE cleanup on the 4 listed log tables filtered by `cfix5b_pathb_probe_%`. I accept the 2–5 second visibility window. Proceed."*
Then I run §3.3 → §3.5 → §3.6 and post all-GREEN if clean.

**Option β — Switch to Path A (true ROLLBACK, requires psql).**
You install `psql` (15 min, OS-specific steps in my previous message), paste output. Full safety guarantee.

**Option γ — Accept Option 2 waiver (already-collected cron evidence only).**
Reply: *"I accept the Option 2 waiver: P6 + 5h cron evidence is sufficient. Proceed to live canary."*
I write the waiver doc, then fire the single `gift_refund` canary per plan.

---

## 11. My recommendation

**Option β (Path A).** You have already invested days of forensic discipline into Phase 1A. The 15-minute `psql` install is the smallest possible cost to preserve that discipline. Skipping it now is the moment where projects break their own safety contracts and later regret it.

But the call is yours. State `α`, `β`, or `γ` and I act.
