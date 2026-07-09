---
name: Accepted risk — wallet_transaction & backfill_judging_notifications authenticated EXECUTE
description: R-OPEN-1 + R-OPEN-2 formally accepted; rely on in-body auth checks. Do not propose bare REVOKE.
type: constraint
---

`public.wallet_transaction(...)` and `public.backfill_judging_notifications(...)` retain `authenticated:EXECUTE` by design (Phase 3 decision, 2026-05-25).

**Do NOT** propose or apply a bare `REVOKE EXECUTE ... FROM authenticated` on either function. Live in-repo callers depend on the grant:
- `src/hooks/wallet/useWallet.ts` (`addFunds`, `deductFunds`) → `wallet_transaction`
- `src/components/admin/NotificationsHealthAudit.tsx` → `backfill_judging_notifications`

**Why safe today:** function bodies enforce authority — `wallet_transaction` checks `auth.uid()` self / `has_role('admin'|'super_admin')`; `backfill_judging_notifications` requires `has_role(auth.uid(), 'admin')` and raises otherwise. `anon`/`PUBLIC` already revoked (HOTFIX-A, HOTFIX-E).

**Re-hardening path (if ever pursued):** route both via service-role edge functions first (REPLAN-A wallet, REPLAN-B backfill), migrate the callers above, then REVOKE. See `docs/fix-sprints/PHASE-3-ACCEPTED-DEFENSE-IN-DEPTH.md`.
