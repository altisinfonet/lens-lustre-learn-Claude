# Phase 1A — Wallet Authority Implementation Backlog

**Mode:** DOCUMENTATION ONLY — no code, no migrations, no policy edits, no deploys.
**Predecessors:** RLS-HOTFIX-3 (closed F-1/F-2/F-3 holes), RLS-HOTFIX-5 (deposit RPC + 48h soak in progress).
**Successor gate:** RLS-HOTFIX-6 (drop legacy `"System can insert transactions"` / `"System can insert wallets"` policies after soak verdict = SAFE).
**Mandate:** `/docs/forensic-engineering-mandate.md` — Zero Assumption / Zero Guesswork / Single Authority.

---

## 0. SCOPE & GROUND TRUTH

Verified by live `rg` scan (this audit) on `src/**` and `supabase/functions/**`. Only **client-side / admin-UI** direct writes and **non-RPC** mutation paths to the four protected ledger tables are in scope:

- `wallet_transactions`
- `wallets`
- `withdrawal_requests`
- `gift_credits`

Read-only paths (`get-wallet-summary`, `get-wallet-transactions`, `useWallet`, `useWalletPageData`, `AdminVoteRewardLedger`, `AdminWalletTab` SELECTs) are **OUT OF SCOPE** — they don't mutate.

Service-role edge-fn writes that already encapsulate atomic logic (`razorpay-verify-payment`, `paypal-capture-order`, `cast-photo-vote`, `expire-gift-credits`, `admin-process-withdrawal`, `hard-delete-competition`, `delete-user`) are **OUT OF PHASE-1A SCOPE** — they will be reviewed in Phase 1B (gateway unification) and Phase 6 (decommission).

---

## 1. BACKLOG (10 items, ranked SAFE ORDER)

### #1 — `AdminTransactions.tsx` direct UPDATE removal **[CRITICAL / F-1 baseline]**

| Field | Value |
|---|---|
| File | `src/components/admin/AdminTransactions.tsx` |
| Lines | 509 (single line: `await supabase.from("wallet_transactions").update({ status: "rejected" }).eq("id", t.id);`) |
| Current risk | Admin UI mutates `wallet_transactions.status` directly — bypasses any reconciliation, no audit row, no balance-side effect, no idempotency, no `db_audit_logs` entry. If admin clicks "Reject" on a `completed` credit row the user's `wallets.balance` becomes inconsistent vs ledger. |
| Target authority model | `SECURITY DEFINER` RPC `admin_reject_wallet_transaction(_txn_id uuid, _reason text)` that (a) verifies admin role, (b) reverses `wallets.balance` if status was `completed`, (c) writes a paired reversal row, (d) logs to `db_audit_logs` and `wallet_reconciliation_log`. |
| Recommended RPC/edge fn | RPC `public.admin_reject_wallet_transaction` (DB-only, no edge fn needed — admin client already authenticated). |
| Blast radius | Admin-only path; ~tens of clicks/month historically. Removing the direct UPDATE without the RPC = admin loses ability to reject pending txns until RPC ships. |
| Rollback complexity | LOW — single-line revert + RPC drop. |
| Dependency chain | None. Independent of HOTFIX-6. Can ship anytime after HOTFIX-3. |
| Smoke tests | (1) Admin rejects a `pending` debit → status flips, balance unchanged. (2) Admin rejects a `completed` credit → status flips, balance reduced by `amount`, paired reversal row inserted. (3) Non-admin call → 403. (4) Re-reject same txn → idempotent no-op. |
| Difficulty | LOW (single function, well-bounded). |
| **SAFE ORDER rank** | **#1 — ship first** |

---

### #2 — `useWalletWithdrawals` direct insert/delete removal **[HIGH]**

