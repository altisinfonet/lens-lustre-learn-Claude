# Phase 1A — Wallet Transaction Authority Unification — Step 1: Forensic Discovery

> **Mode:** AUDIT-ONLY. No runtime, schema, RPC, edge-function, or hook changes performed in this phase.
> **Mandate:** `docs/forensic-engineering-mandate.md` (Rules 1–5 + Output Format).
> **Scope:** Complete authority map of every wallet / ledger / payment mutation path live in the codebase + DB as of this audit.
> **Generated:** 2026-05-12

---

## 0. METHODOLOGY (evidence sources)

| Source | Command |
|---|---|
| Direct table writes (client + edge) | `rg "from\\(['\"](wallet_transactions\|wallets\|withdrawal_requests\|gift_credits\|competition_orders\|competition_payment_details\|wallet_reconciliation_log\|raw_commitments\|referrals)['\"]" src/ supabase/functions/` |
| RPC call sites | `rg "rpc\\(['\"]"` filtered by wallet/payment vocabulary |
| DB function inventory | `pg_proc` query filtered by wallet/payment vocabulary |
| Triggers on protected tables | `information_schema.triggers` for wallet/withdrawal/gift/order tables |
| Existing baselines | `scripts/audits/baselines/wallet-write-baseline.json` (Phase 0B-2), `edge-authority-baseline.json` (Phase 0B-5), `rls-authority-baseline.json` (Phase 0B-6) |

All references are line-numbered against the working tree at audit time.

---

## 1. PROTECTED TABLE INVENTORY (DB-verified)

`pg_tables` ∩ wallet/payment vocabulary returned 11 tables:

```
competition_orders
competition_payment_details
gift_announcements
gift_credits
raw_commitments
referral_codes
referrals
wallet_reconciliation_log
wallet_transactions
wallets
withdrawal_requests
```

### Triggers on protected tables (DB-verified)

| Table | Trigger | Timing | Events | Function |
|---|---|---|---|---|
| `competition_orders` | `trg_competition_orders_updated_at` | BEFORE | UPDATE | `_set_competition_orders_updated_at()` |
| `wallet_transactions` | `audit_wallet_transactions` | AFTER | INSERT / UPDATE / DELETE | `audit_sensitive_table()` |
| `withdrawal_requests` | `audit_withdrawal_requests` | AFTER | INSERT / UPDATE / DELETE | `audit_sensitive_table()` |

**NOT VERIFIED:** triggers on `wallets`, `gift_credits`, `gift_announcements`, `raw_commitments`, `referrals`, `referral_codes`, `competition_payment_details`, `wallet_reconciliation_log` — `information_schema.triggers` returned no rows for those tables. Whether the absence is intentional is unverified at this phase.

---

## 2. DB FUNCTION INVENTORY (wallet vocabulary, DB-verified)

| Function | Args | Verified body summary |
|---|---|---|
| `wallet_transaction` | `_user_id, _type, _amount, _description, _reference_id?, _reference_type?, _metadata?` → `uuid` | `SECURITY DEFINER`, `search_path=public`. Caller-identity gate: `auth.uid()` must equal `_user_id` OR be `admin` OR be `NULL` (service role). Hourly rate-limit = 2000 txns/user. Upserts `wallets` row, `UPDATE wallets SET balance = balance + _amount`. Inserts `wallet_transactions` row. (Verified via `pg_get_functiondef`.) |
| `admin_wallet_credit` | `_admin_id, _target_user_id, _amount, _type, _description?, _reference_id?, _reference_type?, _metadata?` | `SECURITY DEFINER`. Hard-fails if `_admin_id` lacks `admin` role; otherwise delegates to `wallet_transaction`. |
| `approve_deposit` | `_admin_id, _txn_id` | Marks pending deposit `approved`, calls `wallet_transaction` for user credit + a second `wallet_transaction` for `platform_revenue` to first admin. Then sets `wallet_transactions.status='approved'`. (Direct UPDATE inside SECURITY DEFINER fn.) |
| `process_referral_reward` | `(_referred_user_id, _activity_type)` AND overload `(_referred_user_id, _activity_type, _txn_amount)` | Looks up pending referral, reads `site_settings.referral_reward`, calls `wallet_transaction` twice (referrer + optional referee bonus). |
| `fix_gift_drift_admin` / `fix_referral_drift_admin` | `_announcement_id` / `_referral_id` | Phase 2.3 reconciliation backfill RPCs (audit-side). |
| `get_gift_drift_admin` / `get_referral_drift_admin` | — | Read-only audit RPCs. |

**Single chokepoint:** all monetary state changes in known-good paths funnel through `wallet_transaction(...)`.

---

## 3. MUTATION PATH GRAPH (full)

