# Phase 1A — Step C: `gift_refund` Canary Preflight (RE-RUN, post-C0)

> **Mode:** READ ONLY. No code change. No migration. No edge deploy. No cron change. No `p_dry_run=false` flip. No live canary execution.
> **Context:** Step C0 executed (`docs/fix-sprints/phase-1a-step-c0-canary-blocker-resolution-execution.md`). Branch F replaced; new table `wallet_ledger_v2_rows` live; production callers untouched.

---

## 0. Guardrails honored

- ✅ READ ONLY — only `pg_get_*`, `information_schema`, `pg_policies`, `pg_constraint`, count(*) selects, and `rg`
- ✅ ZERO mutation, ZERO deploy, ZERO migration

---

## 1. Verification matrix

| # | Check | Evidence | Status |
|---|---|---|---|
| 1 | `wallet_ledger_v2_rows` exists with `UNIQUE(op, idempotency_key)` | `pg_constraint` → `wallet_ledger_v2_rows_op_idem_unique UNIQUE (op, idempotency_key)` + PRIMARY KEY (id) | ✅ |
| 1b | RLS enabled, admin-only SELECT, no INSERT/UPDATE/DELETE policy | `pg_class.relrowsecurity=true`; `pg_policies` → 1 row, `Admins read wallet_ledger_v2_rows`, cmd=`SELECT` | ✅ |
| 2 | `wallet_ledger_apply_v2` live branch is no longer P0001 stub | `pg_get_functiondef(...) ~ 'wallet_ledger_v2_rows'` → **true**; `~ 'is not authorized in Step A1'` → **false** | ✅ |
| 3 | `p_dry_run=false` writes only to `wallet_ledger_v2_rows` (+ idempotency + audit) | C0 synthetic probe (`db_audit_logs.operation='c0_probe_results'`): `live_first` → `{ok:true, dry_run:false, v2_row_id:f1e3e849-…}`; wallets_checksum and wt_count unchanged across probe | ✅ |
| 4 | Duplicate idempotency returns `replay=true` | C0 synthetic probe: second call with same `(op, idempotency_key)` → `{ok:true, replay:true, balance_after:0}` | ✅ |
| 5 | Wallets checksum unchanged | `md5(string_agg(user_id||':'||balance ORDER BY user_id))` = `fd1cc9470fd4f9d2f8709e365e4651ff` (matches pre-C0) | ✅ |
| 6 | `wallet_transactions` count unchanged | `count(*)` = **192** (matches pre-C0 baseline `192`) | ✅ |
| 7 | All edge callers still `p_dry_run=true` | `rg "p_dry_run" supabase/functions/`: 5 sites — `expire-gift-credits:16`, `paypal-capture-order:16`, `cast-photo-vote:44`, `razorpay-verify-payment:21`, `admin-process-withdrawal:16` — **all `p_dry_run: true`** | ✅ |
| 8 | `expire-gift-credits` has exactly one `gift_refund` shadow call site | `grep -c wallet_ledger_apply_v2 supabase/functions/expire-gift-credits/index.ts` → **2** (one helper definition at line 11 + one helper invocation at line 66 with `op: "gift_refund"`); only one runtime call site | ✅ |
| 9 | `gift_refund` dry-run coverage observed end-to-end | `wallet_ledger_audit_log WHERE op='gift_refund' AND result='dry_run_ok'` → **0**; `wallet_ledger_idempotency op='gift_refund'` → **0**; `wallet_ledger_shadow_log op='gift_refund'` → **0**; `wallet_ledger_v2_rows` → **0** | 🛑 **NOT OBSERVED** |

### 1.1 Live SQL evidence

```text
branch_f_writes_v2_rows  | true
still_has_p0001_stub     | false
wallets_checksum         | fd1cc9470fd4f9d2f8709e365e4651ff
wt_count                 | 192
v2_rows_count            | 0
gift_refund_dry_runs     | 0
gift_refund_idem_rows    | 0
gift_refund_shadow_rows  | 0
```

### 1.2 `expire-gift-credits` flow audit (lines 50–74)

```ts
for (const gift of expiredGifts) {
  ...
  if (deductAmount > 0) {
    const { error: txnError } = await supabase.rpc("wallet_transaction", { ... gift_expiry ... });   // legacy AUTHORITATIVE writer
    if (txnError) { ...; continue; }
    await shadowApplyV2GE(supabase, {                                                                // single gift_refund shadow call
      op: "gift_refund",
      user_id: gift.user_id,
      amount: -deductAmount,
      idempotency_key: `gift_expiry:${gift.id}`,
      ...
    });                                                                                               // calls wallet_ledger_apply_v2 with p_dry_run:true
  }
  await supabase.from("gift_announcements").update({ is_expired: true }).eq("id", gift.id);
}
```

