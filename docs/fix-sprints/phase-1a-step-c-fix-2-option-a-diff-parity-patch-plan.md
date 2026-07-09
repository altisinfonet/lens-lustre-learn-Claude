# Phase 1A — Step C.fix-2: Branch-F Option-A + Diff Parity Patch Plan

> **Mode:** PLAN ONLY. No SQL execution, no DB mutation, no deploy, no `p_dry_run` flip, no cron change, no live canary.
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Source of truth:**
> - `docs/fix-sprints/phase-1a-step-c-branch-f-balance-after-audit.md` (C.fix-1)
> - `docs/fix-sprints/phase-1a-step-c-fix-1b-diff-snapshot-drift-sub-audit.md` (C.fix-1b)
> **Authorised gates:** R1 = Option A · R2 = YES · R4 = DEFER.

---

## 0. SAFETY ATTESTATION

| Gate | Status |
|---|---|
| 100% SAFE | ✅ (plan only) |
| ZERO DAMAGE | ✅ |
| ZERO SIDE EFFECT | ✅ |
| ZERO FAN-OUT | ✅ |
| ZERO RECURSION | ✅ |
| SQL executed this step | NONE |
| DDL this step | NONE |
| Rollback needed this step | N/A |

---

## 1. SCOPE (exactly three functions touched, in one migration)

| # | Function | Change class | Caller diff? |
|---|---|---|---|
| 1 | `public.wallet_ledger_apply_v2` | one-line algebra fix (Option A) + comment | ❌ none |
| 2 | `public.wallet_ledger_v2_diff_report(interval)` | add `balance_after` pairing + counter + verdict gate | ❌ none |
| 3 | `public.wallet_ledger_v2_diff_snapshot(interval)` | mirror (2) inside the persisted snapshot + verdict gate | ❌ none |

Out of scope (DEFER, not touched in this patch):
- `wallet_ledger_v2_drift_report` (counters dashboard, no joins — confirmed in C.fix-1b §3.3)
- R3 `p_source_path` branching (forward-compat only — C.fix-1 §1.2)
- **R4** `diff_snapshot` alert-noise gate (`unmatched_*` paging) — **EXPLICITLY DEFERRED per authorised gates.**
- Edge function callers (`expire-gift-credits`, `vote`, `unvote_penalty`, `deposit_credit`, `vote_payout`) — **zero diffs** by construction of Option A.
- Cron schedules — unchanged.
- `p_dry_run` flips — unchanged (`expire-gift-credits` stays in current mode until C.fix-3 canary rerun).

---

## 2. PATCH 1 — `wallet_ledger_apply_v2` (Option A)

### 2.1 Exact before/after (single line, section C)

**BEFORE (verbatim, from `pg_get_functiondef`, C.fix-1 §1.3):**

```sql
-- C. Read current balance (no mutation)
SELECT COALESCE(balance, 0) INTO v_balance_before
  FROM public.wallets WHERE user_id = p_user_id;
IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;
v_balance_after := v_balance_before + p_amount;
```

**AFTER (one-line algebra change + leading comment block):**

```sql
-- C. Read current balance (no mutation)
SELECT COALESCE(balance, 0) INTO v_balance_before
  FROM public.wallets WHERE user_id = p_user_id;
IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;
-- MIRROR MODE: legacy wallet_transaction() is authoritative. Do not apply
-- p_amount to wallet balance here. p_amount is transaction metadata only.
-- v_balance_before was read AFTER the legacy commit (ordering proven in
-- docs/fix-sprints/phase-1a-step-c-branch-f-balance-after-audit.md §1.4),
-- therefore it already reflects the post-legacy authoritative balance.
v_balance_after := v_balance_before;
```

### 2.2 What does NOT change

- Function signature, language, volatility, SECURITY DEFINER, search_path — all unchanged.
- Sections A, B, D, E, F — unchanged (including the `INSERT INTO wallet_ledger_v2_rows` column list and value list in F).
- Audit log writes, shadow log writes, idempotency row writes — unchanged.
- Return JSON shape — unchanged.
- All five caller edge functions — **zero diffs**.

### 2.3 Algebraic justification

