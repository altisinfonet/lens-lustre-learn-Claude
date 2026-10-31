# RLS-HOTFIX-5 — `submit-deposit` Service-Role Refactor Plan (READ-ONLY PLAN)

**Mode:** PLAN ONLY — no code, no migration, no deployment.
**Mandate:** `/docs/forensic-engineering-mandate.md` (Zero Assumption / Zero Guesswork).
**Goal:** Eliminate `submit-deposit`'s dependency on the authenticated INSERT policy on `wallet_transactions`, so HOTFIX-6 can fully `DROP POLICY "System can insert transactions"`.

---

## 1. VERIFIED FINDINGS

### 1.1 Current `submit-deposit/index.ts` (lines 19-22, 60-67)
- Builds Supabase client with **anon key + caller's `Authorization` header** → ALL writes flow through RLS as `authenticated`.
- Performs `supabase.from("wallet_transactions").insert({ user_id, type:'deposit', amount, status:'pending', ... })`.
- This insert is the **only legitimate user-initiated path** that the post-HOTFIX-3 narrowed `WITH CHECK` was crafted to keep alive (`type='deposit' AND status='pending' AND amount>0 AND balance_after=0 AND reference_id IS NULL AND reference_type IS NULL`).
- Then inserts an `admin_notifications` row (admin RLS already permits — irrelevant to this hole).

### 1.2 Existing wallet RPCs (live `pg_proc` introspection)

| RPC | SECURITY DEFINER | Purpose | Suitable for pending deposit? |
|---|---|---|---|
| `wallet_transaction(_user_id,_type,_amount,_description,_reference_id,_reference_type,_metadata)` | ✅ | Atomic credit/debit: **mutates `wallets.balance`** AND inserts `wallet_transactions` row with hard-coded **`status='completed'`** and `balance_after = new wallet balance`. | ❌ **NO.** It immediately moves money. A pending deposit must NOT touch `wallets.balance` — admin approval (`approve_deposit`) is what credits the wallet later. Using `wallet_transaction` for pending would double-credit on approval. |
| `approve_deposit(_admin_id,_txn_id)` | ✅ | Admin-only. Reads the pending row, calls `wallet_transaction` for user + platform admin, flips `status='approved'`. **Requires the pending row to already exist** with `status='pending'` and `balance_after=0`. | Consumer of the pending row, not a producer. |

**Verdict on Task 3:** `wallet_transaction` does **NOT** support pending deposits. A new SECURITY DEFINER RPC is required.

### 1.3 Codebase consumers of pending-deposit creation
- `supabase/functions/submit-deposit/index.ts` (only producer; per RLS-HOTFIX-2 inventory).
- No other call site inserts `type='deposit' AND status='pending'`. PayPal/Razorpay use service-role + their own approve paths.

---

## 2. NOT VERIFIED ITEMS

- Whether any cron/job reads `wallet_transactions` filtering on `metadata->>'gateway' IN ('upi','bank_transfer')` for SLA alerts. (Not blocking — additive metadata is preserved.)
- Whether `admin_notifications` consumers expect `reference_id = userId` (current behavior) vs. `reference_id = txn_id`. Plan keeps current behavior to avoid surprise.

---

## 3. PROPOSED MINIMAL RPC (NOT YET CREATED)

```sql
CREATE OR REPLACE FUNCTION public.create_pending_deposit(
  _user_id          uuid,
  _amount           numeric,
  _gateway          text,        -- 'upi' | 'bank_transfer'
  _reference        text,        -- user-supplied UTR / bank ref, max 200 chars
  _metadata         jsonb DEFAULT '{}'::jsonb,
  _idempotency_key  text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _txn_id   uuid;
  _existing uuid;
  _key      text;
  _gateway_label text;
BEGIN
  -- 1. Authority: caller must be service-role (auth.uid() IS NULL) OR the user themselves.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate gateway + amount + reference
  IF _gateway NOT IN ('upi','bank_transfer') THEN
    RAISE EXCEPTION 'Invalid gateway: %', _gateway USING ERRCODE = '22023';
  END IF;
  IF _amount IS NULL OR _amount < 1 OR _amount > 50000 THEN
    RAISE EXCEPTION 'Amount out of range' USING ERRCODE = '22003';
  END IF;
  IF _reference IS NULL OR length(btrim(_reference)) = 0 THEN
    RAISE EXCEPTION 'Reference required' USING ERRCODE = '22023';
  END IF;

  _gateway_label := CASE _gateway WHEN 'upi' THEN 'UPI' ELSE 'Bank Transfer' END;
  _key := COALESCE(_idempotency_key, _gateway || ':' || btrim(_reference));

  -- 3. Idempotency: if same user already has a pending row with same key in last 24h, return it.
  SELECT id INTO _existing
  FROM public.wallet_transactions
  WHERE user_id = _user_id
    AND type   = 'deposit'
    AND status = 'pending'
    AND metadata->>'idempotency_key' = _key
    AND created_at > now() - interval '24 hours'
  LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;

  -- 4. Rate limit (mirror wallet_transaction): max 2000 txns/user/hour
  IF (SELECT COUNT(*) FROM public.wallet_transactions
        WHERE user_id = _user_id
          AND created_at > now() - interval '1 hour') >= 2000 THEN
    RAISE EXCEPTION 'Rate limit exceeded' USING ERRCODE = '54000';
  END IF;

  -- 5. Insert pending row — frozen shape, NEVER touches wallets.balance.
  INSERT INTO public.wallet_transactions
    (user_id, type, amount, balance_after, description, status, metadata,
     reference_id, reference_type)
  VALUES
    (_user_id, 'deposit', _amount, 0,
     _gateway_label || ' deposit — Ref: ' || left(btrim(_reference), 200),
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

REVOKE ALL ON FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text) TO authenticated, service_role;
```