- Single shadow call site for `op="gift_refund"` (line 66).
- Idempotency key: `gift_expiry:${gift.id}` — unambiguous, gift-scoped.
- Sequence: legacy write FIRST (authoritative), shadow SECOND (post-success). Cannot create v2 mirror without legacy success.
- Rollback target for future canary: line 16 `p_dry_run: true` boolean, single token.

---

## 2. Blocker status (vs. preflight v1)

| Blocker | v1 status | v2 (now) status |
|---|---|---|
| #1 — Branch F `RAISE EXCEPTION` stub | 🚨 OPEN | ✅ **CLOSED** by C0 (verified by synthetic probe) |
| #2 — Zero observed `gift_refund` dry-run cycle | 🟡 OPEN | 🛑 **STILL OPEN** — `gift_refund_dry_runs = 0` |

---

## 3. Untouched systems (re-confirmed)

- ❎ `public.wallets` — definition + balances unchanged (checksum identical)
- ❎ `public.wallet_transactions` — count = 192 (unchanged)
- ❎ Legacy `public.wallet_transaction()` RPC — unchanged
- ❎ All 5 edge functions calling v2 RPC — `p_dry_run: true` enforced everywhere
- ❎ All cron jobs (incl. Step B hourly diff monitor + `expire-gift-credits` schedule) — untouched
- ❎ All UI under `src/` — untouched

---

## 4. Required next test paths (to close Blocker #2)

Per `phase-1a-step-c0-canary-blocker-resolution-plan.md` §C:

### Path 1 — Wait for organic gift expiry (preferred, zero risk)

Inspect upcoming `gift_announcements WHERE is_expired=false AND expires_at IS NOT NULL ORDER BY expires_at` → after the soonest expiry passes and the cron fires, verify:

- `wallet_ledger_audit_log` row with `op='gift_refund', result='dry_run_ok'`
- `wallet_ledger_shadow_log` row with `op='gift_refund'`
- `wallet_ledger_v2_rows` count UNCHANGED (live branch unreachable until canary flip)

### Path 2 — Synthetic dev probe (only if Path 1 has no upcoming expiry within 7 days)

Per plan §C.2: one $0.01 synthetic `gift_announcements` row on a dev account, pre-expired, with mandatory same-step admin credit cleanup + `db_audit_logs` lifecycle entry. NOT executed here (read-only mode).

### Path 3 — Skip — REJECTED (Rule 1 Zero Assumption).

---

## 5. Rollback readiness (re-confirmed)

| Component | Rollback | ETA |
|---|---|---|
| `wallet_ledger_v2_rows` | `DROP TABLE IF EXISTS public.wallet_ledger_v2_rows;` (no FK refs) | < 5 s |
| `wallet_ledger_apply_v2` branch F | `CREATE OR REPLACE FUNCTION ...` restoring branches A–E + `RAISE EXCEPTION` stub (preserved verbatim in migration `20260514140749_*.sql`) | < 5 s |
| Edge function callers | unchanged in C0 — nothing to roll back | n/a |

---

## 6. Final verdict

### 🛑 **HOLD BEFORE CANARY**

Blocker #1 is resolved. Blocker #2 is **still open** — there is **no observed end-to-end `gift_refund` dry-run cycle** in production logs (`gift_refund_dry_runs=0`, `gift_refund_idem_rows=0`, `gift_refund_shadow_rows=0`).

Flipping `expire-gift-credits` line 16 to `p_dry_run: false` today would mean the **first ever** invocation of branch F via the production caller is a **live mirror write** with no dry-run telemetry to compare. That violates Rule 1 (Zero Assumption) and the plan's success criteria §4.

---

## 7. Required before re-attempting Step C-Execute

1. **Choose Path 1 or Path 2** to close Blocker #2.
2. Observe ≥ 1 `gift_refund` row with `result='dry_run_ok'` in `wallet_ledger_audit_log` (and matching `shadow_log` row).
3. Confirm wallets_checksum still `fd1cc9470fd4f9d2f8709e365e4651ff` (modulo any organic legacy `gift_expiry` deductions, which ARE expected and unrelated to v2).
4. Re-run THIS preflight one more time.
5. Then — and only then — propose the one-line `p_dry_run: true → false` flip in `expire-gift-credits/index.ts:16`.

---

## 8. Next recommended step (user choice required)

- **`GO PHASE-1A STEP C — INSPECT UPCOMING GIFT EXPIRY (PATH 1, READ-ONLY)`** — list `gift_announcements WHERE is_expired=false AND expires_at IS NOT NULL ORDER BY expires_at` to estimate Path 1 ETA.
- OR **`GO PHASE-1A STEP C — PLAN PATH 2 SYNTHETIC PROBE`** — design-only doc for a $0.01 dev probe + cleanup, if Path 1 has no upcoming expiry within 7 days.
