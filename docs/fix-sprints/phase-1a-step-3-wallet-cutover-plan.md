# Phase 1A — Step 3 — Wallet Authority Cutover Plan (PLAN ONLY)

**Status:** DISCOVERY + CUTOVER BLUEPRINT. **No code, no SQL, no migration, no runtime change.**
**Authority:** Forensic Engineering Mandate — Rule 1 (Zero Assumption), Rule 2 (Zero Guesswork), Rule 5 (Single Authority).
**Source of truth:** `/docs/fix-sprints/phase-1a-wallet-authority-discovery.md` (Step 1, paths M-01 … M-16).
**Predecessor gates:** Sprint-0 guardrails 0B-2 (wallet-write), 0B-5 (edge authority), 0B-6 (RLS), 0B-7 (schema drift) — all active.

---

## 0. EXECUTIVE SUMMARY

Goal: collapse all writes to `wallet_transactions` + `wallets.balance` (and the satellite reward / refund / penalty / admin-adjustment paths) onto **one** server-side authority, in **five** non-overlapping phases (A→E), with shadow-write + diff before any cutover, and a published rollback at every phase boundary.

Target end-state authority chain:

```
client / edge / cron / webhook  →  wallet_ledger_apply_v2(...)  (NEW, Step-2 shadow)
                                          │
                                          ├── INSERT wallet_transactions  (single writer)
                                          ├── UPDATE wallets.balance       (single writer, FOR UPDATE lock)
                                          ├── INSERT wallet_ledger_idempotency
                                          └── INSERT wallet_ledger_audit_log
```

Old `wallet_transaction(...)` RPC stays in production through Phase D and is **only** removed in Phase E after 100% diff parity for ≥ N days.

---

## 1. VERIFIED PATHS (carry forward from Step-1)

| ID | Surface | File / RPC | Authority Today | Verified by Step-1 |
|----|---------|------------|-----------------|--------------------|
| M-01 | RPC | `wallet_transaction(p_user_id, p_amount, p_type, p_description, p_reference_id)` | SECURITY DEFINER, sole legitimate balance writer | ✅ |
| M-02 | hook | `useWallet.ts` → `wallet_transaction` (credit on referral payout) | RPC | ✅ |
| M-03 | hook | `useWallet.ts` → `wallet_transaction` (credit on vote earning) | RPC | ✅ |
| M-04 | hook | `useWallet.addFunds` → `wallet_transaction` (self-credit, **unguarded**) | RPC, no server check | ✅ |
| M-05 | hook | `useWithdrawal.ts` → INSERT `wallet_transactions` then `wallet_transaction` deduct | RPC + direct INSERT + heuristic DELETE rollback | ✅ |
| M-06 | edge | `cast-photo-vote` → `wallet_transaction` (vote debit + 2× unvote penalty) | RPC | ✅ |
| M-07 | edge | `approve-deposit` → `wallet_transaction` (admin credit on deposit approval) | RPC | ✅ |
| M-09 | edge | `process-referral-reward` → `wallet_transaction` | RPC | ✅ |
| M-10 | edge | `gift-credits-bulk` → loops per-user `wallet_transaction` | RPC, **non-atomic loop** | ✅ |
| M-12 | edge | `cron-vote-payout` → `wallet_transaction` | RPC | ✅ |
| M-13 | edge | `process-withdrawal` → `wallet_transaction` (rollback on failure) | RPC | ✅ |
| M-14 | edge | `admin-wallet-adjust` → `wallet_transaction` | RPC | ✅ |
| M-15 | trigger | `wallet_transaction` itself updates `wallets.balance` | RPC body | ✅ |

---

## 2. UNSAFE PATHS (must be neutralized in Phase C/D)

