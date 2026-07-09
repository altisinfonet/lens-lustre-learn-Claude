# Phase-1A Step B — Plan Only: Hourly Cron Diff Monitor + Admin Alert

**Mode:** PLAN ONLY. No migration, no cron, no widget, no edge deploy.
**Authored:** 2026-05-15 ~08:25 UTC
**Predecessor:** Step A — sealed **GREEN** (parity 13:13, 0 errors, 0 invalid, admin gate intact)
**Authority:** legacy `wallet_transaction()` remains sole live writer; v2 stays `p_dry_run=true`.

---

## 0. Live ground-truth (verified before authoring this plan)

| Probe | Result |
|---|---|
| `pg_cron` extension | installed v1.6.4 ✅ |
| `pg_net` extension | installed v0.19.5 ✅ |
| Existing cron jobs containing "wallet"/"ledger" | **0** (no name collision) |
| Shadow recorder fn | `public.wallet_ledger_apply_v2(...)` ✅ |
| Diff RPC fn | `public.wallet_ledger_v2_diff_report(interval)` ✅ (admin-gated, returns 42501 to non-admin) |
| Shadow log table | `public.wallet_ledger_shadow_log` (cols: validation_ok, error_code, error_message, ...) ✅ |
| Audit table | `public.wallet_ledger_audit_log` ✅ |
| Existing admin health surface | `src/components/admin/AdminHealth.tsx` (already hosts 10+ drift widgets) ✅ |

> Naming reconciliation: docs in Step A used `wallet_ledger_v2_*` shorthand; live DB uses `wallet_ledger_shadow_log` + `wallet_ledger_apply_v2` + `wallet_ledger_v2_diff_report`. Step B will use the **live** names exclusively.

---

## 1. New table — `public.wallet_ledger_v2_diff_log`

**Purpose:** persistent, append-only log of every hourly diff snapshot for trend + alerting + audit.

**Proposed shape (NOT executed):**
```sql
CREATE TABLE public.wallet_ledger_v2_diff_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at              timestamptz NOT NULL DEFAULT now(),
  window_interval     interval    NOT NULL,
  shadow_rows         bigint      NOT NULL DEFAULT 0,
  shadow_invalid      bigint      NOT NULL DEFAULT 0,
  shadow_errors       bigint      NOT NULL DEFAULT 0,
  live_rows           bigint      NOT NULL DEFAULT 0,
  matched_pairs       bigint      NOT NULL DEFAULT 0,
  unmatched_shadow    bigint      NOT NULL DEFAULT 0,
  unmatched_live      bigint      NOT NULL DEFAULT 0,
  mismatch_count      bigint      NOT NULL DEFAULT 0,
  wallets_checksum    text        NULL,
  raw_report          jsonb       NULL,                -- full RPC return
  alert_fired         boolean     NOT NULL DEFAULT false,
  notes               text        NULL
);
CREATE INDEX wallet_ledger_v2_diff_log_ran_at_idx
  ON public.wallet_ledger_v2_diff_log (ran_at DESC);
```

**RLS plan:**
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- SELECT policy: `has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin')`
- INSERT/UPDATE/DELETE: **revoke from authenticated**; only `service_role` + cron (via SECURITY DEFINER fn) writes.

**Risk:** isolated additive table. No FK to live data. **Rollback = `DROP TABLE`** with zero side-effect.

---

## 2. Hourly cron job

**Job name:** `wallet_ledger_v2_diff_hourly` (verified non-colliding above).
**Schedule:** `'7 * * * *'` (offset by 7 min to avoid hour-boundary contention with other crons).
**Action:** call `public.wallet_ledger_v2_diff_snapshot()` (a new SECURITY DEFINER wrapper — see §2a).

**Proposed registration (NOT executed):**
```sql
SELECT cron.schedule(
  'wallet_ledger_v2_diff_hourly',
  '7 * * * *',
  $$ SELECT public.wallet_ledger_v2_diff_snapshot('1 hour'::interval); $$
);
```

### 2a. Wrapper fn `public.wallet_ledger_v2_diff_snapshot(interval)`

Why a wrapper (not direct RPC call from cron):
- `wallet_ledger_v2_diff_report` is admin-gated via `auth.uid()` → cron has no JWT → would 42501.
- Wrapper runs `SECURITY DEFINER` as table-owner, bypassing the gate **for cron only**, NEVER exposed to anon/authenticated.

```sql
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_snapshot(p_window interval)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report  jsonb;
  v_id      uuid;
  v_alert   boolean;
BEGIN
  -- Compute diff using deployed admin RPC's underlying logic
  -- (re-implement same SQL inline — DO NOT call the gated RPC directly)
  SELECT to_jsonb(t.*) INTO v_report
  FROM (
     -- same SELECT body as wallet_ledger_v2_diff_report, parameterized by p_window
     -- (exact body lifted in implementation step, NOT here)
     SELECT 0::bigint AS shadow_rows  -- placeholder; real body extracted from pg_proc on impl
  ) t;

  v_alert := COALESCE((v_report->>'mismatch_count')::bigint,0) > 0
          OR COALESCE((v_report->>'shadow_errors')::bigint,0) > 0
          OR COALESCE((v_report->>'unmatched_live')::bigint,0) > 0
          OR COALESCE((v_report->>'unmatched_shadow')::bigint,0) > 0;

  INSERT INTO public.wallet_ledger_v2_diff_log
    (window_interval, shadow_rows, shadow_invalid, shadow_errors,
     live_rows, matched_pairs, unmatched_shadow, unmatched_live,
     mismatch_count, wallets_checksum, raw_report, alert_fired)
  VALUES
    (p_window,
     COALESCE((v_report->>'shadow_rows')::bigint,0),
     COALESCE((v_report->>'shadow_invalid')::bigint,0),
     COALESCE((v_report->>'shadow_errors')::bigint,0),
     COALESCE((v_report->>'live_rows')::bigint,0),
     COALESCE((v_report->>'matched_pairs')::bigint,0),
     COALESCE((v_report->>'unmatched_shadow')::bigint,0),
     COALESCE((v_report->>'unmatched_live')::bigint,0),
     COALESCE((v_report->>'mismatch_count')::bigint,0),
     v_report->>'wallets_checksum',
     v_report,
     v_alert)
  RETURNING id INTO v_id;

  IF v_alert THEN
    PERFORM public.emit_admin_alert(  -- see §3
      'wallet_ledger_v2_diff_drift',
      v_report
    );
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_ledger_v2_diff_snapshot(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_diff_snapshot(interval) TO postgres;
```

