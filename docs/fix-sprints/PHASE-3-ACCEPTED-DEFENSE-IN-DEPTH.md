# PHASE-3 — ACCEPTED RISK: Defense-in-Depth for `wallet_transaction` & `backfill_judging_notifications`

**Date:** 2026-05-25
**Mode of decision:** Audit-only PRECHECK proved that a bare `REVOKE EXECUTE ... FROM authenticated` on the two functions below would break live in-repo callers. The risk is therefore formally **ACCEPTED** with reliance on existing function-body authority checks.

---

## Risks accepted

### R-OPEN-1 — `public.wallet_transaction(...)` executable by `authenticated`
- **Live ACL evidence:** `pg_proc.proacl` aclexplode shows `authenticated:EXECUTE` (see `docs/fix-sprints/VERIFY-HOTFIXES-A-B-C-D-E.md` §HOTFIX-A and `VERIFY-OPEN-RISKS-AFTER-HOTFIXES.md` §R-OPEN-1).
- **Body-level enforcement (verified live this session via `pg_get_functiondef`):**
  - Captures `_caller_id := auth.uid()`.
  - If `_caller_id IS DISTINCT FROM _user_id`, requires `has_role(_caller_id, 'admin')` OR `has_role(_caller_id, 'super_admin')`; otherwise raises.
  - Self-writes (`_caller_id = _user_id`) are allowed for legitimate user-facing wallet flows.
- **Live caller dependency:** `src/hooks/wallet/useWallet.ts` — `addFunds` and `deductFunds` invoke this RPC under a user JWT for self-transactions. A bare REVOKE returns `42501` and breaks both flows.

### R-OPEN-2 — `public.backfill_judging_notifications(_window_days, _dry_run)` executable by `authenticated`
- **Live ACL evidence:** `authenticated:EXECUTE` present (see `VERIFY-HOTFIXES-A-B-C-D-E.md` §HOTFIX-E and `VERIFY-OPEN-RISKS-AFTER-HOTFIXES.md` §R-OPEN-2).
- **Body-level enforcement (verified live this session):**
  - First statement asserts `has_role(auth.uid(), 'admin')`; raises otherwise. Non-admin callers cannot proceed past the gate.
- **Live caller dependency:** `src/components/admin/NotificationsHealthAudit.tsx` — admin "Run Backfill" UI invokes this RPC under the admin's user JWT. A bare REVOKE returns `42501` and breaks the admin button.

---

## Why ACCEPT is the correct choice today
1. **Containment from `anon` / `PUBLIC` is already achieved** by HOTFIX-A and HOTFIX-E. Unauthenticated traffic cannot reach either function.
2. **Authority is enforced inside each function body** (verified live, not assumed). The `authenticated` EXECUTE grant only exposes the function entrypoint; the body itself denies unauthorized callers with explicit `RAISE`.
3. **REPLAN-A / REPLAN-B would change live UX** (edge-function indirection for wallet self-writes; admin-only edge function for backfill). Those are valid future hardenings but require a separate, scoped sprint with their own PROVE block.

## What is NOT changed by this acceptance
- No SQL is run. No `REVOKE`, no `GRANT`, no `CREATE OR REPLACE`, no policy change.
- No client code is edited.
- No edge function is created, deployed, or modified.
- No CI workflow is added or modified.

## Future re-hardening (optional, not in this phase)
- **REPLAN-A (wallet):** Introduce an edge function that authenticates the user JWT, then calls `wallet_transaction` under `service_role`. Once `useWallet.addFunds/deductFunds` are migrated, run `REVOKE EXECUTE ON FUNCTION public.wallet_transaction(...) FROM authenticated;` and verify deposit + deduct UX end-to-end.
- **REPLAN-B (backfill):** Introduce an admin-only edge function that verifies admin via JWT and calls `backfill_judging_notifications` under `service_role`. Migrate `NotificationsHealthAudit` to that fn, then `REVOKE EXECUTE ... FROM authenticated;` and verify the admin "Run Backfill" UX.

Either REPLAN can be picked up later without revisiting this acceptance — this doc simply records that until then, body-level authority is the proven defense layer.

---

## References (already in repo)
- `docs/fix-sprints/VERIFY-HOTFIXES-A-B-C-D-E.md` — live ACL evidence.
- `docs/fix-sprints/VERIFY-OPEN-RISKS-AFTER-HOTFIXES.md` — risk inventory.
- `docs/fix-sprints/R9-FUNCTION-BODY-AUDIT.md` — function-body audit baseline.
