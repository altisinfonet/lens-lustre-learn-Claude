# Phase 1A — Step C: Limited Live V2 Canary (PLAN ONLY)

> **STATUS: PLAN ONLY. NOTHING EXECUTED. NO MIGRATION. NO REVOKE. NO EDGE DEPLOY. NO `p_dry_run=false` ANYWHERE.**
> Step B (hourly drift monitor) is VERIFIED SAFE. Zero mismatches observed. Legacy `wallet_transaction()` remains sole live writer. This document only proposes the smallest possible live v2 canary for future approval.

---

## 0. Guardrails for this document

- ✅ AUDIT/PLAN ONLY
- ✅ ZERO DAMAGE — no SQL applied, no code edited, no functions deployed
- ✅ ZERO SIDE EFFECT — read-only review of existing call sites
- ✅ ZERO FAN-OUT — no schedules, no triggers, no notifications added
- ✅ ZERO RECURSION — no functions calling themselves; canary path is single-shot per gift expiry row

---

## 1. Candidate evaluation matrix

All five candidates currently run **legacy-only** (`wallet_transaction` RPC) and **shadow-v2 dry-run** (`wallet_ledger_apply_v2 p_dry_run=true`). The question is: which is safest to flip from "shadow dry-run" to "shadow live mirror" first?

| # | Candidate | Surface (verified) | Blast radius | Concurrency | Rollback complexity | Idempotency risk | Reconciliation | User-visible risk | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **`gift_refund`** | `expire-gift-credits` cron sweeper. Marks expired `gift_announcements` and deducts via `wallet_transaction(type:"gift_expiry", -amount)`. Already wired with shadow `op:"gift_refund"`, `idempotency_key=gift_expiry:<gift_id>`. | **Smallest.** One row per expired gift. Deductions only. No user-initiated path. No money moves OUT of system. | **Lowest.** Cron-driven, sequential per gift, runs off-peak. No user concurrency. | **Trivial.** Flip one boolean back to dry-run; no schema, no triggers. | **Lowest.** Idempotency key is deterministic (`gift_expiry:<gift_id>`). Even on retry the v2 ledger upserts on the key. | **Trivial.** v2 row maps 1:1 to legacy `wallet_transactions` row via `reference_id=gift_id`. Diff monitor already covers it. | **None.** User sees gift expire either way; balance change identical. No emails, no notifications altered. | ✅ **RECOMMENDED — primary canary** |
| 2 | `withdrawal_refund` | `admin-process-withdrawal` reversal branch (`wallet_transaction(type:"withdrawal_reversal", +amount)`). Only fires on step-2 failure. | Small *but* triggers on a real money path; double-credit if mirror diverges. | Low (admin-driven, manual). | Easy but visible to user (refund posts to balance). | Reference is `withdrawal_id`, safe key. | Cross-checks against `withdrawal_requests.status`. | **Real money refund** — any drift visible to end user. | ❌ Not recommended (real-money path) |
| 3 | `deposit_credit` | `submit-deposit` (creates pending only — no credit) + admin approval path (NOT yet identified in audit) + `paypal-capture-order` + `razorpay-verify-payment`. | **Largest** — credits real fiat-converted balance. | High during gateway return storms. | Hard — credit already visible on UI. | Multiple gateways, each with own idempotency story; PayPal 422 re-capture path adds branches. | Requires reconciliation against gateway IDs (`paypal_order_id`, `razorpay_payment_id`). | **High — direct user balance increase.** | ❌ Not recommended (highest blast radius) |
| 4 | `vote_reward_voter` | `cast-photo-vote` voter credit. | Massive volume during voting phase. | **Highest** — concurrent votes per second. | Medium — drift inflates earnings. | Idempotent on `vote_id`, but high cardinality. | Must match `competition_votes` row 1:1. | **Visible to thousands of users instantly.** | ❌ Not recommended (concurrency + volume) |
| 5 | `vote_reward_owner` | `cast-photo-vote` entry-owner credit. | Same as #4 plus self-vote guard. | Highest. | Medium. | Same as #4. | Same as #4. | High. | ❌ Not recommended (same class as #4) |

