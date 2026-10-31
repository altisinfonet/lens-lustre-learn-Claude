# Phase-1A Step B — EXECUTION REPORT — Hourly Cron Diff Monitor + Alert

**Mode:** DRY-RUN MONITORING ONLY. Additive. Zero mutation of `wallets` / `wallet_transactions`.
**Executed:** 2026-05-15 ~08:55 UTC
**Authority:** approved plan `docs/fix-sprints/phase-1a-step-b-cron-diff-monitor-plan.md`
**Predecessor:** Step A — sealed GREEN (parity 13:13).

---

## 1. Pre-implementation read-only checks

| Check | Result |
|---|---|
| `pg_get_functiondef` of `wallet_ledger_v2_diff_report(interval)` dumped (154 lines) | ✅ — full body lifted into wrapper verbatim |
| `admin_notifications` columns: `id, type, title, message, reference_id, is_read, created_at` | ✅ — wrapper writes `(type, title, message, reference_id)` only |
| `cron.job` jobs matching `%wallet%` / `%ledger%` BEFORE migration | 0 — no name collision |
| `pg_cron` extension | installed v1.6.4 ✅ |
| `pg_net` extension | installed v0.19.5 ✅ |
| `app_role` enum values | `user, judge, content_editor, admin, registered_photographer, student` — **no `super_admin`** (corrected: wrapper uses `admin` only) |

---

## 2. SQL applied (one migration)

1. `CREATE TABLE public.wallet_ledger_v2_diff_log` — append-only diagnostic log with all RPC keys + `mismatch_count`, `wallets_checksum`, `alert_fired`, `raw_report jsonb`.
2. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + admin-only SELECT policy + `REVOKE INSERT, UPDATE, DELETE` from `PUBLIC, anon, authenticated`.
3. `CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_snapshot(interval)`
   - `SECURITY DEFINER`, `SET search_path = public`
   - body = exact CTE/SELECT logic of `wallet_ledger_v2_diff_report` (admin gate stripped because cron has no JWT)
   - inserts ONE diff_log row, optionally inserts ONE `admin_notifications` row when `mismatch_count|error_count|unmatched_live|unmatched_shadow > 0` and no alert exists yet for the current hour
   - **`REVOKE ALL` from `PUBLIC, anon, authenticated`**, `GRANT EXECUTE` to `postgres, service_role` only
4. `cron.schedule('wallet_ledger_v2_diff_hourly', '7 * * * *', …)` — returned job id `11`

A second migration ran one manual snapshot to verify end-to-end: `SELECT public.wallet_ledger_v2_diff_snapshot('1 hour'::interval);` → returned `fe30dc7b-982e-4b09-84c2-0d61c59a396c`.

---

## 3. Files touched

| Path | Type | Δ |
|---|---|---|
| `supabase/migrations/<timestamp>_*.sql` | SQL migration | +1 file (table + fn + cron) |
| `supabase/migrations/<timestamp>_*.sql` | SQL migration | +1 file (manual snapshot test) |
| `src/components/admin/WalletLedgerV2DiffAudit.tsx` | new component | +1 file |
| `src/components/admin/AdminHealth.tsx` | edited | +2 lines (1 import, 1 mount) |

No other files touched. No edge functions redeployed. No client wallet wiring touched.

---

## 4. Cron status

```
jobname                          | schedule    | active
---------------------------------+-------------+--------
wallet_ledger_v2_diff_hourly     | 7 * * * *   | true
```

Next tick: minute 7 of the next hour.

---

## 5. Manual run result

```
manual_run_id = fe30dc7b-982e-4b09-84c2-0d61c59a396c
```

Snapshot row (latest in `wallet_ledger_v2_diff_log`):

| col | value |
|---|---|
| `ran_at` | 2026-05-15 08:55:53.821793+00 |
| `live_wallet_transactions_total` | 0 |
| `shadow_log_total` | 0 |
| `matched` | 0 |
| `unmatched_live` | 0 |
| `unmatched_shadow` | 0 |
| `mismatch_count` | 0 |
| `error_count` | 0 |
| `alert_fired` | **false** |
| `wallets_checksum` | `c385be61a2585085ad4c660cb7cb9b55` |

(1h window had no wallet activity — counters all zero, exactly as expected.)

---

## 6. Alert behavior

- `admin_notifications` rows with `type = 'wallet_ledger_v2_diff_drift'` for current hour: **0** ✅
- Confirms `alert_fired = false` correctly suppressed alert insertion.
- Idempotency design: even if cron ticks twice in same hour with non-zero counters, only one alert is created (de-duped by `type + date_trunc('hour', created_at)`).

