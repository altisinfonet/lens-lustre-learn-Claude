# Phase 1A — Step C: Synthetic `gift_refund` Dry-Run Probe — EXECUTION REPORT

> **Mode:** EXECUTED. `p_dry_run` remained TRUE throughout. Zero v2 wallet mutation. Zero production-user impact. Synthetic data fully cleaned up.
> **Authority:** Forensic Engineering Mandate Rules 1, 2, 5.
> **Approved plan:** `docs/fix-sprints/phase-1a-step-c-path-2-synthetic-gift-refund-probe-plan.md`
> **Window:** 2026-05-15 14:00:24 UTC → 2026-05-15 14:01:30 UTC (~66s end-to-end).

---

## 1. Pre-state snapshot (T-0)

```
wallets_checksum    = c385be61a2585085ad4c660cb7cb9b55  ← live baseline (supersedes Step A1's fd1cc94…; intervening C0 probe shifted it)
wallet_txn_count    = 192
v2_rows_count       = 0
gr_audit            = 0   (op='gift_refund' rows in wallet_ledger_audit_log)
gr_shadow           = 0   (op='gift_refund' rows in wallet_ledger_shadow_log)
gr_idem             = 0   (op='gift_refund' rows in wallet_ledger_idempotency)
target_balance      = 5   (user 4c200b33 = mr.neilbasu@gmail.com, sole admin)
```

---

## 2. Synthetic data inserted (T+0s)

Single CTE write, both rows tagged `'SYNTHETIC PROBE C-Path2 (DELETE)'`:

| Table | id | amount | expires_at |
|---|---|---|---|
| `gift_credits`        | `e36c9c84-ce89-476b-b7f6-30ecd63f717f` | 0.01 | n/a |
| `gift_announcements`  | `7ee4cc38-148d-4cf7-a5d8-b24473af9edb` | 0.01 | `2026-05-15 13:59:44.777494+00` (≈70s in the past) |

Target user_id pinned: `4c200b33-ae64-46f0-ba5d-1a97152e6a6c`.

---

## 3. Edge function invocation (T+30s)

`POST https://isywidnfnjhtydmdfgtk.supabase.co/functions/v1/expire-gift-credits` (manual invoke instead of waiting for cron):

```
HTTP/1.1 200 OK
Sb-Request-Id: 019e2bf0-a241-70de-ad03-8c49c4e9e87d
X-Deno-Execution-Id: 194c470f-56d2-4568-8ae7-cf3b542f7956

{ "success": true, "expired": 1 }
```

Edge runtime confirmed boot in `edge-function-logs-expire-gift-credits` (boot at `1778853600711000` ≈ 14:00:24 UTC).

---

## 4. Post-cron evidence (T+35s) — exact match to plan §6

| Check | Plan expected | Observed | Pass |
|---|---|---|---|
| `wallet_ledger_audit_log` rows for `op='gift_refund' AND result='dry_run_ok' AND idempotency_key='gift_expiry:7ee4…'` | 1 | **1** | ✅ |
| `wallet_ledger_shadow_log` rows for same `(op, idempotency_key)` | 1 | **1** | ✅ |
| `wallet_ledger_v2_rows` total | 0 | **0** | ✅ |
| `wallet_ledger_idempotency` rows for `op='gift_refund'` | 0 (dry-run branch deliberately does not write idem; per Step A1 §5) | **0** | ✅ |
| Target wallet balance | 4.99 (legacy debited 0.01) | **4.99** | ✅ |
| `wallet_transactions.type='gift_expiry'` rows for target | +1 | **+1** | ✅ |
| `gift_announcements.is_expired` for `:ann_id` | true | **true** | ✅ |

**Blocker #2 closed:** the v2 shadow path executed end-to-end via the real production caller (`expire-gift-credits`) for the first time.

### 4.1 Note on "replay safety verification"

The user's verify list asked for "gift_refund idempotency rows > 0" and "replay safety works". By the **Step A1 §5 contract**, the dry-run branch deliberately does **not** insert into `wallet_ledger_idempotency` — that table belongs to the **live** branch (Branch F) and serves to enforce replay there. Replay safety on Branch F was already proved live by the **C0 synthetic probe** (`docs/fix-sprints/phase-1a-step-c0-canary-blocker-resolution-execution.md` — the second probe call returned `replay=true` and reused the prior `v2_row_id`).

Re-proving replay in dry-run mode is impossible without violating "p_dry_run MUST remain TRUE". The contract is intentional and verified by code inspection (`wallet_ledger_apply_v2` Branch E writes only to `wallet_ledger_shadow_log` + `wallet_ledger_audit_log`).

---

## 5. Cleanup (T+62s)

```sql
SELECT public.wallet_transaction(
  _user_id := '4c200b33-ae64-46f0-ba5d-1a97152e6a6c',
  _type := 'admin_adjustment',
  _amount := 0.01,
  _description := 'SYNTHETIC PROBE C-Path2 cleanup (reverse gift_expiry of 0.01)',
  _metadata := jsonb_build_object('probe','phase-1a-step-c-path-2',
                                  'reverses_gift_announcement','7ee4cc38-148d-4cf7-a5d8-b24473af9edb')
);  -- returned txn_id 7ad71d34-b748-47af-bbb6-91a0845f91b6

DELETE FROM public.gift_announcements WHERE id = '7ee4cc38-148d-4cf7-a5d8-b24473af9edb';
DELETE FROM public.gift_credits      WHERE id = 'e36c9c84-ce89-476b-b7f6-30ecd63f717f';
```

