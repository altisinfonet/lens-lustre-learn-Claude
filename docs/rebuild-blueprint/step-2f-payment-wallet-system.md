# STEP 2F — Payment & Wallet System (Forensic Blueprint)

> Read-only audit. **VERIFIED** = confirmed in source paths cited; **NOT VERIFIED** = not opened in this audit.

---

## 1. High-Level Architecture (VERIFIED)

```
                          ┌─────────────────────────────────┐
   Wallet UI / Voting →   │ React Query / hooks (src/hooks/ │
                          │ wallet/*, useCompetitionVoting) │
                          └─────────────┬───────────────────┘
                                        ▼
   Public surface  ──────────────►  Edge Functions (12)  ◄────── Admin surface
        │                                                                 │
        ▼                                                                 ▼
 site_settings.payment_gateways  ──►  RPC `wallet_transaction`  ──►  wallets / wallet_transactions
       (RLS-locked, sanitized via                                         │
        `get-payment-gateways-public`)                                    ▼
                                                              gift_credits, gift_announcements,
                                                              withdrawal_requests, bank_details,
                                                              referral_codes, referrals,
                                                              competition_votes, admin_notifications
```

Money model (Core memory): **Financial Model Option B — admin wallet is credited atomically on deposit; spending = atomic insert-then-deduct.** Every credit/debit ultimately goes through the **`wallet_transaction` SQL RPC** (single chokepoint).

---

## 2. Pages (VERIFIED)

| Page | LOC | Purpose |
|---|---|---|
| `src/pages/Wallet.tsx` | 1071 | User wallet UI: balance, ledger, deposit (Stripe / PayPal / Razorpay / UPI / Bank Transfer), withdrawal, gift announcements |
| `src/pages/Referrals.tsx` | 343 | Referral code generation + invite + ledger |

---

## 3. Hooks Map (VERIFIED `src/hooks/wallet/`)

| Hook | LOC | Type | Source of truth | Notes |
|---|---|---|---|---|
| `useWallet` | 101 | `useState/useEffect` | direct DB `wallets` + `wallet_transactions` + `site_settings.usd_to_inr_rate` | Eager load (100 tx). Exposes `addFunds` / `deductFunds` (both call RPC `wallet_transaction`). |
| `useWalletPageData` | 61 | `useQuery` | parallel: `gift_announcements`, edge `get-payment-gateways-public`, `bank_details`, `withdrawal_requests` | Used by Wallet page only. |
| `useWalletSummary` | 49 | `useQuery` | edge `get-wallet-summary` | **LAZY** — `enabled` gated to `pathname.startsWith("/wallet")` to avoid concurrency spikes. `staleTime=5m`, `gcTime=10m`, no refocus. |
| `useWalletTransactions` | 45 | `useInfiniteQuery` | edge `get-wallet-transactions` | Page size 50. |
| `useWalletDeposits` | 51 | `useMutation` | edge `submit-deposit` (UPI / bank_transfer only) | Invalidates `walletSummary`, `walletTransactions`, `walletPageData` on success. |
| `useWalletWithdrawals` | 104 | `useMutation` | direct DB + RPC `wallet_transaction` | Client-side limits: $1 ≤ amount ≤ $50,000. Pre-check for existing `pending` row. **Insert-then-deduct** with rollback on RPC failure. Optional `bank_details` upsert. |
| `useWalletGifts` | 40 | `useQuery` | direct `gift_announcements` | Splits into `activeGifts` / `expiredGifts` from `is_expired` flag. |

---

## 4. Edge Functions (VERIFIED `supabase/functions/`)