| ID | Path | Unsafe Property | Cutover Class |
|----|------|-----------------|---------------|
| M-04 | `useWallet.addFunds` | Client can self-credit; no server-side reason/role gate | **REPLACE** |
| M-05 | `useWithdrawal` direct INSERT into `wallet_transactions` then RPC deduct + manual DELETE rollback | Two-writer pattern; rollback is heuristic, not transactional | **REPLACE** |
| M-08 | `useGifting.ts` client loop: INSERT `gift_credits` rows + per-row `wallet_transaction` | Client-side fan-out, no atomic outbox, partial-failure leaves orphans | **REPLACE** (server batch fn) |
| M-10 | `gift-credits-bulk` per-user RPC loop | Non-atomic; one failure mid-loop leaves split state | **REPLACE** (single batch fn call) |
| M-11 | Client-side `UPDATE wallet_transactions SET status='rejected'` (admin reject deposit) | No FSM guard; direct UPDATE bypasses RPC | **REPLACE** |

---

## 3. NOT VERIFIED — blocks Phase B comparison gate

(Lifted verbatim from Step-1 §14. Each must close before Phase B "diff parity" can be evaluated.)

| # | Item | Why it blocks cutover |
|---|------|-----------------------|
| NV-1 | Inventory of triggers on `wallets`, `gift_credits`, `competition_orders` | A hidden trigger writing balance would invalidate "single writer" claim |
| NV-2 | Full enumeration of `addFunds` callers (search beyond `useWallet`) | Cutover must replace every call site, not just known ones |
| NV-3 | `approve_deposit` FSM guards (allowed status transitions) | Determines whether M-07 needs WRAP or REPLACE |
| NV-4 | Cron auth (`cron-vote-payout`, schedule, secret source) | Affects Phase D rollout (we cannot rely on a path we cannot reproduce) |
| NV-5 | All INSERT paths into `competition_orders` | Order-driven balance changes may exist outside known M-IDs |
| NV-6 | Existing UNIQUE indexes for idempotency keys on `wallet_transactions` | Determines whether shadow can dedupe safely or needs new index first |

**Rule:** Phase B (compare) MUST NOT start until NV-1…NV-6 are resolved in a Step-2 / Step-2.5 follow-up. Plan below assumes they are closed.

---

## 4. CURRENT vs TARGET AUTHORITIES

| Surface | Current Authority | Target Authority |
|---------|-------------------|------------------|
| Vote debit / unvote penalty | `cast-photo-vote` → `wallet_transaction` | `cast-photo-vote` → `wallet_ledger_apply_v2` |
| Vote payout cron | `cron-vote-payout` → `wallet_transaction` | `cron-vote-payout` → `wallet_ledger_apply_v2` |
| Referral reward | `process-referral-reward` → `wallet_transaction` | same edge fn → `wallet_ledger_apply_v2` |
| Deposit approval | `approve-deposit` → `wallet_transaction` | same edge fn → `wallet_ledger_apply_v2` (state machine on `wallet_transactions.status` becomes part of v2) |
| Deposit reject | client UPDATE on `wallet_transactions` | new edge fn `reject-deposit` → `wallet_ledger_apply_v2` (status-only transition op) |
| Withdrawal create | client INSERT + RPC | new edge fn `request-withdrawal` → `wallet_ledger_apply_v2` |
| Withdrawal process | `process-withdrawal` → `wallet_transaction` | same edge fn → `wallet_ledger_apply_v2` |
| Admin adjustment | `admin-wallet-adjust` → `wallet_transaction` | same edge fn → `wallet_ledger_apply_v2` (with admin-role check inside fn) |
| Gifting (single & bulk) | client loop / `gift-credits-bulk` loop | new edge fn `issue-gift-batch` → `wallet_ledger_apply_v2` (single transaction, multi-recipient) |
| `addFunds` self-credit | client RPC | **DELETED** entirely; no replacement (was unsafe by design) |

---

## 5. CUTOVER SEQUENCE — Phase A → Phase E

### Phase A — SHADOW WRITE (zero user impact)
- Build new `wallet_ledger_apply_v2(...)` (Step-2 deliverable, currently blocked).
- For every M-ID above, edge fn / RPC continues to call **old** `wallet_transaction`. Immediately after success, it **also** calls `wallet_ledger_apply_v2` in `dry_run = true` mode that:
  - validates inputs,
  - writes only to `wallet_ledger_shadow_log`,
  - does NOT touch `wallets.balance` or `wallet_transactions`.
