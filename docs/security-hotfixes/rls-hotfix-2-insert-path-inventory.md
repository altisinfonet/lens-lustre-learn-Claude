# RLS-HOTFIX-2 — Forensic Inventory: Legitimate INSERT Paths on `wallet_transactions`, `wallets`, `withdrawal_requests`

**Mode:** READ-ONLY. No migrations, no RLS changes, no code edits, no runtime changes.
**Method:** Exhaustive `rg` over `src/**` and `supabase/functions/**` for `.from('<tbl>')` and `.rpc('wallet_transaction' | 'approve_deposit' | …)`, plus line-level inspection of every hit.
**Mandate:** `/docs/forensic-engineering-mandate.md` (Zero Assumption / Zero Guesswork).
**Predecessor:** `docs/security-hotfixes/wallet-transactions-rls-hole-classification.md` (RLS-HOTFIX-1).

---

## 1. VERIFIED INSERT / WRITE PATHS

> Legend — **Auth**: anon | user-JWT (RLS-bound) | service-role (SR, bypasses RLS) | admin RPC.
> Legend — **RLS-dep?**: YES = relies on the policy being patched ⇒ will 401 if patch applied as-is. NO = unaffected by patch.

### A. `wallet_transactions`

| # | File : line | Operation | Auth | RLS-dep? | Class |
|---|---|---|---|---|---|
| A1 | `supabase/functions/submit-deposit/index.ts:58` | `.insert({ user_id: userId, type:'deposit', status:'pending', … })` | **user-JWT (anon-key client + Authorization header)** — `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { headers: Authorization })` | **YES** — depends on F-2 policy `WITH CHECK (user_id = auth.uid())` | **SAFE intent / RLS-DEPENDENT** |
| A2 | `supabase/functions/razorpay-verify-payment/index.ts:53` | `.select(...)` (read-only — idempotency check) | service-role | NO | SAFE (read) |
| A3 | `supabase/functions/razorpay-verify-payment/index.ts:135` | `admin.rpc('wallet_transaction', …)` | service-role → SECURITY DEFINER RPC | NO (bypasses RLS) | SAFE |
| A4 | `supabase/functions/paypal-capture-order/index.ts:39` & `:138` | `.select(...)` (idempotency) | service-role | NO | SAFE (read) |
| A5 | `supabase/functions/paypal-capture-order/index.ts:148` | `admin.rpc('wallet_transaction', …)` | service-role → SD RPC | NO | SAFE |
| A6 | `supabase/functions/cast-photo-vote/index.ts:213` | `.select(...)` (idempotency check) | service-role | NO | SAFE (read) |
| A7 | `supabase/functions/cast-photo-vote/index.ts:225, 235, 256, 266` | `admin.rpc('wallet_transaction', …)` (vote_reward + unvote_penalty, both sides) | service-role → SD RPC | NO | SAFE |
| A8 | `supabase/functions/admin-process-withdrawal/index.ts:64` | `admin.rpc('wallet_transaction', …)` (deduct on approve) | admin-gated edge fn → SR → SD RPC | NO | SAFE |
| A9 | `supabase/functions/admin-process-withdrawal/index.ts:94` | `admin.rpc('wallet_transaction', …)` (auto-reversal) | same as A8 | NO | SAFE |
| A10 | `supabase/functions/expire-gift-credits/index.ts:39` | `admin.rpc('wallet_transaction', …)` (gift expiry debit) | cron / service-role → SD RPC | NO | SAFE |
| A11 | `supabase/functions/get-wallet-transactions/index.ts:44` | `.select(...)` | user-JWT | n/a | SAFE (read) |
| A12 | `supabase/functions/get-wallet-summary/index.ts:33` | `.select(...)` | user-JWT | n/a | SAFE (read) |
| A13 | `supabase/functions/hard-delete-competition/index.ts:371, 401, 505` | `.delete()` / `.select()` (admin competition purge) | admin edge fn → service-role | NO | SAFE (admin) |
| A14 | `src/hooks/wallet/useWallet.ts:65` | `supabase.rpc('wallet_transaction', …)` (`addFunds`) | user-JWT → SD RPC | NO (RPC is SECURITY DEFINER, runs as definer) | SAFE — but see §9-R1 |
| A15 | `src/hooks/wallet/useWallet.ts:78` | `supabase.rpc('wallet_transaction', …)` (`deductFunds`) | user-JWT → SD RPC | NO | SAFE — see §9-R1 |
| A16 | `src/hooks/wallet/useWalletWithdrawals.ts:65` | `supabase.rpc('wallet_transaction', …)` (deduct after request) | user-JWT → SD RPC | NO | SAFE |
| A17 | `src/components/admin/AdminTransactions.tsx:84` | `.select(...)` | admin user-JWT | n/a | SAFE (read) |
| A18 | `src/components/admin/AdminTransactions.tsx:509` | `.update({ status:'rejected' }).eq('id', t.id)` | admin user-JWT (RLS admin policy `Admins can manage transactions` permits) | depends on **admin** RLS policy, NOT on the policy being dropped | **UNSAFE design** (admin UI mutates ledger row directly — Sprint-0A baseline `F-1 CRITICAL`). Survives the patch but should move to RPC. |
| A19 | `src/components/admin/AdminVoteRewardLedger.tsx:65` | `.select(...)` | admin user-JWT | n/a | SAFE (read) |

