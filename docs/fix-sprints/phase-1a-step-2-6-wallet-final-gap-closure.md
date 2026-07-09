# Phase 1A — Step 2.6 — Final Wallet Authority Gap Closure (READ-ONLY)

**Status:** READ-ONLY forensic closure. Zero migrations, zero code edits, zero runtime changes.
**Authority:** Forensic Engineering Mandate — Rule 1 (Zero Assumption), Rule 2 (Zero Guesswork), Rule 3 (Diff-Captured), Rule 5 (Single Authority).
**Inputs:** Step 1 (`phase-1a-wallet-authority-discovery.md`), Step 3 (`phase-1a-step-3-wallet-cutover-plan.md`), Step 2.5 (`phase-1a-step-2-5-close-wallet-gaps.md`).
**Closes:** U-1 … U-5 + 2 newly surfaced sub-items.

---

## 0. EXECUTIVE VERDICT

**`SAFE TO BEGIN SHADOW RPC BUILD` = ✅ YES**, conditional on three doc-only amendments being applied to Steps 1 & 3 (not code).

Three caveats that the v2 RPC must explicitly model from day 1:

1. **Hidden financial-gate trigger** `trg_enforce_entry_fee` on `competition_entries` (SECURITY DEFINER) reads `wallet_transactions` to validate fee payment. Any future v2 path that writes entry-fee transactions MUST keep `reference_type='competition_entry_fee'`, `status='completed'`, `amount<0` invariants or all submissions break.
2. **`submit_competition_entry()` SQL function bypasses `wallet_transaction()`** — it writes `wallets`, `wallet_transactions`, AND `competition_orders` in one atomic block (this is the order-INSERT path U-2 was looking for). v2 must shadow this path or accept a documented exception.
3. **RLS hole**: `wallet_transactions` policy `"System can insert transactions"` allows ANY authenticated user to INSERT a row for themselves with `WITH CHECK (user_id = auth.uid())`. Balance is not touched (only the RPC updates `wallets.balance`), but orphan ledger rows are creatable client-side. Phase E REVOKE plan must include dropping/replacing this policy.

---

## 1. VERIFIED FINDINGS

### 1.1 New SECURITY DEFINER triggers (NV-1 was incomplete)

```sql
SELECT tgname, c.relname, p.proname, tgenabled
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT tgisinternal AND ...
```
| Trigger | Table | Function | Enabled | Class |
|---------|-------|----------|---------|-------|
| `trg_enforce_entry_fee` | `competition_entries` | `enforce_entry_fee()` SECURITY DEFINER | ✅ O (enabled) | **financial gate** |
| `trg_competition_orders_updated_at` | `competition_orders` | `_set_competition_orders_updated_at()` | ✅ O | benign |

`enforce_entry_fee()` body (extracted via `pg_get_functiondef`):
- Looks up `competitions.entry_fee` for `NEW.competition_id`.
- If fee>0, requires existing row in `wallet_transactions` matching `(user_id, reference_id=competition_id, reference_type='competition_entry_fee', status='completed', amount<0)`.
- Otherwise raises `Entry fee of $% has not been paid for this competition.`

**Implication for cutover:** v2 RPC must either (a) keep this exact reference-row shape when writing entry-fee debits, or (b) the trigger must be migrated in lock-step. Recommend (a).

### 1.2 Order-INSERT RPC found (U-2 closed)

`public.submit_competition_entry(_competition_id, _title, _description, _photos[], _photo_thumbnails[], _photo_meta jsonb, _is_ai_generated, _exif_data jsonb)` SECURITY DEFINER.