| Field | Value |
|---|---|
| File | `src/hooks/wallet/useWalletWithdrawals.ts` |
| Lines | 56 (`insert([{...}])`), 73 (`delete()` rollback) |
| Current risk | Two-step "create row, then RPC, then maybe rollback delete" pattern is racy: (a) if browser dies between insert and RPC, an orphan `pending` `withdrawal_requests` row exists with no debit; (b) the rollback `.delete()` matches by `(user_id, status='pending', latest)` — if a parallel withdrawal was created in the same window, the wrong row may be deleted. |
| Target authority model | Single atomic RPC `request_withdrawal(_amount numeric, _bank jsonb)` that, in one txn: validates amount + pending-count, debits wallet via `wallet_transaction()`, inserts `withdrawal_requests`, returns `{request_id, new_balance}`. |
| Recommended RPC/edge fn | RPC `public.request_withdrawal` (SECURITY DEFINER). No edge fn needed. |
| Blast radius | All user-initiated withdrawals route through this hook. Cutover requires the RPC to be live BEFORE removing the client insert. |
| Rollback complexity | MEDIUM — restore prior client-side flow (still works because RLS now permits self-insert post-HOTFIX-3, with `WITH CHECK (user_id = auth.uid())`). |
| Dependency chain | Should ship **after** HOTFIX-6 OR independently — RLS already requires `user_id = auth.uid()` so it's safe either way. Best ordering: ship after #1. |
| Smoke tests | (1) Submit withdrawal → row + debit + balance both visible. (2) Submit second concurrent withdrawal → second one rejected (pending guard). (3) Submit > balance → RPC raises, no row, no debit. (4) Submit min/max boundary ($1, $50000). (5) Bank details upsert still works. |
| Difficulty | MEDIUM (transactional RPC + client refactor). |
| **SAFE ORDER rank** | **#2** |

---

### #3 — `AdminGiftCredit.tsx` server-authority migration **[HIGH / F-7 baseline]**

| Field | Value |
|---|---|
| File | `src/components/AdminGiftCredit.tsx` |
| Lines | 193–198 (`.from("gift_credits").insert({...})` from admin UI). Line 110 is a SELECT — out of scope. |
| Current risk | Admin UI inserts a `gift_credits` row directly with client-trusted `admin_id`, `amount`, `target_*`. Even though `user_roles` gate is enforced at policy layer, there's no server-side cross-check that `_admin_id == auth.uid()`, no idempotency key, no atomic wallet credit (the credit is performed in a separate code path), no `db_audit_logs`. Compare to `send-gift-credit` edge fn (lines 62–95) which already does this correctly for the email path. |
| Target authority model | All gift issuance MUST flow through `send-gift-credit` edge fn (already exists; already calls `admin_wallet_credit` RPC + inserts `gift_announcements`). The admin UI should call the edge fn for ALL target_types (currently only email path uses it; bulk/role paths still insert directly). |
| Recommended RPC/edge fn | Existing `supabase/functions/send-gift-credit/index.ts` — extend to handle `target_type ∈ {role, all_users, user_ids}` and remove the client-side insert. |
| Blast radius | Admin-only feature; ~weekly use. Cutover is straightforward — keep client UI, swap `.insert()` for `supabase.functions.invoke('send-gift-credit', {...})`. |
| Rollback complexity | LOW — restore client insert; RLS still permits admin role. |
| Dependency chain | Independent of HOTFIX-6. Depends on extending `send-gift-credit` to handle non-email target types. |
| Smoke tests | (1) Single-user gift via email → wallet credit + announcement (existing path, regression check). (2) Role-targeted bulk gift → all role-holders credited atomically; partial failure rolls back. (3) `user_ids[]` gift → all credited. (4) Idempotency: replay same `(admin_id, reason, target, amount)` within 60s → no double-credit. |
| Difficulty | MEDIUM-HIGH (bulk path needs batched RPC + idempotency). |
| **SAFE ORDER rank** | **#3** |

---

### #4 — Remaining `wallet_transactions` direct writes **[MEDIUM]**