**Why SECURITY DEFINER + self-only auth check:** lets us drop the user-INSERT RLS policy (HOTFIX-6) while keeping the same trust model — the user can only create their *own* pending deposit, and only via a frozen-shape function whose every field is server-validated.

---

## 4. INPUT / OUTPUT CONTRACT

### Edge function `submit-deposit` (refactored)
**Request body** (unchanged from today):
```ts
{ amountUSD: number; gateway: 'upi'|'bank_transfer'; reference: string; metadata?: Record<string,any> }
```
**Server pipeline (refactored):**
1. JWT validation via `auth.getClaims` (unchanged).
2. Validate amountUSD ∈ [1, 50000] and reference non-empty (unchanged).
3. Build a **service-role** Supabase client (`SUPABASE_SERVICE_ROLE_KEY`) — replacing the anon+JWT client for the writes only.
4. `supabase.rpc('create_pending_deposit', { _user_id: userId, _amount: amount, _gateway: gateway, _reference: safeRef, _metadata: metadata ?? {}, _idempotency_key: null })`.
5. On success → `supabase.from('admin_notifications').insert({...})` (service-role; admin RLS unchanged).
6. Return `{ success:true, gateway: gatewayLabel, transaction_id: <uuid> }`.

**Response (addition):**
```ts
{ success: true; gateway: 'UPI'|'Bank Transfer'; transaction_id: string }
```
`transaction_id` is **additive** — `useWalletDeposits.ts` ignores extra fields, so no UI break.

---

## 5. IDEMPOTENCY KEY STRATEGY (manual UPI / Bank Transfer)

- Default key = `${gateway}:${trim(reference)}`.
  - User cannot accidentally double-submit the same UTR / bank reference within 24h — same key returns the original `transaction_id`.
- Caller may override via explicit `_idempotency_key` (reserved for future PayPal/Razorpay shared paths; `submit-deposit` passes `null`).
- Key is stored in `metadata.idempotency_key` (no schema change needed; `metadata jsonb` already exists).
- Window: 24h sliding (matches typical bank settlement). Outside window the user can legitimately reuse the same UTR for a different deposit.
- **No new table.** Idempotency lookup uses an index-friendly predicate on `(user_id,type,status,created_at)` already covered by existing indexes.

---

## 6. AUDIT LOGGING

- Existing `audit_wallet_transactions` trigger fires on the INSERT inside the RPC → audit row written automatically. **No change.**
- Add a single-row append to existing `db_audit_logs` (optional, low-risk) keyed `event='deposit_pending_created'` with `{ user_id, txn_id, gateway, idempotency_key, amount }`. Justified by SOW C-5 read-only analytics; can be deferred to HOTFIX-7 if we want HOTFIX-5 minimal.
- Edge function continues to insert `admin_notifications` row (unchanged shape; preserves operator workflow on `/admin/wallet`).

---

## 7. ROLLBACK PLAN

| Step | Rollback action | RTO |
|---|---|---|
| Deploy RPC | `DROP FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text);` | <5s |
| Refactor `submit-deposit` | Re-deploy previous `index.ts` from git (1-line revert: anon+JWT client + direct insert). | <30s |
| HOTFIX-6 RLS drop (separate migration, NOT in this plan) | `CREATE POLICY "System can insert transactions" ON public.wallet_transactions FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND type='deposit' AND status='pending' AND amount>0 AND balance_after=0 AND reference_id IS NULL AND reference_type IS NULL);` (current HOTFIX-3 shape) | <5s |

All three steps are independently reversible. **Zero data mutation.**

---

## 8. COMPATIBILITY WITH `AdminTransactions` APPROVAL FLOW

Verified against `src/components/admin/AdminTransactions.tsx` and `approve_deposit` RPC:

| Field admin/approve flow expects | Produced by `wallet_transactions.insert` today | Produced by `create_pending_deposit` RPC | Match |
|---|---|---|---|
| `type='deposit'` | ✅ | ✅ | ✅ |
| `status='pending'` | ✅ | ✅ | ✅ |
| `amount` (numeric, USD) | ✅ | ✅ | ✅ |
| `balance_after=0` | ✅ | ✅ | ✅ |
| `description` containing gateway label + ref | ✅ | ✅ | ✅ |
| `metadata.gateway` | ✅ | ✅ (+ `idempotency_key`, `submitted_at`) | ✅ (additive) |
| `reference_id`/`reference_type` NULL on pending | ✅ | ✅ | ✅ |