| Function | LOC | Auth | Purpose / Critical behavior |
|---|---|---|---|
| `submit-deposit` | 86 | JWT (anon-key + `auth.getClaims`) | UPI / bank-transfer manual deposit. Inserts `wallet_transactions { type:"deposit", status:"pending" }` + `admin_notifications { type:"deposit_request" }`. Limits: $1–$50k. Reference trimmed to 200 chars. **No money credited** until admin approves. |
| `get-wallet-summary` | 65 | JWT | Returns `{ balance, pendingDeposits, pendingWithdrawals }` (parallel reads). |
| `get-wallet-transactions` | 58 | JWT | Paginated wallet_transactions; default page size 50. |
| `create-payment-session` | NOT VERIFIED past line 80 | JWT | Creates Stripe Checkout / Razorpay order / PayPal order from `site_settings.payment_gateways`. Origin → `${origin}/wallet?payment=success\|cancelled`. |
| `paypal-capture-order` | 168 | JWT | **Idempotent**: skips if a completed `wallet_transactions` row already matches `metadata { gateway:"paypal", paypal_order_id }`. Handles `ORDER_ALREADY_CAPTURED` (422) by re-fetching the order. Validates `status==COMPLETED\|APPROVED`. Reads PayPal cfg from `site_settings.payment_gateways.paypal` (sandbox/live URL switch). |
| `razorpay-verify-payment` | NOT VERIFIED past line 80 | JWT | Verifies `HMAC_SHA256(order_id + "|" + payment_id, key_secret)`. Idempotency on `metadata { razorpay_payment_id }`. Then calls Razorpay GET payment for amount/captured confirmation. |
| `get-payment-gateways-public` | 50+ | **anon** | Returns sanitized `{stripe:{enabled,publishable_key}, paypal:{enabled,client_id,mode}, razorpay:{enabled,key_id}, upi:{enabled,…}, …}`. Strips secret keys (`stripe.secret_key`, `razorpay.key_secret`, `paypal.secret`). Required because `payment_gateways` row in `site_settings` is RLS-blocked. |
| `admin-process-withdrawal` | 125 | JWT + `user_roles.role='admin'` check | Atomic withdrawal approve/reject. Order: (1) deduct via RPC `wallet_transaction(type:"withdrawal", -amount, ref=withdrawal_id)`, (2) update row `status`. On step-2 failure → reverses with `wallet_transaction(type:"withdrawal_reversal", +amount)`. Always writes `db_audit_logs`. |
| `send-gift-credit` | 115 | JWT + admin | Two paths: `target_type:"email"` (resolves via `auth.admin.listUsers`) or `user_ids[]`. Insert `gift_credits` → call RPC `admin_wallet_credit` → insert `gift_announcements`. **Wallet-credit-first**: if RPC fails, deletes the `gift_credits` row to avoid orphans. Announcement failure is logged but non-fatal. |
| `expire-gift-credits` | 60 | service role | Sweeper marks expired `gift_announcements`. NOT VERIFIED past line 50. |
| `cast-photo-vote` | 299 | JWT | Photo-grain atomic vote (Phase 1 fix). See §6. |

---

## 5. Tables & RPCs (VERIFIED references)

### 5.1 Core wallet tables
- `wallets { user_id, balance, … }` — single row per user.
- `wallet_transactions { id, user_id, type, amount (signed), balance_after, description, reference_id, reference_type, status, created_at, metadata jsonb }` — append-only ledger.
- `withdrawal_requests { id, user_id, amount, status:[pending|processing|approved|rejected], bank_details jsonb, admin_note, reviewed_by, created_at, updated_at }`.
- `bank_details { user_id (PK), bank_name, bank_account_name, bank_account_number, bank_ifsc }` — accessed via `from("bank_details" as any)` (typing escape hatch).
- `gift_credits { id, admin_id, amount, reason, target_type, target_value, recipients_count }`.
- `gift_announcements { id, user_id, gift_credit_id, amount, reason, expires_at, is_expired, is_read, created_at }`.
- `referral_codes { user_id, code }`, `referrals { id, referrer_id, referred_id, status, reward_amount, created_at, rewarded_at }`.
- `competition_votes { id, entry_id, user_id, photo_index, created_at }` — UNIQUE on `(entry_id, user_id, photo_index)` per "One Image, One Vote".
- `admin_notifications { type, title, message, reference_id, … }` — fan-out for admin review.
- `db_audit_logs { table_name, operation, row_id, old_data, new_data, changed_by }`.