**Conclusion:** `gift_refund` (candidate #1) is the only path that is single-row, cron-driven, debit-only, off-peak, deterministic-key, and already shadow-wired with zero observed drift.

---

## 2. Proposed canary

### 2.1 Operation
- **Op:** `gift_refund`
- **Source:** `supabase/functions/expire-gift-credits/index.ts` — the existing `shadowApplyV2GE(...)` call.
- **Mode change (proposed, NOT applied):** add a **second** `wallet_ledger_apply_v2` call with `p_dry_run=false`, **mirroring** the legacy `wallet_transaction` write. Legacy remains the **authoritative** writer; v2 becomes a live shadow that actually persists rows in the v2 ledger table.
- **Critically: legacy `wallet_transaction` is NOT removed, NOT bypassed, NOT replaced.** Both writes happen. v2 is observational-but-persisted.

### 2.2 What this canary does NOT do
- ❌ Does not flip any other op to live
- ❌ Does not REVOKE any privileges
- ❌ Does not remove `wallet_transaction()`
- ❌ Does not change `wallets.balance` arithmetic — that remains legacy-only
- ❌ Does not change UI, API contracts, or user-visible state

### 2.3 Required prerequisite (NOT executed in this plan)
- Confirm v2 ledger table has a UNIQUE constraint on `idempotency_key` (must be true before live mirror — duplicate cron runs must be no-ops).
- Confirm `wallet_ledger_apply_v2` returns success on duplicate-key (upsert / on-conflict-do-nothing).
- Both checks are read-only audits to be done in Step C-Execute, not now.

---

## 3. Rollback

### 3.1 Trigger conditions (any one)
- Diff monitor reports `mismatch_count > 0` for `gift_refund` op.
- `shadow_errors > 0` from v2 wrapper.
- `unmatched_v2 > 0` (v2 row with no legacy peer).
- Manual smoke test fails.
- Any admin notification of type `wallet_ledger_v2_diff_drift` fires within first 24h.

### 3.2 Rollback SQL (illustrative — to be finalized at Step C-Execute)
```sql
-- 1. No SQL needed if rollback = code revert.
-- 2. Optional: quarantine canary v2 rows (if any leaked drift)
--    INSERT INTO public.wallet_reconciliation_log (...)
--    SELECT ... FROM wallet_ledger_v2 WHERE source_path='supabase/functions/expire-gift-credits' AND created_at >= '<canary_start>';
-- 3. No DELETE on wallet_transactions (legacy untouched).
-- 4. No DELETE on wallets (balance untouched).
```

### 3.3 Code rollback
- Revert one line in `expire-gift-credits/index.ts` (`p_dry_run: true`).
- Re-deploy edge function.
- ETA to rollback: < 2 minutes.

---

## 4. Monitoring additions (proposed, NOT applied)

1. Extend `wallet_ledger_v2_diff_snapshot` to **break out `gift_refund` op separately** in the diff log (`per_op_breakdown jsonb`).
2. Add a focused admin widget tile: **"Canary: gift_refund live mirror"** showing last 24h `inserts`, `mismatches`, `errors`.
3. Cron frequency unchanged (hourly at `:07`). Optional: add a one-off `:37` tick during canary window only.

---

## 5. Success criteria (must hold for full duration)

- ✅ `wallets_checksum` byte-identical hour-over-hour
- ✅ `wallet_transactions` count delta = expected legacy gift expiries
- ✅ v2 `gift_refund` rows == legacy `gift_expiry` rows for same window
- ✅ Zero `wallet_ledger_v2_diff_drift` admin notifications
- ✅ Zero edge function errors in `expire-gift-credits` logs
- ✅ Zero user reports referencing wallet/gift balance

## 6. Failure criteria (any → immediate rollback)

- ❌ Any mismatch on `gift_refund` op
- ❌ Any v2 insert error
- ❌ Any duplicate v2 row for same `idempotency_key`
- ❌ Any wallet checksum drift
- ❌ Any user-reported balance discrepancy

---

## 7. Duration

- **Minimum:** 7 days of green hourly snapshots.
- **Trigger to extend:** any single anomaly resets the 7-day clock.
- **Trigger to advance to Step D:** 7 consecutive days, ≥ 3 distinct gift expiry events covered live, zero failure-criteria hits.

---

## 8. Required manual tests (pre-flip, in staging if available, otherwise read-only verification in prod)

1. Read v2 table DDL — confirm UNIQUE on `idempotency_key`.
2. Read `wallet_ledger_apply_v2` source — confirm on-conflict behavior.
3. Dry-run a synthetic gift expiry against shadow path — confirm no error.
4. Verify `expire-gift-credits` cron schedule and last-success timestamp.
5. Verify diff monitor wrapper handles new live-mirror rows correctly (no false drift).
6. Confirm rollback path tested at least once in dev.

---

## 9. Untouched systems (confirmed by inspection)

- ❎ `cast-photo-vote` — untouched
- ❎ `submit-deposit` — untouched
- ❎ `paypal-capture-order` — untouched
- ❎ `razorpay-verify-payment` — untouched
- ❎ `admin-process-withdrawal` — untouched
- ❎ `send-gift-credit` — untouched (only the *expiry* sweeper is in scope)
- ❎ `wallet_transaction()` RPC — sole authoritative writer
- ❎ All UI surfaces — untouched
- ❎ All RLS policies — untouched
- ❎ All cron jobs other than the existing diff monitor — untouched

---

## 10. Final verdict

**✅ SAFE CANARY CANDIDATE IDENTIFIED — `gift_refund` via `expire-gift-credits`.**

This plan does **not** authorize execution. Step C-Execute will require:
1. Explicit user approval of this plan.
2. Pre-flight read-only verification (§8).
3. A separate, narrowly scoped migration + single edge function redeploy.
4. Live monitoring window with documented rollback rehearsal.

Until then: legacy `wallet_transaction()` remains sole writer; `p_dry_run=true` everywhere; system state frozen.