- Ordering is proven deterministic: legacy `wallet_transaction()` commits at T+0, `wallet_ledger_apply_v2` runs at T+~234 ms (C.fix-1 §1.4).
- `v_balance_before := wallets.balance` therefore equals `wallet_transactions.balance_after` of the paired legacy row.
- Storing `v_balance_after := v_balance_before` makes `wallet_ledger_v2_rows.balance_after == wallet_transactions.balance_after` by construction.
- `p_amount` is preserved as a column in `wallet_ledger_v2_rows` (unchanged), so the reconciliation invariant `v2.balance_after - prev_v2.balance_after == v2.amount` remains checkable downstream.

### 2.4 NOT included (intentional)

- The `LEDGER_DELTA_MISMATCH` race-assertion sketched in C.fix-1 §8 is **not** part of this patch — gate authorises Option A only. Tracked as a follow-up (C.fix-2b, optional) so this patch stays one-line / zero-blast-radius.

---

## 3. PATCH 2 — `wallet_ledger_v2_diff_report(interval)`

### 3.1 Pre-patch schema confirmation (must run before SQL is drafted)

Single read-only check (NOT part of the patch, executed during C.fix-3 dry-write):

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='wallet_ledger_v2_rows'
  AND column_name IN ('idempotency_key','balance_after','user_id','amount','op');
```

Required result: `idempotency_key text/uuid NOT NULL`, `balance_after numeric`. If `idempotency_key` is nullable on any row in window → use fallback (§3.4).

### 3.2 Pairing strategy

**Preferred (primary):** join `wallet_ledger_v2_rows` to the existing `pairs` CTE on `idempotency_key`.
- `wallet_ledger_shadow_log.idempotency_key` (already present)
- `wallet_ledger_v2_rows.idempotency_key` (present per audit residue)
- One-to-one by construction (`wallet_ledger_idempotency` enforces uniqueness).

**Fallback (only if §3.1 finds nulls):** match by `(user_id, amount, abs(created_at − captured_at) within 5s)`.
- **Fallback risk:** weaker key; collisions possible for identical-amount ops in same window → could cross-pair and mask a real `balance_after` mismatch. Documented here; primary key is preferred.

### 3.3 Exact additions (additive; existing fields unchanged)

**BEFORE — current matched-pairs SELECT (C.fix-1 §1.6, C.fix-1b §3.1):**

```sql
LEFT JOIN LATERAL (
  SELECT * FROM l
   WHERE l.user_id = s.user_id
     AND l.amount  = s.amount
   ORDER BY abs(extract(epoch FROM (l.created_at - s.captured_at)))
   LIMIT 1
) l ON true
```

**AFTER — add v2-rows lateral and project two balance_after columns:**

```sql
LEFT JOIN LATERAL (
  SELECT * FROM l
   WHERE l.user_id = s.user_id
     AND l.amount  = s.amount
   ORDER BY abs(extract(epoch FROM (l.created_at - s.captured_at)))
   LIMIT 1
) l ON true
LEFT JOIN LATERAL (
  -- PRIMARY: idempotency_key 1:1 join (preferred, see §3.2)
  SELECT v.balance_after AS v2_balance_after
    FROM public.wallet_ledger_v2_rows v
   WHERE v.idempotency_key = s.idempotency_key
   LIMIT 1
) v2 ON true
```

**Add to the projection (alongside existing `*_mismatch` fields):**

```sql
,l.balance_after          AS l_balance_after
,v2.v2_balance_after      AS s_balance_after
,(v2.v2_balance_after - l.balance_after) AS balance_after_delta
```

**Add to the aggregator (alongside existing counters):**

```sql
,count(*) FILTER (
   WHERE live_id IS NOT NULL
     AND v2_balance_after IS NOT NULL
     AND v2_balance_after IS DISTINCT FROM l_balance_after
 ) AS balance_after_mismatch
```

**Verdict gate (AND-included, NOT replacing existing terms):**

```sql
-- BEFORE
v_safe := (v_mismatch_count = 0)
      AND (v_error_count = 0)
      AND (v_unmatched_live = 0)
      AND (v_unmatched_shadow = 0);

-- AFTER
v_safe := (v_mismatch_count = 0)
      AND (v_error_count = 0)
      AND (v_unmatched_live = 0)
      AND (v_unmatched_shadow = 0)
      AND (v_balance_after_mismatch = 0);   -- NEW: R2 gate
