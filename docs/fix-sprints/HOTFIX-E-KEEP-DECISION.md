# HOTFIX-E-KEEP Decision Record

## Decision
**Keep `authenticated` EXECUTE on:**
`public.backfill_judging_notifications(integer, boolean)`

## Evidence

| Check | Status | Detail |
|-------|--------|--------|
| `anon` EXECUTE | ✅ Already revoked | Migration `20260522052440` confirmed `has_function_privilege('anon', 'backfill_judging_notifications') = false` |
| `authenticated` EXECUTE | ✅ Required by admin UI | `src/components/admin/NotificationsHealthAudit.tsx:57` calls `supabase.rpc("backfill_judging_notifications", ...)` as `authenticated` role |
| Admin guard in function body | ✅ Present | `IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;` |
| Service-role wrapper exists | ❌ No | No edge function wraps this RPC |
| Live exploit proven | ❌ No | Non-admin authenticated users hit the `has_role` guard with no pre-guard side effects |

## Why revoke is currently unsafe

Revoking `authenticated` EXECUTE would immediately break the Notifications Health Audit admin UI (`NotificationsHealthAudit.tsx`), which calls this RPC directly as an authenticated user. There is no alternative service-role wrapper to switch to.

## Future hardening option (documented, not executed)

If the team wants defense-in-depth closure of R-OPEN-2 later:

1. Build `admin-backfill-notifications` edge function (service-role).
2. Update `NotificationsHealthAudit.tsx` to call `supabase.functions.invoke("admin-backfill-notifications", ...)`.
3. Only then execute:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.backfill_judging_notifications(integer, boolean) FROM authenticated;
   ```
4. Rollback (if needed):
   ```sql
   GRANT EXECUTE ON FUNCTION public.backfill_judging_notifications(integer, boolean) TO authenticated;
   ```

## Actions taken in this task
- None. This is a documentation-only record.

## SQL not executed
- No `REVOKE`.
- No `GRANT`.
- No migration created.
- No frontend change.
- No deployment.

## Verdict
`HOTFIX_E_KEEP_RECORDED`
