# Phase 1A — Step A1.6 — Safe Limited Drift RPC + Retention Plan

**Status:** ✅ APPLIED. Additive-only. Read-only RPC. Zero wallet mutation.
**Migration timestamp:** 2026-05-15 06:44 UTC
**Authority:** Forensic Engineering Mandate Rules 1, 2, 4, 5.
**Predecessors:** A1, A1.5, A1 Gate Summary.
**Final Verdict:** **SAFE FOR SHADOW WIRING.**

---

## 1. SCOPE EXECUTED (this step)

| # | Action | State |
|---|---|---|
| 1 | A1 gate summary doc created | ✅ `docs/fix-sprints/phase-1a-a1-gate-summary.md` |
| 2 | Read-only drift RPC `public.wallet_ledger_v2_drift_report(interval)` created | ✅ |
| 3 | Permissions verified (anon blocked; authenticated allowed but admin-gated inside fn; service_role allowed; `wallet_ledger_apply_v2` remains fully locked) | ✅ |
| 4 | 90-day retention design documented | ✅ (PLAN ONLY — no cron) |
| 5 | Test cases documented (duplicate idempotency, overdraft) | ✅ (DOCS ONLY — no live mutation) |

Out of scope (explicitly NOT done):
- ❌ no caller wiring
- ❌ no edge function deploy
- ❌ no UI change
- ❌ no live wallet mutation
- ❌ no cron job
- ❌ no client EXECUTE grant on `wallet_ledger_apply_v2`

---

## 2. SQL APPLIED

```sql
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_drift_report(
  p_window interval DEFAULT interval '24 hours'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_since timestamptz := now() - p_window;
  -- counters omitted for brevity; see migration file
BEGIN
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role)
             OR public.has_role(auth.uid(), 'super_admin'::app_role);
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Pure SELECT counts from wallet_ledger_audit_log, wallet_ledger_shadow_log,
  -- wallet_ledger_idempotency over (now() - p_window). No INSERT/UPDATE/DELETE.
  RETURN jsonb_build_object(...);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_ledger_v2_drift_report(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_drift_report(interval)
  TO authenticated;
```

The grant to `authenticated` is safe because the function self-rejects non-admin callers with SQLSTATE `42501` before reading any row. `service_role` inherits implicitly (verified below).

---

## 3. READ-ONLY GUARANTEE

