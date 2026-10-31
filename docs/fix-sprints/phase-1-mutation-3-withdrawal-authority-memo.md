# Phase 1 Mutation #3 — Withdrawal Authority Decision Memo

**Status:** AUDIT-ONLY · No DB / code / edge / wallet mutation performed.
**Scope:** Decide the single canonical debit point for user withdrawals **before** drafting `request_withdrawal` RPC.
**Forensic basis:** `src/hooks/wallet/useWalletWithdrawals.ts`, `supabase/functions/admin-process-withdrawal/index.ts`, `docs/rebuild-blueprint/step-2f-payment-wallet-system.md §7.3 + §11`.

---

## 1. Current State (verified)

| Step | Actor | What happens | Money moved? |
|---|---|---|---|
| 1 | User (hook) | INSERT `withdrawal_requests {status:'pending'}` | No |
| 2 | User (hook) | RPC `wallet_transaction(type:'withdrawal', −amount)` | **Yes — debit #1** |
| 3 | User (hook, RPC fail) | DELETE last pending row | (silent fail under RLS) |
| 4 | Admin (`admin-process-withdrawal`, approve) | RPC `wallet_transaction(type:'withdrawal', −amount, ref=withdrawal_id)` | **Yes — debit #2** |
| 5 | Admin (approve, step-update fail) | `wallet_transaction(type:'withdrawal_reversal', +amount)` | Credit |
| 6 | Admin (reject) | Status update only — **no refund** | (refund out-of-band; NOT VERIFIED) |

**Confirmed defects:**
- **D1 — Double-debit on approve:** Steps 2 + 4 both deduct. No reconciliation logic between them in code path.
- **D2 — Silent rollback hole:** Step 3 DELETE has no RLS DELETE policy for `withdrawal_requests` → rollback fails silently when wallet RPC fails.
- **D3 — No refund on reject:** Step 6 leaves the user's funds debited (from step 2) with no automatic credit-back.

---

## 2. The Three Debit-Point Models

### A. Debit at REQUEST time (current behavior, formalized in RPC)
- Funds leave `wallets.balance` the moment the request is created.
- Admin approve/reject is metadata-only.
- **Requires:** delete the second `wallet_transaction(...)` in `admin-process-withdrawal`; add **refund-on-reject** path.

### B. Debit at APPROVAL time
- Request creation only inserts the row (no money moved).
- Admin approve performs the only debit.
- **Requires:** server-side balance gate so a user cannot create multiple requests exceeding balance; UI must show "pending" without misleading the user that funds are already held.

### C. RESERVE/HOLD model (two columns)
- Add `wallets.reserved_balance` (or compute `available = balance − sum(pending_withdrawals.amount)`).
- Request: increment reserve (no real debit). Approve: decrement reserve + debit. Reject: decrement reserve only.
- **Requires:** new column or view, refactor of every balance read site (`useWallet`, `useWalletSummary`, `get-wallet-summary`, ledger UI), migration of existing pending rows.

---

## 3. Comparison Matrix

| Criterion | A (Debit-at-Request) | B (Debit-at-Approval) | C (Reserve/Hold) |
|---|---|---|---|
| Fixes D1 double-debit | ✅ (remove admin debit) | ✅ (remove user debit) | ✅ (single debit point) |
| Fixes D2 silent rollback | ✅ (atomic in RPC) | ✅ (no debit to roll back) | ✅ |
| Fixes D3 no-refund-on-reject | Needs new refund branch in admin fn | ✅ (nothing to refund) | ✅ (release reserve) |
| Balance semantics change | None — `balance` keeps current meaning | **Yes** — `balance` no longer reflects committed-out funds | **Yes** — new `available` vs `balance` everywhere |
| Files touched | 1 RPC + 1 edge fn (admin-process-withdrawal) | 1 RPC + 1 edge fn + balance-display review | 1 migration + ~6 hooks + 3 edge fns + UI labels |
| User mental model | "Money already deducted, will be paid out" (matches today) | "Money still here, will be removed when approved" | "Money locked, will be released or removed" |
| Race-condition surface | Low (atomic at request) | Medium (TOCTOU between request gate and approve) | Low (reserve is atomic) |
| Rollback path | Drop new RPC; revert admin fn diff | Drop new RPC; revert admin fn diff + restore client deduct | Revert migration (data shape change) + revert all readers |
| Blast radius if wrong | Small (1 user-facing fn, 1 admin fn) | Medium (balance numbers shift meaning mid-flight) | **Large** (every balance display + reconciliation report changes) |
| Production risk | **LOW** | MEDIUM | HIGH |
| Single-mutation scope | ✅ fits Phase 1 | ⚠️ borderline | ❌ multi-phase |

---

## 4. Answers to the Required Questions

**Q1 — Where should the debit occur?**
→ **At REQUEST time (Model A)**. Matches current production semantics, atomic, server-enforced, and removes the most defects with the smallest surface.

