# RLS-HOTFIX-3 — Wallet RLS Hotfix Patch Plan (Path β, NOT YET APPLIED)

**Mode:** PLAN ONLY. No migration executed, no code changed, no runtime touched.
**Predecessors:**
- `docs/security-hotfixes/wallet-transactions-rls-hole-classification.md` (HOTFIX-1)
- `docs/security-hotfixes/rls-hotfix-2-insert-path-inventory.md` (HOTFIX-2)
**Strategy:** Path β (tighten F-2 in place; drop F-3; tighten F-1). Path α (refactor `submit-deposit` to RPC then DROP F-2) deferred to a later sprint.
**Mandate:** `/docs/forensic-engineering-mandate.md` — Zero Assumption / Zero Guesswork.

---

## 0. CRITICAL CORRECTION vs HOTFIX-1 §11 / HOTFIX-2 §9 draft

Live introspection of `information_schema.columns` for `public.wallet_transactions` returned:

| column | is_nullable | default |
|---|---|---|
| `balance_after` | **NO** | `0` |
| `status` | NO | `'completed'` |
| `reference_id` | YES | — |
| `reference_type` | YES | — |

`balance_after` is **NOT NULL with default 0**. The earlier draft predicate `balance_after IS NULL` would **always evaluate FALSE on insert** and would **block `submit-deposit` 100% of the time**. Corrected predicate uses `balance_after = 0` instead. This is the single revision vs the earlier draft.

`submit-deposit/index.ts:58` payload (verified by `grep`):
```ts
.from("wallet_transactions").insert({
  user_id: userId,            // = auth.uid()
  type: "deposit",
  amount: amount,             // > 0 (validated 1..50000)
  description: `${gatewayLabel} deposit — Ref: ${safeRef}`,
  status: "pending",
  metadata: { gateway, ...metadata },
})
```
Omits `balance_after` → DB writes default `0`. Omits `reference_id` / `reference_type` → both NULL. All Path β predicates pass.

---

## 1. EXACT MIGRATION SQL (NOT YET APPLIED)

```sql
-- =====================================================================
-- RLS-HOTFIX-3 — Wallet authority hardening (Path β)
-- READ THIS BEFORE APPLY:
--   1. Path α refactor of submit-deposit is NOT included; F-2 is tightened
--      in place rather than dropped. Full DROP deferred to later sprint.
--   2. No data is mutated. Only RLS policy definitions change.
-- =====================================================================

BEGIN;

-- ---- F-1: withdrawal_requests — close cross-user impersonation ----
ALTER POLICY "Users can create withdrawals"
  ON public.withdrawal_requests
  WITH CHECK (user_id = auth.uid());

-- ---- F-3: wallets — drop unused authenticated INSERT ----
-- Verified by exhaustive grep (HOTFIX-2 §B5): no .from('wallets').insert(...)
-- in src/** or supabase/functions/**. Wallet rows are exclusively created
-- by the wallet_transaction() SECURITY DEFINER RPC.
DROP POLICY "System can insert wallets" ON public.wallets;

-- ---- F-2: wallet_transactions — tighten in place ----
-- Allow ONLY the exact shape submit-deposit produces: a self-owned,
-- pending, positive-amount deposit row with zero starting ledger
-- snapshot and no reference linkage.
ALTER POLICY "System can insert transactions"
  ON public.wallet_transactions
  WITH CHECK (
    user_id        = auth.uid()
    AND type       = 'deposit'
    AND status     = 'pending'
    AND amount     > 0
    AND balance_after = 0          -- column is NOT NULL DEFAULT 0; submit-deposit omits it
    AND reference_id   IS NULL
    AND reference_type IS NULL
  );

COMMIT;
```

No `ALTER TABLE`, no `DROP TABLE`, no data-touching statement. RLS policy definitions only.

---

## 2. ROLLBACK SQL (single transaction, restores prior — vulnerable — state)

```sql
BEGIN;

-- Revert F-2 to the prior loose form
ALTER POLICY "System can insert transactions"
  ON public.wallet_transactions
  WITH CHECK (user_id = auth.uid());

-- Re-create F-3 exactly as it was (authenticated, INSERT only, self-scoped)
CREATE POLICY "System can insert wallets"
  ON public.wallets
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Revert F-1 to its prior open form (with_check = NULL)
-- Postgres has no syntax for "policy with NULL with_check"; recreate it.
DROP POLICY "Users can create withdrawals" ON public.withdrawal_requests;
CREATE POLICY "Users can create withdrawals"
  ON public.withdrawal_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (true);   -- equivalent to original NULL (was effectively unconditional)

COMMIT;
```

Rollback is non-destructive (no data) and restores the same authority surface present pre-patch.

---

## 3. FLOWS THAT REMAIN WORKING (proven payload-vs-policy)