| Field | Value |
|---|---|
| Files / lines | After #1 ships: only service-role edge fns remain (`razorpay-verify-payment:53`, `paypal-capture-order:39,138`, `cast-photo-vote:213`, `hard-delete-competition:371,401,505`). `get-wallet-transactions:44` is SELECT. |
| Current risk | Service-role writes bypass RLS by design. Risks are LOGIC-level: (a) `paypal-capture-order` and `razorpay-verify-payment` both insert directly without going through `wallet_transaction()` RPC — duplicate of deposit logic now centralized in HOTFIX-5's `create_pending_deposit` + `approve_deposit`. (b) `hard-delete-competition` performs HARD DELETEs of `wallet_transactions` (lines 371, 401) — violates the project's Soft-Delete Policy. |
| Target authority model | (a) Payment-gateway capture functions should call the canonical `complete_deposit(_provider, _provider_txn_id, _amount, _user_id)` RPC (to be built as part of Phase 1B gateway unification). (b) Hard-delete should be replaced with `status='void'` + `metadata.voided_by_competition_delete=true` to preserve audit trail. |
| Recommended RPC/edge fn | New RPC `complete_deposit()` (Phase 1B) + soft-void path in `hard-delete-competition`. |
| Blast radius | Payment captures are revenue-critical — needs full Razorpay + PayPal sandbox replay before cutover. Hard-delete is admin-only and rare. |
| Rollback complexity | MEDIUM (payment paths) / LOW (delete path). |
| Dependency chain | **WAIT** until HOTFIX-6 closes and Phase 1B gateway unification begins. Do NOT touch payment captures until then. |
| Smoke tests | (1) Razorpay sandbox capture → ledger row, balance moves, `wallet_reconciliation_log` clean. (2) PayPal sandbox capture → same. (3) Replay same provider txn id → idempotent. (4) Hard-delete competition → wallet rows marked `void`, balance unchanged, audit row written. |
| Difficulty | HIGH (payment paths + sandbox env required). |
| **SAFE ORDER rank** | **#4 — after HOTFIX-6** |

---

### #5 — Remaining `wallets` direct writes **[LOW after HOTFIX-3]**

| Field | Value |
|---|---|
| Files / lines | None in client code (post-HOTFIX-3 the `"System can insert wallets"` policy is the only remaining surface; HOTFIX-6 will drop it). `expire-gift-credits:33` is SELECT. |
| Current risk | LOW once HOTFIX-6 lands. Today, a brand-new user (no wallet row) can self-insert `wallets` with `balance=0` — currently harmless because UPDATE is admin-only. |
| Target authority model | Wallet rows created exclusively by `handle_new_user` trigger (already exists per migration history) — no other path. |
| Recommended RPC/edge fn | None — trigger-only authority. |
| Blast radius | Minimal. Verify `handle_new_user` trigger inserts `wallets` row for all signup paths (email + Google + Apple) before HOTFIX-6 drops the user-side INSERT policy. |
| Rollback complexity | TRIVIAL (recreate the policy). |
| Dependency chain | Bundled into HOTFIX-6. |
| Smoke tests | (1) Email signup → wallet row exists immediately. (2) Google signup → same. (3) Apple signup → same. (4) Existing user without wallet (none expected; verify count = 0) → backfill if needed. |
| Difficulty | LOW. |
| **SAFE ORDER rank** | **#5 — bundled with HOTFIX-6** |

---

### #6 — Remaining `withdrawal_requests` direct writes **[LOW after #2]**

| Field | Value |
|---|---|
| Files / lines | After #2 ships: only `admin-process-withdrawal:49,82` (admin approve/reject — service-role, correct) and `delete-user:75` (clears `reviewed_by` on user delete — service-role, correct). |
| Current risk | LOW. Both remaining writes are service-role and intentional. |
| Target authority model | No change. Document as canonical. |
| Recommended RPC/edge fn | N/A. |
| Blast radius | None (documentation only). |
| Rollback complexity | N/A. |
| Dependency chain | After #2. |
| Smoke tests | (1) Admin approve → status `approved`, payout queued. (2) Admin reject → status `rejected`, balance refunded. (3) Delete user with pending withdrawal → `reviewed_by` nulled, request preserved for audit. |
| Difficulty | TRIVIAL. |
| **SAFE ORDER rank** | **#6** |

---

### #7 — Canonical wallet authority convergence **[STRUCTURAL]**

| Field | Value |
|---|---|
| Files | New: `supabase/migrations/<ts>_canonical_wallet_authority.sql`. Affects all RPCs that touch wallet/ledger. |
| Lines | New file. |
| Current risk | Multiple RPCs (`wallet_transaction`, `admin_wallet_credit`, `create_pending_deposit`, `approve_deposit`, `cast_photo_vote_internal`, future `request_withdrawal`, future `complete_deposit`, future `admin_reject_wallet_transaction`) each implement balance-update logic independently. Drift risk: balance and ledger can diverge if any RPC is updated without the others. |
| Target authority model | Single internal helper `_apply_wallet_delta(_user, _amount, _type, _ref_id, _ref_type, _description, _idempotency_key)` that ALL RPCs call. Helper enforces: (a) lock `wallets` row, (b) compute `balance_after`, (c) insert `wallet_transactions` with `status='completed'`, (d) update `wallets.balance`, (e) write `wallet_reconciliation_log` row, (f) honor idempotency key. |
| Recommended RPC/edge fn | DB function `public._apply_wallet_delta` (PRIVATE — `REVOKE EXECUTE FROM PUBLIC`, granted only to other SECURITY DEFINER RPCs). |
| Blast radius | EVERY money-moving RPC. Cutover must be one migration that updates all callers atomically. |
| Rollback complexity | HIGH (touches every wallet RPC). |
| Dependency chain | Requires #1, #2, #3, #4 done so all callers are known and stable. |
| Smoke tests | Full reconciliation pass on all 179+ existing `wallet_transactions` rows; balance-vs-ledger must equal zero diff. Replay idempotency keys from soak window. |
| Difficulty | HIGH. |
| **SAFE ORDER rank** | **#7** |

