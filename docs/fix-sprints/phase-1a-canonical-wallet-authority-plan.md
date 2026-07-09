# Phase 1A — Canonical Wallet Authority Convergence Plan (PLAN ONLY)

**Status:** AUDIT + PLAN. **No code, no SQL, no migration, no deployment, no realtime change, no UI refactor.**
**Authority:** Forensic Engineering Mandate — Rule 1 (Zero Assumption), Rule 2 (Zero Guesswork), Rule 5 (Single Authority).
**Predecessors complete:** RLS-HOTFIX-3 (`wallet_transactions` SELECT lockdown), RLS-HOTFIX-5 (`create_pending_deposit` SD RPC + `submit-deposit` cutover), RLS-HOTFIX-6 (drop of legacy `"System can insert transactions"` INSERT policy).
**Predecessor read:** `docs/fix-sprints/phase-1a-step-3-wallet-cutover-plan.md` (M-IDs reused below).
**Smoke baseline:** Real ₹5 Razorpay deposit by `payelkundubasu@gmail.com` (txn `1154466d-…-15d6`, 2026-05-14 13:13:13 UTC) — proven service-role path.

---

## 0. EXECUTIVE SUMMARY

After HOTFIX-6 the `wallet_transactions` write surface is **structurally locked**: only `service_role` (i.e. SD RPCs / edge fns with admin client) can INSERT/UPDATE/DELETE. RLS default-deny is the wall.

Remaining authority debt is **logical, not structural**:

- **One** legitimate write-RPC (`wallet_transaction`) — but **8 separate callers**, each carrying its own idempotency, rollback, and audit semantics.
- **Two** unsafe client-driven patterns survive (`useWalletWithdrawals` two-writer, `AdminTransactions` direct UPDATE).
- **One** unsafe admin-UI direct INSERT (`AdminGiftCredit.tsx` → `gift_credits`).
- **Zero** central audit log of attempted-but-failed writes.
- **Zero** uniform idempotency contract — each caller invents its own `reference_id` shape.

Goal of Phase 1A canonical convergence:
collapse all 13 write paths onto **one** server authority — `wallet_ledger_apply_v2(...)` — with a uniform idempotency key, atomic balance update, and one audit log table. Done in 5 ordered phases (A→E) inherited from the Step-3 plan, with the new findings below slotted in.

---

## 1. AUDIT — REMAINING AUTHORITY DEBT (10 items)

For each item: **file · lines · current model · target model · required RPC/edge · migration risk · rollback complexity · smoke req · blast radius · order**.

### Item 1 — `AdminTransactions.tsx` direct UPDATE (deposit reject)

- **File:** `src/components/admin/AdminTransactions.tsx`
- **Lines:** 509 (direct `.update({ status: "rejected" })`)
- **Current authority:** client UPDATE under admin JWT. Allowed today by `"Admins can manage transactions"` ALL policy. **No FSM guard, no audit row, no wallet reversal logic.**
- **Target authority:** new SD edge fn `reject-deposit` → calls `wallet_ledger_apply_v2(op='reject_deposit', txn_id=…)` which validates current `status='pending'`, transitions to `rejected`, writes audit row, no balance change.
- **Required RPC/edge:** new edge fn `reject-deposit` + v2 RPC op `reject_deposit`.
- **Migration risk:** LOW (admin-only path, low volume).
- **Rollback complexity:** LOW (revert UI to direct UPDATE; admin policy still allows).
- **Smoke:** create a `pending` deposit (e.g. fresh Razorpay test), reject via new path, assert `status=rejected`, assert balance unchanged, assert audit row.
- **Blast radius:** LOW. Admin only, < 50 rows/day.
- **Order:** **C-2** (per Step-3 plan).

### Item 2 — `useWalletWithdrawals` two-writer pattern

- **File:** `src/hooks/wallet/useWalletWithdrawals.ts`
- **Lines:** 56 (INSERT `withdrawal_requests`), 65 (RPC `wallet_transaction` deduct), 73 (DELETE rollback heuristic).
- **Current authority:** client INSERT under user JWT, then SD RPC deduct, with heuristic DELETE rollback if RPC fails. Two writers, no atomic boundary, rollback is best-effort.
- **Target authority:** new SD edge fn `request-withdrawal` → single transaction inside v2: validate user balance, INSERT `withdrawal_requests`, debit via `wallet_ledger_apply_v2(op='withdrawal_hold')`, return.
- **Required RPC/edge:** edge fn `request-withdrawal` + v2 RPC op `withdrawal_hold`.
- **Migration risk:** MEDIUM (touches money out, user-facing).
- **Rollback complexity:** MEDIUM (revert hook to two-writer; both surfaces remain valid).
- **Smoke:** test withdrawal $1 happy path; force RPC failure (simulate) — assert no orphan request row.
- **Blast radius:** MEDIUM. Low volume but critical.
- **Order:** **D-2**.

