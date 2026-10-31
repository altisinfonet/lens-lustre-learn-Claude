-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0038_p32_password_verification_hook_closure.sql
-- Identical stem, as required. ONE object.
--
-- Set C. Not authorized for dispatch pending Owner Decision 1 (Appendix D ACL
-- posture). Prepared under Auditor ruling R-8.
--
-- ═════════════════════════════════════════════════════════════════════════
-- THE TWO MEASURED STARTING ACLs — QUOTED HERE BECAUSE THIS FILE'S ENTIRE
-- DESIGN TURNS ON THEM DIFFERING IN **TWO** WAYS, NOT ONE
--
--   STAGING  fpszggreishhuvdpkmdr — measured by SELECT, 2026-09-22T08:42Z:
--     =X/postgres | postgres=X/postgres | anon=X/postgres |
--     authenticated=X/postgres | service_role=X/postgres
--       PUBLIC holds EXECUTE                 : TRUE
--       supabase_auth_admin NAMED entry      : FALSE   <- reaches it via PUBLIC
--
--   PRODUCTION jtdtehuqtinjxropkkcn — RELAYED from the Auditor's two-lane diff,
--   NOT measured by this session (production is not attached to this session's
--   Supabase connector; a developer session never handles a connection string):
--     postgres | service_role | supabase_auth_admin
--       PUBLIC holds EXECUTE                 : FALSE
--       supabase_auth_admin NAMED entry      : TRUE
--
-- The two lanes are mirror images, and each difference pulls the rollback in
-- the opposite direction.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 1 · PUBLIC — NEVER RE-GRANTED, ON ANY LANE, EVER
--
-- Staging's starting state included PUBLIC; this file does not put it back. A
-- faithful inverse of staging would, run against production, CREATE a PUBLIC
-- EXECUTE grant that has never existed there — the recorded UNAPPLIED_0023
-- hazard, on an auth hook whose body trusts a caller-supplied user_id. A
-- rollback is the artefact most likely to be run in a hurry, under pressure, on
-- the wrong lane. Between "staging does not get its PUBLIC grant back" and
-- "production acquires one", the choice is not close.
--
-- So: `anon` and `authenticated` are restored — they are the named grants the
-- apply removed — and PUBLIC is not. On production this restores the measured
-- starting ACL for those roles exactly; on staging it restores it minus PUBLIC,
-- a strictly smaller privilege set than the state being rolled back to.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 2 · THE supabase_auth_admin GRANT — AND WHY STATE ALONE CANNOT DECIDE IT
--
-- R-8 §6.2 requires that on the staging shape this rollback also drop the
-- `supabase_auth_admin` grant the apply added, since it did not exist before.
-- On the production shape it must NOT: there the grant pre-exists and is
-- GoTrue's only named path to the hook. Revoking it would break password
-- verification on production — the outage the apply file exists to prevent,
-- caused by the file meant to undo it.
--
-- ⚠ AND AFTER THE APPLY, THE TWO LANES ARE INDISTINGUISHABLE FROM STATE.
-- The apply is convergent: from the staging shape or the production shape it
-- produces the same ACL, `postgres | service_role | supabase_auth_admin`. No
-- read of pg_proc, pg_authid or current_database() can tell which lane it is
-- (`current_database()` is `postgres` on both; the session-pooler username
-- apply-migration.yml inspects is not visible to SQL). This is not a hard
-- question — it is an unanswerable one from state.
--
-- So the apply RECORDS what it did, in a token inside the function's COMMENT,
-- and this file reads it back:
--
--     [R8-0038 auth_admin_grant_added=true]   the apply created the entry  -> revoke it
--     [R8-0038 auth_admin_grant_added=false]  it already existed           -> leave it
--     token absent or unreadable                                           -> LEAVE IT
--
-- The third case is deliberate and it fails SAFE. Leaving staging marginally
-- more closed than found is recoverable; revoking production's only named path
-- to its auth hook is an incident. A rollback that under-restores can be run
-- again; one that over-revokes cannot be un-run.
--
-- ⚠ Standing Rule 21 cuts both ways here. That comment is a CONTROL, not
-- documentation. If anyone edits the token away, this file silently takes the
-- safe branch and staging keeps a named grant it did not have before — which is
-- a drift, not a break, and is why the branch taken is announced by NOTICE on
-- every run.
--
-- No `_STAGING` / `_PRODUCTION` file variant is invented here; §6.2 reserves
-- that decision to the Auditor, and this design does not need one.
--
-- IDEMPOTENCE — GRANT and REVOKE are idempotent; re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $rollback$
DECLARE
  fn_oid    oid := to_regprocedure('public.password_verification_hook(jsonb)')::oid;
  cmt       text;
  added     boolean;
  pub_after int;
BEGIN
  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ABORT — public.password_verification_hook(jsonb) does not resolve.';
  END IF;

  -- 1 · Restore the named grants the apply removed. Never PUBLIC.
  GRANT EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) TO anon;
  GRANT EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) TO authenticated;

  -- 2 · The auth-admin grant, decided by the apply's own marker.
  cmt := coalesce(obj_description(fn_oid, 'pg_proc'), '');
  IF cmt LIKE '%[R8-0038 auth_admin_grant_added=true]%' THEN
    added := true;
  ELSIF cmt LIKE '%[R8-0038 auth_admin_grant_added=false]%' THEN
    added := false;
  ELSE
    added := NULL;
  END IF;

  IF added IS TRUE THEN
    REVOKE EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) FROM supabase_auth_admin;
    RAISE NOTICE 'ROLLBACK — marker says the apply ADDED the supabase_auth_admin grant (staging shape); it has been revoked, restoring the pre-apply state.';
  ELSIF added IS FALSE THEN
    RAISE NOTICE 'ROLLBACK — marker says supabase_auth_admin already held a NAMED grant before the apply (production shape); it is LEFT IN PLACE. Revoking it would remove GoTrue''s only named path to this hook.';
  ELSE
    RAISE WARNING 'ROLLBACK — the [R8-0038 auth_admin_grant_added=…] marker is absent or unreadable. Taking the SAFE branch: the supabase_auth_admin grant is LEFT IN PLACE. If this lane is staging, it now carries a named grant it did not have before the apply — a drift, not a break. Re-derive and correct by hand.';
    added := false;
  END IF;

  -- 3 · Restore a comment without the marker: the apply's record must not
  --     outlive the apply, or a second rollback would read a stale instruction.
  COMMENT ON FUNCTION public.password_verification_hook(event jsonb) IS
    'Supabase Auth "Password Verification" hook. Invoked by GoTrue as supabase_auth_admin. ⚠ ROLLED BACK from the P32 R-8 closure: anon and authenticated hold EXECUTE again, which re-exposes the caller-supplied event->>''user_id'' defect — any holder of the public anon key can lock or unlock an arbitrary member''s sign-in. PUBLIC was deliberately NOT restored. This comment is the marker that the lane is in the rolled-back state.';

  -- 4 · Post-conditions, inside the transaction.
  SELECT count(*) INTO pub_after FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF pub_after > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — PUBLIC holds EXECUTE after rollback (% entr(y/ies)). This file must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', pub_after;
  END IF;
  IF NOT has_function_privilege('anon', fn_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — anon and/or authenticated were not restored.';
  END IF;
  IF added IS FALSE AND NOT has_function_privilege('supabase_auth_admin', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — supabase_auth_admin lost EXECUTE on a lane where the apply did not grant it. That is GoTrue''s path and it must survive this rollback.';
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED — anon and authenticated restored, PUBLIC absent, auth-admin branch handled.';
END
$rollback$;

COMMIT;
