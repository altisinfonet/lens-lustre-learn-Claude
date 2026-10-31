# Phase 1A — Step C: Live `gift_refund` Canary — EXECUTION REPORT

> **Mode:** EXECUTED. Live `p_dry_run=false` exposure window: ~50 s (15:30:13 → 15:31:03 UTC, edit-save → rollback-deploy).
> **Authority:** Forensic Engineering Mandate Rules 1, 2, 4, 5.
> **Plan:** `phase-1a-step-c-live-gift-refund-canary-execution-plan.md`
> **Outcome:** 🛑 **HARD ABORT — ROLLBACK EXECUTED.** Parity break detected at §6 verification gate. v2 mirror appended a row whose `balance_after` differed from legacy `wallets.balance` by exactly $0.01. Rollback + cleanup proven complete. No production user impacted. Net wallet movement = $0.00.

---

## 1. VERIFIED FINDINGS

### 1.1 Pre-flight snapshot (gate ✅ PASS)
```
wallets_checksum_normalized = 1e80ba01ca19b78fa0d27508c933d0ea
wallet_txn_count            = 194
v2_rows_total               = 0
v2_rows_gift_refund         = 0
idem_gift_refund            = 0
audit_live_ok_pre           = 0
audit_dry_run_ok_pre        = 1   (Step C synthetic dry-run probe artifact, expected)
audit_replay_pre            = 0
organic_eligible_now        = 0   ← gate condition: zero real users at risk
operator_balance            = 5.00
```

### 1.2 Synthetic injection
```
gc_id  (gift_credits)        = 0998dcc1-9db2-45b7-af46-bead1397f358
ann_id (gift_announcements)  = 04c33d91-9264-4153-aef2-6125ae1b491f
amount                        = 0.01
expires_at                    = now() - 1 minute (already expired)
recipient                     = operator 4c200b33-ae64-46f0-ba5d-1a97152e6a6c
```
`gift_credits.target_type` set to `'email'` (the only check-constraint-allowed value besides `'all'`; plan §0 unaware of constraint — `target_type='specific'` would have failed; corrected at injection time, no semantic impact on cron path).

### 1.3 One-line flip applied
```
File: supabase/functions/expire-gift-credits/index.ts
Line 17 BEFORE:   p_source_path: SHADOW_PATH_GE, p_dry_run: true,
Line 17 AFTER :   p_source_path: SHADOW_PATH_GE, p_dry_run: false,
```
Deploy: `supabase--deploy_edge_functions(["expire-gift-credits"]) → success`

### 1.4 Live invoke result
```
POST /functions/v1/expire-gift-credits  → 200 OK
body: { "expired": 1, "success": true }
sb-request-id: 019e2c0b-a0c0-76bc-9faa-4387e86456f8
```

### 1.5 Post-flip verification (§6 of plan) — **PARITY BREAK**

| Metric | Expected | Observed | Verdict |
|---|---|---|---|
| `v2_rows_for_probe` | 1 | **1** | ✅ |
| `audit_live_ok_for_probe` | 1 | **1** | ✅ |
| `idem_for_probe` | 1 | **1** | ✅ |
| `legacy_gift_expiry_rows_in_window` | 1 | **1** | ✅ |
| `operator_balance_after_legacy` | 4.99 | **4.99** | ✅ |
| `v2_recorded_balance_after = operator_balance_after_legacy` | true | **`v2_recorded_balance_after = 4.98` ≠ `4.99`** | 🛑 **FAIL** |
| `ann_is_expired` | true | true | ✅ |

`Δ = -0.01`. v2 mirror under-reports authoritative balance by exactly the canary amount.

### 1.6 Root cause (verified, not inferred)

`wallet_ledger_apply_v2` Branch F computes `balance_after := (current wallets.balance) + p_amount` from a fresh read of `public.wallets`. The expire-gift-credits handler:
1. Calls legacy `wallet_transaction(... -0.01 ...)` first → `wallets.balance: 5.00 → 4.99` (committed).
2. Calls `wallet_ledger_apply_v2(... -0.01 ...)` second → reads `wallets.balance = 4.99`, computes `balance_after = 4.99 + (-0.01) = 4.98`, persists 4.98 into `wallet_ledger_v2_rows.balance_after`.

Both calls subtract; the v2 mirror records a hypothetical "v2-owned-the-wallet" post-state on top of an already-debited table. This is a **structural semantics mismatch** between the legacy-authoritative + v2-mirror dual-path design and Branch F's current `balance_after` computation. It will fail the Phase 1B reconciliation invariant for every operation, not just `gift_refund`.