### B. `wallets`

| # | File : line | Operation | Auth | RLS-dep? | Class |
|---|---|---|---|---|---|
| B1 | `supabase/functions/get-wallet-summary/index.ts:31` | `.select('balance')` | user-JWT | n/a | SAFE (read) |
| B2 | `supabase/functions/expire-gift-credits/index.ts:33` | `.select('balance')` | service-role | n/a | SAFE (read) |
| B3 | `src/hooks/wallet/useWallet.ts:35` | `.select('balance')` | user-JWT | n/a | SAFE (read) |
| B4 | (DB-side) `wallet_transaction` SECURITY DEFINER RPC — performs the actual `INSERT … ON CONFLICT DO UPDATE` on `wallets` and the `INSERT` on `wallet_transactions`. | RPC executes as definer (postgres / supabase_admin) | NO — bypasses RLS by definition | SAFE |
| B5 | **No code path** in `src/**` or `supabase/functions/**` performs `.from('wallets').insert(` directly. Confirmed by exhaustive grep. | — | — | DEAD-USE for F-3 policy |

### C. `withdrawal_requests`

| # | File : line | Operation | Auth | RLS-dep? | Class |
|---|---|---|---|---|---|
| C1 | `src/hooks/wallet/useWalletWithdrawals.ts:46` | `.select('id')` (pending check) | user-JWT | n/a | SAFE (read) |
| C2 | `src/hooks/wallet/useWalletWithdrawals.ts:56` | `.insert([{ user_id: user.id, amount, bank_details }])` | user-JWT | **YES** — depends on F-1 policy (currently `with_check = NULL`). After patch with `WITH CHECK (user_id = auth.uid())` this still works because `user_id` is set to `user.id`. | **SAFE after correct patch** |
| C3 | `src/hooks/wallet/useWalletWithdrawals.ts:73` | `.delete().eq('user_id', user.id).eq('status','pending')…` (rollback) | user-JWT | DELETE is admin-only on `withdrawal_requests` (only `Admins can manage withdrawals` covers DELETE). | **CURRENTLY BROKEN / DEAD** — this rollback already cannot delete (no user DELETE policy). Pre-existing bug, unrelated to this hotfix. |
| C4 | `src/hooks/wallet/useWalletPageData.ts:32` | `.select(...)` | user-JWT | n/a | SAFE (read) |
| C5 | `supabase/functions/admin-process-withdrawal/index.ts:49` | `.select(...)` | admin/SR | n/a | SAFE (read) |
| C6 | `supabase/functions/admin-process-withdrawal/index.ts:82` | `.update({ status, admin_note, reviewed_by })` | admin/SR | NO | SAFE |
| C7 | `supabase/functions/delete-user/index.ts:75` | `.update({ reviewed_by: null })` (cascade scrub) | service-role | NO | SAFE |
| C8 | `src/components/admin/AdminWalletTab.tsx:68` | `.select(...)` | admin user-JWT | n/a | SAFE (read) |

### D. Adjacent finance tables (referenced for completeness, NOT in patch scope)