```

**Return JSON additions (additive, no field renamed/removed):**

```json
{
  "...existing fields...": "...",
  "balance_after_mismatch": <int>,
  "max_balance_after_delta": <numeric|null>
}
```

### 3.4 Fallback documentation (only if §3.1 finds nulls)

Replace the v2 lateral with:

```sql
LEFT JOIN LATERAL (
  SELECT v.balance_after AS v2_balance_after
    FROM public.wallet_ledger_v2_rows v
   WHERE v.user_id = s.user_id
     AND v.amount  = s.amount
     AND abs(extract(epoch FROM (v.created_at - s.captured_at))) < 5
   ORDER BY abs(extract(epoch FROM (v.created_at - s.captured_at)))
   LIMIT 1
) v2 ON true
```

Risk: ambiguous pairing for identical-amount ops within 5 s. If §3.1 confirms NOT NULL `idempotency_key`, do NOT ship the fallback.

---

## 4. PATCH 3 — `wallet_ledger_v2_diff_snapshot(interval)`

### 4.1 Mirror Patch 2 inside the persisted snapshot

- Add the **same** v2-rows lateral (§3.3) into `diff_snapshot`'s matched-pairs SELECT.
- Compute `v_balance_after_mismatch` the same way.
- Persist `balance_after_mismatch` and `max_balance_after_delta` into the JSON written to `wallet_ledger_v2_diff_log` (additive columns inside the existing `report jsonb` payload — no DDL on the log table).

### 4.2 Snapshot verdict — must AND-include the new counter

```sql
-- AFTER
v_safe_for_shadow_wiring := (v_mismatch_count = 0)
                       AND (v_error_count = 0)
                       AND (v_unmatched_live = 0)
                       AND (v_unmatched_shadow = 0)
                       AND (v_balance_after_mismatch = 0);  -- NEW: R2 gate
```

This ensures the snapshot **cannot** log GREEN / `safe_for_shadow_wiring=true` if any paired row has `balance_after` drift.

### 4.3 Alert paging — R4 DEFERRED

**Per authorised gates, the `v_alert` expression in `diff_snapshot` is NOT modified in this patch.**

Current expression (kept as-is):
```sql
v_alert := (v_mismatch_count > 0) OR (v_error_count > 0)
        OR (v_unmatched_live > 0) OR (v_unmatched_shadow > 0);