### Item 3 — `AdminGiftCredit` authority path

- **File:** `src/components/AdminGiftCredit.tsx`
- **Lines:** 110 (read), 193–200 (direct INSERT into `gift_credits` from admin UI).
- **Current authority:** client INSERT under admin JWT. No server-side admin re-check, no atomic credit ledger row.
- **Target authority:** new SD edge fn `issue-gift-batch` (replaces both M-08 and M-10) → server-side `has_role(auth.uid(),'admin')` check, atomic per-batch v2 calls.
- **Required RPC/edge:** edge fn `issue-gift-batch` + v2 op `gift_credit_issue`.
- **Migration risk:** MEDIUM (replaces existing `gift-credits-bulk` non-atomic loop too).
- **Rollback complexity:** MEDIUM (re-enable client INSERT path).
- **Smoke:** issue gift to one user; issue batch of 5; force mid-batch failure → assert all-or-nothing.
- **Blast radius:** MEDIUM, bursty.
- **Order:** **D-3** (combine with M-08/M-10).

### Item 4 — Remaining `wallet_transaction()` consumers

- **Files & lines (8 callers):**
  | # | Caller | File:line |
  |---|--------|-----------|
  | a | Razorpay verify | `supabase/functions/razorpay-verify-payment/index.ts:135` |
  | b | Vote debit | `supabase/functions/cast-photo-vote/index.ts:225, 235, 256, 266` |
  | c | Admin withdrawal process (debit + rollback) | `supabase/functions/admin-process-withdrawal/index.ts:64, 94` |
  | d | Gift expiry refund | `supabase/functions/expire-gift-credits/index.ts:39` |
  | e | PayPal capture | `supabase/functions/paypal-capture-order/index.ts:148` |
  | f | Client withdrawal hook | `src/hooks/wallet/useWalletWithdrawals.ts:65` |
  | g | `useWallet.addFunds` (self-credit) | `src/hooks/wallet/useWallet.ts:65` |
  | h | `useWallet` (referral / vote payout local credit) | `src/hooks/wallet/useWallet.ts:78` |
- **Current authority:** SD RPC `wallet_transaction(p_user_id, p_amount, p_type, p_description, p_reference_id)` — sole legitimate balance writer today (per Step-3 §1).
- **Target authority:** all 8 routed through `wallet_ledger_apply_v2(...)`. RPC `wallet_transaction` kept callable through Phase D, dropped in Phase E after ≥14 days clean diff.
- **Required RPC/edge:** v2 RPC + ops (`deposit_credit`, `vote_debit`, `vote_unvote_penalty`, `withdrawal_hold`, `withdrawal_settle`, `withdrawal_refund`, `gift_refund`, `referral_reward`).
- **Migration risk:** caller-by-caller — see Step-3 §5 ordering.
- **Rollback complexity:** LOW per caller (each is one edge-fn / hook revert).
- **Smoke:** per-caller scripted smoke (Razorpay test, vote+unvote, withdrawal happy + fail, gift expiry, PayPal sandbox).
- **Blast radius:** vote (HIGH) > withdrawal (CRITICAL) > deposit (HIGH) > others (LOW–MED).
- **Order:** C-3, C-4, C-5, then D-1, D-2, D-3, D-4 per Step-3.

> **Item 4-g (`addFunds`) special note:** unsafe client self-credit. Target = **DELETE the call site, no replacement** (per Step-3 §4). RPC stays for one release for rollback then dropped in Phase E.

### Item 5 — Remaining wallet-adjacent direct writes

- **Files & lines:**
  - `supabase/functions/hard-delete-competition/index.ts:371, 401, 505` — admin DELETE on `wallet_transactions` during competition hard-delete.
  - `supabase/functions/send-gift-credit/index.ts:62, 86` — admin INSERT/DELETE on `gift_credits`.
  - `supabase/functions/delete-user/index.ts:75` — UPDATE `withdrawal_requests.reviewed_by = NULL` on user delete.
  - `supabase/functions/expire-gift-credits/index.ts:33` — read `wallets.balance` (read only — no debt).
  - Read paths (`useWallet.ts:35,37`, `useWalletPageData.ts:32`, `AdminWalletTab.tsx:68`, `AdminVoteRewardLedger.tsx:65`, `get-wallet-summary/index.ts:31,33,40`, `get-wallet-transactions/index.ts:44`) — read only, **no debt**.