The RPC body contains **only** `SELECT` statements aggregating counts. No `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `COPY`, or DDL. Marked `STABLE` so Postgres rejects any future amendment that attempts mutation. Returns a single jsonb summary:

```json
{
  "window_start": "...", "window_end": "...",
  "audit":  { "total":4, "dry_run_ok":3, "replay":0, "error":1, "live_ok":0 },
  "shadow": { "total":3, "valid":3, "invalid":0 },
  "idempotency": { "rows_in_window": 0 },
  "error_breakdown": { "OVERDRAFT": 1 },
  "note": "read-only; no wallet mutation; A1.6 scope"
}
```

---

## 4. PERMISSION VERIFICATION (live DB, post-migration)

```
proname                          | rolname        | can_execute
---------------------------------+----------------+-------------
wallet_ledger_apply_v2           | anon           | false   ← still fully locked
wallet_ledger_apply_v2           | authenticated  | false   ← still fully locked
wallet_ledger_apply_v2           | public         | false
wallet_ledger_apply_v2           | service_role   | false   ← still fully locked
wallet_ledger_v2_drift_report    | anon           | false   ← blocked
wallet_ledger_v2_drift_report    | authenticated  | true    ← allowed; admin-gated inside fn
wallet_ledger_v2_drift_report    | public         | false
wallet_ledger_v2_drift_report    | service_role   | true    ← allowed (inherited)
```

✅ anon/public completely blocked.
✅ `wallet_ledger_apply_v2` remains callable by no role.
✅ Drift RPC reachable only by an authenticated admin / super_admin or service_role.

---

## 5. RETENTION PLAN (DESIGN ONLY — NO CRON ENABLED)

Target retention windows:

| Table | Retention | Rationale |
|---|---|---|
| `wallet_ledger_shadow_log` | 90 days | Shadow simulations are operationally valuable only during cutover; after 90 days they have no forensic value. |
| `wallet_ledger_audit_log` | **indefinite** | Forensic backbone — must outlive every cutover. |
| `wallet_ledger_idempotency` | 90 days for resolved keys | Long enough to absorb retried client calls; safe to prune older. |

Proposed (NOT applied) prune statement, to be wrapped in a future SECURITY DEFINER admin function and scheduled by `pg_cron` in a later step:

```sql
DELETE FROM public.wallet_ledger_shadow_log    WHERE captured_at < now() - interval '90 days';
DELETE FROM public.wallet_ledger_idempotency   WHERE created_at  < now() - interval '90 days';
-- wallet_ledger_audit_log: NEVER PRUNED
```

Activation gate: only after Step A (shadow wiring) has logged ≥30 days of clean data and a signed-off `pg_cron` policy doc exists. Not in this step.

---

## 6. TEST CASES (DOCS ONLY — NO RUN)

These cases are recorded for the future Step A1.7 / A live-mode smoke. **No live execution in A1.6.**

### 6.1 Duplicate idempotency_key behavior
- **Setup:** call `wallet_ledger_apply_v2('deposit_credit', U, +5, 'k-001', ..., p_dry_run=>false)` twice.
- **Expected (live mode, future):** first call → `{ok:true, live_ok:true, txn_id:T1}`; second call → `{ok:true, replay:true, txn_id:T1}` reading from `wallet_ledger_idempotency`. Wallet balance moves by +5 exactly once.
- **Dry-run mode (today):** both calls return `{ok:true, dry_run:true}`; idempotency table intentionally NOT touched (proven in A1.5 call_3).

### 6.2 Overdraft rejection
- **Setup:** wallet balance B; call `wallet_ledger_apply_v2('vote_debit', U, -(B+1), 'k-od', ..., p_dry_run=>false)`.
- **Expected:** `{ok:false, error_code:'OVERDRAFT', balance_before:B, amount:-(B+1)}`. No wallet update, no `wallet_transactions` insert, audit log row with `result='error'`.
- **Verified in A1.5 call_4** under dry-run; live-mode equivalent will be retested in A1.7 once live branch is unstubbed.

### 6.3 Reference-id duplicate (cross-key)
- **Note:** the function key is `(op, idempotency_key)`. Distinct `p_reference_id` with the **same** `(op, key)` still replays. Distinct `p_reference_id` with **different** `(op, key)` is a fresh write. To be exercised in A1.7.

---

## 7. ROLLBACK SQL (staged — NOT executed)

```sql
DROP FUNCTION IF EXISTS public.wallet_ledger_v2_drift_report(interval);
```

Rollback is independent of A1 / A1.5; dropping the report does not touch the shadow infrastructure.

---

## 8. RISKS

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Non-admin `authenticated` user calls the RPC | LOW | NONE — fn raises 42501 before any read | Admin-gate inside fn; verified |
| Future amendment introduces a write | LOW | HIGH | Marked `STABLE`; review checklist for any v2 RPC change |
| Linter pre-existing 378 findings | OBSERVED | NONE caused here | No change to any existing object |
| Drift counts confused with live mismatch | LOW | LOW | RPC returns shadow/audit counts only; true live-vs-shadow diff arrives in Step A1.7 |

---

## 9. NEXT SAFE STEP

After this report, two paths are eligible:

1. **`GO PHASE-1A STEP A1.7 — LIVE-VS-SHADOW DIFF RPC`** — additive read-only RPC that joins `wallet_ledger_shadow_log` ↔ `wallet_transactions` over a window and returns mismatches. Requires no caller wiring.
2. **`GO PHASE-1A STEP A — WIRE dry_run=true SHADOW AT 13 CALLER SITES`** — edge-function deploys only; `wallet_ledger_apply_v2` remains in dry-run; live branch still stubbed; mutation impossible.

Recommend (1) first so the diff plumbing exists before any caller wires.

---

# ✅ FINAL VERDICT — SAFE FOR SHADOW WIRING