```

Consequence (accepted): admin_notifications will continue to fire hourly while wiring is partial. New `balance_after_mismatch` will naturally be reflected via `v_mismatch_count` propagation only if Step C.fix-2b adds it; for this patch, balance_after drift is surfaced **in the report JSON and in the `v_safe_for_shadow_wiring` gate** but does not independently page. This is intentional and matches the DEFER directive.

### 4.4 What does NOT change in `diff_snapshot`

- Volatility (`VOLATILE`), SECURITY DEFINER, search_path, signature.
- Writes restricted to `wallet_ledger_v2_diff_log` + `admin_notifications` (no wallet/ledger writes introduced).
- `wallets_checksum` calculation — unchanged.

---

## 5. WHAT IS NOT CHANGED ANYWHERE (negative-space inventory)

- `wallets` table — no writes added.
- `wallet_transactions` table — no writes added.
- `wallet_ledger_v2_rows` table — no writes added, no schema change.
- `wallet_ledger_idempotency` table — no change.
- `wallet_ledger_audit_log` table — no change.
- `wallet_ledger_shadow_log` table — no change.
- `wallet_ledger_v2_diff_log` table — no schema change (additive JSON keys only).
- `admin_notifications` — no change to writers; no new paging path (R4 deferred).
- `wallet_ledger_v2_drift_report` — not touched.
- All five edge-function callers — not touched.
- Cron schedules — not touched.
- RLS / GRANT — not touched.

---

## 6. ROLLBACK PLAN

Single migration file with three `CREATE OR REPLACE FUNCTION` statements (Patches 1, 2, 3). Rollback = a second migration that runs the **inverse** `CREATE OR REPLACE FUNCTION` block restoring the verbatim pre-patch bodies captured in C.fix-1 §1.3 and C.fix-1b §3.1 / §3.2.

- No DDL on tables → rollback is pure function-body revert.
- No data migration → no data rollback needed.
- Idempotent: re-running rollback is a no-op.
- Time-to-rollback target: < 60 s (single migration apply).

Pre-patch function bodies are already preserved in the C.fix-1 / C.fix-1b audit docs and will be re-captured verbatim into the migration commit message at C.fix-3 time.

---

## 7. SYNTHETIC PROBE PLAN (must pass before live canary rerun)

All probes run inside an explicit `BEGIN; … ROLLBACK;` in a throw-away DB session against operator wallet only. No production state mutated.

| # | Probe | Setup | Action | Pass criteria |
|---|---|---|---|---|
| P1 | Dry-run idempotence | none | call `wallet_ledger_apply_v2(... p_dry_run := true, p_amount := -0.01)` | returns `ok=true`; **no** row in `wallet_ledger_v2_rows`; returned `balance_after == wallets.balance` (NOT `balance − 0.01`) |
| P2 | Live ordered mirror | `BEGIN` | (a) `SELECT wallet_transaction(..., type:='gift_expiry', amount:=-0.01)` → records to legacy; (b) `SELECT wallet_ledger_apply_v2(..., p_dry_run := false, p_amount := -0.01)` | new v2 row's `balance_after` equals `wallets.balance` AND equals the paired `wallet_transactions.balance_after` → drift = 0 |
| P3 | Diff-report parity | after P2 (still in txn) | `SELECT wallet_ledger_v2_diff_report('5 minutes')` | `amount_mismatch=0`, `balance_after_mismatch=0`, `max_balance_after_delta=0`, `safe_for_shadow_wiring=true` |
| P4 | Diff-report regression detection | inject fake drift: manually `UPDATE wallet_ledger_v2_rows SET balance_after = balance_after - 0.01 WHERE id = <P2 row>` (inside same txn) | re-run `wallet_ledger_v2_diff_report('5 minutes')` | `balance_after_mismatch >= 1`, `safe_for_shadow_wiring=false` (proves the new gate fires) |
| P5 | Snapshot mirror | rollback then redo P2 in a new txn that allows COMMIT only of the snapshot row | call `wallet_ledger_v2_diff_snapshot('5 minutes')` | persisted `report` JSON in `wallet_ledger_v2_diff_log` contains `balance_after_mismatch=0`; with P4-style drift injection, mismatch ≥1 and `safe_for_shadow_wiring=false` |
| P6 | Caller compatibility | none | smoke-call each of the 5 edge functions in their current `p_dry_run` mode in staging | identical return JSON shape vs pre-patch; no new error codes |

**All six probes GREEN ⇒ §8 prerequisites unlocked.**

---

## 8. LIVE CANARY RERUN PREREQUISITES (for C.fix-3, NOT this step)

1. ✅ Patches 1–3 applied via migration; rollback migration drafted and dry-applied in staging.
2. ✅ Probes P1–P6 all GREEN against staging.
3. ✅ Operator wallet selected; pre-balance recorded; cleanup `admin_adjustment` script pre-staged.
4. ✅ ≤ 3-minute exposure window; `organic_eligible_now = 0` gate confirmed.
5. ✅ User explicit `GO PHASE-1A STEP C.fix-3 — APPLY OPTION-A + DIFF PARITY MIGRATION` command issued.
6. ✅ `expire-gift-credits` stays in current `p_dry_run` mode (no flip in this step).
7. ✅ Diff-report run immediately post-canary must show `balance_after_mismatch = 0`.

---

## 9. DELIVERABLES OF THIS STEP

| Path | Type | Status |
|---|---|---|
| `docs/fix-sprints/phase-1a-step-c-fix-2-option-a-diff-parity-patch-plan.md` | plan | NEW (this file) |

Zero SQL, zero migration file, zero edge-fn edits, zero deploy.

---

## 10. FINAL VERDICT

# 🟢 GREEN — Patch plan ready for execution command.

Plan is complete, scope-bound, reversible, and gates R1 + R2 closed end-to-end (with R4 explicitly deferred per authorisation).

**Next authorised command (do NOT execute without explicit user `GO`):**

> `GO PHASE-1A STEP C.fix-3 — APPLY OPTION-A + DIFF PARITY MIGRATION (SINGLE MIGRATION, ROLLBACK INCLUDED, SYNTHETIC PROBES FIRST)`

That step will:
1. Run the §3.1 schema confirmation query (read-only).
2. Draft the single migration containing Patches 1 + 2 + 3.
3. Pre-draft the inverse rollback migration.
4. Submit the migration for user approval.
5. After approval and apply, run Probes P1–P6 §7.
6. Only on all-GREEN, return control for the C.fix-4 live canary rerun.