- **Current authority:** SD edge fns with `service_role` admin client. Legal post-HOTFIX-6, but **bypass `wallet_ledger_apply_v2` and write no audit row**.
- **Target authority:** routed through v2 ops `admin_purge_competition_ledger`, `gift_credit_issue`, `gift_credit_void`, `withdrawal_unassign_reviewer`.
- **Required RPC/edge:** v2 op extensions; existing edge fns kept as thin wrappers.
- **Migration risk:** LOW (admin-only).
- **Rollback complexity:** LOW.
- **Smoke:** dev hard-delete on a sandbox competition; gift send/cancel; user delete with assigned withdrawal.
- **Blast radius:** LOW–MED.
- **Order:** **C-1** (admin-only, lowest risk) for the gift / unassign ops; competition purge in **D-3** alongside gifting.

### Item 6 — Reconciliation RPC fragmentation

- **Files:** existing reconciliation surface = `wallet_reconciliation_log` (Phase 2.2) + `get_gift_drift_admin` / `get_referral_drift_admin` (Phase 2.3) + `backfill_judging_notifications` shape. Each emits a different row schema.
- **Current authority:** N independent RPCs, each its own quarantine semantics.
- **Target authority:** one canonical writer — `wallet_ledger_apply_v2` — emits a uniform `wallet_ledger_audit_log` row per attempt (success or fail). Drift RPCs become **read-only views** over that table.
- **Required RPC/edge:** `wallet_ledger_audit_log` table + `get_wallet_ledger_drift_admin(window)` read-only RPC.
- **Migration risk:** LOW (additive).
- **Rollback complexity:** LOW (drop new table; old RPCs untouched).
- **Smoke:** none (additive, shadow only).
- **Blast radius:** ZERO (read-only).
- **Order:** built **in Phase A** (shadow) alongside v2.

### Item 7 — Idempotency inconsistencies

- **Today:** every caller passes its own `_reference_id` shape:
  - vote: `entry_id` (UUID)
  - razorpay: `razorpay_payment_id` (string)
  - admin adjust: free-text
  - withdrawal: `withdrawal_request_id`
  - referral: `referral_id`
- **Risk:** two callers can collide on string overlap; no UNIQUE index covers (`reference_type`, `reference_id`).
- **Target:** v2 mandates `(p_op text, p_idempotency_key text)` and writes to `wallet_ledger_idempotency` table with `UNIQUE(op, idempotency_key)`. Replay of same `(op,key)` returns prior result, never double-applies.
- **Required:** `wallet_ledger_idempotency` table with unique index, populated by v2.
- **Migration risk:** LOW (additive table).
- **Rollback:** LOW (drop table).
- **Smoke:** call same (op,key) twice → second returns prior result, no second balance change.
- **Blast radius:** ZERO during shadow.
- **Order:** **Phase A** with v2.
- **NV-6 dependency** (Step-3 §3): index inventory on `wallet_transactions` must complete before Phase B, else dedupe semantics ambiguous.

### Item 8 — Audit logging inconsistencies

- **Today:** `db_audit_logs` is generic; `wallet_reconciliation_log` only fires on drift; failed RPC attempts emit nothing.
- **Target:** every v2 invocation (success **and** failure) writes one row to `wallet_ledger_audit_log(id, op, actor_user_id, target_user_id, amount, idempotency_key, request_jwt_role, result, error_code, balance_before, balance_after, captured_at)`. Becomes the forensic single-source-of-truth.
- **Required:** `wallet_ledger_audit_log` table + insert from v2.
- **Migration risk:** LOW (additive).
- **Rollback:** LOW.
- **Smoke:** force a known-fail v2 call (bad amount) → assert one row with `result='error'`.
- **Blast radius:** ZERO.
- **Order:** **Phase A**.

### Item 9 — Wallet balance mutation authority

- **Today:** `wallets.balance` is updated **only** inside `wallet_transaction(...)` body (Step-3 M-15). No direct UPDATE callers found in repo grep (verified). Triggers on `wallets` not yet enumerated (NV-1 from Step-3).
- **Target:** `wallets.balance` written **only** inside `wallet_ledger_apply_v2`, with explicit `SELECT … FOR UPDATE` lock and `balance_after` returned. No trigger writers.
- **Required:** trigger inventory on `wallets` (NV-1), then v2 owns the write, then `REVOKE UPDATE(balance)` on `wallets` from all roles except function owner.
- **Migration risk:** MEDIUM (REVOKE could surface unknown trigger writers).
- **Rollback:** LOW (`GRANT UPDATE` back).
- **Smoke:** concurrent-vote stress test (2 sessions race on same wallet) — assert no negative balance, no lost update.
- **Blast radius:** HIGH if a hidden writer exists; ZERO otherwise.
- **Order:** **Phase E** (final lockdown, after all callers cut over).