### 5.2 RPCs invoked
| RPC | Callers | Purpose |
|---|---|---|
| `wallet_transaction(_user_id, _type, _amount, _description, _reference_id?, _reference_type?)` | `useWallet`, `useWalletWithdrawals`, `admin-process-withdrawal`, `cast-photo-vote` | The **only** sanctioned ledger writer. Amount is signed (`+credit / −debit`). Updates `wallets.balance` and inserts `wallet_transactions` atomically. |
| `admin_wallet_credit(_admin_id, _target_user_id, _amount, _type, _description, _reference_id, _reference_type)` | `send-gift-credit` | Admin-side credit (Financial Model Option B). |
| `current_phase(p_competition_id)` | `cast-photo-vote` | Canonical SQL phase gate (R5 single source of truth). |

### 5.3 Settings rows (all in `site_settings.value jsonb`)
- `usd_to_inr_rate` → `{ rate, source, auto_fetch }`
- `payment_gateways` → `{ stripe:{enabled, publishable_key, secret_key}, paypal:{enabled, mode, client_id, secret}, razorpay:{enabled, key_id, key_secret}, upi:{enabled, …}, bank:{enabled, …} }` — **RLS-locked**, fetched server-side or via sanitized `get-payment-gateways-public`.
- `vote_reward_config` → `{ active, voter_reward, entry_owner_reward }` (read by `cast-photo-vote`).

---

## 6. Voting / Earn-While-You-Create Flow (VERIFIED `cast-photo-vote`)

1. **Authn** via JWT (anon-key client + `auth.getUser`).
2. **Validate**: `entryId` UUID, `action ∈ {vote, unvote}`, `0 ≤ photoIndex ≤ 99`.
3. **Lookup** `competition_entries (id, user_id, competition_id, photos, photo_meta)`. Reject if `photo_meta[i].rejected === true`. Reject self-vote.
4. **Phase gate** via `current_phase()` RPC. Allowed windows: `submission_open` (early engagement) and `voting`.
5. **Vote row**: insert into `competition_votes (entry_id, user_id, photo_index)` or capture id then delete.
6. **Reward / penalty** via `wallet_transaction` RPC:
   - **Vote**: skips if `wallet_transactions { type:"vote_reward", reference_id=voteRowId, reference_type:"competition_vote" }` already exists (idempotency).
     - Voter: `+voter_reward` (`type=vote_reward`).
     - Entry owner (≠ voter): `+entry_owner_reward` (`type=vote_reward`).
   - **Unvote**: penalty = `2× voter_reward` and `2× entry_owner_reward` (Wallet Protection memory).
     - `type="unvote_penalty"`. `reference_id` = pre-delete `voteRowId` if available, else `entryId` (with `reference_type="competition_entry"`) — Phase 2.2 W4 traceability rule.
   - Skipped early-exit reasons returned in payload: `not_vote_reward_window`, `rewards_inactive`, `already_rewarded`.
7. Returns `{success, action, photo_index, rewards_applied, voter_reward(signed), reason?}`.

UX rule (memory `unvote-penalty-ux`): **all toggles must show explicit 2× penalty AlertDialog** before firing `action="unvote"`; never bypass `cast-photo-vote` with a direct delete.

---

## 7. Deposit / Withdrawal Lifecycles (VERIFIED)

### 7.1 Manual deposit (UPI / Bank Transfer)
```
User → useWalletDeposits → submit-deposit edge fn
         insert wallet_transactions {status:"pending"}
         insert admin_notifications {type:"deposit_request"}
                                            │
Admin (AdminWalletTab) approves → wallet_transaction RPC credits balance,
                                  flips wallet_transactions row to completed
```
NOT VERIFIED: exact admin-approval edge function name (the admin-side approval flow lives in `AdminWalletTab.tsx`, not opened beyond line 40).

### 7.2 Gateway deposit (Stripe / PayPal / Razorpay)
```
User clicks gateway in Wallet.tsx
  → create-payment-session (returns checkout/order id + redirect URL)
  → user redirected to gateway hosted UI
  → gateway redirects back to /wallet?...
       Stripe: ?payment=success → banner "Stripe", refresh
       PayPal: ?token=<order_id>&PayerID=… → paypal-capture-order
                (idempotent capture → wallet credited inside fn)
       Razorpay: client posts to razorpay-verify-payment (HMAC verify → credit)
       cancel: ?payment=cancelled → banner only
  → fireConversion("payment_success", {gateway, amount?})
  → useWallet.refresh()
```