**Pre-impl forensic step (mandated):** before writing this fn, dump the live body of `wallet_ledger_v2_diff_report(interval)` via `pg_get_functiondef` and inline the **exact** SELECT body — zero guesswork on column shape.

---

## 3. Alert rule

**Trigger conditions (ANY one fires):**
- `mismatch_count > 0`
- `shadow_errors > 0`
- `unmatched_live > 0`
- `unmatched_shadow > 0`

**Delivery channel:** existing `public.admin_notifications` table (already used by Phase H verification escalation). New event type: `wallet_ledger_v2_diff_drift`.

`emit_admin_alert(event_type text, payload jsonb)` is a thin wrapper that inserts one row per super_admin + admin into `admin_notifications` with severity = `critical` and `acknowledged_at = NULL`.

**Rate-limit:** suppress duplicate alerts within 1 hour of same `event_type` with non-zero matching counters (idempotency key: `event_type || date_trunc('hour', now())`).

**No email by default** in Step B (avoid noise during initial cron rollout). Email escalation deferred to Step B.1 once cron is observed clean for 7 days.

---

## 4. Admin visibility

**Reuse `AdminHealth.tsx`** (already hosts 10+ widgets). Add ONE new compact card:

`src/components/admin/WalletLedgerV2DiffAudit.tsx`
- Reads last 24 rows from `wallet_ledger_v2_diff_log` (RLS-gated SELECT)
- Shows: latest `ran_at`, latest 4 counter values, sparkline of `mismatch_count` over 24h, red banner if any `alert_fired = true` in window
- Optional "Run now" button → calls `wallet_ledger_v2_diff_snapshot('1 hour')` via a new admin-only edge fn `admin-trigger-wallet-diff` (NOT in Step B scope; deferred).

**No route changes.** No nav changes. Card slots into existing health grid.

---

## 5. Rollback (one-shot, fully reversible)

```sql
-- 1. Stop cron
SELECT cron.unschedule('wallet_ledger_v2_diff_hourly');
-- 2. Drop wrapper
DROP FUNCTION IF EXISTS public.wallet_ledger_v2_diff_snapshot(interval);
-- 3. Drop log table
DROP TABLE IF EXISTS public.wallet_ledger_v2_diff_log;
-- 4. Remove widget
--    rm src/components/admin/WalletLedgerV2DiffAudit.tsx
--    + revert single import/render line in AdminHealth.tsx
```

Rollback impact on live wallet path: **ZERO**. Step B touches no wallet table, no edge fn, no RLS on wallets/wallet_transactions, no client wiring.

---

## 6. Safety attestation

| Risk surface | Step B impact |
|---|---|
| `wallet_transaction()` legacy | untouched |
| `wallets` / `wallet_transactions` schema | untouched |
| RLS on wallet tables | untouched |
| Edge functions (5 wired in Step A) | untouched (no redeploy) |
| `p_dry_run` flag | stays `true` everywhere |
| Client wiring | none |
| Auth flow | none |
| Notification triggers / templates | none |
| Realtime channels | none |
| User-visible UI (non-admin) | none |
| New write surface | only admin-readable diff log, populated by SECURITY DEFINER cron wrapper |
| New attack surface | wrapper fn explicitly REVOKEd from anon/authenticated |

**Fan-out:** zero. **Recursion:** zero (cron wrapper does not call itself or any wallet RPC). **Side-effects:** one INSERT per hour into one new log table, plus conditional admin_notifications row.

---

## 7. Pre-implementation forensic checklist (must run before Step B execution)

- [ ] Dump live body of `wallet_ledger_v2_diff_report(interval)` via `pg_get_functiondef`
- [ ] Confirm `admin_notifications` table exists + accepts the proposed event_type
- [ ] Confirm `emit_admin_alert(text,jsonb)` exists OR scope a thin new helper inside the same migration
- [ ] Confirm no other cron job mutates `wallet_ledger_shadow_log` (avoid contention)
- [ ] Confirm super_admin RLS policy pattern matches existing `*Audit` widgets (consistency)

---

## 8. Final verdict

**SAFE TO IMPLEMENT STEP B** ✅ — pending the §7 pre-impl forensic checklist being run at execution time.

No execution performed. Plan only.

### Exact next GO command (when ready)

```
GO PHASE-1A STEP B — EXECUTE: CRON HOURLY DIFF MONITOR + ALERT (DRY-RUN, ADMIN-ONLY VISIBILITY)
```

That step will:
1. Run §7 pre-impl forensic checklist (read-only).
2. Apply ONE migration: new table + RLS + wrapper fn + cron schedule.
3. Add ONE admin widget file + one import line in `AdminHealth.tsx`.
4. Verify first cron tick lands a row with all-zero counters within 70 minutes.
5. Sign **STEP B GREEN** or roll back via §5 SQL.

— END OF PLAN —