### Item 10 — Rollback / replay strategy

- **Today:** rollback is per-caller (e.g. `useWalletWithdrawals` deletes the `withdrawal_requests` row by heuristic). No replay primitive.
- **Target:** v2 supports `op='reverse'` taking a prior `idempotency_key`; emits a compensating ledger row with `reference_type='reversal'` and updated balance. `wallet_ledger_idempotency` enforces one reversal per original.
- **Required:** v2 op `reverse` + reversal-of-reversal guard.
- **Migration risk:** LOW (new op; opt-in).
- **Rollback:** LOW.
- **Smoke:** apply, reverse, attempt double-reverse (must error).
- **Blast radius:** ZERO during shadow.
- **Order:** **Phase A** (built with v2).

---

## 2. SAFE FIRST IMPLEMENTATION

The smallest atomic, fully reversible unit (carried over from Step-3 §11):

> **Step 2 build of `wallet_ledger_apply_v2(...)`** under a NEW name, plus three NEW tables: `wallet_ledger_idempotency`, `wallet_ledger_shadow_log`, `wallet_ledger_audit_log`. `REVOKE ALL` on the function. Default `p_dry_run = true`. **Zero call-site changes.**

Reversal: `DROP FUNCTION wallet_ledger_apply_v2; DROP TABLE` of the three new objects. Existing rows untouched. Existing RPCs untouched. Existing edge fns untouched.

Precondition: NV-1 … NV-6 from Step-3 §3 must close first via `GO 1A-2.5` (read-only audit, no migration).

---

## 3. HIGH-RISK IMPLEMENTATIONS

Ranked by combined blast radius + irreversibility:

1. **D-1 cast-photo-vote cutover** — highest write volume; double-charge or lost-vote regression visible to every voter. **Must be canaried** by `competition_id` for 24h on a low-traffic comp before global.
2. **D-2 withdrawal cutover (request + process)** — money leaves the system. Requires reconciler dry-run on production for 72h.
3. **C-5 approve-deposit cutover** — money enters; FSM transitions must be proven by smoke against the real Razorpay row.
4. **Phase E `REVOKE UPDATE(balance) on wallets`** — could surface unknown trigger writers (NV-1). Run only after a clean trigger inventory.
5. **Phase E `DROP FUNCTION wallet_transaction`** — irreversible without restoring body from migration history. Function body MUST be archived in `phase-1a-wallet-authority-discovery.md` Appendix A first.

---

## 4. WHAT CAN BREAK FINANCE

Concrete failure modes to design tests against:

- **Lost update on `wallets.balance`** — two concurrent v2 calls without `FOR UPDATE` could overwrite each other. Mitigation: explicit row lock in v2.
- **Double-credit on idempotency miss** — caller retries with different `idempotency_key`. Mitigation: derive key deterministically from caller (e.g. `vote:{entry_id}:{user_id}`) and document the contract.
- **Orphan `withdrawal_requests`** — request inserted but debit fails. Mitigation: D-2 collapses both into single v2 call.
- **Orphan `gift_credits`** — bulk loop partial failure. Mitigation: D-3 single-transaction batch op.
- **Silent reject in admin UI** — current direct UPDATE writes no audit; reversed in C-2.
- **Ledger ↔ balance drift** — v2 enforces `balance_after = balance_before + amount` in one statement; drift RPC asserts daily.
- **Replay attack via reused `reference_id`** — UNIQUE index in idempotency table blocks.
- **Hidden trigger on `wallets`** — NV-1 must close before Phase E REVOKE.
- **Vote payout cron silent miss** — cron auth (NV-4) must be reproducible in a sandbox before C-4.
- **Reversal-of-reversal** — v2 must reject; otherwise infinite refund chain possible.

---

## 5. REQUIRED TEST MATRIX

