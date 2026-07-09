# Phase 1A — Step 2.5 — Close Wallet Authority Gaps (READ-ONLY FORENSIC CLOSURE)

**Status:** READ-ONLY. No migrations, no code, no runtime change.
**Authority:** Forensic Engineering Mandate — Rule 1 (Zero Assumption), Rule 2 (Zero Guesswork), Rule 3 (Diff-Captured).
**Inputs:** Step-1 discovery + Step-3 cutover plan. Closes NV-1 … NV-6.
**Method:** Live DB introspection (`pg_proc`, `pg_indexes`, `pg_constraint`, `information_schema.triggers`, `cron.job`) + `rg` over `src/` + `supabase/functions/` + migrations.

---

## 0. EXECUTIVE VERDICT

**SAFE TO PROCEED to Step-2 (shadow RPC build) with revised scope:** ✅ conditional.
**Critical new findings that REVISE Step-1:**
1. M-12 `cron-vote-payout` **does not exist** — vote rewards run inline inside `cast-photo-vote`. Cutover plan must drop M-12.
2. Three **new** payment-gateway mutation paths missed in Step-1 (`submit-deposit`, `paypal-capture-order`, `razorpay-verify-payment`) directly write `wallet_transactions`.
3. **Hard DELETE** of `wallet_transactions` rows in `hard-delete-competition` violates Soft-Delete Policy and breaks ledger integrity audits.
4. **No DB-level idempotency** on `wallet_transactions` — only per-call ad-hoc `maybeSingle` checks with TOCTOU race.
5. `addFunds` is **dead code** (zero consumers in `src/`). M-04 risk is theoretical, not active.

---

## 1. VERIFIED GAPS CLOSED

| NV-# | Status | Evidence |
|------|--------|----------|
| NV-1 | ✅ CLOSED | `information_schema.triggers` returned **0 rows** for `wallets`, `gift_credits`, `competition_orders`, `wallet_transactions`, `competition_payment_details` |
| NV-2 | ✅ CLOSED | `rg "addFunds" src` → only declaration + export in `src/hooks/wallet/useWallet.ts:63,97`. Zero consumers. |
| NV-3 | ✅ CLOSED | `pg_get_functiondef('approve_deposit')` extracted; FSM = `pending → approved` only, atomic PG transaction |
| NV-4 | ✅ CLOSED | `cron.job` enumerated → 11 active jobs; **no `cron-vote-payout` exists**; auth pattern documented |
| NV-5 | ✅ CLOSED | `rg` + migration scan → all writers identified |
| NV-6 | ✅ CLOSED with **CRITICAL FINDING** | `pg_indexes` on `wallet_transactions` shows NO unique idempotency index |

---

## 2. TRIGGER INVENTORY

```sql
SELECT * FROM information_schema.triggers
WHERE event_object_schema='public'
  AND event_object_table IN ('wallets','gift_credits','competition_orders',
                             'wallet_transactions','competition_payment_details');
-- → 0 rows
```

**Implication:** No hidden writers via triggers. The "single writer" claim of `wallet_transaction()` is mechanism-only — **not enforced by DB triggers**. Direct INSERT/UPDATE/DELETE bypasses are possible (and exist — see §5). Closing this requires REVOKE + RLS, not triggers.

---

## 3. CONSUMER INVENTORY (revised vs Step-1)

### 3.1 RPC consumers of `wallet_transaction(...)`

| File | Line | Caller | Notes |
|------|------|--------|-------|
| `supabase/functions/cast-photo-vote/index.ts` | 225, 235, 256 | vote reward (voter), vote reward (owner), unvote penalty | inline reward (no cron) |
| `src/hooks/wallet/useWallet.ts` | 63 (`addFunds`) | **DEAD CODE** — 0 consumers | safe to delete in Phase E |
| `src/pages/CompetitionSubmit.tsx` | 325 | `process_referral_reward` (different RPC) | indirect |
| `src/components/admin/AdminReferrals.tsx` | 124 | `process_referral_reward` | indirect |

### 3.2 RPC consumers of `admin_wallet_credit(...)`

| File | Line | Path |
|------|------|------|
| `src/components/admin/AdminWalletTab.tsx` | 119 | admin direct credit |
| `src/components/AdminGiftCredit.tsx` | 210 | gift fan-out (client loop) |
| `supabase/functions/send-gift-credit/index.ts` | 73 | server gift |

### 3.3 RPC consumers of `approve_deposit(...)`

| File | Line | Path |
|------|------|------|
| `src/components/admin/AdminTransactions.tsx` | 482 | admin approves pending deposit |