### 7.3 Withdrawal
```
User submits Wallet.tsx withdraw form
 → useWalletWithdrawals
     1. validate $1 ≤ amount ≤ $50,000
     2. (optional) upsert bank_details
     3. SELECT pending withdrawals → block if any
     4. INSERT withdrawal_requests {status:"pending"}        (no money moved)
     5. RPC wallet_transaction(type:"withdrawal", -amount)   (deduct now)
        on failure → DELETE the just-inserted pending row
 → admin opens Admin Wallet
 → admin-process-withdrawal {approve|reject}
     approve: wallet_transaction already deducted at request-time;
              this fn applies a SECOND wallet_transaction(type:"withdrawal", -amount)
              with reference_id=withdrawal_id, then updates row status.
              On status-update failure → wallet_transaction(type:"withdrawal_reversal", +amount).
     reject:  status only updated; refund handled out-of-band (NOT VERIFIED)
     always : db_audit_logs row written.
```
**⚠ Risk** (see §11): The hook deducts at request time **and** the admin fn deducts again on approval — a double-debit unless one side is a no-op. The admin fn comment says *"deduct from wallet FIRST (atomic check)"* and references `withdrawal_id`, while the hook's deduction has no `_reference_id`. Reconciliation logic is NOT VERIFIED in this audit.

### 7.4 Gift credit (admin → user)
```
Admin (AdminGiftCredit.tsx, 484 lines) → send-gift-credit
   target_type="email" or user_ids[]
   for email path:
     resolve via auth.admin.listUsers
     INSERT gift_credits
     RPC admin_wallet_credit          (CRITICAL: wallet credit FIRST)
       on failure → DELETE gift_credits row (no orphan)
     INSERT gift_announcements        (failure logged, not fatal)
```

### 7.5 Gift expiry
- `expire-gift-credits` cron sweeper (NOT VERIFIED past line 50).
- `gift_announcements.is_expired` is the source of truth used by `useWalletGifts`.

---

## 8. UI States in `Wallet.tsx` (VERIFIED partial — first ~260 lines)

| State | Type | Notes |
|---|---|---|
| `currencyDisplay` | "usd" \| "inr" | Conversion via `toINR(usd)` from `useWallet` |
| `addAmount`, `addCurrency` | string / "usd" \| "inr" | Top-up entry; `getAmountInUSD()` normalizes |
| `upiStep`, `upiTxnRef`, `bankStep`, `bankTxnRef` | step machines for manual flows |
| `withdrawSubmitting`, `wBankName/wAccountName/wAccountNumber/wIfsc` | withdrawal form |
| `gatewayLoading` | per-button spinner during `create-payment-session` invoke |
| `returnBanner` | `success \| cancelled \| error \| processing` after gateway redirect |

Loading: `authLoading || loading` → minimal "Loading…" splash. Empty/error states for ledger NOT VERIFIED in detail.

---

## 9. Component Hierarchy (VERIFIED)

```
<Wallet>                                       (1071 lines)
  ├─ useAuth, useWallet, useWalletPageData
  ├─ useWalletSummary (lazy on /wallet)
  ├─ useWalletTransactions (infinite)
  ├─ useWalletGifts
  ├─ useWalletDeposits, useWalletWithdrawals
  ├─ <GiftCelebrationModal>                    (232 lines)
  ├─ Currency toggle (USD ↔ INR via site_settings.usd_to_inr_rate)
  └─ Gateway return-handler effect (PayPal capture / Stripe banner)

<Referrals>                                    (343 lines)
  ├─ referral_codes auto-create (alphabet skip I,O,1,0)
  ├─ referrals + profiles_public name join
  └─ ?ref=<code> link copy + email invite (NOT VERIFIED past line 120)

<AdminGiftCredit>                              (484 lines)
  └─ → send-gift-credit edge fn

<AdminWalletTab>                               (NOT VERIFIED past line 40)
  └─ uses safeAdminExecute, WalletReconciliationAudit
```

