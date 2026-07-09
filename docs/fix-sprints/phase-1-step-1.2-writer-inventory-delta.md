# Phase 1 — Step 1.2 — Writer Inventory Delta (Read-Only)

**Mode:** AUDIT ONLY. No code, no DB, no edge-fn deploys.
**Authority baseline:** `docs/fix-sprints/phase-1a-wallet-authority-backlog.md` (DO NOT duplicate).
**Predecessor:** Step 1.1 grants snapshot.
**Scope:** Diff-only of current `src/**` + `supabase/functions/**` direct writers and RPC callers against the backlog inventory.

---

## 1. METHOD

Live `rg` scan (2026-05-19) for:

```
\.from\(["'](wallet_transactions|wallets|withdrawal_requests|gift_credits|gift_announcements)["']\)
  \.\s*(insert|update|delete|upsert)
.rpc(["'](wallet_transaction|wallet_ledger_apply_v2|admin_wallet_credit
         |create_pending_deposit|approve_deposit|request_withdrawal|complete_deposit)["']
```

Cross-referenced against the 10 backlog items in `phase-1a-wallet-authority-backlog.md`.

---

## 2. DELTA TABLE — DIRECT TABLE WRITES

| Location | Op | Backlog item | Delta vs backlog |
|---|---|---|---|
| `src/components/admin/AdminTransactions.tsx:509` | `wallet_transactions.update({status:'rejected'})` | **#1** | **NO CHANGE** — still present, still CRITICAL. RPC `admin_reject_wallet_transaction` not yet shipped. |
| `src/hooks/wallet/useWalletWithdrawals.ts:56` | `withdrawal_requests.insert([…])` | **#2** | **NO CHANGE** — racy insert→RPC→rollback pattern still in place. |
| `src/components/AdminGiftCredit.tsx:221` | `gift_announcements.insert({…})` | **#3** (announcement side) | **NO CHANGE** — admin UI still inserts announcement directly after RPC credit. Bulk paths not yet routed through `send-gift-credit` edge fn. |
| `supabase/functions/send-gift-credit/index.ts:86` | `gift_credits.delete()` | **#3** (refund path) | **NO CHANGE** — internal cleanup inside service-role edge fn; documented intentional. |
| `supabase/functions/send-gift-credit/index.ts:93` | `gift_announcements.insert({…})` | **#3** | **NO CHANGE** — service-role edge fn; canonical path. |
| `supabase/functions/delete-user/index.ts:75` | `withdrawal_requests.update({reviewed_by:null})` | **#6** | **NO CHANGE** — service-role, documented canonical. |
| `supabase/functions/expire-gift-credits/index.ts:74` | `gift_announcements.update({is_expired:true})` | **#3** (cleanup) | **NEW vs backlog** — not enumerated in #3 originally; service-role and intentional. Add to canonical list. |
| `supabase/functions/hard-delete-competition/index.ts:371` | `wallet_transactions.delete()` | **#4** | **NO CHANGE** — still HARD DELETE; violates Soft-Delete Policy. |
| `supabase/functions/hard-delete-competition/index.ts:401` | `wallet_transactions.delete()` | **#4** | **NO CHANGE** — same. |