| # | Scenario | Phase gate | Pass criterion |
|---|----------|-----------|----------------|
| T-01 | v2 dry_run on every legacy call (Phase A) | A→B | 100% pairing for 7d |
| T-02 | Diff job 0 mismatches | B→C | 0 for 72h continuous |
| T-03 | Admin reject deposit via new path | C-2 | status=rejected, audit row, balance unchanged |
| T-04 | Referral reward via v2 | C-3 | balance +reward, idempotent on retry |
| T-05 | Cron vote payout via v2 | C-4 | per-payout-id idempotent |
| T-06 | approve-deposit via v2 | C-5 | new Razorpay smoke credits exactly once |
| T-07 | Vote + unvote race (2 sessions) | D-1 | no negative balance, 2× penalty applied once |
| T-08 | Withdrawal happy path | D-2 | request + debit atomic |
| T-09 | Withdrawal forced-fail | D-2 | no orphan request row |
| T-10 | Gift batch of 5, mid-fail | D-3 | all-or-nothing |
| T-11 | `addFunds` UI gone | D-4 | no client call site; RPC still callable |
| T-12 | Concurrent balance write | E pre-check | `FOR UPDATE` prevents lost update |
| T-13 | Trigger inventory on `wallets` | E pre-check | only v2-owned writes remain |
| T-14 | REVOKE UPDATE(balance) | E | no 42501 from legitimate paths for 24h |
| T-15 | DROP `wallet_transaction()` | E | no caller; function body archived |
| T-16 | Reversal of vote debit | any | compensating row, idempotency enforced |
| T-17 | Replay of same (op,key) | any | second call returns prior result |
| T-18 | Drift RPC | always-on | 0 mismatches in last 24h |

---

## 6. RECOMMENDED EXECUTION ORDER

```
GO 1A-2.5          read-only close of NV-1…NV-6        (no migration)
GO 1A-2 OPT-B      build v2 + idempotency + shadow +   (1 migration, fully reversible)
                   audit_log; REVOKE ALL; dry_run=true
GO 1A-A            wire dry_run=true at all 13 sites    (edge-fn deploys only, no SQL)
                   → 7 days soak
GO 1A-B            run diff RPC hourly                  (read-only RPC)
                   → 72h zero-mismatch
GO 1A-C-1          admin gift / unassign-reviewer ops   (lowest blast)
GO 1A-C-2          reject-deposit edge fn               (replaces AdminTransactions:509)
GO 1A-C-3          process-referral-reward cutover
GO 1A-C-4          cron-vote-payout cutover
GO 1A-C-5          approve-deposit cutover              (requires real Razorpay smoke)
GO 1A-D-1          cast-photo-vote canary → global
GO 1A-D-2          request-withdrawal + admin-process-withdrawal cutover
GO 1A-D-3          issue-gift-batch (replaces M-08, M-10, AdminGiftCredit:194,
                   hard-delete-competition purge)
GO 1A-D-4          delete useWallet.addFunds UI call site
GO 1A-E-1          REVOKE EXECUTE on wallet_transaction from authenticated/anon/service_role
GO 1A-E-2          REVOKE UPDATE(balance) on wallets    (requires NV-1 closed)
GO 1A-E-3          DROP FUNCTION wallet_transaction     (≥14d clean, body archived)
GO 1A-E-4          drop shadow tables / dry_run paths
```

Each `GO` step is a separate approval. Every step before `1A-E-1` is rollback-by-redeploy. `1A-E-*` requires `GRANT` to undo and is treated as irreversible without prior body archival.

---

## 7. EXIT CRITERIA FOR PHASE 1A

- All 13 write paths above route through `wallet_ledger_apply_v2`.
- `wallet_transaction(...)` dropped.
- `wallet_ledger_audit_log` shows `result='ok'` ≥99.99% over trailing 14d.
- `get_wallet_ledger_drift_admin(24h)` returns 0 mismatches for ≥14d.
- Guardrail 0B-2 baseline updated to allow-list **only** v2.
- `AdminTransactions.tsx`, `AdminGiftCredit.tsx`, `useWalletWithdrawals.ts`, `useWallet.ts` baselined entries removed from `scripts/audits/baselines/wallet-write-baseline.json`.

---

## 8. NOT IN SCOPE FOR PHASE 1A

- Realtime subscription changes on wallet tables.
- UI redesign of admin transactions / wallet pages.
- Currency/locale refactor.
- Razorpay → other gateway changes.
- Withdrawal payout automation.

---

## 9. NEXT RECOMMENDED STEP

`GO 1A-2.5` — read-only audit closing NV-1 … NV-6 (trigger inventory on `wallets`/`gift_credits`/`competition_orders`, ripgrep for `addFunds` callers, extract `approve_deposit` body, document cron auth, INSERT path scan on `competition_orders`, index list on `wallet_transactions`). **No migrations. No code changes.**

Only after 1A-2.5 closes all six gaps: `GO 1A-2 OPT-B` per §2 above.
