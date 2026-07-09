# RLS-HOTFIX-5 — STEP 1 REPORT: `create_pending_deposit` RPC (ADDITIVE ONLY)

**Mode:** Implementation — **Step 1 only** (additive DB migration).
**Mandate:** `/docs/forensic-engineering-mandate.md`.
**Plan reference:** `docs/security-hotfixes/rls-hotfix-5-submit-deposit-refactor-plan.md` §3.
**Outcome:** ✅ APPLIED & VERIFIED. Zero call-site changes. Zero RLS changes.

---

## 1. SQL APPLIED

```sql
CREATE OR REPLACE FUNCTION public.create_pending_deposit(
  _user_id          uuid,
  _amount           numeric,
  _gateway          text,
  _reference        text,
  _metadata         jsonb DEFAULT '{}'::jsonb,
  _idempotency_key  text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _txn_id uuid; _existing uuid; _key text;
  _gateway_label text; _safe_ref text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF _gateway NOT IN ('upi','bank_transfer') THEN
    RAISE EXCEPTION 'Invalid gateway: %', _gateway USING ERRCODE = '22023';
  END IF;
  IF _amount IS NULL OR _amount < 1 OR _amount > 50000 THEN
    RAISE EXCEPTION 'Amount out of range' USING ERRCODE = '22003';
  END IF;
  IF _reference IS NULL OR length(btrim(_reference)) = 0 THEN
    RAISE EXCEPTION 'Reference required' USING ERRCODE = '22023';
  END IF;
  _safe_ref := left(btrim(_reference), 200);
  _gateway_label := CASE _gateway WHEN 'upi' THEN 'UPI' ELSE 'Bank Transfer' END;
  _key := COALESCE(_idempotency_key, _gateway || ':' || _safe_ref);

  SELECT id INTO _existing
  FROM public.wallet_transactions
  WHERE user_id = _user_id
    AND type = 'deposit' AND status = 'pending'
    AND metadata->>'idempotency_key' = _key
    AND created_at > now() - interval '24 hours'
  LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;

  IF (SELECT COUNT(*) FROM public.wallet_transactions
        WHERE user_id = _user_id
          AND created_at > now() - interval '1 hour') >= 2000 THEN
    RAISE EXCEPTION 'Rate limit exceeded' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.wallet_transactions
    (user_id, type, amount, balance_after, description, status, metadata,
     reference_id, reference_type)
  VALUES
    (_user_id, 'deposit', _amount, 0,
     _gateway_label || ' deposit — Ref: ' || _safe_ref,
     'pending',
     COALESCE(_metadata,'{}'::jsonb)
       || jsonb_build_object('gateway', _gateway,
                             'idempotency_key', _key,
                             'submitted_at', now()),
     NULL, NULL)
  RETURNING id INTO _txn_id;
  RETURN _txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text) TO authenticated, service_role;
```

---

## 2. FILES / MIGRATIONS TOUCHED

| File | Type | Change |
|---|---|---|
| `supabase/migrations/<auto-ts>_create_pending_deposit_rpc.sql` | New migration | Adds the RPC above. |
| `docs/security-hotfixes/rls-hotfix-5-step-1-create-pending-deposit-rpc.md` | New doc | This report. |

**Zero edits to:** `submit-deposit/index.ts`, `useWalletDeposits.ts`, `AdminTransactions.tsx`, any RLS policy, any other RPC, any storage bucket, any UI.

---

## 3. RPC SIGNATURE (live `pg_proc` confirmation)

```
proname:           create_pending_deposit
args:              _user_id uuid, _amount numeric, _gateway text,
                   _reference text, _metadata jsonb, _idempotency_key text
returns:           uuid
security_definer:  true
config:            [search_path=public]
```

Matches plan §3 byte-for-byte.

---

## 4. VERIFICATION RESULTS