---

### #8 — Reconciliation hardening **[SAFETY-NET]**

| Field | Value |
|---|---|
| Files | `wallet_reconciliation_log`, new RPC `get_wallet_drift_admin`, admin widget on `/admin/health`. |
| Current risk | Reconciliation log exists but isn't continuously verified. No alert fires if `SUM(wallet_transactions.amount) WHERE user_id=X != wallets.balance`. |
| Target authority model | Nightly cron (`pg_cron` or scheduled edge fn) computes per-user drift, writes findings to `wallet_reconciliation_log`, surfaces non-zero rows in admin widget. |
| Recommended RPC/edge fn | RPC `get_wallet_drift_admin()` returning `(user_id, ledger_sum, balance, drift)` for all non-zero. Cron edge fn `wallet-recon-nightly`. |
| Blast radius | Read-only audit. Zero risk. |
| Rollback complexity | TRIVIAL. |
| Dependency chain | Independent. Can ship in parallel with anything. |
| Smoke tests | (1) Inject synthetic drift on staging → widget surfaces it. (2) Real-world run → expect drift = 0 across all users. |
| Difficulty | LOW. |
| **SAFE ORDER rank** | **#8** (parallel-safe — can ship anytime) |

---

### #9 — Idempotency standardization **[STANDARDS]**

| Field | Value |
|---|---|
| Files | All wallet RPCs + ledger schema. |
| Current risk | `create_pending_deposit` uses `(user_id, idempotency_key)` UNIQUE. Other RPCs (`wallet_transaction`, `admin_wallet_credit`, `cast_photo_vote_internal`) have ad-hoc or no idempotency. Duplicate browser submits or webhook retries can double-charge. |
| Target authority model | Add `idempotency_key TEXT` column to `wallet_transactions` with partial UNIQUE index `WHERE idempotency_key IS NOT NULL`. All RPCs accept and persist the key. Replays return the original txn id instead of inserting. |
| Recommended RPC/edge fn | Migration + RPC signature update. |
| Blast radius | Schema-level — touches every wallet RPC signature. Backward-compatible if key is nullable. |
| Rollback complexity | MEDIUM. |
| Dependency chain | Best done as part of #7 (canonical helper enforces it). |
| Smoke tests | Webhook replay (Razorpay/PayPal), double-click on vote button, double-submit withdrawal — all must yield single ledger row. |
| Difficulty | MEDIUM. |
| **SAFE ORDER rank** | **#9 (bundled with #7)** |

---

### #10 — Audit logging normalization **[OBSERVABILITY]**

| Field | Value |
|---|---|
| Files | `db_audit_logs`, all wallet RPCs, `audit_wallet_transactions` trigger (existing). |
| Current risk | Existing trigger logs all `wallet_transactions` writes, but RPC-level context (caller `auth.uid()`, idempotency replay vs new, reason) is not captured. Forensic reconstruction after a hypothetical exploit is harder than necessary. |
| Target authority model | Every wallet RPC writes one structured `db_audit_logs` row: `{rpc_name, caller_uid, target_uid, amount, type, ref_id, idempotency_key, replay:boolean, balance_before, balance_after}`. |
| Recommended RPC/edge fn | Helper `_log_wallet_rpc(...)` invoked at top of every wallet RPC. |
| Blast radius | Append-only logging — zero risk to money flow. |
| Rollback complexity | TRIVIAL. |
| Dependency chain | After #7 (helper is the natural place to call it). |
| Smoke tests | Sample one txn, verify audit row contains all fields and matches ledger row 1:1. |
| Difficulty | LOW. |
| **SAFE ORDER rank** | **#10** |