This was **not visible in the Step C synthetic dry-run probe** because dry-run paths never persist a `balance_after` into `wallet_ledger_v2_rows` (no row written), only into the audit log — which the synthetic probe report did not parity-check against the post-legacy wallet balance.

### 1.7 Rollback (executed within ~50 s of flip)
```
File: supabase/functions/expire-gift-credits/index.ts
Line 17 reverted: p_dry_run: false → p_dry_run: true
Deploy: supabase--deploy_edge_functions(["expire-gift-credits"]) → success
sed verification: line 17 == "      p_source_path: SHADOW_PATH_GE, p_dry_run: true,"  ✅
```

### 1.8 Cleanup (executed)

```
wallet_transaction(admin_adjustment, +0.01, operator) → txn_id = 9edadf7d-bddb-4763-93d9-d295a3d6f56b
DELETE gift_announcements WHERE id = 04c33d91-… → 1 row
DELETE gift_credits       WHERE id = 0998dcc1-… → 1 row
```

### 1.9 Post-cleanup snapshot vs §8 success criteria

| Metric | Pre | Expected post | Observed post | Verdict |
|---|---|---|---|---|
| `wallets_checksum_normalized` | `1e80ba01ca19b78fa0d27508c933d0ea` | byte-identical | **`1e80ba01ca19b78fa0d27508c933d0ea`** | ✅ |
| `operator_balance` | 5.00 | 5.00 | **5.00** | ✅ |
| `wallet_transactions` count | 194 | 196 (+legacy gift_expiry, +admin_adjustment) | **196** | ✅ |
| `wallet_ledger_v2_rows` count for `gift_refund` | 0 | +1 (kept) | **1** | ✅ |
| `wallet_ledger_v2_rows` for any other op | 0 | 0 (no fan-out) | **0** | ✅ |
| `wallet_ledger_idempotency` count for `gift_refund` | 0 | +1 (kept) | **1** | ✅ |
| `wallet_ledger_audit_log` `gift_refund/live_ok` | 0 | +1 (kept) | **1** | ✅ |
| `wallet_ledger_audit_log` `gift_refund/replay` | 0 | +1 (from §7) | **0** (§7 skipped per §9 abort rule) | ⚠️ expected-skip |
| Synthetic `gift_announcements` rows | 0 | 0 | **0** | ✅ |
| Synthetic `gift_credits` rows | 0 | 0 | **0** | ✅ |
| Edge fn line 17 | `true` | `true` | **`true`** | ✅ |

### 1.10 Required-verification checklist (from user prompt)

| # | Check | Status |
|---|---|---|
| 1 | legacy `wallet_transaction()` still authoritative | ✅ — `wallets.balance 5.00 → 4.99 → 5.00`, all writes via legacy RPC, zero v2 writes to `wallets`/`wallet_transactions` |
| 2 | `wallet_ledger_v2_rows` receives live append | ✅ — exactly 1 row with `op='gift_refund'`, `idempotency_key='gift_expiry:04c33d91-…'` |
| 3 | idempotency row created | ✅ — exactly 1 row in `wallet_ledger_idempotency` |
| 4 | replay returns `replay=true` | ⚠️ **NOT TESTED** — §7 replay test skipped per §9 hard-abort rule (do not run §7 on parity failure). Replay safety remains as previously proven by Step C synthetic dry-run + C0 plan. |
| 5 | audit row created | ✅ — `wallet_ledger_audit_log` `result='live_ok'` row present |
| 6 | wallets net balance restored after cleanup | ✅ — operator 5.00 → 4.99 → 5.00; checksum byte-identical |
| 7 | wallet_transactions count restored to net-zero impact | ✅ — +2 rows summing to $0.00 (gift_expiry −0.01, admin_adjustment +0.01) |
| 8 | no mismatch alerts | 🛑 **PARITY MISMATCH OBSERVED** — `v2_recorded_balance_after (4.98) ≠ wallets.balance (4.99)` |
| 9 | no shadow drift on other ops | ✅ — `v2_rows_other_ops_post = 0` |
| 10 | rollback line verified | ✅ — `sed -n '17p'` shows `p_dry_run: true` |

---

## 2. NOT VERIFIED ITEMS

- §7 direct replay call (`wallet_ledger_apply_v2(...p_dry_run:=false, same key)`) — intentionally skipped per §9 abort rule. Replay-safety status: not regressed in this canary, last-proven in Step C synthetic dry-run (audit `result='replay'` was previously observed in C0 plan validation, not re-asserted here).
- 24-hour observation window of §12 — superseded by hard rollback; not applicable.

---

## 3. FILES TOUCHED