- Exit criterion: 100% of mutations have a paired shadow row for ≥ 7 days.

### Phase B — COMPARE
- Diff job (read-only) joins `wallet_transactions` ↔ `wallet_ledger_shadow_log` on idempotency key.
- Acceptance: 0 amount-mismatches, 0 type-mismatches, 0 missing-shadow, 0 extra-shadow, for ≥ 72h continuous.
- **Blocker:** NV-1…NV-6 must be closed before this phase is allowed to declare green.

### Phase C — PARTIAL CUTOVER (lowest-blast-radius first)
Order is chosen by blast radius (rows/day × user-visible severity), ascending:

1. **C-1 admin-wallet-adjust (M-14)** — admin-only, low volume, easy rollback.
2. **C-2 reject-deposit (replaces M-11 client UPDATE)** — admin-only.
3. **C-3 process-referral-reward (M-09)** — server-only, idempotent by referral id.
4. **C-4 cron-vote-payout (M-12)** — server-only, idempotent by payout id.
5. **C-5 approve-deposit (M-07)** — admin-only, FSM-guarded.

For each: edge fn switches from `wallet_transaction` → `wallet_ledger_apply_v2` (real, not dry_run). Shadow continues against the **other direction** (old RPC re-called in dry_run for diff).

### Phase D — FULL CUTOVER (high-volume / user-facing)
6. **D-1 cast-photo-vote (M-06)** — highest volume; canary by competition_id (1 small comp first, 24h soak, then all).
7. **D-2 process-withdrawal (M-13)** + new `request-withdrawal` (replaces M-05 two-writer pattern).
8. **D-3 issue-gift-batch (replaces M-08 client loop AND M-10 server loop)**.
9. **D-4 DELETE `useWallet.addFunds` call site (M-04)** — UI-side removal only; RPC stays callable for one release for rollback.

### Phase E — REMOVE OLD WRITES
- `REVOKE EXECUTE` on legacy `wallet_transaction(...)` from `authenticated`, `anon`, `service_role` (kept owner-only for emergency).
- Drop client `UPDATE wallet_transactions` permission (RLS).
- After ≥ 14 days clean: `DROP FUNCTION wallet_transaction(...)`.
- Remove shadow tables / dry_run paths.

---

## 6. ROLLBACK ORDER (mirror of cutover)

| Trigger | Action |
|---------|--------|
| Diff job in Phase B reports ANY mismatch | Stop progression. No rollback needed (no real writes by v2 yet). |
| Phase C step fails (any of C-1…C-5) | Re-deploy previous edge-fn version (calls `wallet_transaction` again). v2 row in shadow log is harmless. |
| Phase D-1 (votes) regression | Same — redeploy `cast-photo-vote` previous version. `wallet_transaction` still live. |
| Phase D-2 / D-3 regression | Redeploy edge fn. For partial-batch gifts already applied via v2: reconcile via existing `wallet_reconciliation_log` (Phase 2.2). |
| Phase D-4 (UI `addFunds` removed) | Re-add UI button in a hotfix (RPC still exists). |
| Phase E REVOKE breaks something | `GRANT EXECUTE` back. Function body unchanged. |
| Phase E DROP FUNCTION executed and regression discovered | Restore from migration history (function body is in `phase-1a-wallet-authority-discovery.md` Appendix A — must be copied there before Phase E). |

---

## 7. BLAST-RADIUS MATRIX