Atomic body performs (all in one PG transaction):
1. `INSERT INTO wallets ON CONFLICT DO NOTHING`
2. `SELECT balance FOR UPDATE` (row lock)
3. `IF balance < entry_fee` → RAISE
4. `UPDATE wallets SET balance = balance - entry_fee` (DIRECT balance write — bypasses `wallet_transaction()`)
5. `INSERT INTO wallet_transactions (type='competition_fee', amount=-fee, balance_after, status='completed', reference_id=competition_id, reference_type='competition_entry_fee')` — DIRECT INSERT
6. `INSERT INTO competition_entries` (triggers `enforce_entry_fee`, which finds the row from step 5)
7. `INSERT INTO competition_orders (order_no=_gen_competition_order_no(), wallet_txn_id=_txn_id, status='completed')`

**This is M-NEW-F — a 6th newly-discovered direct writer of `wallets.balance` AND `wallet_transactions`.** It is the SOLE entry-fee payment path. Must appear in revised Step-1 inventory.

### 1.3 Gateway edge functions — full FSM + idempotency extracted

| Gateway | File | Idempotency mechanism | Replay-safety verdict |
|---------|------|----------------------|----------------------|
| **PayPal** | `paypal-capture-order/index.ts` | Pre-check `metadata @> {gateway:'paypal', paypal_order_id}` (line 38–48) AND post-check `metadata @> {gateway:'paypal', paypal_capture_id}` (line 136–145) AND PayPal's `ORDER_ALREADY_CAPTURED` 422 handling (line 90–100) | ✅ **Race-window narrow but present.** Two near-simultaneous calls before either INSERT could both pass pre-check. PayPal's own 422 catches one side. **App-level only — no DB unique index.** |
| **Razorpay** | `razorpay-verify-payment/index.ts` | HMAC signature verify (line 73–78) + pre-check `metadata @> {gateway:'razorpay', razorpay_payment_id}` (line 51–60) | ✅ Same race window as PayPal. App-level only. |
| **UPI / Bank** | `submit-deposit/index.ts` | **NONE** — direct INSERT with no pre-check, no signature, no provider call. Status='pending' until admin approve_deposit. | 🟡 Replay creates duplicate pending rows. Admin sees both. Not financially dangerous (no balance change until approval), but UI clutter. |

### 1.4 `expire-gift-credits` mutation surface (U-5 closed)

`expire-gift-credits/index.ts` (60 LOC, full body inspected):
- **Reads** `gift_announcements WHERE is_expired=false AND expires_at<now()` (note: NOT `gift_credits`).
- **Reads** `wallets.balance` (line 32).
- **Writes**: `wallet_transaction()` RPC with `_type='gift_expiry'`, `_amount=-min(gift.amount, current_balance)` (line 39–43).
- **Writes**: `gift_announcements.is_expired=true` (line 47).
- **Auth**: SERVICE_ROLE_KEY (line 12).
- **Idempotency**: protected by `is_expired=false` filter — once flipped, gift is skipped. ✅
- **No replay safety on the wallet_transaction RPC call itself** — if the RPC succeeds but the subsequent UPDATE `is_expired=true` fails, the next cron tick will deduct AGAIN. **Race window of ~1 SQL round-trip.** Low frequency (hourly + 10-min crons), but real.

