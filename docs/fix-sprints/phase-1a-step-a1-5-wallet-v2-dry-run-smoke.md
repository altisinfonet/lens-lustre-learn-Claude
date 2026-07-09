# Phase 1A — Step A1.5 — Dry-Run Smoke for `wallet_ledger_apply_v2`

**Status:** ✅ PASSED. **Verdict: SAFE FOR SHADOW WIRING.**
**Timestamp:** 2026-05-14 14:13 UTC.
**Authority:** Forensic Engineering Mandate Rules 1, 2, 5.
**Predecessors:** `phase-1a-step-a1-wallet-ledger-v2-shadow-infra.md`, `phase-1a-canonical-wallet-authority-plan.md`.

---

## 1. SQL EXECUTED (3 ordered operations)

### 1.1 Temporary GRANT (migration)
```sql
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(
  text, uuid, numeric, text, text, text, text, boolean
) TO service_role;
```

### 1.2 Four dry-run calls (single batch)
```sql
SELECT 'call_1_credit',           public.wallet_ledger_apply_v2('deposit_credit', '<smoke_uuid>',  5, 'a1.5-smoke-credit-001',    ..., p_dry_run=>true)
UNION ALL
SELECT 'call_2_debit',            public.wallet_ledger_apply_v2('vote_debit',     '<smoke_uuid>', -1, 'a1.5-smoke-debit-001',     ..., p_dry_run=>true)
UNION ALL
SELECT 'call_3_duplicate_dryrun', public.wallet_ledger_apply_v2('deposit_credit', '<smoke_uuid>',  5, 'a1.5-smoke-credit-001',    ..., p_dry_run=>true)
UNION ALL
SELECT 'call_4_overdraft',        public.wallet_ledger_apply_v2('vote_debit',     '<smoke_uuid>', -1e9, 'a1.5-smoke-overdraft-001', ..., p_dry_run=>true);
```

### 1.3 Cleanup REVOKE (migration)
```sql
REVOKE EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(...) FROM service_role;
```
Verified: `information_schema.routine_privileges` returns **0 rows** for the function — back to lockdown.

---

## 2. BEFORE / AFTER — ZERO MUTATION PROOF

| Metric | BEFORE | AFTER | Δ |
|---|---:|---:|---:|
| `wallets` row count | 14 | 14 | 0 |
| `wallets` Σ balance | 96.71263157894736842 | 96.71263157894736842 | **0** |
| `wallets` md5 checksum | `207d7f824bcf0bdd5fbe419774a0a4cd` | `207d7f824bcf0bdd5fbe419774a0a4cd` | **byte-identical** |
| `wallet_transactions` row count | 180 | 180 | 0 |
| Smoke user balance (`payelkundubasu@gmail.com` / `cbb7cda6-…`) | 20.20263157894736842 | 20.20263157894736842 | 0 |
| `wallet_ledger_idempotency` count | 0 | 0 | 0 (correct — dry_run never registers) |
| `wallet_ledger_shadow_log` count | 0 | 3 | +3 |
| `wallet_ledger_audit_log` count | 0 | 4 | +4 |

**No financial table mutated. Only the two new log tables received rows.**

---

## 3. DRY-RUN CALL RESULTS

| # | Call | Returned `ok` | Returned shape |
|---|------|---------------|----------------|
| 1 | credit +5 | `true` | `{ok:true, dry_run:true, balance_before:20.2026…, balance_after:25.2026…}` |
| 2 | debit -1 | `true` | `{ok:true, dry_run:true, balance_before:20.2026…, balance_after:19.2026…}` |
| 3 | duplicate of #1 | `true` | `{ok:true, dry_run:true, balance_before:20.2026…, balance_after:25.2026…}` |
| 4 | overdraft -1e9 | `false` | `{ok:false, error_code:"OVERDRAFT", balance_before:20.2026…, amount:-1e9}` |

Every call computed against the **live** balance (20.2026…) — the function correctly reads current state without mutating it.

---

## 4. SHADOW LOG EVIDENCE (3 rows)

| op | idempotency_key | intended_amount | bal_before | bal_after | validation_ok |
|---|---|---:|---:|---:|---|
| deposit_credit | a1.5-smoke-credit-001 | 5 | 20.2026… | 25.2026… | true |
| vote_debit | a1.5-smoke-debit-001 | -1 | 20.2026… | 19.2026… | true |
| deposit_credit | a1.5-smoke-credit-001 | 5 | 20.2026… | 25.2026… | true |