Format per row:
`<id>` | entry point | file:line | runtime trigger | tables mutated | RPCs / edge fns | auth | service-role | idempotency | reconciliation | rollback | audit | race risk | double-write risk | replay risk | drift risk | guardrail | severity | survives Phase 1?

> "Survives Phase 1" = whether this path should remain after the unification (Y / N / RECONFIG).

### 3.1 USER-FACING DEPOSIT PATHS

#### M-01 — Manual deposit (UPI / bank-transfer)
- Entry point: `useWalletDeposits.submitDeposit()` → `supabase.functions.invoke("submit-deposit")`
- File: `src/hooks/wallet/useWalletDeposits.ts` (full file)
- Edge fn: `supabase/functions/submit-deposit/index.ts:58`
- Runtime trigger: user clicks "Submit deposit" in wallet UI
- Tables mutated: `wallet_transactions` (INSERT, status=`pending`), `admin_notifications` (INSERT)
- RPCs: none — **direct INSERT into `wallet_transactions` from edge fn using anon-key client (no service role)**
- Auth: JWT verified via `auth.getClaims(token)` (anon-key client with caller's Authorization header)
- Service-role: NOT used — INSERT runs under user JWT through RLS
- Idempotency: NONE — repeated submits create duplicate pending rows (only client-side button-disable mitigation)
- Reconciliation: deferred until admin clicks Approve in `AdminTransactions.tsx`
- Rollback: none defined
- Audit: AFTER INSERT trigger `audit_wallet_transactions` → `db_audit_logs`
- Race risk: LOW (pending only)
- Double-write risk: HIGH (no idempotency key) — duplicate pending rows possible
- Replay risk: HIGH — same `reference` string can be replayed
- Drift risk: MEDIUM (admin must manually match)
- Guardrails: none (Phase 0B-2 baseline does NOT include this — INSERT happens inside edge fn, not client)
- Severity: **MEDIUM**
- Survives Phase 1: **RECONFIG** — must move to RPC `submit_deposit_request` with idempotency key + service-role write

#### M-02 — PayPal deposit capture
- Entry point: client invokes `paypal-capture-order`
- Edge fn: `supabase/functions/paypal-capture-order/index.ts`
- Runtime trigger: PayPal SDK onApprove callback
- Tables mutated: `wallet_transactions` (INSERT via `wallet_transaction` RPC)
- RPC: `wallet_transaction` at line 148 (service-role client, deposit type)
- Auth: JWT `getClaims`; PayPal `custom_id` cross-checked vs `userId` (line 124–128)
- Service-role: YES (needed to bypass RLS for self-INSERT under service identity)
- Idempotency: 2-stage —
  1. Pre-check by `metadata.paypal_order_id` (line 39-44)
  2. Pre-insert recheck by `metadata.paypal_capture_id` (line 138-145)
- Reconciliation: stamps full PayPal IDs in metadata
- Rollback: none (no compensating txn if PayPal returns COMPLETED but RPC fails — error returned to client only)
- Audit: AFTER INSERT trigger
- Race risk: LOW–MEDIUM (two concurrent captures could both pass pre-check before insert; mitigated only by Postgres serialization, not unique constraint)
- Double-write risk: MEDIUM — no DB-level unique index on `metadata.paypal_capture_id`
- Replay risk: LOW (PayPal capture id is unique)
- Drift risk: LOW
- Guardrails: edge-authority baseline (Phase 0B-5) records this as compliant (auth + service role with checks)
- Severity: **MEDIUM**
- Survives Phase 1: **Y** with addition of unique constraint on `(metadata->>'paypal_capture_id')` (deferred)

#### M-03 — Razorpay deposit verification
- Entry point: client invokes `razorpay-verify-payment`
- Edge fn: `supabase/functions/razorpay-verify-payment/index.ts`
- Runtime trigger: Razorpay handler callback
- Tables mutated: `wallet_transactions` (INSERT via RPC)
- RPC: `wallet_transaction` at line 135
- Auth: JWT `getClaims`; HMAC-SHA256 signature verified (line 75); Razorpay order `notes.user_id` cross-checked
- Service-role: YES
- Idempotency: pre-check on `metadata.razorpay_payment_id` (line 53)
- Reconciliation: stamps `razorpay_order_id`, `razorpay_payment_id`, `amount_inr_paise`
- Rollback: none
- Audit: AFTER INSERT trigger
- Race risk: LOW–MEDIUM (same gap as PayPal — no DB unique constraint)
- Double-write risk: MEDIUM
- Replay risk: LOW (HMAC + payment id)
- Drift risk: LOW
- Guardrails: edge-authority baseline compliant
- Severity: **MEDIUM**
- Survives Phase 1: **Y** with unique-constraint hardening

#### M-04 — Generic top-up via `useWallet.addFunds`
- File: `src/hooks/wallet/useWallet.ts:65`
- RPC: `wallet_transaction` (`_type='deposit'`)
- Auth: caller JWT — `wallet_transaction` enforces `_caller_id == _user_id` for self
- Service-role: NO
- Idempotency: NONE
- Reconciliation: none (no gateway reference)
- Audit: trigger
- Severity: **HIGH** — bypasses gateway flow entirely; unguarded user-driven self-credit is allowed by `wallet_transaction` (caller==user check passes; rate limit 2000/hr is the only ceiling)
- Survives Phase 1: **N** — `addFunds` must be removed; deposits MUST flow through gateway-bound edge fn

> **NOT VERIFIED:** active call sites of `useWallet.addFunds`. `rg` shows `useWallet.ts:65` definition only; UI consumers were not enumerated in this discovery (deferred to Step 2 inventory).

### 3.2 USER-FACING WITHDRAWAL PATHS

#### M-05 — User-initiated withdrawal request
- Hook: `src/hooks/wallet/useWalletWithdrawals.ts:56,65,73`
- Tables mutated: `withdrawal_requests` (INSERT line 56; conditional DELETE line 73 on rollback), `wallet_transactions` (INSERT via `wallet_transaction` RPC line 65, signed −amount)
- Auth: caller JWT
- Service-role: NO
- Idempotency: client-side server check for existing pending row (line 46) — NOT a DB constraint, race window exists
- Reconciliation: 2-step "create-then-deduct" with manual rollback (DELETE) on RPC failure
- Rollback: line 73 — best-effort DELETE of latest pending row by `(user_id, status='pending', order desc, limit 1)` — NOT keyed to the row just inserted (could delete a concurrent request)
- Audit: trigger on `withdrawal_requests`
- Race risk: HIGH — pending-check + insert is non-atomic; rollback DELETE keys are heuristic
- Double-write risk: MEDIUM
- Replay risk: HIGH (no idempotency key)
- Drift risk: HIGH (rollback can delete the wrong row)
- Guardrails: Phase 0B-2 baseline allow-listed both writes (lines 56 + 73) as MEDIUM
- Severity: **HIGH** (Phase 1 priority)
- Survives Phase 1: **N** — must collapse into single SECURITY-DEFINER RPC `submit_withdrawal_request(_amount, _bank)` returning new row id, performing pending-check + deduction in one transaction

#### M-06 — Admin approve / reject withdrawal
- Edge fn: `supabase/functions/admin-process-withdrawal/index.ts`
- Tables mutated: `withdrawal_requests` (UPDATE line 82), `wallet_transactions` (INSERT via RPC line 64; reversal RPC line 94 on update failure), `db_audit_logs` (manual INSERT line ~108)
- Auth: JWT + `user_roles.role='admin'` lookup with service-role client
- Service-role: YES
- Idempotency: status pre-check `withdrawal.status === 'pending'` (line ~53) — single-shot guarded
- Reconciliation: deduct first, then UPDATE; if UPDATE fails, automatic compensating `withdrawal_reversal` RPC
- Rollback: explicit reversal txn
- Audit: trigger + manual `db_audit_logs` row
- Race risk: LOW (status pre-check + downstream constraints)
- Double-write risk: LOW
- Replay risk: LOW
- Drift risk: LOW
- Guardrails: edge-authority compliant
- Severity: **LOW**
- Survives Phase 1: **Y**

### 3.3 ADMIN GIFT CREDIT PATHS

#### M-07 — `AdminGiftCredit.tsx` "email" target (single recipient)
- File: `src/components/AdminGiftCredit.tsx:194` (gift_credits INSERT) — invoked when targetType==="email" path is delegated to `send-gift-credit` edge fn (line ~234 `supabase.functions.invoke("send-gift-credit")`).
- Edge fn: `supabase/functions/send-gift-credit/index.ts` — performs `gift_credits` INSERT (line 62) → `admin_wallet_credit` RPC (line 73) → `gift_announcements` INSERT (line 82). On RPC failure, deletes the `gift_credits` row (line 86).
- Auth: JWT `getClaims` + admin role recheck (line 35)
- Service-role: YES
- Idempotency: NONE
- Reconciliation: rollback DELETE of `gift_credits` if wallet credit fails
- Severity: **MEDIUM**
- Survives Phase 1: **Y** (with idempotency key)

#### M-08 — `AdminGiftCredit.tsx` "role" / "all" targets (bulk)
- File: `src/components/AdminGiftCredit.tsx:193` (`gift_credits` INSERT) → loop calling `admin_wallet_credit` RPC (line 210) and `gift_announcements` INSERT (line 220) PER USER, then ALSO invokes `send-gift-credit` with the same `user_ids` (line ~234).
- Tables mutated: `gift_credits` (INSERT), `gift_announcements` (INSERT × N), `wallet_transactions` (via RPC × N)
- Auth: caller JWT
- Service-role: NO (client-side loop)
- Idempotency: NONE
- Reconciliation: NONE — partial failure mid-loop leaves inconsistent state (some users credited, some not, no rollback)
- Rollback: NONE
- Audit: trigger only
- Race / replay / drift risk: HIGH on all three
- Guardrails: Phase 0B-2 baseline allow-listed `gift_credits` INSERT at line 193 as **HIGH (F-7)**; the per-user RPC loop at line 210 is implicit
- Severity: **CRITICAL** (largest blast radius — bulk monetary action with zero atomicity)
- Survives Phase 1: **N** — must consolidate into single SECURITY-DEFINER RPC `admin_issue_gift_bulk(_admin, _target_user_ids[], _amount, _reason, _expires_at)` with single audit row + per-user idempotency key + atomic transaction OR queued worker

#### M-09 — `expire-gift-credits` cron edge fn
- File: `supabase/functions/expire-gift-credits/index.ts`
- Tables mutated: `wallet_transactions` (via `wallet_transaction` RPC, signed −amount), `gift_announcements` (UPDATE `is_expired=true`)
- Auth: cron — service-role only (no JWT path inspected; **NOT VERIFIED** as cron-protected — call source not in scope of this discovery)
- Idempotency: filter `is_expired=false` is the only guard; if RPC succeeds and UPDATE fails, next run will re-deduct
- Reconciliation: per-gift `min(gift_amount, current_balance)` clamp
- Rollback: none
- Severity: **MEDIUM**
- Survives Phase 1: **Y** with reordering (UPDATE `is_expired` BEFORE deduction inside single txn) or idempotency key in metadata

### 3.4 ADMIN DEPOSIT APPROVAL

#### M-10 — `AdminTransactions.tsx` Approve
- File: `src/components/admin/AdminTransactions.tsx:482`
- RPC: `approve_deposit(_admin_id, _txn_id)` — verified SECURITY DEFINER body wraps two `wallet_transaction` calls + UPDATE on the original pending row
- Severity: **LOW** (RPC-encapsulated)
- Survives Phase 1: **Y**

#### M-11 — `AdminTransactions.tsx` Reject  ⚠️
- File: `src/components/admin/AdminTransactions.tsx:509`
- Direct `supabase.from("wallet_transactions").update({ status: "rejected" }).eq("id", t.id)` from client
- Auth: caller JWT — relies entirely on `wallet_transactions` UPDATE RLS
- Idempotency: NONE
- Reconciliation: NONE (no compensating wallet motion expected because original was `pending`, but no guard that status was actually `pending`)
- Audit: trigger
- Race risk: LOW
- Drift risk: HIGH — admin can flip ANY `wallet_transactions` row to `rejected`, including already-`approved` rows, with no DB-level state-machine guard
- Guardrails: Phase 0B-2 baseline F-1 marks this **CRITICAL — top priority for Phase 0C**
- Severity: **CRITICAL**
- Survives Phase 1: **N** — must move to SECURITY-DEFINER RPC `reject_deposit(_admin_id, _txn_id)` with state-machine check (`status='pending'`) + audit row, or to existing `admin-process-withdrawal`-style edge fn

### 3.5 ADMIN WALLET CREDIT (manual)

#### M-12 — `AdminWalletTab.creditWallet`
- File: `src/components/admin/AdminWalletTab.tsx:119`
- RPC: `admin_wallet_credit` (verified SECURITY DEFINER + admin gate)
- Caps: client-side `amt > 10000` blocked
- Severity: **LOW** (RPC-encapsulated, server-side admin gate)
- Survives Phase 1: **Y**, optional: move client cap to DB RPC

### 3.6 REFERRAL REWARD PATHS

#### M-13 — Auto-trigger on competition entry
- File: `src/pages/CompetitionSubmit.tsx:325`
- RPC: `process_referral_reward(_referred_user_id, _activity_type, _txn_amount)` — SECURITY DEFINER, fans into 2× `wallet_transaction`
- Severity: **LOW**
- Survives Phase 1: **Y**

#### M-14 — Manual admin approve referral
- File: `src/components/admin/AdminReferrals.tsx:124`
- RPC: 2-arg `process_referral_reward`
- Severity: **LOW**
- Survives Phase 1: **Y**

### 3.7 VOTE REWARD / PENALTY PATHS

#### M-15 — Vote / unvote
- Edge fn: `supabase/functions/cast-photo-vote/index.ts:213,225,235,256,266`
- Tables mutated: `competition_votes` (INSERT/DELETE — out of wallet scope), `wallet_transactions` (via `wallet_transaction` RPC × up to 2 per call)
- Auth: JWT
- Service-role: YES
- Idempotency: pre-check by `(user_id, type='vote_reward', reference_id=voteRowId, reference_type='competition_vote')` (line 213)
- Penalties (unvote): tagged with `reference_id` = `voteRowId ?? entryId` and matching `reference_type` — Phase 2.2 W4 traceability noted in code
- Reconciliation: signed amounts, audited via `wallet_reconciliation_log` (downstream — out of scope here)
- Rollback: none (vote already deleted before penalty applied)
- Race risk: MEDIUM — vote DELETE and penalty INSERT not in single txn
- Double-write risk: LOW (idempotency check)
- Severity: **MEDIUM**
- Survives Phase 1: **Y** with single-txn wrap (deferred to Phase 2 vote integrity stream)

### 3.8 HARD-DELETE / TEARDOWN

#### M-16 — `hard-delete-competition`
- File: `supabase/functions/hard-delete-competition/index.ts:371,372,401,402,505`
- Tables mutated (DELETE): `wallet_transactions`, `wallet_reconciliation_log` (twice — by entry id list and by competition id)
- Auth: presumed admin (NOT VERIFIED — auth gate not inspected in this discovery)
- Severity: **CRITICAL** for blast radius; benign for normal operation if admin-gated
- Survives Phase 1: **Y** (out of unification scope — destructive path; flagged for separate Phase 1B audit)

### 3.9 SUPPORTING CONFIG / METADATA WRITES (informational)

| Path | File:line | Notes |
|---|---|---|
| `competition_payment_details` upsert | `src/services/admin/competitionService.ts:79` | Configuration only (no money moved); admin-RLS-gated. Severity: LOW. |
| `competition_payment_details` read | `src/services/admin/competitionService.ts:40` | Read-only. |
| `competition_orders` read | `src/components/admin/AdminOrders.tsx:49` | Read-only. |
| `competition_orders` read | `src/components/admin/AdminTransactions.tsx:102` | Read-only. |
| `wallets` read | `src/hooks/wallet/useWallet.ts:35`, `useWalletPageData.ts`, edge fns `get-wallet-summary`, `expire-gift-credits` | Read-only. |
| `referrals` UPDATE (status='rejected') | `src/components/admin/AdminReferrals.tsx` (handleReject, no money motion) | Status only, no wallet impact. |

---

## 4. WALLET MUTATION GRAPH (A)

```
                            ┌─────────────────────────────────────────────┐
                            │       wallet_transaction()  [SD/RPC]        │
                            │  • caller-identity gate (self/admin/srv)    │
                            │  • rate limit 2000/hr/user                  │
                            │  • upsert wallets row                       │
                            │  • UPDATE wallets.balance += amount         │
                            │  • INSERT wallet_transactions row           │
                            │  • returns new txn uuid                     │
                            └────────────▲────────▲───────────▲───────────┘
                                         │        │           │
                  ┌──────────────────────┘        │           └────────────────────┐
                  │                               │                                 │
        admin_wallet_credit() [SD/RPC]   approve_deposit() [SD/RPC]      process_referral_reward() [SD/RPC]
        • require admin role             • UPDATE wallet_transactions          • read site_settings
        • delegate to wallet_transaction   to status='approved'                • call wallet_transaction × 2
                  ▲                               ▲                                 ▲
                  │                               │                                 │
       ┌──────────┼─────────────┐       ┌─────────┴──────────┐         ┌────────────┴──────────┐
       │          │             │       │                    │         │                       │
   Admin UI   Edge fn:      Edge fn:  Admin UI:           (none —      Edge fn:           Client UI:
   M-12       send-gift-    expire-   M-10                tied to     cast-photo-vote    M-13 (CompetitionSubmit)
              credit (M-07) gift-     (Approve            admin path)  (M-15)             M-14 (AdminReferrals)
                            credits   button)
                            (M-09)

   ── DIRECT (non-RPC) writes still present ───────────────────────────────────────────────────────────────────────
   • submit-deposit edge fn — wallet_transactions INSERT (M-01)            ⚠ no service role; no idempotency
   • useWallet.addFunds  — wallet_transaction RPC self-credit (M-04)        ⚠ unguarded entry into RPC
   • useWalletWithdrawals.* — withdrawal_requests INSERT/DELETE (M-05)      ⚠ non-atomic create-then-deduct
   • AdminGiftCredit bulk loop — gift_credits INSERT + per-user RPC (M-08)  ⚠ CRITICAL non-atomic bulk
   • AdminTransactions reject — wallet_transactions UPDATE (M-11)          ⚠ CRITICAL no state-machine guard
   • hard-delete-competition  — wallet_transactions DELETE (M-16)           ⚠ destructive admin op
```

## 5. GATEWAY FLOW GRAPH (B)

```
   ┌────────────────────┐    ┌─────────────────────┐    ┌────────────────────┐
   │  PayPal SDK        │    │  Razorpay Checkout   │    │  UPI / Bank wire    │
   └─────────┬──────────┘    └──────────┬──────────┘    └──────────┬─────────┘
             │ orderID                  │ payment_id+sig            │ user-typed ref
             ▼                          ▼                           ▼
     paypal-capture-order       razorpay-verify-payment       submit-deposit
       (M-02, IDEMPOTENT)         (M-03, IDEMPOTENT, HMAC)     (M-01, NOT IDEMPOTENT)
             │                          │                           │
             └────────────┬─────────────┘                           ▼
                          ▼                              wallet_transactions
                  wallet_transaction RPC                  INSERT(status='pending')
                  (status='completed')                            │
                          │                                       ▼
                          ▼                              admin_notifications + Admin UI
                    wallets.balance                             │
                                                  ┌─────────────┴─────────────┐
                                                  ▼                           ▼
                                          M-10 approve_deposit         M-11 direct UPDATE
                                          (RPC, multi-write)           (status='rejected')
                                                  │                          ⚠ CRITICAL
                                                  ▼
                                          wallet_transaction × 2
                                          (user credit + platform_revenue)
```

## 6. WALLET AUTHORITY MAP (C)

| Authority | Holder | Enforced where |
|---|---|---|
| Self-credit | User JWT via `wallet_transaction` (caller==user check) | DB RPC body |
| Self-debit | User JWT via `wallet_transaction` (caller==user check) | DB RPC body |
| Cross-user credit | Admin role via `admin_wallet_credit` | DB RPC body, `has_role(_admin_id,'admin')` |
| Cross-user debit | **NONE legitimate** | — |
| Service-role bypass | Edge fns with `auth.uid()=NULL` | DB RPC body conditional |
| Status mutation (`pending`→`approved`) | `approve_deposit` RPC | Encapsulated |
| Status mutation (`pending`→`rejected`) | **Direct client UPDATE — no RPC owner** ⚠ M-11 | RLS only |
| Withdrawal status change | `admin-process-withdrawal` edge fn | Edge-fn admin gate |
| Bulk gift issuance | **Distributed: client loop + edge fn** ⚠ M-07/M-08 | Mixed |

## 7. LEDGER OWNERSHIP MAP (D)

| Ledger | Owner authority | Read paths | Write paths |
|---|---|---|---|
| `wallets.balance` | `wallet_transaction` RPC ONLY (verified) | M-04 hook, edge fns get-wallet-summary, expire-gift-credits | M-01..M-15 indirectly |
| `wallet_transactions` | `wallet_transaction` RPC for inserts; `approve_deposit` RPC for status updates; **M-11 direct UPDATE breach** | get-wallet-summary, get-wallet-transactions, AdminTransactions, useWallet | INSERT: M-01 (direct), M-02..M-15 (via RPC); UPDATE: approve_deposit + M-11; DELETE: hard-delete-competition |
| `withdrawal_requests` | M-05 client INSERT/DELETE + M-06 edge-fn UPDATE | useWalletPageData, AdminWalletTab, get-wallet-summary | M-05, M-06 |
| `gift_credits` | M-07 edge fn + M-08 client | AdminGiftCredit history view | M-07, M-08 |
| `wallet_reconciliation_log` | DB-internal (Phase 2.2) | WalletReconciliationAudit | hard-delete-competition (DELETE only — destructive) |
| `competition_orders` | Insert path NOT in scope of this discovery (NOT VERIFIED) | AdminOrders, AdminTransactions | (NOT VERIFIED — no INSERT call site found in current scan) |

## 8. DOUBLE-DEBIT RISK MATRIX (E)

| Path | Pre-check race | DB unique constraint | Result | Score |
|---|---|---|---|---|
| M-01 submit-deposit | NO | NO | duplicate `pending` rows | HIGH |
| M-02 PayPal capture | YES (2×) | NO (metadata-only) | rare; relies on PG read-committed | MEDIUM |
| M-03 Razorpay | YES | NO (metadata-only) | rare | MEDIUM |
| M-04 addFunds | NO | NO | unbounded self-credit (rate-limit only) | HIGH |
| M-05 withdraw | YES (manual select) | NO | duplicate pending possible | HIGH |
| M-06 admin-withdraw | YES (status check) | implicit (status fsm) | safe | LOW |
| M-07 gift email | NO | NO | duplicate gift on retry | MEDIUM |
| M-08 gift bulk | NO | NO | duplicate per-user credits on retry | CRITICAL |
| M-09 expire-gift | filter only | NO | duplicate deduction on partial failure | MEDIUM |
| M-10 approve_deposit | implicit (RPC checks status) | NO | safe | LOW |
| M-11 reject (direct UPDATE) | NO | NO state-machine | can flip any status | CRITICAL |
| M-13/M-14 referral | RPC checks pending | NO | safe | LOW |
| M-15 vote/unvote | YES (idempotency check) | NO | rare | LOW–MEDIUM |

## 9. RECONCILIATION MAP (F)

| Path | Reconciliation table/trail | Verified |
|---|---|---|
| Deposit | `wallet_transactions.metadata.{gateway,paypal_*,razorpay_*}` + AFTER-INSERT audit | ✅ via `pg_get_functiondef` + edge-fn read |
| Withdrawal | `withdrawal_requests` ↔ `wallet_transactions.reference_id` | ✅ via `admin-process-withdrawal:64,94` |
| Gift | `gift_credits.id` ↔ `wallet_transactions.reference_id` (`reference_type='gift_credit'`) | ✅ via M-07/M-08 + Phase 2.3 `get_gift_drift_admin` |
| Referral | `referrals.id` ↔ `wallet_transactions.reference_id` (`reference_type='referral'`) | ✅ via `process_referral_reward` body + Phase 2.3 `get_referral_drift_admin` |
| Vote reward | `competition_votes.id` ↔ `wallet_transactions.reference_id` (`reference_type='competition_vote'`) | ✅ via `cast-photo-vote:213` |
| Vote penalty | same key OR fallback `entryId`/`competition_entry` | ✅ via `cast-photo-vote:256-266` |
| Manual admin credit (M-12) | reference fields optional — **can be NULL** | ⚠ POSSIBLE DRIFT |

## 10. IDEMPOTENCY MATRIX (G)

| Path | Mechanism | Strength |
|---|---|---|
| M-01 deposit submit | none | ✗ |
| M-02 PayPal | metadata pre-check ×2 | partial |
| M-03 Razorpay | metadata pre-check | partial |
| M-04 addFunds | none (rate-limit only) | ✗ |
| M-05 withdraw | client-side pending pre-check | ✗ (race) |
| M-06 admin-withdraw | status FSM | ✓ |
| M-07/M-08 gift | none | ✗ |
| M-09 expire-gift | `is_expired` flag (post-RPC update) | partial |
| M-10 approve_deposit | RPC fetches `_txn_id`; assumed status check | partial — **NOT VERIFIED** that body rejects already-approved rows |
| M-11 reject | none | ✗ |
| M-13/14 referral | RPC pending-only filter | ✓ |
| M-15 vote reward | `(user, type, reference_id, reference_type)` pre-check | ✓ |
| M-15 vote penalty | none — relies on vote already deleted | partial |

## 11. ADMIN FINANCE AUTHORITY MATRIX (H)

| Capability | UI surface | Path id | RPC-mediated? | DB-side admin check? |
|---|---|---|---|---|
| Approve manual deposit | AdminTransactions | M-10 | ✓ | ✓ (`approve_deposit`) |
| Reject manual deposit | AdminTransactions | M-11 | ✗ direct UPDATE | ✗ (RLS only) |
| Approve/reject withdrawal | AdminWalletTab → admin-process-withdrawal | M-06 | edge-fn | ✓ (admin lookup) |
| Manual credit user | AdminWalletTab | M-12 | ✓ | ✓ (`admin_wallet_credit`) |
| Issue gift (single email) | AdminGiftCredit → send-gift-credit | M-07 | partial — gift insert via edge fn, RPC for credit | ✓ (admin lookup) |
| Issue gift (bulk role/all) | AdminGiftCredit (client loop) | M-08 | ✗ client-driven | partial (`admin_wallet_credit` checks per call but `gift_credits` INSERT is client-side) |
| Approve referral | AdminReferrals | M-14 | ✓ | implicit (RPC) |
| Reject referral | AdminReferrals | (status update, no money) | ✗ direct UPDATE | RLS only |
| Hard-delete competition (purges ledger) | (admin tool — NOT VERIFIED entry point) | M-16 | edge-fn | NOT VERIFIED |

## 12. PROTECTED VS UNSAFE MUTATION PATHS (I)

**Protected (RPC-mediated, audited, single-chokepoint compliant):**
M-02, M-03, M-06, M-09 (partial), M-10, M-12, M-13, M-14, M-15.

**Unsafe (Phase 1 cutover targets):**
- **CRITICAL:** M-08 bulk gift loop, M-11 reject direct UPDATE.
- **HIGH:** M-04 `addFunds`, M-05 withdrawal create-then-deduct.
- **MEDIUM:** M-01 deposit submit (no idempotency), M-07 gift single (no idempotency), M-09 expire-gift (ordering).

**Out-of-scope for Phase 1 (separate Phase 1B):** M-16 hard-delete-competition.

---

## 13. RECOMMENDED CUTOVER SEQUENCE (J)

Each step is a single shadow-mode-deployable unit. **No production-write change shipped without (a) shadow-mode RPC + (b) reconciliation drift audit + (c) rollback toggle.**

1. **Step C-1 (CRITICAL):** Replace M-11 with new RPC `reject_deposit(_admin_id uuid, _txn_id uuid) returns jsonb` enforcing `status='pending'` FSM check + audit row. Switch UI to RPC; keep direct UPDATE blocked behind Phase 0B-2 baseline + new ESLint rule update. **Shadow mode:** ship RPC first; UI flag-gated; verify drift audit clean for one week before removing direct UPDATE allowance.
2. **Step C-2 (CRITICAL):** Replace M-08 bulk gift with single RPC `admin_issue_gift_bulk(_admin uuid, _target_user_ids uuid[], _amount numeric, _reason text, _expires_at timestamptz)` performing single `gift_credits` INSERT + per-user `wallet_transaction` inside one transaction with `gift_credits.id`+`user_id` idempotency key on `wallet_transactions.metadata.gift_dispatch_key`. Decommission per-user client loop. **Shadow mode:** dual-write behind feature flag; reconcile counts via `get_gift_drift_admin` for one cycle.
3. **Step C-3 (HIGH):** Replace M-05 with RPC `submit_withdrawal_request(_amount numeric, _bank jsonb) returns uuid` — single transaction performs pending-check + `withdrawal_requests` INSERT + `wallet_transaction` debit. Remove the heuristic rollback DELETE.
4. **Step C-4 (HIGH):** Remove M-04 `useWallet.addFunds` after grep proves zero call sites; if call sites exist, route them through gateway flows (M-02/M-03/M-01-replacement).
5. **Step C-5 (MEDIUM):** Replace M-01 with RPC `submit_deposit_request(_amount numeric, _gateway text, _reference text, _metadata jsonb) returns uuid` with unique-constraint on `(user_id, gateway, reference)` for idempotency.
6. **Step C-6 (MEDIUM):** Add unique partial indexes:
   - `wallet_transactions ((metadata->>'paypal_capture_id')) where metadata?'paypal_capture_id'`
   - `wallet_transactions ((metadata->>'razorpay_payment_id')) where metadata?'razorpay_payment_id'`
   to harden M-02, M-03 against any race.
7. **Step C-7 (MEDIUM):** Reorder M-09 to UPDATE `is_expired=true` BEFORE the `wallet_transaction` deduction inside an explicit DB function `expire_gift_credit(_announcement_id uuid)` to make per-gift expiry atomic.
8. **Step C-8:** Audit `approve_deposit` body for status-machine guard; if missing, add `WHERE status='pending'` to its UPDATE (verify before adding).
9. **Step C-9:** Tighten Phase 0B-2 baseline by removing each entry as it migrates; flip ESLint rule severity from "baseline allow" to "hard block" when count reaches 0.
10. **Step C-10:** Phase 1B follow-up audit on M-16 destructive admin teardown (out of scope for Phase 1 unification).

---

## 14. NOT VERIFIED ITEMS (Rule 1)

- Trigger inventory for `wallets`, `gift_credits`, `gift_announcements`, `raw_commitments`, `referrals`, `referral_codes`, `competition_payment_details`, `wallet_reconciliation_log` (no rows returned by the same query that found triggers on wallet_transactions / withdrawal_requests / competition_orders — absence not yet confirmed authoritative).
- `useWallet.addFunds` consumer call sites (definition only seen).
- `approve_deposit` body did NOT show explicit `status='pending'` guard in the truncated `tail -40` extract — must re-verify before C-8.
- Cron schedule + auth gate for `expire-gift-credits` and `hard-delete-competition` invocation surfaces.
- INSERT call sites for `competition_orders` (no client/edge code path found in this scan — likely DB-trigger-driven; needs separate read).
- Whether `wallet_transactions.metadata` has any GIN/expression index supporting the idempotency pre-checks at scale.

---

## 15. RISKS (audit-only phase)

- Discovery itself introduced **zero runtime change**; but the report exposes CRITICAL paths (M-08, M-11) — mishandled disclosure could attract a fix attempt outside the cutover plan. Phase 1A explicitly forbids any fix.
- Step 2 (Step-2 inventory of `addFunds` consumers, `competition_orders` writers, cron auth surfaces) MUST run before any Step C-* fix is queued.

## 16. ROLLBACK PLAN

This phase produced a single new file:
`docs/fix-sprints/phase-1a-wallet-authority-discovery.md`

Rollback = `rm docs/fix-sprints/phase-1a-wallet-authority-discovery.md`. Zero side effects.

## 17. NEXT RECOMMENDED STEP

**GO 1A-2** — Step 2 deep-dive forensic discovery to close the NOT VERIFIED items above (trigger inventory, `addFunds` consumer enumeration, `approve_deposit` full body, cron auth surfaces, `competition_orders` INSERT path), still audit-only. Fixes (`GO 1B-*` cutover steps C-1 .. C-10) MUST NOT begin until Step 2 closes those gaps.

— END OF PHASE 1A STEP 1 REPORT —