**`wallets` direct writes:** none in client code (matches backlog #5).
**`gift_credits` writes:** only the service-role delete above (matches backlog #3 scope).
**`withdrawal_requests` writes:** only the two above (matches backlog #2 and #6).

---

## 3. DELTA TABLE — RPC CALLERS (CUTOVER STATUS)

| Caller | RPC used | Authority status |
|---|---|---|
| `src/hooks/wallet/useWallet.ts:65,78` | `wallet_transaction` | ✅ canonical |
| `src/hooks/wallet/useWalletWithdrawals.ts:65` | `wallet_transaction` | ⚠ paired with direct `withdrawal_requests.insert` (backlog #2) |
| `src/components/admin/AdminTransactions.tsx:482` | `approve_deposit` (cast `as any`) | ✅ canonical RPC; `as any` cast flagged by Phase 0 ESLint rule — verify the file is exempted or the cast is removed before next change |
| `src/components/admin/AdminWalletTab.tsx:119` | `admin_wallet_credit` | ✅ canonical |
| `src/components/AdminGiftCredit.tsx:210` | `admin_wallet_credit` | ✅ canonical (paired with #2 direct announcement insert) |
| `supabase/functions/submit-deposit:70` | `create_pending_deposit` | ✅ canonical |
| `supabase/functions/cast-photo-vote:39` | `wallet_ledger_apply_v2` (shadow) | ⚠ shadow probe; **also** uses `wallet_transaction` at lines 245/262/290/307 — DUAL-PATH still active |
| `supabase/functions/expire-gift-credits:11,59` | `wallet_ledger_apply_v2` + `wallet_transaction` | ⚠ DUAL-PATH |
| `supabase/functions/admin-process-withdrawal:11,84,122` | `wallet_ledger_apply_v2` + `wallet_transaction` | ⚠ DUAL-PATH |
| `supabase/functions/razorpay-verify-payment:13,160` | `wallet_ledger_apply_v2` + `wallet_transaction` | ⚠ DUAL-PATH (backlog #4) |
| `supabase/functions/paypal-capture-order:11,168` | `wallet_ledger_apply_v2` + `wallet_transaction` | ⚠ DUAL-PATH (backlog #4) |
| `supabase/functions/send-gift-credit:73` | `admin_wallet_credit` | ✅ canonical |

**`request_withdrawal` RPC:** ❌ not present (backlog #2 target — not yet built).
**`complete_deposit` RPC:** ❌ not present (backlog #4 / Phase 1B target).
**`admin_reject_wallet_transaction` RPC:** ❌ not present (backlog #1 target).

---

## 4. NEW DELTA OBSERVATIONS (not in backlog)

1. **`AdminTransactions.tsx:482` uses `"approve_deposit" as any`.** Phase 0 added `no-as-any-in-protected-dirs` for `src/hooks/wallet/**` — this file is under `src/components/admin/`, currently outside the ESLint rule glob. Recommend extending the rule glob to `src/components/admin/AdminTransactions.tsx` OR removing the cast (types now regenerated post-RPC ship).
2. **`expire-gift-credits` update to `gift_announcements.is_expired`** is not enumerated in backlog #3. Service-role and benign — recommend adding to the §6 canonical-writers list in the backlog as a documentation patch (no code change).
3. **DUAL-PATH writers** (cast-photo-vote, expire-gift-credits, admin-process-withdrawal, razorpay-verify-payment, paypal-capture-order) call BOTH `wallet_ledger_apply_v2` (shadow) AND `wallet_transaction` (canonical) within the same request. This is the documented shadow-mode wiring; retirement is tracked under backlog Phase 1B / Step 1.5. **No new action required** — flagged only so Step 1.3 cutover plan does not treat these as "not yet routed".

---

## 5. NET-NEW WORK FOR PHASE 1 (vs Phase 0 + backlog)

| ID | Item | Source |
|---|---|---|
| Δ-A | Ship `admin_reject_wallet_transaction` RPC + cut over `AdminTransactions:509` | backlog #1 |
| Δ-B | Ship `request_withdrawal` RPC + cut over `useWalletWithdrawals:56` | backlog #2 |
| Δ-C | Extend `send-gift-credit` for bulk/role targets + remove `AdminGiftCredit:221` direct insert | backlog #3 |
| Δ-D | Soft-void replacement for `hard-delete-competition:371,401` | backlog #4 (delete path only) |
| Δ-E | Extend ESLint `no-as-any-in-protected-dirs` glob to `src/components/admin/AdminTransactions.tsx` OR remove cast | NEW (§4.1) |
| Δ-F | Documentation patch — add `expire-gift-credits` announcement-update to backlog §6 canonical list | NEW (§4.2) |

**Backlog items #4 (payment captures), #5 (wallets policy drop), #7 (canonical helper), #8 (drift widget), #9 (idempotency), #10 (audit logging)** remain governed by the existing backlog. No delta.

---

## 6. AUTHORITY STATEMENT

This delta document is **subordinate** to `phase-1a-wallet-authority-backlog.md`. It does not redefine items, ordering, or risk classifications. It only enumerates what changed (or did not change) between the backlog snapshot and the 2026-05-19 repo state, plus two new observations (§4.1, §4.2).

---

## 7. VERIFIED / NOT VERIFIED / RISKS / ROLLBACK / NEXT

**VERIFIED:** §2 and §3 derived from live `rg` output retained in chat transcript.
**NOT VERIFIED:** Per-caller traffic counts; whether shadow `wallet_ledger_apply_v2` diff reports are currently zero-drift (separate Step 1.5 audit).
**FILES TOUCHED:** This doc only.
**RISKS:** None — read-only.
**DIFF SUMMARY:** +1 markdown file.
**VERIFICATION PROOF:** `rg` exit code 0; line numbers cross-checked against current `HEAD`.
**ROLLBACK:** `rm docs/fix-sprints/phase-1-step-1.2-writer-inventory-delta.md`.
**NEXT RECOMMENDED STEP:** Step 1.3 cutover canary plan (this batch).
