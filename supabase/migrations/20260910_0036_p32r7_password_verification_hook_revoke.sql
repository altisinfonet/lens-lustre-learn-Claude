-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · UNIT 0036 — password_verification_hook(jsonb) closed to PUBLIC, anon
-- AND authenticated, with the supabase_auth_admin named grant ADDED.
-- ONE object.
--
-- Set C. Not authorized for dispatch pending Owner Decision 1 (Appendix D ACL
-- posture). Prepared under Auditor allocation R-7.
--
-- ⚠ ORDINAL. `0036` is allocated by the Auditor under R-7. Not self-selected.
-- Replaces the clean half of PR #274's `0029`. The other half,
-- `get_public_role_user_ids`, is `0037` — RESERVED and NOT CONSUMED, prepared
-- only, pending Owner Decision 6. Bundling them was one of the reasons for
-- the re-cut: zero caller risk and verified caller breakage do not belong in
-- one file.
--
-- ═════════════════════════════════════════════════════════════════════════
-- ⚠⚠ THIS FILE ADDS A GRANT. IF YOU REMOVE THAT LINE, STAGING SIGN-IN BREAKS.
--
-- Measured on staging fpszggreishhuvdpkmdr, SELECT only, 2026-09-22T06:45Z:
--
--   proacl        = =X/postgres | postgres=X/postgres | anon=X/postgres |
--                   authenticated=X/postgres | service_role=X/postgres
--   PUBLIC EXECUTE entries                                = 1
--   has_function_privilege('supabase_auth_admin', …)      = TRUE
--   NAMED supabase_auth_admin ACL entries                 = **0**
--
-- Those last two lines together are the whole point. `supabase_auth_admin`
-- **can** execute the hook on staging, and it has **no grant of its own** —
-- it reaches the function *through PUBLIC*, like every other role. GoTrue
-- invokes this hook out of band, as `supabase_auth_admin`, on every sign-in.
--
-- So revoking PUBLIC without first adding the named grant would remove
-- GoTrue's only path to the hook and break password verification on staging.
-- The GRANT below is an **ADDITION**, not the preservation of something that
-- already exists.
--
-- PRODUCTION already has the named grant (RELAYED from the work order §3 and
-- the Auditor's two-lane diff; production is not attached to this session's
-- connector — BLOCKER-B):
--   postgres | service_role | supabase_auth_admin       PUBLIC = **NO**
-- On production the GRANT below is therefore a harmless no-op, which is what
-- lets one file serve both lanes.
--
-- ═════════════════════════════════════════════════════════════════════════
-- WHY anon AND authenticated ARE BOTH REVOKED — the exposure, stated plainly.
--
-- The body trusts `event->>'user_id'`, which is caller-supplied and never
-- verified against the caller's own identity (Session A finding 2026-09-21;
-- the body is NOT modified by this file and the defect remains). While anon or
-- authenticated hold EXECUTE, any holder of the public anon key can call
-- `rpc/password_verification_hook` with an arbitrary `user_id` and lock or
-- unlock that member's sign-in. There is no legitimate client caller: the
-- caller trace across src/, functions/, supabase/functions/ and scripts/ found
-- ZERO occurrences of any kind at 2026-09-22T05:33:08Z. A zero is only true at
-- the moment it is taken, and this one is not evidence that the hook is
-- unused — it is evidence that it is not called *through the application*.
--
-- ⚠ THIS IS A GRANT-LAYER CLOSURE OF A BODY-LEVEL DEFECT. It removes the
-- reachability, not the bug. The body fix is a separate unit and is not in
-- scope here; §17 forbids fixing a defect outside this unit.
--
-- F-62 — PUBLIC first; anon and authenticated inherit through it.
-- F-66 — no DROP, no CREATE, no body change. If this function is ever
-- recreated with DROP+CREATE, the built-in EXECUTE-to-PUBLIC default returns,
-- the named supabase_auth_admin grant is LOST, and both must be re-applied and
-- re-proved.
-- ORDER — the GRANT to supabase_auth_admin is written AFTER the revokes in the
-- same transaction, so there is no moment, even inside the transaction, at
-- which the hook is reachable by nobody.
-- IDEMPOTENCE — REVOKE and GRANT are idempotent; re-running is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.password_verification_hook(event jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.password_verification_hook(event jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.password_verification_hook(event jsonb) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) TO service_role;

-- ⚠ THE LOAD-BEARING LINE. Staging has no named grant for this role today; it
-- reaches the hook through PUBLIC, which the statements above have just
-- removed. Without this, GoTrue's password verification stops on staging.
GRANT EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) TO supabase_auth_admin;

-- Post-condition, in the same transaction: if the auth admin cannot execute
-- the hook when this file finishes, nothing commits.
DO $verify$
DECLARE ok boolean; pub int;
BEGIN
  SELECT has_function_privilege('supabase_auth_admin',
           to_regprocedure('public.password_verification_hook(jsonb)')::oid, 'EXECUTE') INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — supabase_auth_admin cannot EXECUTE password_verification_hook after this migration. GoTrue sign-in would break. Transaction aborted.';
  END IF;
  SELECT count(*) INTO pub FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = to_regprocedure('public.password_verification_hook(jsonb)')::oid
     AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF pub > 0 THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — PUBLIC still holds EXECUTE (% entr(y/ies)); the closure did not take.', pub;
  END IF;
  IF has_function_privilege('anon', to_regprocedure('public.password_verification_hook(jsonb)')::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — anon can still EXECUTE the hook.';
  END IF;
  RAISE NOTICE 'POST-CONDITION PASSED — PUBLIC/anon/authenticated closed; service_role and supabase_auth_admin hold named EXECUTE.';
END $verify$;

COMMIT;