| Path | Type | Change |
|---|---|---|
| `supabase/functions/expire-gift-credits/index.ts` | edge fn | Line 17 `true → false → true` (net zero diff after rollback) |
| `docs/fix-sprints/phase-1a-step-c-live-gift-refund-canary-execution.md` | report | NEW (this file) |

DB state changes (all compensating, net-zero):
- `gift_credits`, `gift_announcements`: +1/−1 each (synthetic, deleted)
- `wallets`: 5.00 → 4.99 → 5.00 (operator only)
- `wallet_transactions`: +2 rows (gift_expiry −0.01, admin_adjustment +0.01) — kept as audit trail
- `wallet_ledger_v2_rows`: +1 (`gift_refund`, `balance_after=4.98`) — **kept as proof artifact of parity break**
- `wallet_ledger_idempotency`: +1 — kept
- `wallet_ledger_audit_log`: +1 (`live_ok`) — kept

---

## 4. RISKS

- **R1 (RESOLVED):** Live `p_dry_run=false` exposure on production cron path → bounded to ~50 s; `organic_eligible_now=0` precondition guaranteed zero real-user fan-out.
- **R2 (NEW, BLOCKING):** Branch F `balance_after` semantics are incompatible with the dual-path "legacy authoritative + v2 mirror" design. Any future live cutover of any op will produce identical −Δ offsets. **Phase 1B reconciliation will alarm on every live mirror row** until Branch F is rewritten to either (a) compute `balance_after` from a snapshot taken **before** legacy debits, or (b) record the legacy-authoritative `wallets.balance` directly post-leg-1.

---

## 5. DIFF SUMMARY

```diff
--- supabase/functions/expire-gift-credits/index.ts
+++ supabase/functions/expire-gift-credits/index.ts
@@ -17 +17 @@  (transient flip during canary)
-      p_source_path: SHADOW_PATH_GE, p_dry_run: true,
+      p_source_path: SHADOW_PATH_GE, p_dry_run: false,
@@ -17 +17 @@  (rolled back same-window)
-      p_source_path: SHADOW_PATH_GE, p_dry_run: false,
+      p_source_path: SHADOW_PATH_GE, p_dry_run: true,
```

Net file diff vs. pre-canary tree: **0 bytes**.

---

## 6. VERIFICATION PROOF

- Pre & post wallets checksum equal: `1e80ba01ca19b78fa0d27508c933d0ea` (string_agg with scale-normalized `(balance+0)::text`).
- Operator wallet net movement: `5.00 → 4.99 → 5.00` (zero).
- `wallet_transactions` net amount in window: `−0.01 + 0.01 = 0.00`.
- `v2_rows_other_ops_post = 0` ⇒ zero cross-op fan-out.
- `synthetic_ann_remaining = 0`, `synthetic_gc_remaining = 0` ⇒ synthetic rows fully cleaned.
- Edge fn line 17 confirmed `p_dry_run: true` via `sed`.
- Edge fn redeployed twice (flip + rollback), both `successfully deployed`.

---

## 7. ROLLBACK PLAN

Already executed in this run. No further action needed on production code or data.

If a follow-up post-mortem requires removing the **kept** v2 proof artifact (1 row each in `wallet_ledger_v2_rows`, `wallet_ledger_idempotency`, `wallet_ledger_audit_log`), it can be done via migration; deliberately retained here as forensic evidence of the parity break.

---

## 8. NEXT RECOMMENDED STEP

**`GO PHASE-1A STEP C — BRANCH F BALANCE_AFTER SEMANTICS FORENSIC AUDIT`**

Audit-only, plan-only. Must:
1. Read `pg_get_functiondef(wallet_ledger_apply_v2)` Branch F in full.
2. Define and approve one of:
   - **Option A:** Branch F snapshots `wallets.balance` **before** Leg-1 legacy call and records `snapshot + p_amount`, so `balance_after` matches what legacy will leave behind.
   - **Option B:** Branch F records the **post-legacy** `wallets.balance` verbatim (i.e., `balance_after := (SELECT balance FROM wallets WHERE user_id = ...)` after legacy commit).
   - **Option C:** Re-define Phase 1B reconciliation invariant to permit `balance_after = wallets.balance − p_amount` for mirror-mode rows.
3. Specify migration + regression test.
4. Re-derive go/no-go for any future live canary on any op.

DO NOT re-attempt any live canary on any op until R2 is closed.

---

## 9. FINAL VERDICT

# 🛑 ROLLBACK EXECUTED

Live v2 canary for `gift_refund` aborted at §6 verification gate due to a structural `balance_after` parity break between Branch F and legacy-authoritative `wallets.balance`. Rollback + cleanup are complete and proven. Production users were not affected. Branch F semantics must be fixed and re-approved before any further live canary attempt on any operation.