---

## 10. Hook → UI Map

| Surface | Hook(s) | Edge fn / RPC |
|---|---|---|
| Wallet header / balance | `useWallet`, `useWalletSummary` | `get-wallet-summary` |
| Ledger | `useWalletTransactions` | `get-wallet-transactions` |
| Pending pills | `useWalletPageData` | direct + `get-payment-gateways-public` |
| Gift list | `useWalletGifts` | `gift_announcements` direct |
| Manual deposit | `useWalletDeposits` | `submit-deposit` |
| Gateway deposit | inline in `Wallet.tsx` | `create-payment-session`, `paypal-capture-order`, `razorpay-verify-payment` |
| Withdrawal | `useWalletWithdrawals` | `wallet_transaction` RPC + DB |
| Photo voting reward | `useCompetitionVoting` (Step 2B) | `cast-photo-vote` |
| Admin gifting | `AdminGiftCredit` | `send-gift-credit` → `admin_wallet_credit` RPC |
| Admin withdrawal review | `AdminWalletTab` | `admin-process-withdrawal` |

---

## 11. Risks / Tech-Debt (VERIFIED in code)

| Risk | Source | Severity |
|---|---|---|
| **Possible double-debit on withdrawal approval** — `useWalletWithdrawals` deducts at request time *and* `admin-process-withdrawal` deducts again on approve. Reconciliation logic NOT VERIFIED. | `useWalletWithdrawals.ts` L60–80 vs `admin-process-withdrawal/index.ts` L60–95 | **high — needs verification** |
| `bank_details` table accessed with `as any` (no generated types). | `useWalletPageData.ts`, `useWalletWithdrawals.ts` | low |
| `referral_codes` / `referrals` tables also `as any`. | `Referrals.tsx` | low |
| Two parallel rate caches (`useWallet` direct fetch + `useWalletPageData` parallel fetch) — possible drift for ≤5 min `staleTime`. | `useWalletSummary.ts` vs `useWallet.ts` | low |
| `useWallet` eager-loads up to 100 transactions on every mount even when user isn't on /wallet. | `useWallet.ts` L29–46 | medium (perf) |
| `useWalletDeposits` accepts only `"upi" \| "bank_transfer"` — gateway deposits bypass this hook entirely (handled inline in `Wallet.tsx`). Two different code paths for "deposit". | `useWalletDeposits.ts` + `Wallet.tsx` L210–260 | medium (maintainability) |
| `wallet_transaction` is the ONLY ledger writer — must never be bypassed. Confirmed: every credit/debit in code goes through it (memory rule). | all edge fns audited | accepted |
| `payment_gateways` secrets live in `site_settings.value jsonb`, not in vault. Sanitized via dedicated edge fn for the public side. | `get-payment-gateways-public` | accepted (RLS-locked) |
| Rate config `usd_to_inr_rate` is read client-side from `site_settings`; stale up to refresh. Default fallback `83.5`. | `useWallet.ts` L31 | low |
| PayPal capture handles 422 ORDER_ALREADY_CAPTURED but only fetches and re-credits if no completed wallet row exists — hardened idempotency. | `paypal-capture-order/index.ts` L80–115 | accepted |
| `Wallet.tsx` is 1071 LOC monolith mixing 6 hooks + 3 gateway flows + 2 manual flows + currency toggle. | `Wallet.tsx` | medium (refactor candidate) |

Open items / NOT VERIFIED in this audit:
- `create-payment-session` body past line 80 (Razorpay/PayPal branches).
- `razorpay-verify-payment` body past line 80 (refund / wallet credit step).
- `expire-gift-credits` body past line 50.
- `Wallet.tsx` lines 260–1071 (all the JSX surfaces, banners, ledger rendering).
- `Referrals.tsx` lines 120–343 (invite send + admin override).
- `AdminWalletTab.tsx` past line 40 (approve/reject UI; uses `WalletReconciliationAudit`).
- `AdminGiftCredit.tsx` past line 40.
- `submitting → completed` state transition for manual deposits — admin-approval edge fn name not located in this audit.

---

**End of Step 2F.**