| # | Flow | Path | Why it passes the new predicates |
|---|---|---|---|
| 1 | UPI / Bank Transfer deposit | `submit-deposit/index.ts:58` user-JWT INSERT into `wallet_transactions` | `user_id=auth.uid()`, `type='deposit'`, `status='pending'`, `amount>0`, `balance_after`=DB-default 0, `reference_id`=NULL, `reference_type`=NULL → **F-2 satisfied** |
| 2 | User withdrawal request | `useWalletWithdrawals.ts:56` user-JWT INSERT into `withdrawal_requests` with `user_id: user.id` | F-1 now requires `user_id=auth.uid()` and the call already supplies that → **F-1 satisfied** |
| 3 | PayPal capture credit | `paypal-capture-order/index.ts:148` `admin.rpc('wallet_transaction', …)` | service-role + SECURITY DEFINER → bypasses RLS entirely. F-2 irrelevant. |
| 4 | Razorpay credit | `razorpay-verify-payment/index.ts:135` same pattern | same — bypasses RLS |
| 5 | Vote rewards / unvote penalties | `cast-photo-vote/index.ts:225/235/256/266` `admin.rpc('wallet_transaction', …)` | same — bypasses RLS |
| 6 | Admin withdrawal approval (deduct + auto-reversal) | `admin-process-withdrawal/index.ts:64/94` admin → `admin.rpc('wallet_transaction', …)` | same — bypasses RLS |
| 7 | Gift expiry debit | `expire-gift-credits/index.ts:39` cron → `admin.rpc('wallet_transaction', …)` | same — bypasses RLS |
| 8 | `useWallet.addFunds` / `deductFunds` | `useWallet.ts:65/78` `supabase.rpc('wallet_transaction', …)` | RPC is SECURITY DEFINER → bypasses RLS |
| 9 | `useWalletWithdrawals.ts:65` debit-after-request | same — `supabase.rpc('wallet_transaction', …)` | bypasses RLS |
| 10 | Admin transactions UPDATE (`AdminTransactions.tsx:509`) | admin user-JWT UPDATE | governed by `Admins can manage transactions` (untouched). Survives. |
| 11 | All `.select(...)` reads on the 3 tables | n/a | SELECT policies untouched |
| 12 | `delete-user/index.ts:75` cascade scrub of `withdrawal_requests.reviewed_by` | service-role UPDATE | bypasses RLS |
| 13 | `hard-delete-competition` admin purge | service-role | bypasses RLS |

**No production flow regresses.**

---

## 4. PROOF — fake completed credit row is BLOCKED

Attacker payload via authenticated user-JWT REST call:
```http
POST /rest/v1/wallet_transactions
{ "user_id":"<self>", "type":"vote_reward", "amount":99999, "status":"completed", "balance_after":99999 }
```

Predicate evaluation (F-2 new):
- `user_id = auth.uid()` ✅
- `type = 'deposit'` ❌ (`'vote_reward'`)

→ **rejected** with `42501 / new row violates row-level security policy`. Even if attacker switches to `type='deposit'`, `status='completed'` fails the `status='pending'` check. Even if both are bent, `amount>0 + balance_after=0` blocks any pre-set ledger snapshot. **All three pollution vectors closed.**

---

## 5. PROOF — cross-user withdrawal impersonation is BLOCKED

Attacker payload (user A trying to file withdrawal as user B):
```http
POST /rest/v1/withdrawal_requests
{ "user_id":"<user_B>", "amount":1000, "bank_details":{...} }
```

Predicate evaluation (F-1 new):
- `user_id = auth.uid()` → user_B ≠ user_A ❌

→ **rejected** with `42501`. The legitimate self-withdrawal at `useWalletWithdrawals.ts:56` (`user_id: user.id`) continues to pass.

---

## 6. PROOF — wallet self-mint is BLOCKED

After `DROP POLICY "System can insert wallets"`, the only remaining `wallets` write authority for `authenticated` is `Admins can manage wallets` (admin-only). All other roles have **no INSERT policy** → INSERT denied.

```http
POST /rest/v1/wallets
{ "user_id":"<self>", "balance":99999 }
```
→ **rejected** for any non-admin authenticated user. Service-role + the `wallet_transaction()` SECURITY DEFINER RPC continue to insert wallet rows via `INSERT … ON CONFLICT DO UPDATE` (HOTFIX-2 §B4) — both bypass RLS.

---

## 7. PAYMENT GATEWAY / ADMIN RPC IMPACT — confirmed UNAFFECTED

