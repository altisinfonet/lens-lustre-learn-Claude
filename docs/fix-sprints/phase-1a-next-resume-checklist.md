# Phase-1A Next Resume Checklist

**Frozen at:** 2026-05-15 ~07:55 UTC  
**Resume earliest:** 2026-05-18 07:05:02 UTC (T+72h soak close)  
**Resume command (exact):**
```
GO PHASE-1A STEP A — 72H SHADOW DIFF FINAL VERDICT
```

---

## Pre-resume preflight (READ-ONLY, do these first)

- [ ] Confirm current UTC ≥ 2026-05-18 07:05:02
- [ ] Open `docs/fix-sprints/phase-1a-step-a-72h-shadow-diff-monitor.md` and confirm all interim checkpoints = GREEN
- [ ] Run read-only checkpoint:
  ```sql
  SELECT
    (SELECT count(*) FROM public.wallet_ledger_v2_shadow) AS shadow_rows,
    (SELECT count(*) FROM public.wallet_ledger_v2_errors) AS shadow_errors,
    (SELECT count(*) FROM public.wallet_transactions)     AS live_tx,
    (SELECT md5(string_agg(user_id::text || ':' || balance::text, '|' ORDER BY user_id))
       FROM public.wallets)                               AS wallets_checksum;
  ```
- [ ] Run admin-gated diff RPC from admin/service context:
  ```sql
  SELECT public.wallet_ledger_v2_diff_report('72 hours'::interval);
  ```
- [ ] Confirm `shadow_errors = 0` (or only OVERDRAFT-class, documented)
- [ ] Confirm `unmatched_shadow = 0` AND `unmatched_live = 0`
- [ ] Confirm no user-visible wallet/payment incidents in last 72h

## Sign 72h verdict

- [ ] If all above pass → write **GREEN** verdict, unlock Step B
- [ ] Else → write **INVESTIGATE**, do NOT proceed to Step B

---

## Step B (only after GREEN 72h verdict)

Scope (paper-only until explicit GO):
- Add cron job to run `wallet_ledger_v2_diff_report('1 hour')` hourly into `wallet_ledger_v2_diff_log`
- Add admin alert when `mismatch_count > 0`
- **STILL** dry-run; **STILL** legacy is sole writer

---

## Step C, D, E (do NOT touch without separate explicit GO)

- C — Canary flip ONE edge fn to `p_dry_run=false` behind feature flag
- D — Full cutover + grants migration
- E — Decommission `wallet_transaction()` legacy

---

## Hard rules during freeze

- ❌ No migrations
- ❌ No edge deploys
- ❌ No client wiring changes
- ❌ No RLS edits
- ❌ No `p_dry_run=false` anywhere
- ✅ Read-only checkpoints allowed
- ✅ Documentation-only updates allowed

---

## Known safe rollback (if anything looks off at resume)

```sql
DROP FUNCTION IF EXISTS public.wallet_ledger_v2_diff_report(interval);
DROP FUNCTION IF EXISTS public.wallet_ledger_v2_record(uuid, text, numeric, text, text, jsonb, boolean);
DROP TABLE IF EXISTS public.wallet_ledger_v2_errors;
DROP TABLE IF EXISTS public.wallet_ledger_v2_shadow;
```
Edge fns silently no-op (try/catch wrapped). Legacy wallet path unaffected.

---

**END OF CHECKLIST. AWAITING RESUME COMMAND.**