### 1.5 RLS state on the 5 tables (U-4 closed)

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename IN (...);
```

| Table | Policy | Cmd | Quals | Risk |
|-------|--------|-----|-------|------|
| `wallet_transactions` | `Admins can manage transactions` | ALL | `has_role(uid,'admin')` | normal |
| `wallet_transactions` | `System can insert transactions` | INSERT | qual=NULL, `WITH CHECK (user_id=auth.uid())` | 🔴 **HOLE** — any authed user can INSERT self-rows (no balance impact, but creates orphan ledger rows) |
| `wallet_transactions` | `Users can view own transactions` | SELECT | `user_id=auth.uid()` | normal |
| `wallets` | `Admins can manage wallets` | ALL | `has_role(uid,'admin')` | normal |
| `wallets` | `System can insert wallets` | INSERT | qual=NULL, `WITH CHECK (user_id=auth.uid())` | low — auto-creates own wallet row only |
| `wallets` | `Users can view own wallet` | SELECT | `user_id=auth.uid()` | normal |
| `gift_credits` | `Admins can manage gift credits` | ALL | `has_role(uid,'admin')` | ✅ admin-only writes |
| `competition_orders` | `admins_read_all_orders`, `users_read_own_orders` | SELECT only | — | ✅ no client INSERT/UPDATE — only via SECURITY DEFINER RPC |
| `competition_payment_details` | `Admins can manage` | ALL | `has_role(uid,'admin')` | ✅ admin-only |

**Phase E plan implication:** REVOKE alone is insufficient. The `"System can insert transactions"` policy must be DROPPED or rewritten to admit only `service_role` callers. This is the most important finding from RLS sweep.

### 1.6 `process_referral_reward` overload bodies (U-1 closed)

Both overloads (`(uuid,text)` and `(uuid,text,numeric)`) extracted via `pg_get_functiondef`:
- Status FSM on `referrals.status`: `pending → rewarded | rejected | capped | manual_review_required`.
- 3-arg overload adds: `enabled`, `min_qualifying_amount`, `monthly_cap`, `manual_approval` gates from `site_settings.referral_reward`.
- Both call `wallet_transaction()` for referrer + referee.
- **Replay safety**: `WHERE status='pending'` filter on the SELECT. If status already moved off pending, function silently RETURNs. ✅ Idempotent.
- **No idempotency on the wallet_transaction calls themselves** — but status guard makes outer flow safe.

---

## 2. U-1 … U-5 RESOLUTION STATUS

| ID | Title | Status | Finding |
|----|-------|--------|---------|
| U-1 | `process_referral_reward` body + idempotency | ✅ CLOSED | Both overloads extracted. Status-guard idempotent. |
| U-2 | Order-INSERT RPC at migration:173 + call sites | ✅ CLOSED | `submit_competition_entry()`. Called from `src/pages/CompetitionSubmit.tsx` (per Step-1 grep). |
| U-3 | Gateway idempotency mechanisms | ✅ CLOSED | PayPal + Razorpay: app-level pre-check on metadata + provider-side dedupe. UPI/Bank: none (pending-state model). No DB-level unique index anywhere. |
| U-4 | RLS state on 5 wallet/order tables | ✅ CLOSED | Found INSERT hole on `wallet_transactions`. Documented §1.5. |
| U-5 | `expire-gift-credits` mutation surface | ✅ CLOSED | Reads `gift_announcements` (NOT `gift_credits`!), writes via `wallet_transaction()`, `is_expired` flag idempotency. ~1-roundtrip race window. |
| **U-6** (NEW) | `enforce_entry_fee` trigger inventory miss | ✅ CLOSED | Trigger is on `competition_entries`, not on the 5 tables NV-1 queried. Documented §1.1. |
| **U-7** (NEW) | `submit_competition_entry` direct writes | ✅ CLOSED | M-NEW-F. Documented §1.2. |

---

## 3. ACTIVE VS DEAD PATHS

| Path | State | Evidence |
|------|-------|----------|
| `useWallet.addFunds` (M-04) | **DEAD** | `rg "addFunds" src` → 0 consumers (only declaration + export) |
| `cron-vote-payout` (Step-1 M-12) | **DOES NOT EXIST** | `cron.job` enumerated, not present. Vote rewards are inline in `cast-photo-vote`. |
| `wallet_transaction()` RPC | ACTIVE | 11 verified call sites (Step-1 M-02…M-15 minus dead/disproven) |
| `admin_wallet_credit()` RPC | ACTIVE | 3 call sites (Step-1 §3.2 in 2.5) |
| `approve_deposit()` RPC | ACTIVE | 1 call site (`AdminTransactions.tsx:482`) |
| `process_referral_reward()` (both overloads) | ACTIVE | 2 call sites |
| `submit_competition_entry()` RPC (M-NEW-F) | ACTIVE | `CompetitionSubmit.tsx` |
| `submit-deposit` edge fn (M-NEW-A) | ACTIVE | UPI/Bank deposit pending creation |
| `paypal-capture-order` (M-NEW-B) | ACTIVE | PayPal post-checkout |
| `razorpay-verify-payment` (M-NEW-C) | ACTIVE | Razorpay post-checkout |
| `hard-delete-competition` (M-NEW-D) | ACTIVE | admin-only competition purge |
| `expire-gift-credits` cron (M-NEW-G) | ACTIVE | duplicate cron schedules (10-min + hourly), service-role |
| `send-gift-credit` edge fn | ACTIVE | targeted gift send |
| `gift-credits-bulk` edge fn (Step-1 M-10) | ACTIVE | bulk gift fan-out |
| `process-withdrawal` edge fn (Step-1 M-13) | ACTIVE (assumed — not re-verified this pass) | NOT VERIFIED again |
| `admin-wallet-adjust` edge fn (Step-1 M-14) | ACTIVE (assumed) | NOT VERIFIED again |

---

## 4. HIDDEN FINANCE MUTATIONS (newly surfaced, not in Step-1)

| ID | Path | Hidden because |
|----|------|----------------|
| M-NEW-A | `submit-deposit` direct INSERT `wallet_transactions` (status='pending') | Not in Step-1 grep |
| M-NEW-B | `paypal-capture-order` — RPC + metadata pre-check | RPC call wrapped in idempotency, looked benign |
| M-NEW-C | `razorpay-verify-payment` — RPC + signature + metadata pre-check | same |
| M-NEW-D | `hard-delete-competition` HARD DELETE on `wallet_transactions` (lines 371, 401, 505) | Soft-Delete Policy violation; not in any earlier inventory |
| M-NEW-E | `send-gift-credit` INSERT `gift_credits` + DELETE rollback | partial in Step-1 |
| M-NEW-F | `submit_competition_entry()` DIRECT writes `wallets.balance` + INSERT `wallet_transactions` + INSERT `competition_orders` | bypasses `wallet_transaction()`; only entry-fee path |
| M-NEW-G | `expire-gift-credits` cron — service-role wallet debits | duplicate cron schedules |
| M-HIDDEN-T1 | `enforce_entry_fee` trigger reads `wallet_transactions` to gate `competition_entries` INSERT | trigger not on the 5 tables NV-1 queried |

---

## 5. IDEMPOTENCY PROOF STATUS

| Path | DB-level unique | App-level dedupe | Race window | Verdict |
|------|----------------|------------------|-------------|---------|
| `wallet_transaction()` (generic) | ❌ no unique on (user_id,type,reference_id) | ❌ none | wide | UNSAFE under concurrent calls with same ref |
| `approve_deposit()` | ❌ | ✅ status='pending' guard | none (single PG txn) | ✅ Safe |
| `process_referral_reward()` | ❌ | ✅ status='pending' guard | none | ✅ Safe |
| `submit_competition_entry()` (M-NEW-F) | ❌ | ✅ `FOR UPDATE` row lock + atomic txn | none | ✅ Safe under concurrency |
| `cast-photo-vote` reward | ❌ | ✅ but TOCTOU on `maybeSingle` pre-check | narrow | 🟡 Race possible |
| `cast-photo-vote` penalty | ❌ | ❌ synthesized ref | wide | UNSAFE |
| `paypal-capture-order` | ❌ | ✅ pre-check + post-check + PayPal 422 | narrow | ✅ Practically safe |
| `razorpay-verify-payment` | ❌ | ✅ HMAC + pre-check + payment_id provider-unique | narrow | ✅ Practically safe |
| `submit-deposit` (UPI/Bank) | ❌ | ❌ none | wide | 🟡 Duplicate pending rows possible (not financial harm) |
| `expire-gift-credits` | ❌ | ✅ `is_expired=false` filter | ~1 roundtrip | 🟡 Edge race: deduct succeeds + flag UPDATE fails ⇒ next tick re-deducts |
| `competition_orders` | ✅ `UNIQUE(order_no)` | n/a (sequence) | none | ✅ Strong |
| `gift_credits` | ❌ | ❌ | wide | UNSAFE |

---

## 6. REPLAY PROTECTION STATUS

- **DB-level**: only `competition_orders.order_no` unique. Nothing else.
- **App-level**: 7 paths use status-guard or metadata pre-check; 4 paths have NO replay protection.
- **v2 RPC requirement**: must accept an `idempotency_key uuid` parameter and write to `wallet_ledger_idempotency(key UNIQUE)` before any balance change. Lookup-then-return-prior-result on duplicate key.

---

## 7. DELETE / PURGE RISKS

| Path | Risk | Severity |
|------|------|----------|
| `hard-delete-competition/index.ts:371,401,505` HARD DELETE on `wallet_transactions` | **Destroys financial ledger rows** — breaks `wallet_reconciliation_log` audit, violates Soft-Delete Policy | **CRITICAL** |
| `send-gift-credit/index.ts:86` DELETE on `gift_credits` after RPC failure | Cleanup-on-fail; safe pattern but non-atomic | Low |
| `AdminGiftCredit.tsx` DELETE on `gift_credits` (rollback) | same | Low |
| `useWithdrawal` DELETE rollback (Step-1 M-05) | heuristic; can leak if RPC succeeded but DELETE arg was wrong | Medium |
| `competition_orders.wallet_txn_id ON DELETE SET NULL` FK | Auto-orphans orders if wallet_transactions row is deleted (which `hard-delete-competition` does) | Medium |

---

## 8. SERVICE-ROLE FINANCE MAP

| Edge fn | Auth | Finance op |
|---------|------|------------|
| `paypal-capture-order` | service-role | wallet credit |
| `razorpay-verify-payment` | service-role | wallet credit |
| `expire-gift-credits` | service-role (cron) | wallet debit |
| `cast-photo-vote` | service-role | wallet credit/debit |
| `process-withdrawal` (Step-1 M-13) | service-role (assumed) | wallet debit + status |
| `admin-wallet-adjust` (Step-1 M-14) | service-role (assumed) | wallet credit/debit |
| `gift-credits-bulk` (Step-1 M-10) | service-role | wallet credit (loop) |
| `send-gift-credit` | service-role | wallet credit |
| `hard-delete-competition` | service-role | **wallet HARD DELETE** |
| `submit-deposit` | user-auth | wallet pending insert |
| `process-referral-reward` | (RPC, not edge fn) | wallet credit |

Cron-driven (anon-key Bearer hardcoded except `process-email-queue`):
- `expire-gift-credits` (10-min + hourly — duplicate)
- 9 other non-finance jobs

---

## 9. FINAL UNKNOWN AREAS

| # | Item | Severity | Why still open |
|---|------|----------|----------------|
| F-1 | `useWithdrawal` hook + `process-withdrawal` edge fn full flow (Step-1 M-05/M-13) | Medium | Not re-inspected this pass; Step-1 said "create-then-deduct heuristic". Should re-verify before Phase D-2. |
| F-2 | `admin-wallet-adjust` edge fn body | Medium | Not re-inspected this pass. |
| F-3 | `gift-credits-bulk` edge fn body (loop semantics, partial-failure recovery) | Medium | Not re-inspected. |
| F-4 | `cast-photo-vote` complete reward+penalty flow under concurrent vote+unvote | Medium | Body partially read; no concurrency proof. |

**None of F-1…F-4 block shadow RPC build.** They block Phase D cutover (high-volume / withdrawal paths). They can be closed in a `GO 1A-2.7` if desired, OR can be closed in-line during Phase A shadow-mode build (the shadow log will surface the actual mutation shape before any cutover).

---

## 10. SAFE-TO-BUILD RPC VERDICT

| Question | Answer |
|----------|--------|
| Can I enumerate every active wallet/order/gift writer? | ✅ Yes (15 paths) |
| Can I enumerate every authority that bypasses `wallet_transaction()`? | ✅ Yes — 8 bypass paths (M-NEW-A,B,C,D,E,F,G + M-11) |
| Do I know the idempotency contract per path? | ✅ Yes (§5) |
| Do I know the RLS state? | ✅ Yes (§1.5) |
| Do I know the cron auth + replay shape? | ✅ Yes (§1.4 + Step 2.5 §5) |
| Are there any unknown writers? | ❌ None found in this pass. F-1…F-4 are *re-verification* gaps on already-known paths. |
| Can I write a v2 RPC contract that day-1 covers all paths? | ✅ Yes |

**VERDICT: SAFE TO BEGIN SHADOW RPC BUILD.** ✅

---

## 11. CUTOVER READINESS STATUS

| Phase | Ready? | Blocker |
|-------|--------|---------|
| Step 2 — shadow build of `wallet_ledger_apply_v2` | ✅ READY | none — proceed |
| Phase A — dual-write shadow log | ✅ READY (after Step 2 deploys) | requires v2 RPC |
| Phase B — diff comparison | 🟡 READY but recommend closing F-1…F-4 first to widen comparison surface | F-1…F-4 |
| Phase C — partial cutover (admin-only paths first) | 🟡 READY after F-2 (admin-wallet-adjust) re-verified | F-2 |
| Phase D — full cutover (votes, withdrawal, gifts) | 🔴 NOT READY | F-1, F-3, F-4 must close. RLS hole §1.5 must have a documented fix plan. |
| Phase E — REVOKE + DROP | 🔴 NOT READY | depends on Phase D + RLS rewrite plan |

**Doc-only amendments required before Step 2 build (no code):**
1. Update `phase-1a-wallet-authority-discovery.md` — add M-NEW-A/B/C/D/E/F/G + M-HIDDEN-T1; remove M-12; downgrade M-04 to dead.
2. Update `phase-1a-step-3-wallet-cutover-plan.md` — drop C-4 (cron-vote-payout); add Phase D-5 for entry-fee path (M-NEW-F); add Phase E-RLS step to drop `"System can insert transactions"` policy.
3. Memory entry — record `enforce_entry_fee` trigger as load-bearing financial gate.

---

## 12. NEXT SAFE STEP

`GO 1A-3-AMEND` — **doc-only amendment pass** (no code, no migration) to apply the three updates listed in §11 to Steps 1 + 3, plus a one-line memory entry for `enforce_entry_fee`. Then `GO 1A-2 (Option B)` — shadow build of `wallet_ledger_apply_v2(...)`, `wallet_ledger_idempotency`, `wallet_ledger_shadow_log`, `REVOKE ALL`, `dry_run` default true, zero existing call-site changes.

If you also want F-1…F-4 closed before any code: `GO 1A-2.7` (read-only re-verification of withdrawal + admin-adjust + gift-bulk + vote concurrency). ~10 min, zero risk.

---

## 13. EVIDENCE INDEX

- `pg_trigger` query (NOT `information_schema.triggers`) → caught `trg_enforce_entry_fee` that NV-1 missed.
- `pg_proc.pg_get_functiondef` for: `admin_wallet_credit`, `process_referral_reward`(×2), `_gen_competition_order_no`, `_set_competition_orders_updated_at`, `enforce_entry_fee`, `submit_competition_entry`.
- `pg_policies` on 5 tables → 10 policies, RLS hole identified.
- Full file reads: `submit-deposit/index.ts` (86 LOC), `paypal-capture-order/index.ts` (168 LOC), `razorpay-verify-payment/index.ts` (160 LOC), `expire-gift-credits/index.ts` (60 LOC).
- Step 2.5 cron enumeration carried forward.