All edge functions in §3 rows 3–9 instantiate the Supabase client with `SUPABASE_SERVICE_ROLE_KEY`:
- `supabase/functions/paypal-capture-order/index.ts:36` — service-role
- `supabase/functions/razorpay-verify-payment/index.ts:42` — service-role
- `supabase/functions/cast-photo-vote/index.ts` — service-role admin client
- `supabase/functions/admin-process-withdrawal/index.ts` — service-role admin client
- `supabase/functions/expire-gift-credits/index.ts` — service-role
- `supabase/functions/submit-deposit/index.ts:16-20` — **anon key + user JWT** (the one exception, fully covered by §3 row 1)

Service-role bypasses RLS by design. The patch touches only `authenticated` policies. Therefore **zero impact** on PayPal, Razorpay, vote rewards, unvote penalties, withdrawal approvals, gift expiry, admin RPCs, hard-delete admin purge, and `delete-user` cascade.

---

## 8. PRE-FLIGHT CHECKLIST (run before applying the migration)

- [ ] Re-grep `src/**` and `supabase/functions/**` for any new `.from('wallets').insert(` or `.from('withdrawal_requests').insert(` added since HOTFIX-2 was generated. Expected: only the two existing sites in HOTFIX-2 §B5/§C2.
- [ ] Confirm `submit-deposit/index.ts:58` payload shape unchanged (no new field that would fail the new F-2 predicates). Specifically: it MUST NOT set `balance_after`, `reference_id`, `reference_type`, and MUST keep `status='pending'`, `type='deposit'`.
- [ ] Confirm no recent migration redefined `wallet_transactions.balance_after` to allow NULL (would invalidate the `= 0` predicate). Current introspection: `NOT NULL DEFAULT 0`.
- [ ] Stage rollback SQL (§2) in a separate file ready to paste.
- [ ] Notify on-call: 5-second window where deposit submission could 401 if any silent code drift exists.

---

## 9. POST-APPLY VERIFICATION (manual, after migration is approved + run)

Read-only checks the operator should run AFTER the migration is approved and executed:

```sql
-- Confirm policies look as intended
SELECT polname, pg_get_expr(polqual,polrelid) AS using_expr,
       pg_get_expr(polwithcheck,polrelid)     AS check_expr
FROM   pg_policy
WHERE  polrelid IN (
  'public.wallet_transactions'::regclass,
  'public.wallets'::regclass,
  'public.withdrawal_requests'::regclass
)
ORDER BY polrelid::text, polname;
```

Smoke flow:
1. As a real test user, submit a UPI deposit of $1 via the app — **must succeed** (proves F-2 still permits the legitimate shape).
2. As the same user, file a self-withdrawal of a tiny amount — **must succeed** (proves F-1 still permits self).
3. From DevTools console issue a REST POST to `/rest/v1/withdrawal_requests` with `user_id` set to a different user UUID — **must fail with 42501** (proves F-1 hardening).
4. From DevTools console issue a REST POST to `/rest/v1/wallet_transactions` with `type='vote_reward', status='completed'` — **must fail with 42501** (proves F-2 hardening).
5. From DevTools console issue a REST POST to `/rest/v1/wallets` with arbitrary `balance` — **must fail with 42501** (proves F-3 removal).

If any of 1, 2 fails → run the §2 rollback immediately.

---

## 10. WHAT THIS HOTFIX DOES NOT DO

- Does **not** drop F-2 outright. Path α (refactor `submit-deposit` → SD RPC, then `DROP POLICY "System can insert transactions"`) remains pending. Tracked as follow-up R-α.
- Does **not** repair the dead rollback in `useWalletWithdrawals.ts:73` (no user DELETE policy on `withdrawal_requests`; pre-existing). Tracked as R-4 in HOTFIX-2 §10.
- Does **not** RPC-ify `AdminTransactions.tsx:509` direct ledger UPDATE (Sprint-0A `F-1 CRITICAL`). Tracked as R-2.
- Does **not** RPC-ify `AdminGiftCredit.tsx:193` (Sprint-0A HIGH). Tracked as R-3.
- Does **not** historically reconcile the existing 179 `wallet_transactions` rows vs `wallets.balance`. That is RLS-HOTFIX-4 (read-only) and remains required before Phase 1A canonical RPC build resumes.

---

## 11. FINAL VERDICT

**PATCH PLAN READY — SAFE TO APPLY** as a single migration, **provided** the §8 pre-flight checklist passes. Predicate compatibility is proven against the actual `submit-deposit` payload and against the live column nullability. Rollback is one transaction, non-destructive, and restores the prior state exactly.

**Phase 1A canonical wallet RPC build remains paused** until:
1. This patch is applied + verified (closes the leaking surface).
2. RLS-HOTFIX-4 (historical ledger reconciliation) confirms no prior exploitation.
3. R-α refactor lands and F-2 is fully dropped.

## NEXT SAFE STEP

Operator review + approval of this plan. On approval, the migration in §1 is the next action. Until then: **no DB writes, no code edits, no runtime changes.**

**Plan only — complete.**