**Q2 — How to prevent double-debit permanently?**
→ In the same migration that ships `request_withdrawal`, **patch `admin-process-withdrawal`** to remove its `wallet_transaction(-amount)` call on approve. Approve becomes a pure status transition + audit. A unit/integration assertion is added: `count(wallet_transactions WHERE type='withdrawal' AND reference_id=<withdrawal_id>) == 1`.

**Q3 — Available vs total balance?**
→ Under Model A, **no change**. `wallets.balance` continues to mean "spendable now". Pending withdrawals are already netted out (because the debit row exists). No new column, no new view, no UI relabel.

**Q4 — What `admin-process-withdrawal` behavior must change?**
- **Remove** the approve-path `wallet_transaction(type:'withdrawal', -amount, ref=withdrawal_id)` call.
- **Remove** the corresponding step-2-failure `withdrawal_reversal` branch (no debit to reverse).
- **Add** a reject-path refund: `wallet_transaction(type:'withdrawal_refund', +amount, ref=withdrawal_id, ref_type='withdrawal_request')` — idempotent on `reference_id`.
- Keep `db_audit_logs` writes on every path.
- Approve = status `pending → approved` + audit only.
- Reject = status `pending → rejected` + refund RPC + audit.

**Q5 — UI labels?**
→ No mandatory changes. Optional clarification on Wallet ledger row labels (e.g. "Withdrawal pending review" stays accurate). Withdrawal form copy already says "will be transferred after admin review" — still correct.

**Q6 — Rollback path?**
- Code: `git revert` of admin fn diff.
- DB: `DROP FUNCTION IF EXISTS public.request_withdrawal(uuid, numeric, jsonb);`
- Hook: `git checkout` of `useWalletWithdrawals.ts`.
- No data migration → no data rollback needed.
- Refund RPC calls during the live window are idempotent and self-consistent even if reverted.

**Q7 — Lowest-risk option for production?**
→ **Model A**, decisively. Lowest blast radius, lowest semantic change, lowest reader-side fan-out, fits a single Phase-1 mutation envelope.

---

## 5. Recommended Implementation Path (single track)

**Path: Model A — Debit-at-Request, formalized in `request_withdrawal` RPC, with `admin-process-withdrawal` patched to stop double-debit and to refund on reject.**

### Pros
- Preserves today's balance semantics → zero surprise for existing users.
- Fixes all three confirmed defects (D1, D2, D3) in one cohesive change.
- Tight code surface: 1 new RPC + 1 edge fn patch + 1 hook cutover.
- Atomic at the SQL boundary → no client-side rollback ever needed.
- Clean rollback: drop the function, revert two files.
- Idempotent refund prevents reject-loop accidents.

### Cons
- Requires editing `admin-process-withdrawal` in the **same** mutation envelope (otherwise the double-debit defect persists between steps). This slightly enlarges the mutation versus a pure "RPC only" ship.
- Refund-on-reject is **new behavior** — must be explicitly approved by the operator since it changes admin-side money movement (even though it only restores funds the user already lost at request time).
- Does not introduce a forward-looking `available_balance` concept — that remains tech-debt for a future redesign.

### Suggested mutation envelope (3 atomic steps, single approval gate)
1. **Step A — Migration:** ship `request_withdrawal(_user_id uuid, _amount numeric, _bank_details jsonb)` SECURITY DEFINER fn. Grants: revoke PUBLIC/anon, grant authenticated/service_role.
2. **Step B — Edge fn patch:** update `admin-process-withdrawal` to (i) remove approve-path debit + reversal branch, (ii) add idempotent reject-path refund. Deploy.
3. **Step C — UI cutover:** replace `useWalletWithdrawals.ts` direct-insert + `wallet_transaction` calls with a single `supabase.rpc('request_withdrawal', …)` call.

Each step is independently revertable. Step B + C MUST land together with Step A or the double-debit window persists.

---

## 6. Open Items Before GO

Operator must explicitly confirm:
1. ✅/❌ Refund-on-reject is the desired behavior (vs out-of-band manual refund).
2. ✅/❌ Mutation #3 envelope may include the `admin-process-withdrawal` patch (otherwise propose splitting into Mutation #3 + #3.1).
3. ✅/❌ `withdrawal_refund` is acceptable as the `wallet_transactions.type` string (or pick alternative).
4. ✅/❌ Manual smoke plan acceptable: (a) request $1 withdrawal → balance drops $1, ledger shows `withdrawal`; (b) admin reject → balance restored $1, ledger shows `withdrawal_refund`; (c) admin approve a fresh request → balance unchanged from request-time state, ledger shows no second debit.

---

## 7. HOLD State

No DB migration drafted.
No code edits performed.
No wallet money moved.
No edge function deployed.
Awaiting operator answer to the 4 Open Items in §6 before drafting Mutation #3 Step A migration.

**Recommendation: GO with Model A, three-step envelope, pending §6 confirmations.**