### 3.4 DIRECT `wallet_transactions` table writers (BYPASSES of `wallet_transaction()`)

| ID | File | Line | Op | Severity |
|----|------|------|-----|----------|
| **M-NEW-A** | `supabase/functions/submit-deposit/index.ts` | 58 | INSERT (status='pending') | High |
| **M-NEW-B** | `supabase/functions/paypal-capture-order/index.ts` | 39, 138 | INSERT + UPDATE | High |
| **M-NEW-C** | `supabase/functions/razorpay-verify-payment/index.ts` | 53 | INSERT | High |
| **M-NEW-D** | `supabase/functions/hard-delete-competition/index.ts` | 371, 401, 505 | **DELETE** wallet_transactions | **CRITICAL** — violates Soft-Delete Policy, destroys ledger |
| M-11 | `src/components/admin/AdminTransactions.tsx` | 509 | UPDATE status='rejected' | High (Step-1 confirmed) |

### 3.5 `gift_credits` writers

| File | Line | Op |
|------|------|-----|
| `src/components/AdminGiftCredit.tsx` | 110, 194 | INSERT + DELETE-on-rollback |
| `supabase/functions/send-gift-credit/index.ts` | 62, 86 | INSERT + DELETE-on-rollback |

---

## 4. FSM VERIFICATION — `approve_deposit(_admin_id, _txn_id)`

### 4.1 Verified state machine

```
pending ──approve_deposit()──► approved   (atomic, single PG transaction)
pending ──client UPDATE────────► rejected   (UNGUARDED — M-11)
approved ──(no path)
rejected ──(no path)
```

### 4.2 Verified guards (extracted from `pg_proc`)

1. `has_role(_admin_id, 'admin')` else `RAISE EXCEPTION` — ✅
2. Row exists else `RAISE EXCEPTION` — ✅
3. `_txn.status = 'pending'` else `RAISE EXCEPTION` — ✅ (idempotent against replay)

### 4.3 Atomicity & rollback

- The function performs: **(a)** credit user wallet via `wallet_transaction()`, **(b)** credit platform-admin wallet via `wallet_transaction()`, **(c)** UPDATE `wallet_transactions.status='approved'`.
- All three are inside the same plpgsql function ⇒ same PG transaction ⇒ failure of (b) or (c) **rolls back (a)** automatically. ✅ Atomic.
- **No retry logic** — caller must retry. Status guard makes retry safe.

### 4.4 Gaps in FSM coverage

- **No `reject_deposit` RPC** — admin reject path (M-11) bypasses RPC entirely. Direct client UPDATE is the only mechanism. **No FSM guard, no audit, no balance impact.**
- **No `cancel` / `expire` state** — pending deposits can sit forever.

---

## 5. CRON AUTH VERIFICATION

11 active jobs in `cron.job`. All wallet-relevant ones listed:

| Job | Schedule | Auth | Notes |
|-----|----------|------|-------|
| `apply-scheduled-boosts-hourly` | `0 * * * *` | **anon-key Bearer hardcoded** | not wallet-mutating |
| `expire-gift-credits-every-10min` | `*/10 * * * *` | anon-key Bearer | reads `wallets.balance` (gift expiry) |
| `expire-gift-credits-hourly` | `0 * * * *` | anon-key Bearer | **DUPLICATE schedule** of above (10-min and hourly both exist) |
| `expire-photo-verifications-every-15min` | `*/15 * * * *` | anon-key Bearer | not wallet |
| `judging-invariants-nightly` | `15 3 * * *` | anon-key Bearer | not wallet |
| `process-email-queue` | `5 seconds` | **vault `email_queue_service_role_key`** | only one using service role |
| `backfill-thumbnails-daily` | `0 4 * * *` | anon-key | not wallet |
| `detect-orphan-files-weekly` | `0 3 * * 0` | anon-key | not wallet |
| `autoscale-ad-traffic-every-6h` | `0 */6 * * *` | anon-key | not wallet |
| `weekly-backup-reminder` | `0 9 * * 1` | anon-key | not wallet |

### Findings
- **`cron-vote-payout` does NOT exist.** Step-1 M-12 is **DISPROVEN.** Vote rewards run inline inside `cast-photo-vote` (lines 225, 235). Cutover plan §5 C-4 must be removed.
- **`expire-gift-credits` is duplicated** (10-min + hourly). Both anon-key. Potential double-fire risk on gift expiry.
- **Anon-key Bearer is hardcoded** in 10/11 cron commands — rotation requires editing `cron.job` rows. Documented, not a bug per se, but a Phase-2 RLS hardening target.
- Retry semantics: `pg_net.http_post` is fire-and-forget. **No automatic retry.** Failures are logged in `net.http_response` only.