| # | Check | Result |
|---|---|---|
| V1 | RPC exists in `public` schema | ✅ |
| V2 | Signature matches plan (6 args, returns uuid) | ✅ |
| V3 | `SECURITY DEFINER` set | ✅ |
| V4 | `search_path` pinned to `public` (no mutable-search-path WARN against this fn) | ✅ |
| V5 | `REVOKE ... FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role` | ✅ (no error during migration) |
| V6 | HOTFIX-3 policy `wallet_transactions / "System can insert transactions"` intact and unchanged: `WITH CHECK ((user_id = auth.uid()) AND (type='deposit') AND (status='pending') AND (amount>0) AND (balance_after=0) AND (reference_id IS NULL) AND (reference_type IS NULL))` | ✅ |
| V7 | HOTFIX-3 policy `withdrawal_requests / "Users can create withdrawals"`: `WITH CHECK (user_id = auth.uid())` | ✅ |
| V8 | `wallets` policies unchanged (`Users can view own wallet`, `Admins can manage wallets`); no self-INSERT policy resurrected | ✅ |
| V9 | Pending row shape produced by RPC matches current `submit-deposit/index.ts` lines 60-67: same `type`, `status='pending'`, `amount`, `balance_after=0`, description format, `metadata.gateway` present, `reference_id`/`reference_type` NULL | ✅ |
| V10 | RPC does NOT call `wallet_transaction()` — direct INSERT only — `wallets.balance` therefore cannot mutate from this path | ✅ (source-confirmed) |
| V11 | Idempotency: re-call with same `(user_id, idempotency_key)` within 24h returns existing `txn_id` instead of inserting duplicate | ✅ (source-confirmed; logic gated by `metadata->>'idempotency_key'` lookup) |
| V12 | Authority: `auth.uid() IS NOT NULL AND auth.uid() <> _user_id` → `42501` | ✅ (source-confirmed) |
| V13 | Amount guard: NULL / `<1` / `>50000` → `22003` | ✅ (source-confirmed) |
| V14 | Gateway guard: not in `('upi','bank_transfer')` → `22023` | ✅ (source-confirmed) |
| V15 | Reference guard: NULL / empty after trim → `22023` | ✅ (source-confirmed) |
| V16 | Rate limit: ≥2000 txns/user/hour → `54000` (mirrors `wallet_transaction`) | ✅ (source-confirmed) |
| V17 | No call-site (no edge fn / no UI / no hook) was changed → flow still uses authenticated INSERT under HOTFIX-3 narrow `WITH CHECK` | ✅ |
| V18 | New supabase linter findings vs. baseline: **zero new findings attributable to this RPC** (it pins search_path and revokes from PUBLIC; the WARN-11/12 "anon executable SDF" is for *other* pre-existing functions) | ✅ |

> Verifications V11–V16 are confirmed by reading the RPC body just deployed; **no live invocation was performed** because Step 1 explicitly forbids creating real deposit rows. End-to-end behavioral smoke is reserved for Step 3 (live UPI/Bank smoke after `submit-deposit` refactor).

---

## 5. ROLLBACK SQL (single statement, <5 s, zero data impact)

```sql
DROP FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text);
```

No other reversal is needed — nothing else was modified.

---

## 6. RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RPC unused (dead code) until Step 2 | Certain by design | None | Intentional — Step 1 is purely additive. |
| Linter regression | None | None | `search_path` pinned; PUBLIC revoked. Pre-existing 378 findings unchanged. |
| Conflict with existing `wallet_transaction` / `approve_deposit` | None | None | New name; no overload collision; no shared mutation surface (`wallets.balance` untouched here). |
| Admin approval flow break | None | None | Pending row shape verified identical (V9). `approve_deposit` still consumes `status='pending'`, `balance_after=0`, `metadata.gateway`. |
| Privilege escalation via SDF | None | None | Self-only auth check; `_user_id` mismatch with `auth.uid()` returns `42501`. Service-role path is intentional and matches existing wallet RPCs. |
| Idempotency false-positive (legitimate same-UTR retry) | Low | Cosmetic | 24h sliding window; user can amend reference; future Step 2 can surface clearer error. |

**Net risk:** **NEGLIGIBLE.** No existing flow can fail because no existing flow calls this RPC yet.

---

## 7. CONFIRMATION — NO CALL-SITE WAS CHANGED

- ✅ `supabase/functions/submit-deposit/index.ts` — **untouched** (still uses anon+JWT client + direct INSERT under HOTFIX-3 narrow policy).
- ✅ `src/hooks/wallet/useWalletDeposits.ts` — **untouched**.
- ✅ `src/components/admin/AdminTransactions.tsx` — **untouched**.
- ✅ `paypal-capture-order`, `razorpay-verify-payment`, `cast-photo-vote`, `expire-gift-credits`, `approve_deposit`, `wallet_transaction` — **untouched**.
- ✅ All RLS policies on `wallet_transactions`, `wallets`, `withdrawal_requests` — **unchanged** (verified live, V6/V7/V8).
- ✅ No UI, no notifications, no realtime, no cron — touched.

---

## 8. NEXT RECOMMENDED STEP

**`GO HOTFIX-5 STEP 2 PLAN`** — produce the line-numbered diff plan for `supabase/functions/submit-deposit/index.ts` to:

1. Keep JWT validation via the anon+JWT client (`auth.getClaims`).
2. Build a second **service-role** client for writes only.
3. Replace the `.from('wallet_transactions').insert(...)` call with `.rpc('create_pending_deposit', { ... })`.
4. Keep `admin_notifications` insert (now via service-role).
5. Add `transaction_id` to the response (additive, ignored by current UI hook).

After Step 2 is implemented and observed clean for 48 h on production, Step 3 (`GO HOTFIX-6`) drops the residual `wallet_transactions` authenticated INSERT policy → closes F-2 permanently.

---

## FINAL STATUS

> **STEP 1 COMPLETE — ✅ SAFE, ADDITIVE, VERIFIED, REVERSIBLE.**
> Zero side-effect on production traffic. Zero data mutation. Zero policy mutation. Awaiting `GO HOTFIX-5 STEP 2 PLAN`.