`approve_deposit(_admin_id, _txn_id)` reads `id, user_id, amount, description, metadata, status` — all present, all unchanged. **No admin UI change required.** `AdminTransactions.tsx` line 509 (status='rejected' direct UPDATE — pre-existing CRITICAL F-1 from `wallet-write-baseline.json`) is **out of scope** for HOTFIX-5; tracked separately.

---

## 9. POST-REFACTOR RLS PLAN (HOTFIX-6 PREVIEW — NOT EXECUTED HERE)

Once `submit-deposit` is on the new RPC and verified live:

```sql
-- HOTFIX-6 (later, separate migration):
DROP POLICY "System can insert transactions" ON public.wallet_transactions;
```

After this drop:
- All authenticated INSERTs on `wallet_transactions` return `42501`.
- Legitimate paths still work because they all run as service-role or via SECURITY DEFINER:
  - `submit-deposit` → `create_pending_deposit` (SD)
  - `paypal-capture-order`, `razorpay-verify-payment` → service-role direct (RLS-bypassed)
  - `approve_deposit` (SD) → `wallet_transaction` (SD)
  - `cast-photo-vote` → `wallet_transaction` (SD) via service-role
  - `expire-gift-credits` → service-role direct
- Closes F-2 permanently. F-1 already closed by HOTFIX-3. F-3 (`wallets` self-insert) already closed by HOTFIX-3.

Pre-HOTFIX-6 gate (must all be ✅ in production for ≥48h):
1. `submit-deposit` deploys cleanly with new RPC; UPI + Bank Transfer end-to-end smoke passes.
2. `pg_stat_statements` shows ≥1 successful `create_pending_deposit` call.
3. Zero `42501` errors traced to `submit-deposit` in edge logs.
4. `approve_deposit` continues to flip rows created by the RPC.

---

## 10. RISKS

| Risk | Likelihood | Mitigation |
|---|---|---|
| Service-role key not present in edge env | LOW | `SUPABASE_SERVICE_ROLE_KEY` is a default Lovable Cloud secret — verified used by `paypal-capture-order`, `razorpay-verify-payment`, `cast-photo-vote`. |
| Idempotency window collides with legitimate retry of different deposit using same UTR | LOW | 24h window matches bank settlement; user can change reference; explicit error message can be added. |
| Audit trigger duplicates row | NONE | Same INSERT path, same trigger; one row as today. |
| AdminTransactions UI break | NONE | Output shape identical (additive metadata only). |
| Drop policy breaks an unknown insert path | LOW | RLS-HOTFIX-2 inventory enumerated all client + edge inserts on `wallet_transactions`; only `submit-deposit` uses the authenticated path. |

---

## 11. FILES THAT WILL BE TOUCHED (HOTFIX-5 implementation phase, NOT this plan)

- `supabase/migrations/<ts>_create_pending_deposit_rpc.sql` (new)
- `supabase/functions/submit-deposit/index.ts` (refactor: anon+JWT client → JWT validation only; service-role client for writes; `.insert()` → `.rpc('create_pending_deposit', …)`)
- `docs/security-hotfixes/rls-hotfix-5-implementation-report.md` (post-deploy verification)

No changes to:
- `src/hooks/wallet/useWalletDeposits.ts` (response is additive)
- `src/components/admin/AdminTransactions.tsx`
- `wallet_transaction` / `approve_deposit` RPCs
- Any other edge function

---

## 12. VERIFICATION PROOF (PLAN-ONLY)

- `pg_proc` introspection: `wallet_transaction` and `approve_deposit` definitions captured above (live DB).
- `submit-deposit/index.ts` re-read in this turn (lines 19-22 anon-client; 60-67 user insert).
- `useWalletDeposits.ts` re-read — only consumes `data.gateway`; ignores extra fields → safe to add `transaction_id`.
- RLS-HOTFIX-2 inventory: `submit-deposit` is the sole user-path producer of `type='deposit'/status='pending'` rows.

---

## 13. NEXT RECOMMENDED STEP

`GO HOTFIX-5 IMPLEMENT` — execute in this strict order, each gated on the previous:
1. Apply migration creating `create_pending_deposit` RPC (additive; zero impact).
2. Re-deploy `submit-deposit` calling the RPC via service-role.
3. Live UPI smoke ($1) + Bank Transfer smoke ($1) by user.
4. After 48h clean → `GO HOTFIX-6` to DROP the residual `wallet_transactions` authenticated INSERT policy.

---

## FINAL VERDICT

> **NEEDS RPC FIRST**

`submit-deposit` cannot be safely flipped to service-role without a new SECURITY DEFINER `create_pending_deposit` RPC, because `wallet_transaction` always sets `status='completed'` and mutates `wallets.balance` (would double-credit on admin approval). The proposed RPC is minimal, additive, fully reversible, and unblocks HOTFIX-6 (final DROP of the `wallet_transactions` authenticated INSERT policy).

**No fixes applied. Plan only — complete.**