---

## 2. SAFE NEXT IMPLEMENTATION

**#1 — `AdminTransactions.tsx` direct UPDATE removal.**
- Smallest blast radius (admin-only).
- Independent of HOTFIX-6 outcome.
- Closes the only remaining CRITICAL baseline finding (`wallet-write-baseline.json` F-1).
- Self-contained: one new RPC + one client-side line swap.
- Can ship in parallel with the HOTFIX-5 48h soak.

## 3. HIGH-RISK IMPLEMENTATIONS

- **#4** — Payment-gateway capture refactor (`razorpay-verify-payment`, `paypal-capture-order`). Touches live revenue. Requires sandbox replay matrix + Phase 1B gateway plan.
- **#7** — Canonical `_apply_wallet_delta` helper. Touches every money-moving RPC at once. One bug = global money breakage.
- **#9** — Idempotency schema migration. Schema-level + RPC-signature change across the board.

## 4. WHAT MUST WAIT UNTIL AFTER HOTFIX-6

- **#4** (payment-gateway refactor) — needs the legacy `"System can insert transactions"` policy gone first, otherwise the new RPCs and the legacy policy coexist and create dual-authority drift.
- **#5** (wallets-policy drop) — IS HOTFIX-6 itself; bundled.
- **#7** (canonical helper) — depends on #4 having converged all payment paths into RPCs.

## 5. RECOMMENDED EXECUTION ORDER

```
Now (parallel with HOTFIX-5 soak):
  └─ #1  AdminTransactions reject RPC
  └─ #8  Reconciliation drift widget (read-only, parallel-safe)

After HOTFIX-5 verdict = SAFE:
  └─ HOTFIX-6  Drop legacy wallet/wallet_transactions INSERT policies (bundles #5)

After HOTFIX-6:
  └─ #2  request_withdrawal RPC + client cutover
  └─ #3  AdminGiftCredit → send-gift-credit edge fn (extend bulk paths)
  └─ #6  Document remaining service-role withdrawal writes as canonical

After #1–#3 + #6:
  └─ #4  Payment-gateway capture → complete_deposit RPC (Phase 1B gateway unification)

After #4:
  └─ #7  Canonical _apply_wallet_delta helper (bundles #9 idempotency + #10 audit)
```

**Parallelizable at any time:** #8 (drift widget — read-only, no risk).
**Strict sequential:** #1 → #2 → #3 → #4 → #7.
**Bundled:** #5 ⊂ HOTFIX-6; #9 ⊂ #7; #10 ⊂ #7.

---

## 6. READ-ONLY GUARANTEE

This document was produced by:
- Live `rg` scan of `src/**` and `supabase/functions/**` for `.from("wallet_transactions" | "wallets" | "withdrawal_requests" | "gift_credits")`.
- Cross-reference with existing audit docs:
  - `docs/security-hotfixes/wallet-transactions-rls-hole-classification.md`
  - `scripts/audits/baselines/wallet-write-baseline.json`
  - `docs/security-hotfixes/rls-hotfix-3-patch-plan.md`
  - `docs/security-hotfixes/hotfix-5-48h-soak-monitor.md`
  - `docs/fix-sprints/phase-1a-step-2-5-close-wallet-gaps.md`
  - `docs/fix-sprints/phase-1a-step-2-6-wallet-final-gap-closure.md`

**Zero database queries executed. Zero migrations. Zero deploys. Zero policy edits. Zero runtime changes. Zero code edits to `src/` or `supabase/functions/`.**

Backlog only. Awaiting explicit `GO PHASE-1A #1` to proceed with implementation of item #1.

---

## 7. RESOLVED — Shadow Ledger Probe Permission Denial (2026-05-19)

- **Observation:** SQL editor execution of `SELECT * FROM wallet_ledger_apply_v2(...)` returns `42501 permission denied`.
- **Root cause:** `wallet_ledger_apply_v2` is `SECURITY DEFINER` with `GRANT EXECUTE` restricted to `service_role`; SQL editor runs as `supabase_read_only_user`. Denial is correct and expected.
- **Conclusion:** No bug. No migration needed. Shadow-mode v2 ledger probe remains a separate Phase 1B infrastructure item (requires service-role edge fn or admin-gated RPC wrapper).