| Path | Avg writes/day (est. from Step-1) | User-visible severity if broken | Cutover Phase |
|------|-----------------------------------|---------------------------------|---------------|
| M-14 admin-wallet-adjust | < 10 | Low (admin sees error) | C-1 |
| M-11 reject-deposit | < 50 | Medium (admin retry) | C-2 |
| M-09 referral reward | low | Medium (user sees missing reward, recoverable via cron retry) | C-3 |
| M-12 cron-vote-payout | bursty, daily | High if silent loss | C-4 |
| M-07 approve-deposit | low–medium | High (money on the line) | C-5 |
| M-06 cast-photo-vote | **highest** | High (vote not recorded / double-charged) | D-1 |
| M-13 / M-05 withdrawal | low | Critical (money out) | D-2 |
| M-08 / M-10 gifting bulk | bursty | Medium | D-3 |
| M-04 addFunds | n/a (deleted) | n/a | D-4 |

---

## 8. SHADOW-MODE PLAN

- New table (created in Step-2, not in this step): `wallet_ledger_shadow_log(id, source_path, idempotency_key, intended_user_id, intended_amount, intended_type, computed_balance_after, mismatch boolean, captured_at)`.
- v2 RPC accepts `p_dry_run boolean default false`. When `true`: validate, compute, INSERT into shadow log, RETURN. **No** write to `wallet_transactions` or `wallets`.
- Every legacy call site adds (in same edge fn) a non-blocking `try { v2(dry_run=true) } catch { log }` immediately after the legacy success. Failures in shadow MUST NOT fail the user request.

---

## 9. COMPARISON PLAN (Phase B gate)

Read-only SQL job (admin RPC, run hourly):

```
get_wallet_shadow_diff_admin(window_start, window_end) →
  - matched_rows
  - amount_mismatch
  - type_mismatch
  - missing_in_shadow
  - extra_in_shadow
  - sample_offenders (LIMIT 20)
```

Acceptance to advance to Phase C: each non-zero counter = 0 for 72 continuous hours.
This RPC is **read-only** and does not violate guardrail 0B-2.

---

## 10. FAILURE RECOVERY PLAN

| Failure mode | Detection | Recovery |
|--------------|-----------|----------|
| v2 returns wrong balance during shadow | diff job | block cutover; fix v2; re-shadow |
| v2 idempotency key collision | UNIQUE violation in `wallet_ledger_idempotency` | v2 returns prior result; legacy path is source of truth |
| Phase C edge fn deploy hot-reload partial | edge_function_logs | redeploy previous tag (Lovable auto-deploys) |
| Phase D-1 vote double-charge | `wallet_reconciliation_log` orphan / duplicate | run existing fixer + revert canary |
| Phase E REVOKE breaks an unknown caller | runtime 42501 errors | `GRANT EXECUTE` back; identify caller; relist NOT VERIFIED |

---

## 11. SAFE FIRST IMPLEMENTATION

When (and only when) NV-1…NV-6 are closed, the **first executable change** is:

> Step 2 build of `wallet_ledger_apply_v2(...)` under a NEW name, plus `wallet_ledger_idempotency` and `wallet_ledger_shadow_log` tables, with `REVOKE ALL` on the function and `dry_run` default true, and zero call-site changes.

That single Step-2 migration is the smallest atomic unit that unblocks Phase A and is fully reversible (`DROP FUNCTION` + `DROP TABLE` of brand-new objects, no existing rows touched).

---

## 12. EXIT CRITERIA FOR PHASE 1A

- All M-IDs above route through `wallet_ledger_apply_v2`.
- Legacy `wallet_transaction(...)` dropped.
- Diff job reports 0 mismatches for ≥ 14 days post-cutover.
- `wallet_reconciliation_log` shows no new orphan/legacy quarantines attributable to the new path.
- Guardrail 0B-2 baseline updated to point its allow-list at v2 only.

---

## 13. NEXT RECOMMENDED STEP

`GO 1A-2.5` — close NV-1 … NV-6 (pure read-only audit: trigger inventory, ripgrep for `addFunds`, `approve_deposit` body extract, cron schedule + auth source, INSERT path scan on `competition_orders`, index list on `wallet_transactions`). No migrations.

Only after 1A-2.5 closes all six gaps: `GO 1A-2 (Option B)` — shadow build of `wallet_ledger_apply_v2` per Step 11.