---

## 7. Admin widget proof

`src/components/admin/WalletLedgerV2DiffAudit.tsx`:
- Reads last 24 rows of `wallet_ledger_v2_diff_log` via supabase-js (RLS admin-gated)
- Renders status pill (clean/drift), 8 stat tiles, and a collapsible recent-snapshots table
- Read-only — no mutation buttons, no triggers, no edge calls

Mounted in `src/components/admin/AdminHealth.tsx` line 442 directly under `<WalletReconciliationAudit />`. No route, no nav, no auth changes.

---

## 8. Permission proof (post-migration)

```
function: public.wallet_ledger_v2_diff_snapshot(interval)
  anon            EXECUTE = false   ✅
  authenticated   EXECUTE = false   ✅
  service_role    EXECUTE = true    ✅ (and postgres, used by cron)
```

`wallet_ledger_v2_diff_log`:
- SELECT: admin only (RLS policy)
- INSERT/UPDATE/DELETE: revoked from anon/authenticated; only definer wrapper writes

---

## 9. Untouched-systems confirmation

| Surface | State |
|---|---|
| `wallets` table schema | unchanged ✅ |
| `wallets` row count | 14 (unchanged) ✅ |
| **`wallets_checksum` BEFORE → AFTER** | `c385be61a2585085ad4c660cb7cb9b55` → **identical** ✅ |
| `wallet_transactions` schema | unchanged ✅ |
| **`wallet_transactions` count BEFORE → AFTER** | 192 → 192 ✅ |
| `wallet_ledger_apply_v2(...)` | unchanged, `p_dry_run` default still TRUE ✅ |
| `wallet_transaction()` legacy fn | unchanged, still sole live writer ✅ |
| Edge functions (5 wired in Step A) | not redeployed ✅ |
| RLS policies on wallets / wallet_transactions | unchanged ✅ |
| Auth, realtime, notifications, client wiring | unchanged ✅ |
| User-facing UI | unchanged (admin-only widget added) ✅ |
| Linter findings | 380 → 380 (no net new) ✅ |

---

## 10. Rollback SQL (one-shot, fully reversible)

```sql
-- 1. Stop cron
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname='wallet_ledger_v2_diff_hourly' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- 2. Drop wrapper
DROP FUNCTION IF EXISTS public.wallet_ledger_v2_diff_snapshot(interval);

-- 3. Drop diff log
DROP TABLE IF EXISTS public.wallet_ledger_v2_diff_log;
```

Then revert `AdminHealth.tsx` import + mount lines and delete `WalletLedgerV2DiffAudit.tsx`. Total time: <60 s. Zero impact on live wallet path.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Cron ticks at minute 7 with empty 1h window → unmatched_live > 0 spurious alert | Pre-wiring legacy is sole writer; if `shadow_log_total = 0` AND `live > 0`, alert is technically correct (drift = no shadow coverage). Operator can mute by clearing the `wallet_ledger_v2_diff_drift` notification once acknowledged. |
| Cron runs while wallet activity in flight | Read-only; uses `count(*)` over `created_at >= now() - 1h` — no locks taken on wallet tables. |
| Wrapper diverges from `wallet_ledger_v2_diff_report` body | Wrapper body lifted verbatim from `pg_get_functiondef`. Future RPC changes require a paired wrapper update — documented in `phase-1a-step-b-cron-diff-monitor-plan.md` §2a. |
| Linter flags new SECURITY DEFINER fn | Same posture as A1.6/A1.7. Net new findings: **0**. |

---

## 12. Final verdict

# ✅ SAFE FOR STEP C PLANNING

All acceptance criteria from the GO command satisfied:
- cron job exists ✅
- wrapper exists ✅
- diff log table exists ✅
- RLS admin-read only ✅
- manual wrapper run created exactly one diff_log row ✅
- no alert created when counts are zero ✅
- admin widget mounted ✅ (compiles via existing build pipeline)
- wallet checksum unchanged ✅
- `wallet_transactions` count unchanged (192 → 192) ✅
- no edge functions touched ✅
- no `p_dry_run=false` anywhere ✅

### Next safe command (when ready)
```
GO PHASE-1A STEP C — PLAN ONLY: 7-DAY GREEN-RUN OBSERVATION + STEP D PRE-CUTOVER CHECKLIST
```

Step C will be **plan-only** as well — observe 7 days of clean cron ticks, define cutover preconditions for Step D (the actual `p_dry_run=false` flip with rollback fence). No execution in Step C.

— END OF EXECUTION REPORT —