| # | File : line | Notes |
|---|---|---|
| D1 | `src/components/AdminGiftCredit.tsx:193` | `.from('gift_credits').insert(…)` from admin UI — Sprint-0A baseline (HIGH). Not in this hotfix scope. |
| D2 | `src/pages/CompetitionSubmit.tsx:325`, `src/components/admin/AdminReferrals.tsx:124` | `supabase.rpc('process_referral_reward')` — SD RPC. Out of scope. |
| D3 | `src/hooks/competition/useCompetitionEntryMutations.ts:35` | `supabase.rpc('submit_competition_entry')` — SD RPC. Out of scope. |
| D4 | `src/components/admin/AdminTransactions.tsx:482` | `supabase.rpc('approve_deposit')` — SD RPC. Out of scope. |

---

## 2. SAFE PATHS (require no change for the patch)

A2–A13, A14–A16, A17, A19, B1–B4, C1, C4–C8 — all reads, all SECURITY DEFINER RPC calls, all admin/service-role direct writes, and the user-JWT withdrawal `INSERT` (after the F-1 fix correctly sets `WITH CHECK (user_id = auth.uid())`).

## 3. UNSAFE PATHS (survive patch but should be refactored)

- **A18** — `AdminTransactions.tsx:509` admin UI directly UPDATEs `wallet_transactions.status`. Already in Sprint-0A baseline as `F-1 CRITICAL`. Survives patch (admin RLS policy `Admins can manage transactions` is untouched), but should move to a server-side reconciliation RPC.
- **D1** — `AdminGiftCredit.tsx:193` direct insert into `gift_credits`. Sprint-0A baseline HIGH. Out of this hotfix scope.

## 4. DEAD / LEGACY PATHS

- **B5** — Zero direct `.from('wallets').insert(...)` exists in the codebase. The F-3 policy (`System can insert wallets`) has **no live consumer**. Dropping it is **zero-impact**. Wallet rows are created exclusively by the `wallet_transaction` SECURITY DEFINER RPC's `INSERT … ON CONFLICT DO UPDATE` path (B4), which bypasses RLS.
- **C3** — `useWalletWithdrawals.ts:73` rollback `.delete()` is already non-functional (no user DELETE policy on `withdrawal_requests`). Pre-existing bug; the patch neither helps nor breaks it.

## 5. NOT VERIFIED

- DB-internal triggers on `wallets` / `wallet_transactions` other than `audit_*` were not re-enumerated in this pass (covered by RLS-HOTFIX-1 §1 F-4: only audit triggers exist, no validation triggers). No new evidence to revise that finding.
- No unknown server cron job inserting directly via REST was found; all crons identified (`expire-gift-credits`, withdrawal admin path) go through the RPC.

## 6. RLS-DEPENDENT FLOWS (the only patch blockers)

| Flow | Depends on | Patch impact if applied as RLS-HOTFIX-1 §11 proposes |
|---|---|---|
| **A1** `submit-deposit` edge fn — pending deposit row insert | F-2 policy (`wallet_transactions` user-JWT INSERT) | **WILL BREAK** — function calls fail with `42501 / new row violates RLS`. Users can no longer file UPI / Bank Transfer deposit requests. |
| **C2** user withdrawal request | F-1 policy (`withdrawal_requests` user-JWT INSERT) | **CONTINUES TO WORK** — F-1 fix only adds `WITH CHECK (user_id = auth.uid())`; existing call sets `user_id: user.id`. |
| **B5** wallet row creation | F-3 policy | **NO IMPACT** — no client code uses this policy. |

## 7. SECURITY DEFINER FLOWS (insulated from RLS patch)

All paths that go through `public.wallet_transaction(...)` RPC: A3, A5, A7, A8, A9, A10, A14, A15, A16. These continue to work post-patch.

## 8. FLOWS THAT WILL BREAK AFTER PATCH (single, explicit list)

1. **`submit-deposit` edge function (A1)** — UPI / Bank Transfer pending-deposit creation. **MUST be fixed before or in the same migration as the F-2 drop.**

No other production flow breaks.

## 9. SAFE PATCH STRATEGY (refined from RLS-HOTFIX-1 §11 — NOT applied)

