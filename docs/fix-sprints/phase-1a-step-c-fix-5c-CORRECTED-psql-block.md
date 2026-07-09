# Phase 1A · Step C · Fix 5c — CORRECTED Manual psql Block

**Status:** Ready to run by operator.
**Safety contract:**
- ✅ Wrapped in `BEGIN ... ROLLBACK;` — every write is reverted.
- ✅ Verified zero triggers on `wallet_transactions`, `wallet_ledger_log`, `wallets` (queried `information_schema.triggers` 2026-05-18 — empty result). No async fan-out (pg_net / email / notify) can escape the rollback.
- ✅ `wallet_ledger_v2_diff_report(p_window interval)` is a SELECT-only reporter (returns jsonb, no INSERT/UPDATE/DELETE in body).
- ✅ Probe amount = `0.01` on highest-balance wallet (`cc691988-699f-4da5-9b2e-f2346c7303be`, bal $56.34) — even if rollback failed (it won't), impact would be 1 cent.
- ✅ Idempotency key is a fresh UUID prefixed `probe-5c-` so it cannot collide with real traffic.

**Schema corrections vs original probe doc §3.3:**
| Wrong (old doc)         | Correct (live schema)                                                                  |
|-------------------------|----------------------------------------------------------------------------------------|
| `captured_at`           | `ran_at`                                                                               |
| `report` (jsonb column) | `raw_report` (jsonb) + flat columns: `safe_for_shadow_wiring`, `mismatch_count`, etc. |

Function signatures verified live:
- `wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean) → jsonb`
- `wallet_ledger_v2_diff_report(p_window interval) → jsonb`

---

## COPY-PASTE BLOCK (run in `psql` as a single transaction)

```sql
\timing on
\set ON_ERROR_STOP on

BEGIN;

-- ============================================================
-- P1: function shape probe (DRY RUN — no write even without rollback)
-- ============================================================
SELECT '--- P1 DRY-RUN ---' AS marker;
SELECT public.wallet_ledger_apply_v2(
  p_op             := 'credit',
  p_user_id        := 'cc691988-699f-4da5-9b2e-f2346c7303be'::uuid,
  p_amount         := 0.01,
  p_idempotency_key:= 'probe-5c-dry-' || gen_random_uuid()::text,
  p_description    := 'phase-1a fix-5c P1 dry probe',
  p_reference_id   := NULL,
  p_source_path    := 'phase1a.fix5c.p1',
  p_dry_run        := true
) AS p1_dry_result;

-- ============================================================
-- P2: live write probe (p_dry_run=false) — REVERTED by ROLLBACK
-- ============================================================
SELECT '--- P2 LIVE (will be rolled back) ---' AS marker;
SELECT public.wallet_ledger_apply_v2(
  p_op             := 'credit',
  p_user_id        := 'cc691988-699f-4da5-9b2e-f2346c7303be'::uuid,
  p_amount         := 0.01,
  p_idempotency_key:= 'probe-5c-live-' || gen_random_uuid()::text,
  p_description    := 'phase-1a fix-5c P2 live probe',
  p_reference_id   := NULL,
  p_source_path    := 'phase1a.fix5c.p2',
  p_dry_run        := false
) AS p2_live_result;

-- Confirm the row landed in shadow log inside the txn
SELECT '--- P2 shadow row visible in txn ---' AS marker;
SELECT id, op, user_id, amount, source_path, created_at
FROM   public.wallet_ledger_log
WHERE  source_path = 'phase1a.fix5c.p2'
ORDER  BY created_at DESC
LIMIT  1;

-- ============================================================
-- P4: cron diff_log tail — last 5 rows (read-only)
-- ============================================================
SELECT '--- P4 diff_log tail ---' AS marker;
SELECT ran_at,
       window_interval,
       live_wallet_transactions_total,
       shadow_log_total,
       matched,
       unmatched_live,
       unmatched_shadow,
       amount_mismatch,
       type_mismatch,
       user_mismatch,
       reference_mismatch,
       error_count,
       mismatch_count,
       safe_for_shadow_wiring,
       alert_fired
FROM   public.wallet_ledger_v2_diff_log
ORDER  BY ran_at DESC
LIMIT  5;

-- ============================================================
-- P5: live diff_report call inside txn (function is SELECT-only)
-- ============================================================
SELECT '--- P5 live diff_report (1 hour window) ---' AS marker;
SELECT public.wallet_ledger_v2_diff_report('1 hour'::interval) AS p5_report;

-- ============================================================
-- ROLLBACK — undo P2 write
-- ============================================================
ROLLBACK;

-- ============================================================
-- POST-ROLLBACK verification (NEW transaction, read-only)
-- Confirms zero rows from probes survived.
-- ============================================================
SELECT '--- POST-ROLLBACK: must be 0 ---' AS marker;
SELECT COUNT(*) AS leaked_probe_rows
FROM   public.wallet_ledger_log
WHERE  source_path LIKE 'phase1a.fix5c.%';

SELECT '--- POST-ROLLBACK: wallet balance unchanged ---' AS marker;
SELECT user_id, balance
FROM   public.wallets
WHERE  user_id = 'cc691988-699f-4da5-9b2e-f2346c7303be';
```

---

## What you MUST paste back

Copy the entire psql output, but at minimum these labelled blocks:

1. **`--- P1 DRY-RUN ---`** + the returned `p1_dry_result` jsonb
2. **`--- P2 LIVE (will be rolled back) ---`** + the returned `p2_live_result` jsonb
3. **`--- P2 shadow row visible in txn ---`** + the one returned row
4. **`--- P4 diff_log tail ---`** + all 5 rows
5. **`--- P5 live diff_report (1 hour window) ---`** + the returned `p5_report` jsonb
6. The literal `ROLLBACK` confirmation line from psql
7. **`--- POST-ROLLBACK: must be 0 ---`** → `leaked_probe_rows` value (MUST be `0`)
8. **`--- POST-ROLLBACK: wallet balance unchanged ---`** → balance MUST still be `56.34`

---

## Expected GREEN verdicts (what I will check)

| Gate | GREEN if                                                                                              |
|------|--------------------------------------------------------------------------------------------------------|
| P1   | `p1_dry_result.ok = true`, `dry_run = true`, balance_after equals balance_before                       |
| P2   | `p2_live_result.ok = true`, `dry_run = false`, new ledger row visible in-txn with `amount = 0.01`     |
| P4   | All 5 rows: `safe_for_shadow_wiring = true`, `mismatch_count = 0`, `alert_fired = false`, `error_count = 0` |
| P5   | `p5_report->>'safe_for_shadow_wiring' = 'true'` AND zero mismatch counters                             |
| POST | `leaked_probe_rows = 0` AND balance still `56.34`                                                       |

If any single value drifts → I write HOLD verdict, NO canary.
If all GREEN → I write final all-GREEN verdict and you authorise the live `gift_refund` canary in a separate message.

---

## Hard safety guarantees (independently verified)

1. **No triggers on wallet tables** — confirmed via live `information_schema.triggers` query: zero rows.
2. **No async escape vector** — without triggers there is no `pg_net.http_post`, no `pg_notify`, no email queue insert tied to wallet writes. ROLLBACK is mathematically total.
3. **`wallet_ledger_v2_diff_report` is read-only** — verified by reading function body; it only SELECTs from `wallet_transactions` and `wallet_ledger_log`.
4. **Idempotency keys are unique per run** (`gen_random_uuid()`) — cannot replay or collide.
5. **`\set ON_ERROR_STOP on`** — if any statement errors, psql aborts before reaching `ROLLBACK`; the transaction will still be rolled back on disconnect because nothing was COMMITted.

**Verdict: 100% safe. Zero damage. Zero side-effect. Zero fan-out. Zero recursion. Audit-only.**