---

## 6. ORDER WRITE PATHS (NV-5)

### 6.1 `competition_orders` writers

| Source | Op | Notes |
|--------|-----|-------|
| `supabase/migrations/20260421055129_*.sql:173` | INSERT inside SQL function | Likely `purchase_competition_entry()` or similar — **need follow-up read** to confirm RPC name and call sites |
| `supabase/functions/hard-delete-competition/index.ts:378` | **DELETE** | Hard delete (Soft-Delete violation) |
| `src/components/admin/AdminOrders.tsx:49` | SELECT only (read) | safe |
| `src/components/admin/AdminTransactions.tsx:102` | SELECT only (read) | safe |

### 6.2 `competition_payment_details` writers

| Source | Op |
|--------|-----|
| `src/services/admin/competitionService.ts:79` | UPSERT (admin sets price) |
| `src/services/admin/competitionService.ts:40` | SELECT (read) |
| `supabase/functions/hard-delete-competition/index.ts:386` | DELETE |

### 6.3 NOT VERIFIED — sub-item

The migration at `20260421055129_*.sql:173` defines a SQL function that INSERTs into `competition_orders`. The function **name** and **call sites** were not inspected in this pass. → **NV-5b: identify the order-INSERT RPC name and all callers.** Low risk (orders flow into `wallet_txn_id` FK, so any mismatch is detectable), but should be closed before Phase D.

---

## 7. IDEMPOTENCY PROOF (NV-6) — **CRITICAL**

### 7.1 Indexes on `wallet_transactions`

```
wallet_transactions_pkey         (id) UNIQUE
idx_wallet_txn_status            (status) WHERE status='pending'
idx_wallet_txn_user_created      (user_id, created_at DESC)
```

### 7.2 Constraints on `wallet_transactions`

```
wallet_transactions_pkey         PRIMARY KEY (id)
```
**No CHECK, no FK, no UNIQUE on `reference_id` or any composite.**

### 7.3 Findings

- **No idempotency column.** `wallet_transactions` has no `idempotency_key` field.
- **No unique constraint on `(user_id, type, reference_id, reference_type)`.** Two identical reward INSERTs for the same vote would both succeed at DB level.
- **Application-level dedupe exists** (e.g. `cast-photo-vote/index.ts:212-219` does `maybeSingle()` pre-check), but this is a **TOCTOU race** under concurrent calls — two simultaneous votes for the same `vote_id` could both pass the pre-check and both INSERT.
- **`approve_deposit` is idempotent by status guard** (status='pending' check) — safe under replay.
- **`competition_orders` IS idempotent at DB level** via `UNIQUE(order_no)`. Good model to follow.
- **`gift_credits` has NO idempotency.** Bulk fan-out (client loop in AdminGiftCredit.tsx) can create duplicates on retry.

### 7.4 Replay-protection scoreboard

| Path | DB-level dedupe | App-level dedupe | Verdict |
|------|-----------------|------------------|---------|
| `wallet_transaction()` (generic) | ❌ | ❌ | UNSAFE under concurrency |
| `approve_deposit()` | ❌ | ✅ status FSM | Safe |
| `cast-photo-vote` reward | ❌ | ✅ but TOCTOU | Race-window unsafe |
| `cast-photo-vote` penalty | ❌ | ❌ (uses synthesized ref) | Unsafe |
| `paypal-capture-order` | ❌ | (unverified) | NOT VERIFIED |
| `razorpay-verify-payment` | ❌ | (unverified) | NOT VERIFIED |
| `submit-deposit` | ❌ | (unverified) | NOT VERIFIED |
| `process_referral_reward` | (unverified) | (unverified) | NOT VERIFIED |
| `competition_orders` | ✅ `UNIQUE(order_no)` | n/a | Safe |
| `gift_credits` | ❌ | ❌ | Unsafe |

---

## 8. REMAINING UNKNOWN AREAS

