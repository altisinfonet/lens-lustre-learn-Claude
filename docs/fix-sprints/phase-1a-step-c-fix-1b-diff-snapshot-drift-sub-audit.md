# Phase 1A — Step C.fix-1b: Diff / Snapshot / Drift `balance_after` Sub-Audit

> **Mode:** READ-ONLY. No mutation, no DDL, no deploy, no flag flips, no edge-fn edits, no live wallet ops.
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Source-of-truth:** `pg_get_functiondef()` + `pg_proc` live pulls (2026-05-18 06:11 UTC).
> **Predecessor:** `phase-1a-step-c-branch-f-balance-after-audit.md` (R2 follow-up).

---

## 1. SCOPE

Verify whether each of the three "parity-surface" functions named in Step C.fix-1 §2 actually compares `balance_after` between `wallet_ledger_v2_rows`/`wallet_ledger_shadow_log` and `wallet_transactions`:

| # | Function | Inspected? | balance_after comparison? |
|---|---|---|---|
| 1 | `wallet_ledger_v2_diff_report(interval)` | ✅ full body re-pulled | 🛑 **NO** |
| 2 | `wallet_ledger_v2_diff_snapshot(interval)` | ✅ full body pulled | 🛑 **NO** |
| 3 | `wallet_ledger_v2_drift_report(interval)`  | ✅ full body pulled | 🛑 **NO** (doesn't join at all) |

---

## 2. VERIFIED METADATA

```
proname                             | volatility | secdef | contains_write_keyword
------------------------------------+------------+--------+------------------------
wallet_ledger_v2_diff_report        | STABLE     | true   | false
wallet_ledger_v2_diff_snapshot      | VOLATILE   | true   | true   (← writes diff_log + admin_notifications)
wallet_ledger_v2_drift_report       | STABLE     | true   | false
```

Notes:
- `diff_snapshot` is **VOLATILE** because it APPENDS to `wallet_ledger_v2_diff_log` and (conditionally) to `admin_notifications`. **It does NOT touch `wallets`, `wallet_transactions`, `wallet_ledger_v2_rows`, `wallet_ledger_shadow_log`, or `wallet_ledger_audit_log`.** No wallet/ledger mutation risk.
- Both `*_report` functions are `STABLE` ⇒ Postgres rejects any future write inside them.
- All three are `SECURITY DEFINER` with `search_path=public`, admin-gated where applicable.

---

## 3. PER-FUNCTION FINDINGS

### 3.1 `wallet_ledger_v2_diff_report` (lines 1–153)

Match algebra:
```sql
LEFT JOIN LATERAL (
  SELECT * FROM l
   WHERE l.user_id = s.user_id
     AND l.amount  = s.amount
   ORDER BY abs(extract(epoch FROM (l.created_at - s.captured_at)))
   LIMIT 1
) l ON true
```

Mismatch counters emitted:
- `amount_mismatch` — but the pair was already keyed on `amount`, so this is effectively always 0 unless `s_amount` is NULL.
- `type_mismatch` — `s.op` vs `l.type`.
- `user_mismatch` — defensive.
- `reference_mismatch` — `l.reference_id IS NULL`.
- **`balance_after_mismatch` — ABSENT.**

Verdict: blind to the −0.01 drift discovered in §1.4 of C.fix-1. `safe_for_shadow_wiring=true` is **necessary-but-insufficient**.

### 3.2 `wallet_ledger_v2_diff_snapshot` (lines 154–309)

Byte-for-byte the same match algebra as 3.1, plus:
- Computes `wallets_checksum = md5(string_agg(user_id::text || ':' || balance::text, ',' …))`.
- **Persists the report** into `wallet_ledger_v2_diff_log`.
- Fires **one** `admin_notifications` row per hour when `mismatch_count > 0 OR error_count > 0 OR unmatched_live > 0 OR unmatched_shadow > 0` (dedup via `date_trunc('hour', now())`).

Critical observations:
- The persisted snapshot inherits the **same balance_after blind spot** as `diff_report` (§3.1).
- The `wallets_checksum` field would catch wallet-balance drift between snapshots, but **only if the legacy and v2 paths actually disagreed about `wallets.balance` itself** — they don't (legacy is sole writer). It does **not** catch v2 mirror-row `balance_after` recording the wrong value.
- The alert rule is OR-gated on `unmatched_live > 0`. Pre-wiring and during partial wiring, **every** snapshot trips `v_alert=true` and inserts one admin_notification per hour. (Observed behaviour — not the topic of this audit, but flagged for the noise budget.)

Verdict: blind to balance_after drift; also currently noisy by design while wiring is partial.

### 3.3 `wallet_ledger_v2_drift_report` (lines 310–388)

Does **not join** `wallet_transactions` against `wallet_ledger_v2_rows` or `wallet_ledger_shadow_log` at all. It only aggregates counts:
- `audit.total / dry_run_ok / replay / error / live_ok` from `wallet_ledger_audit_log`
- `shadow.total / valid / invalid` from `wallet_ledger_shadow_log`
- `idempotency.rows_in_window` from `wallet_ledger_idempotency`
- `error_breakdown` jsonb grouped by `error_code`

Verdict: this RPC was never designed to compare `balance_after`; it is a health-counters dashboard. Not a regression — out of scope for parity. But also means it cannot be the place we fix R2.

---

## 4. RISK REGISTER (UPDATED FROM C.fix-1)

| ID | Status | Note |
|---|---|---|
| **R1** Branch-F double-debit | OPEN (BLOCKING) | Unchanged. Owned by C.fix-2. |
| **R2** `diff_report` has no balance_after check | **CONFIRMED + EXPANDED** | Also affects `diff_snapshot`. `drift_report` is out of scope. Single one-line fix in the matched-pairs SELECT closes both (3.1 + 3.2). |
| **R3** `p_source_path` stored but never branched | Unchanged | Forward-compat only. |
| **R4 (NEW)** `diff_snapshot` is noisy: `v_alert` is OR-gated on `unmatched_live>0`, so during partial wiring every hour produces an `admin_notifications` row. | OBSERVED | Not a correctness bug. Suggest gating alert on **semantic** mismatches once C.fix-2 lands. Plan-only. |

---

## 5. RECOMMENDED PATCH SHAPE (PLAN ONLY — DO NOT APPLY)

Two surgical one-line additions, paired with the Option-A fix from C.fix-1:

**5.1 `diff_report` + `diff_snapshot` matched-pairs SELECT**

Add to the `pairs` projection:
```sql
,l.balance_after AS l_balance_after
,s_v2.balance_after AS s_balance_after   -- joined from wallet_ledger_v2_rows by idempotency_key
```
Add counter:
```sql
count(*) FILTER (
  WHERE live_id IS NOT NULL
    AND s_balance_after IS DISTINCT FROM l_balance_after
) AS v_balance_after_mismatch
```
Emit `balance_after_mismatch` in the returned JSON and AND-include it in `v_safe`:
```sql
v_safe := v_safe AND (v_balance_after_mismatch = 0);
```

**5.2 `diff_snapshot` alert gate (closes R4)**

Replace:
```sql
v_alert := (v_mismatch_count > 0) OR (v_error_count > 0)
        OR (v_unmatched_live > 0) OR (v_unmatched_shadow > 0);
```
With:
```sql
v_alert := (v_mismatch_count > 0)
        OR (v_balance_after_mismatch > 0)
        OR (v_error_count > 0);
-- unmatched_{live,shadow} surfaced via dashboard, not paged
```

No caller edits. No DDL beyond `CREATE OR REPLACE FUNCTION`. Fully reversible by reverting the function bodies.

---

## 6. NOT VERIFIED

- The shape of the join key between `wallet_ledger_v2_rows` and the existing shadow/live pair (likely `idempotency_key`, but **not confirmed against rows-table schema** in this sub-audit). C.fix-2 plan must include a 1-query schema confirmation before SQL is drafted.
- Whether any caller (UI, cron, alerting) parses the JSON shape of `diff_report` such that adding a new key would break it. Quick grep needed in C.fix-2 plan.

---

## 7. FILES TOUCHED

| Path | Type | Change |
|---|---|---|
| `docs/fix-sprints/phase-1a-step-c-fix-1b-diff-snapshot-drift-sub-audit.md` | report | NEW (this file) |

Zero code, zero SQL, zero edge-fn, zero migration changes.

---

## 8. SAFETY ATTESTATION

| Gate | Status |
|---|---|
| 100% SAFE | ✅ |
| ZERO DAMAGE | ✅ |
| ZERO SIDE EFFECT | ✅ |
| ZERO FAN-OUT | ✅ |
| ZERO RECURSION | ✅ |
| Live mutation | NONE |
| DDL | NONE |
| Rollback needed | N/A (read-only) |

---

## 9. VERDICT

# 🛑 HOLD — R2 confirmed and expanded. DO NOT patch yet.

**Gates that must be signed before C.fix-2 plan is drafted:**

1. ✅ User sign-off that **Option A** (re-read `wallets.balance` post-legacy as `balance_after`) is the chosen fix for R1.
2. ✅ User sign-off on the **two-line `balance_after` parity patch** to `diff_report` + `diff_snapshot` (§5.1).
3. ⚠️ User sign-off on the **alert-noise gate change** in `diff_snapshot` (§5.2 / R4) — optional but recommended.

Once 1–3 are signed, the next authorised command is:

> `GO PHASE-1A STEP C.fix-2 — DRAFT BRANCH-F OPTION-A + DIFF PARITY PATCH PLAN (PLAN ONLY)`

That step will produce the exact migration SQL diff and an updated synthetic revalidation plan. It will **not** execute the migration.
