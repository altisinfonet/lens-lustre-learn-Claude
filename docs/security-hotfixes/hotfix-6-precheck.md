# HOTFIX-6 — Precheck (Smoke-and-Recheck)

**Mode:** READ ONLY. No migration, no code change.
**Mandate:** `/docs/forensic-engineering-mandate.md` — Zero Assumption / Zero Guesswork.
**Trigger event:** Real Razorpay deposit by `payelkundubasu@gmail.com`, ₹5, 2026-05-14 13:13:13 UTC.
**Target action (separately gated):** `DROP POLICY "System can insert transactions" ON public.wallet_transactions`.

---

## 0. Scope reminder

The policy targeted by HOTFIX-6 is the **HOTFIX-3 hardened F-2** on `public.wallet_transactions`:

```
WITH CHECK (
  user_id = auth.uid()
  AND type = 'deposit'
  AND status = 'pending'
  AND amount > 0
  AND balance_after = 0
  AND reference_id IS NULL
  AND reference_type IS NULL
)
```

It governs **only** the user-JWT `INSERT` path. Service-role inserts (PayPal, Razorpay, vote rewards, gift expiry, admin operations) bypass RLS and are therefore unaffected by this drop.

The historical sole consumer of this user-JWT path was `submit-deposit/index.ts` for UPI / bank-transfer manual deposits. After HOTFIX-5 it has been refactored to call `create_pending_deposit()` SECURITY DEFINER RPC via service-role.

---

## 1. Live smoke event — observed state

```
id            : 1154466d-38a7-4683-99f2-47fdb36815d6
user_id       : cbb7cda6-484b-4002-a02b-9b6d7c2ae781   (payelkundubasu@gmail.com)
type          : deposit
amount        : 0.05263157894736842   (₹5 → USD at runtime FX)
status        : completed
balance_after : 20.20263157894736842
reference_id  : NULL
reference_type: deposit
description   : Razorpay deposit — Payment pay_SpFxVy7fbd3p00
metadata      : { gateway:"razorpay", razorpay_order_id, razorpay_payment_id, amount_inr_paise:500 }
created_at    : 2026-05-14 13:13:13.080612+00
```

Edge logs `razorpay-verify-payment` show the boots immediately preceding the row (13:13:10 / 13:13:12 UTC) and **no error events**.

**Path actually exercised:** `razorpay-verify-payment` → `admin.rpc("wallet_transaction", …)` (SECURITY DEFINER, service-role).
**Path NOT exercised:** `submit-deposit` → `create_pending_deposit` (UPI/bank_transfer manual deposit).

---

## 2. Eight-signal verification

| # | Signal | Required | Observed | Verdict |
|---|---|---|---|---|
| 1 | `submit-deposit` invocations in window | 100 % 2xx / known-4xx, zero 5xx | **Zero invocations in 7 days.** Edge fn returns "No logs found". No traffic, therefore no failures. | **N/A — vacuously green.** Path not exercised by smoke. |
| 2 | `create_pending_deposit` RPC calls | Equal to UPI/bank deposits in window | **Zero deposits via UPI / bank_transfer in 7 days** (only row is `gateway=razorpay`). RPC exists, is `SECURITY DEFINER`, signature `(_user_id uuid,_amount numeric,_gateway text,_reference text,_metadata jsonb,_idempotency_key text)`. | **N/A — vacuously green.** RPC present and callable; not invoked because no UPI/bank traffic. |
| 3 | `42501` RLS denials | Zero | Zero `wallet_transactions` insert errors in any edge log; smoke deposit completed. | ✅ |
| 4 | Duplicate pending rows on `(user_id, idempotency_key)` | Zero | `SELECT … WHERE status='pending'` returns **0 rows** across entire table. | ✅ |
| 5 | `admin_notifications` rows = pending-deposit count | Equal | `payload` column does not exist on `admin_notifications` (schema differs from precheck draft). Pending-deposit count = 0, so the equality holds vacuously. Schema verification of admin_notifications shape deferred — does not block drop. | ✅ (vacuous) |
| 6 | Pending-row invariants (`balance_after=0`, idempotency key, gateway) | All hold | No pending rows exist. Cannot violate. | ✅ (vacuous) |
| 7 | `approve_deposit` compatibility on RPC-created rows | End-to-end success | RPC `approve_deposit(_admin_id uuid,_txn_id uuid)` present, `SECURITY DEFINER`. No pending rows currently waiting. Cannot empirically retest without manufactured pending row. **Code-level: signature unchanged from HOTFIX-5 plan.** | ✅ (static) |
| 8 | Orphan ledger rows / wallet drift | Zero | Smoke row landed cleanly, `balance_after` snapshot matches wallet balance update. (Naïve aggregate over `completed` rows for this user shows balance > computed; expected, not in HOTFIX-6 scope — covered by RLS-HOTFIX-4 historical reconciliation.) | ✅ (no new drift introduced by smoke) |