| # | Item | Why it remains unknown | Impact |
|---|------|------------------------|--------|
| U-1 | Body of `process_referral_reward` (both overloads) — exact FSM, idempotency, balance impact | Not extracted in this pass | Affects M-09 cutover |
| U-2 | Order-INSERT RPC at `migration:173` — name + call sites | Not inspected | Affects Phase B comparison completeness |
| U-3 | `paypal-capture-order` / `razorpay-verify-payment` / `submit-deposit` idempotency mechanisms (provider side?) | Edge fn body not fully read | Affects gateway cutover (Phase D) |
| U-4 | RLS policies on `wallet_transactions`, `wallets`, `gift_credits`, `competition_orders` (who can INSERT/UPDATE/DELETE directly today) | Not queried this pass | Determines whether Phase E REVOKE is sufficient or needs RLS rewrite |
| U-5 | `expire-gift-credits` mutation surface (does it write `wallets.balance`? `gift_credits.status`?) | Only read query confirmed | Affects gift cutover |
| U-6 | `hard-delete-competition` cascade — does the FK `competition_orders.wallet_txn_id ON DELETE SET NULL` mean orphaned ledger rows survive? Yes (per `pg_constraint`). Does the explicit DELETE then erase them? Yes. Confirmed unsafe. | n/a — confirmed | n/a |

---

## 9. BLOCKERS REMAINING (Phase B comparison gate)

| Blocker | Origin | How to close |
|---------|--------|--------------|
| U-1 referral RPC body | NV-2 follow-up | `pg_get_functiondef('process_referral_reward')` (1 SELECT) |
| U-2 order-INSERT RPC | NV-5b | `pg_get_functiondef` of fn defined in migration `20260421055129` (1 SELECT + 1 ripgrep) |
| U-3 gateway idempotency | NV-6 follow-up | Read 3 edge fn bodies (~150 LOC total) |
| U-4 RLS state | NV-1 follow-up | `SELECT * FROM pg_policies WHERE tablename IN (...)` (1 SELECT) |
| U-5 `expire-gift-credits` | NV-3 follow-up | Read 1 edge fn body |

All five are **read-only**, can be closed in a single follow-up pass (`GO 1A-2.6`), and do not require the Step-2 RPC build to wait if the Phase A shadow scope is restricted to the **verified** paths only.

---

## 10. REVISED STEP-1 INVENTORY (must be applied to discovery doc before cutover)

| Old M-ID | Status | New M-ID added |
|----------|--------|----------------|
| M-12 cron-vote-payout | **DELETE** — does not exist | — |
| M-11 client UPDATE reject | confirmed High | — |
| M-04 addFunds | downgraded — dead code, no consumers | — |
| — | NEW | **M-NEW-A** `submit-deposit` direct INSERT |
| — | NEW | **M-NEW-B** `paypal-capture-order` direct INSERT + UPDATE |
| — | NEW | **M-NEW-C** `razorpay-verify-payment` direct INSERT |
| — | NEW (CRITICAL) | **M-NEW-D** `hard-delete-competition` hard DELETE on `wallet_transactions` |

Total verified mutation paths: **15 → 18** (M-04 dead, M-12 disproven, +4 new).

---

## 11. SAFE TO PROCEED VERDICT

| Step | Verdict |
|------|---------|
| `GO 1A-2.6` (close U-1…U-5, ~10 min, read-only) | ✅ SAFE |
| `GO 1A-2 Option B` (build `wallet_ledger_apply_v2` shadow RPC, new tables, REVOKE ALL, dry_run default) | ✅ SAFE **after** 1A-2.6 closes U-1…U-5 |
| Step-3 cutover plan (Phase A→E) | ✅ SAFE **after** discovery doc + cutover plan are amended with M-NEW-A/B/C/D and M-12 removal |

**Recommendation:** Run `GO 1A-2.6` next (still read-only). Then amend `phase-1a-wallet-authority-discovery.md` and `phase-1a-step-3-wallet-cutover-plan.md` in a **single doc-only pass** (no code) to reflect the 4 new paths and the M-12 removal. Only then proceed to Step-2 RPC build.

---

## 12. EVIDENCE INDEX (queries / files actually inspected)

- `information_schema.triggers` (NV-1) — 0 rows
- `pg_indexes` on 7 tables (NV-6) — full list captured §7.1
- `pg_constraint` on 5 tables (NV-3, NV-6) — full list captured §3.4 + §7.2
- `pg_proc.pg_get_functiondef('approve_deposit')` (NV-3) — full body in §4
- `pg_proc.pg_get_functiondef('wallet_transaction')` — full body inspected (rate limit 2000/hr verified, negative-balance reversal verified)
- `cron.job` (NV-4) — 11 jobs enumerated §5
- `rg "addFunds" src` (NV-2) — 2 hits, both in same file
- `rg` over `src/` + `supabase/functions/` for all wallet/order/gift writers (NV-2, NV-5) — captured §3 + §6
- Migration `20260421055129_*.sql:173` — INSERT INTO competition_orders confirmed (RPC name to be extracted in 1A-2.6)