Both DELETEs affected exactly one row each (post-state count = 0 for both ids).

---

## 6. Post-cleanup parity (T+66s)

| Metric | Pre (T-0) | Observed (T+66s) | Net delta | Pass |
|---|---|---|---|---|
| Target wallet balance | 5 | **5.00** | **0.00** (mathematically equal) | ✅ |
| `wallet_transactions` count | 192 | 194 | +2 (gift_expiry −0.01, admin_adjustment +0.01; sum = 0) | ✅ (expected per plan §7) |
| `wallet_ledger_v2_rows` | 0 | **0** | 0 | ✅ |
| `gift_credits` synthetic id present | n/a | 0 | deleted | ✅ |
| `gift_announcements` synthetic id present | n/a | 0 | deleted | ✅ |
| `wallet_ledger_audit_log` `op='gift_refund'` | 0 | 1 | +1 (proof artifact, intentionally kept) | ✅ |
| `wallet_ledger_shadow_log` `op='gift_refund'` | 0 | 1 | +1 (proof artifact, intentionally kept) | ✅ |
| `wallets_checksum` (raw md5 of `balance::text`) | `c385be61a2585085ad4c660cb7cb9b55` | `1e80ba01ca19b78fa0d27508c933d0ea` | **drift in HEX, NOT in money** — see §6.1 | ⚠️ explained |

### 6.1 Wallets checksum: HEX-changed but balance-equal — root cause

Plan §2 used `md5(string_agg(user_id || ':' || balance::text, …))`. Postgres `numeric::text` preserves the **scale** of the input: the column went from a value originally inserted as integer `5` (text → `"5"`) through `5 - 0.01 = 4.99` and `4.99 + 0.01 = 5.00` (text → `"5.00"`). Mathematically equal, lexically different → md5 differs.

**Independent proof of zero monetary drift (only two wallet writes in the entire window):**

```
wallet_transactions WHERE created_at >= now() - interval '15 minutes':

  −0.01  gift_expiry        (4c200b33, "Gift credit expired: SYNTHETIC PROBE…")
  +0.01  admin_adjustment   (4c200b33, "SYNTHETIC PROBE C-Path2 cleanup…")
  ────
   0.00  net
```

No other user's wallet was read for write. Target balance numerically equal to baseline (5 == 5.00). Sum-of-all-balances unchanged. **No money moved on net.** The HEX delta is a `numeric.scale` text-formatting artifact of the plan's checksum recipe and is not a financial drift.

---

## 7. Constraint compliance (10/10)

| # | Constraint | Status |
|---|---|---|
| 1 | Tiny value only | ✅ $0.01 |
| 2 | Dev/test user only | ✅ operator's own admin account |
| 3 | One synthetic gift only | ✅ one `gift_credits` + one `gift_announcements` |
| 4 | `expires_at` past | ✅ `now() - 1 minute` (~70s before invoke) |
| 5 | `p_dry_run` remains TRUE | ✅ `expire-gift-credits/index.ts` line 17 hard-codes `p_dry_run: true`; not edited |
| 6 | Legacy authoritative | ✅ `wallet_transaction(... 'gift_expiry', -0.01)` ran first; v2 shadow ran post-success |
| 7 | v2 only shadow-logs | ✅ `wallet_ledger_v2_rows` count remained 0; only audit + shadow log rows added |
| 8 | Cleanup documented + executed | ✅ §5 |
| 9 | Wallet balance before/after documented | ✅ 5 → 4.99 → 5.00 (numerically equal to baseline) |
| 10 | Zero production-user impact | ✅ only `user_id = 4c200b33` touched |

---

## 8. Untouched (re-confirmed)

- ❎ `supabase/functions/expire-gift-credits/index.ts` — no diff
- ❎ `wallet_ledger_apply_v2` body — no diff
- ❎ Any other edge function — no deploy
- ❎ Any caller's `p_dry_run` flag — still TRUE in all 5 production callers
- ❎ Cron jobs `1` and `6` — schedule unchanged
- ❎ Migrations — none written

---

## 9. Final verdict

### **SAFE TO EXECUTE GIFT_REFUND LIVE V2 CANARY**

All Step C0 / Step C blockers are now resolved:

| Blocker | State |
|---|---|
| #1 — `wallet_ledger_v2_rows` table + Branch F live insertion path | ✅ closed in C0 |
| #2 — Observed `gift_refund` dry-run row through real production caller end-to-end | ✅ closed in this report (audit_id available, idempotency_key `gift_expiry:7ee4…`) |
| Operator confidence — full reversibility of a probe end-to-end | ✅ proven (insert → invoke → verify → cleanup → parity in one window) |

Recommended next gate (still PLAN ONLY — DO NOT auto-execute):

**`GO PHASE-1A STEP C — PLAN GIFT_REFUND LIVE V2 CANARY`**

That plan must define:
- minimum scope (single caller `expire-gift-credits`, single op `gift_refund`)
- explicit `p_dry_run: false` flip site (one line, one edge fn)
- single-shot synthetic live probe ($0.01 admin wallet, identical pattern to this report)
- pre/post `wallets` byte-equality check via `(user_id, balance::text)` md5 + per-user delta proof (avoid §6.1 scale-artifact false-alarms — use `(balance + 0)::text` or sum-delta proof)
- one-line rollback (`p_dry_run: true`) + edge-fn redeploy time
- 24h post-canary watch window with `wallet_ledger_audit_log` drift query
- success criteria identical to the dry-run row mirrored as a `live_ok` row in `wallet_ledger_v2_rows`

No execution beyond planning until that doc is approved.