Note: overdraft (call 4) is correctly **not** present in the shadow log — branch D rejects before the dry-run write. This matches the function design (shadow log = "what would have happened on a *valid* dry-run").

---

## 5. AUDIT LOG EVIDENCE (4 rows)

| op | idempotency_key | amount | bal_before | bal_after | result | error_code |
|---|---|---:|---:|---:|---|---|
| deposit_credit | a1.5-smoke-credit-001 | 5 | 20.2026… | 25.2026… | dry_run_ok | — |
| vote_debit | a1.5-smoke-debit-001 | -1 | 20.2026… | 19.2026… | dry_run_ok | — |
| deposit_credit | a1.5-smoke-credit-001 | 5 | 20.2026… | 25.2026… | dry_run_ok | — |
| vote_debit | a1.5-smoke-overdraft-001 | -1e9 | 20.2026… | (null) | error | OVERDRAFT |

Audit log captures every call (success **and** error) — forensic backbone is functional.

---

## 6. SPECIFIC CONTRACT CHECKS

| Requirement | Result | Evidence |
|---|---|---|
| `dry_run=true` does NOT mutate `wallets` | ✅ | balance md5 byte-identical |
| `dry_run=true` does NOT insert into `wallet_transactions` | ✅ | count 180 → 180 |
| Shadow log row created per valid dry call | ✅ | 3 rows for 3 valid calls |
| Audit log row created per call (incl. error) | ✅ | 4 rows for 4 calls |
| Idempotency NOT registered in dry mode (documents contract) | ✅ | `wallet_ledger_idempotency` count 0 → 0 |
| Duplicate dry call returns same computed result | ✅ | call_3 == call_1 output |
| Invalid debit (overdraft) rejected with `error_code=OVERDRAFT` | ✅ | call_4 |
| Live mutation impossible | ✅ | live branch raises `P0001`; EXECUTE revoked |
| No existing wallet path changed | ✅ | only new log tables touched; no edge fn redeployed; no UI |

---

## 7. ROLLBACK SQL (staged — NOT needed)

The smoke generated 7 log rows (3 shadow + 4 audit). They are forensic evidence and intentionally retained. If the user wants the slate fully clean before Step A:

```sql
DELETE FROM public.wallet_ledger_shadow_log WHERE source_path = 'phase-1a-step-a1.5-smoke';
DELETE FROM public.wallet_ledger_audit_log  WHERE source_path = 'phase-1a-step-a1.5-smoke';
```

Full rollback of the entire shadow infrastructure (Step A1 + A1.5):
```sql
DROP FUNCTION IF EXISTS public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean);
DROP TABLE    IF EXISTS public.wallet_ledger_audit_log;
DROP TABLE    IF EXISTS public.wallet_ledger_shadow_log;
DROP TABLE    IF EXISTS public.wallet_ledger_idempotency;
```

---

## 8. FINAL VERDICT

# ✅ SAFE FOR SHADOW WIRING

- Function behaves exactly as designed across all 4 contract paths (credit / debit / duplicate / overdraft).
- Zero mutation of `wallets` and `wallet_transactions` proven by md5 checksum + row count.
- Audit + shadow logs populated correctly with discriminating fields.
- Function returned to fully revoked state (no role can call it).
- Live mutation branch remains stubbed.

---

## 9. NEXT SAFE STEP

**`GO PHASE-1A STEP A1.6 — DRIFT RPC + RETENTION (read-only)`** — additive, no caller change:
- Create read-only admin RPC `get_wallet_ledger_drift_admin(p_window interval)` that joins `wallet_ledger_shadow_log` ↔ `wallet_transactions` over the last window and returns `(matched, amount_mismatch, type_mismatch, missing_in_shadow, extra_in_shadow, sample_offenders)`.
- Add a daily retention prune for `wallet_ledger_shadow_log` rows older than 90 days (keep `audit_log` indefinitely as forensic record).
- No existing object touched. No EXECUTE granted to clients.

After A1.6: `GO PHASE-1A STEP A` — wire `dry_run=true` shadow at the 13 caller sites (edge-fn deploys only, no SQL).
