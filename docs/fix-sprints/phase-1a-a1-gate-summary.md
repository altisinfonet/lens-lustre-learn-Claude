# Phase 1A — A1 Gate Summary

**Status:** ✅ A1 + A1.5 GREEN. Ready for shadow wiring (next gate: A1.6 → A).
**Authority:** Forensic Engineering Mandate Rules 1, 2, 4, 5.
**Predecessors:**
- `docs/fix-sprints/phase-1a-canonical-wallet-authority-plan.md`
- `docs/fix-sprints/phase-1a-step-a1-wallet-ledger-v2-shadow-infra.md`
- `docs/fix-sprints/phase-1a-step-a1-5-wallet-v2-dry-run-smoke.md`

---

## 1. A1 RESULT — SHADOW INFRASTRUCTURE BUILT

| Object | Type | State |
|---|---|---|
| `public.wallet_ledger_idempotency` | table | created (RLS on, admin-read policy) |
| `public.wallet_ledger_shadow_log` | table | created (RLS on, admin-read policy) |
| `public.wallet_ledger_audit_log` | table | created (RLS on, admin-read policy) |
| `public.wallet_ledger_apply_v2(...)` | function | created, SECURITY DEFINER, `search_path = public`, live branch stubbed with `RAISE EXCEPTION`, `REVOKE ALL` enforced |

No existing wallet table, RLS policy, edge function, or UI surface was modified.

---

## 2. A1.5 RESULT — DRY-RUN SMOKE PASSED

4 controlled `dry_run=true` calls executed via temporarily-granted `service_role` (revoked immediately after):

| # | Call | Result | Notes |
|---|---|---|---|
| 1 | credit +5 | `dry_run_ok` | shadow + audit row written |
| 2 | debit -1 | `dry_run_ok` | shadow + audit row written |
| 3 | duplicate of #1 | `dry_run_ok` | dry mode does NOT register idempotency (by contract) |
| 4 | overdraft -1e9 | `error / OVERDRAFT` | rejected pre-write |

---

## 3. EVIDENCE SQL (re-runnable)

```sql
-- Object existence
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name LIKE 'wallet_ledger_%';

-- Function existence + signature
SELECT proname, pg_get_function_identity_arguments(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN ('wallet_ledger_apply_v2','wallet_ledger_v2_drift_report');

-- Permission lock proof
SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('public')) r(rolname)
 WHERE n.nspname='public' AND p.proname='wallet_ledger_apply_v2';

-- Wallet checksum (must be byte-identical before and after any A1.x step)
SELECT count(*), sum(balance), md5(string_agg(user_id::text||':'||balance::text, '|' ORDER BY user_id))
  FROM public.wallets;
```

---

## 4. CHECKSUM PROOF

| Metric | Value (post-A1.5) |
|---|---|
| `wallets` row count | 14 |
| `wallets` Σ balance | 96.71263157894736842 |
| `wallets` md5 checksum | `207d7f824bcf0bdd5fbe419774a0a4cd` |
| `wallet_transactions` row count | 180 |

Both A1 and A1.5 proved byte-identical wallet state before and after.

---

## 5. PERMISSION-LOCK PROOF (live DB, 2026-05-15)

```
proname                    | rolname        | can_execute
---------------------------+----------------+-------------
wallet_ledger_apply_v2     | anon           | false
wallet_ledger_apply_v2     | authenticated  | false
wallet_ledger_apply_v2     | public         | false
wallet_ledger_apply_v2     | service_role   | false
```

`wallet_ledger_apply_v2` is callable by **no role**. Even if someone obtained service-role credentials today, they could not invoke it without an explicit future GRANT. Combined with the `RAISE EXCEPTION` stub on the live branch, two independent locks block any balance mutation.

---

## 6. READINESS VERDICT

# ✅ READY FOR SHADOW WIRING

- Infrastructure exists, policies enforced, function locked.
- Dry-run mechanics proven against 4 contract paths.
- Wallet state byte-identical across every operation.
- No production caller wired, no edge fn deployed, no UI changed.

Next sanctioned step: **A1.6 (this report's sibling)** = read-only drift RPC + retention plan (no wiring), then **A** = wire `dry_run=true` shadow at the 13 caller sites (edge-fn deploys only).