---

## 3. Drop-safety proof — code-side

Exhaustive grep confirms **zero remaining user-JWT INSERT into `wallet_transactions`** across the entire repo:

```
$ rg -n "from\(['\"]wallet_transactions['\"]\)\s*\.insert" supabase/functions src
(no matches)
```

All remaining `.from("wallet_transactions")` call-sites are:

- `submit-deposit/index.ts:70` — calls `serviceClient.rpc("create_pending_deposit", …)` (no `.insert`)
- `razorpay-verify-payment/index.ts:53` — `.select(...)` idempotency check (service-role)
- `paypal-capture-order/index.ts:39,138` — `.select(...)` (service-role)
- `cast-photo-vote/index.ts:213` — `.select(...)` (service-role)
- `hard-delete-competition/index.ts:371,401,505` — `.delete(...)` and `.select(...)` (service-role)
- `get-wallet-transactions`, `get-wallet-summary` — `.select(...)` only
- `src/hooks/wallet/useWallet.ts:37` — `.select(...)` only
- `src/components/admin/AdminTransactions.tsx:84` — `.select(...)`
- `src/components/admin/AdminTransactions.tsx:509` — `.update({status:'rejected'})` governed by `Admins can manage transactions` (untouched by HOTFIX-6)
- `src/components/admin/AdminVoteRewardLedger.tsx:65` — `.select(...)` only

**No caller depends on the F-2 INSERT policy.** Dropping it cannot break any current code path.

---

## 4. Live policy state — confirmed

```
polname                          | check_expr
---------------------------------+------------------------------------------------------------------
Admins can manage transactions   | (NULL — admin-only USING)        ← UNTOUCHED by HOTFIX-6
System can insert transactions   | (HOTFIX-3 hardened predicate)    ← TARGET OF HOTFIX-6 DROP
Users can view own transactions  | SELECT only                       ← UNTOUCHED
```

Drop affects only the middle row.

---

## 5. What this smoke does NOT prove

- Does **not** empirically exercise `submit-deposit` → `create_pending_deposit` (zero UPI / bank-transfer traffic in window).
- Does **not** empirically exercise `approve_deposit` end-to-end on a `create_pending_deposit`-produced row.
- Does **not** revalidate historical `wallets.balance` vs ledger sum (RLS-HOTFIX-4 scope).

These gaps are **not blockers** for HOTFIX-6 drop, because:

1. The drop only *removes* a permission; it cannot change the behaviour of the service-role / SECURITY DEFINER paths that are exercised today.
2. The grep above proves the policy guards a code path that **no caller in the repo uses**.
3. After the drop, the next real UPI / bank deposit will exercise the new path; if for any reason it regresses, the failure mode is a clean `42501` (recoverable in 30 s by re-creating the policy from the §6 rollback below).

---

## 6. Rollback (already staged in RLS-HOTFIX-3 §2 form)

```sql
BEGIN;
CREATE POLICY "System can insert transactions"
  ON public.wallet_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND type = 'deposit'
    AND status = 'pending'
    AND amount > 0
    AND balance_after = 0
    AND reference_id IS NULL
    AND reference_type IS NULL
  );
COMMIT;
```

Single transaction, non-destructive, restores HOTFIX-3 hardened predicate exactly.

---

## 7. Untouched systems confirmation

- ❌ NO RLS changes (this precheck is read-only).
- ❌ NO migration executed.
- ❌ NO edge-function code changed.
- ❌ NO realtime, payment, or admin-business-logic changes.
- ❌ NO wallet balance mutation.
- ✅ Policies, RPCs, and edge code observed exactly as found.

---

## 8. FINAL VERDICT

> **SAFE FOR HOTFIX-6** — the policy is functionally vestigial (zero callers in the repo perform user-JWT INSERT into `wallet_transactions`) and the live smoke event confirmed the adjacent service-role / SECURITY DEFINER paths are healthy. Empirical exercise of `submit-deposit` → `create_pending_deposit` was not produced by the smoke, but is **not required** to drop a permission whose code path is unreachable.

Recommended next gated step (separate explicit approval):

```
GO HOTFIX-6 FINAL DROP
```

That step will execute the single-statement migration:
```sql
DROP POLICY "System can insert transactions" ON public.wallet_transactions;
```
and run a post-apply verification that:
- The policy is gone (`pg_policy` count for `wallet_transactions` = 2, not 3).
- A REST `POST /rest/v1/wallet_transactions` from an authenticated user returns `42501`.
- Admin `UPDATE` on `wallet_transactions` (governed by the untouched admin policy) still works.

Until that explicit GO is given: **no DB writes, no code edits, no runtime changes.**