The original RLS-HOTFIX-1 strategy is **incomplete**: dropping F-2 outright will break `submit-deposit`. Two viable paths:

### Path α — Fix `submit-deposit` first, then drop F-2 (preferred)

1. **Code change (separate PR, no DB migration):** Replace `submit-deposit/index.ts:58` direct `.insert` with either:
   - `admin.rpc('wallet_transaction', { ..., _type:'deposit', _status:'pending' })` using a service-role admin client (matches PayPal / Razorpay pattern), **OR**
   - extend the existing `wallet_transaction` RPC to accept `_status='pending'` (RPC currently writes `status='completed'` — needs verification before changing signature).
2. **Verify** `submit-deposit` end-to-end in staging.
3. **Then** apply the 3-line RLS migration (F-1 ALTER, F-2 DROP, F-3 DROP).

### Path β — Keep F-2 but harden it (fast, lower-blast-radius)

Tighten F-2 instead of dropping:

```sql
-- F-2 (hardened) — still allows submit-deposit's user-JWT insert,
-- but bans arbitrary type/amount/balance manipulation
ALTER POLICY "System can insert transactions"
  ON public.wallet_transactions
  WITH CHECK (
    user_id = auth.uid()
    AND type   = 'deposit'
    AND status = 'pending'
    AND amount > 0
    AND balance_after IS NULL          -- forbids self-mint of running balance
    AND reference_id IS NULL
    AND reference_type IS NULL
  );
```

This closes the F-2 ledger-pollution vector while preserving `submit-deposit` exactly as-is. Path α is still the long-term goal.

### F-1 and F-3 fixes (unchanged from HOTFIX-1)

```sql
ALTER POLICY "Users can create withdrawals"
  ON public.withdrawal_requests
  WITH CHECK (user_id = auth.uid());

DROP POLICY "System can insert wallets" ON public.wallets;  -- zero live consumer
```

## 10. REQUIRED FOLLOW-UP REFACTOR (post-hotfix, NOT this sprint)

- **R1** Move `useWallet.addFunds` / `deductFunds` (A14, A15) — currently exposed to ANY component as a generic credit/debit handle calling SD RPC from the client. Audit who calls them; ideally restrict to specific server-mediated flows.
- **R2** Move `AdminTransactions.tsx:509` ledger UPDATE (A18) into an `admin_reject_transaction` RPC.
- **R3** Move `AdminGiftCredit.tsx:193` (D1) into an `admin_issue_gift_credit` edge function.
- **R4** Repair `useWalletWithdrawals.ts:73` (C3) rollback — currently dead code due to missing user DELETE policy. Either route rollback through `admin-process-withdrawal` style RPC, or accept rollback impossibility and surface admin-side reconciliation.
- **R5** Re-confirm `wallet_transaction` RPC accepts a `_status` argument before Path α; if not, extend the function signature.

## 11. HOTFIX READINESS VERDICT

| Item | Status |
|---|---|
| F-1 (withdrawal_requests open INSERT) | **READY** — patch is one-line ALTER, only consumer (C2) already self-scopes `user_id`. |
| F-3 (wallets open INSERT) | **READY** — DROP has zero live consumer (B5). |
| F-2 (wallet_transactions open INSERT) | **NOT READY for outright DROP** — would break `submit-deposit` (A1). Use Path β (hardened ALTER) immediately, or block DROP until Path α refactor lands. |

**Overall:** Hotfix is **safe to ship for F-1 and F-3 today**, plus **Path β tightening for F-2 today**. The full F-2 DROP must wait for the `submit-deposit` refactor (Path α).

**Phase 1A** remains paused per RLS-HOTFIX-1 §13 — the canonical wallet RPC build cannot start until F-2 is fully closed (Path α complete) and the 179 historical ledger rows are reconciled (RLS-HOTFIX-3).

## NEXT SAFE STEP

`GO RLS-HOTFIX-3` — read-only **historical ledger reconciliation** of the 179 existing `wallet_transactions` rows vs. `wallets.balance` to confirm no exploitation of F-1 / F-2 / F-3 has occurred prior to patch. **No DB writes.**

**No fix applied. Read-only forensic inventory only — complete.**
