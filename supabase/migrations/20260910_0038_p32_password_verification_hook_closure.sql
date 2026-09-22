-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · UNIT 0038 — password_verification_hook(event jsonb): corrected closure.
-- ONE object.
--
-- Set C. Not authorized for dispatch pending Owner Decision 1 (Appendix D ACL
-- posture). Prepared under Auditor ruling R-8.
--
-- ⚠ ORDINAL. `0038` is allocated by the Auditor under R-8. Not self-selected.
--
-- ═════════════════════════════════════════════════════════════════════════
-- SUPERSEDES THE WITHDRAWN `0029`, AND THE DIFFERENCE IS ONE LINE
--
-- `UNAPPLIED_20260910_0029_p32_auth_hook_and_role_enum_revoke.sql` makes the
-- same three revokes and then asserts, in a comment, that
-- `supabase_auth_admin`'s EXECUTE survives them. **On staging it does not.**
--
-- Measured on staging fpszggreishhuvdpkmdr, SELECT only, 2026-09-22T08:42Z:
--
--   proacl = =X/postgres | postgres=X/postgres | anon=X/postgres |
--            authenticated=X/postgres | service_role=X/postgres
--
--   public_holds                  = TRUE
--   supabase_auth_admin EFFECTIVE = TRUE    <- has_function_privilege()
--   supabase_auth_admin **NAMED** = FALSE   <- no supabase_auth_admin= entry
--
-- The effective privilege is TRUE only because PUBLIC holds the grant and every
-- role belongs to PUBLIC. `REVOKE … FROM public` removes it. GoTrue calls this
-- hook, as `supabase_auth_admin`, on **every sign-in attempt** — so `0029` as
-- written would break staging sign-in.
--
-- Relayed from the Auditor's two-lane diff (production is not attached to this
-- session's connector, so this is not measured here): on PRODUCTION the ACL is
-- `postgres | service_role | supabase_auth_admin` — no PUBLIC, and the named
-- grant DOES exist. The claim in `0029` is true on production and false on
-- staging, which is exactly why it survived review.
--
--   **The GRANT below is an ADDITION on staging, not a preservation.**
--   On production it is a harmless no-op, which is what lets one file serve
--   both lanes.
--
-- ═════════════════════════════════════════════════════════════════════════
-- WHY anon AND authenticated ARE BOTH REVOKED
--
-- The body trusts `event->>'user_id'`, caller-supplied and never verified
-- against the caller's own identity (Session A finding 2026-09-21). While anon
-- or authenticated hold EXECUTE, any holder of the public anon key can call
-- `rpc/password_verification_hook` with an arbitrary `user_id` and lock or
-- unlock that member's sign-in. There is no legitimate client caller: zero
-- occurrences of any kind across `src/`, `functions/`, `supabase/functions/`
-- and `scripts/` at 2026-09-22T05:33:08Z. That zero does NOT mean the hook is
-- unused — it means it is not called through the application.
--
-- ⚠ THIS IS A GRANT-LAYER CLOSURE OF A BODY-LEVEL DEFECT. It removes the
-- reachability, not the bug. **The function body is not changed by this file.**
-- The body fix is a separate unit (§8 — a defect outside this unit is recorded,
-- not fixed).
--
-- F-62 — PUBLIC first; anon and authenticated inherit through it.
-- F-66 — no DROP, no CREATE. If this function is ever recreated with
--        DROP+CREATE, the built-in EXECUTE-to-PUBLIC default returns AND the
--        named supabase_auth_admin grant is lost; both must be re-applied and
--        re-proved.
-- ORDER — the GRANT is written after the revokes inside one transaction, so
--        there is no instant, even mid-transaction, at which the hook is
--        reachable by nobody.
-- IDEMPOTENCE — REVOKE and GRANT are idempotent; re-running is a no-op.
--
-- ═════════════════════════════════════════════════════════════════════════
-- ⚠ THE COMMENT THIS FILE WRITES IS ALSO ITS ROLLBACK'S ONLY INPUT. READ THIS.
--
-- After this migration runs, the resulting ACL is **byte-identical on both
-- lanes**: `postgres | service_role | supabase_auth_admin`. Starting from the
-- staging shape or the production shape, the apply converges to the same state.
-- That convergence is good for the apply and fatal for the rollback: the
-- rollback must revoke the auth-admin grant **only where this file added it**,
-- and after the fact no ACL read can tell the two cases apart. It is not a hard
-- question, it is an unanswerable one from state alone.
--
-- So this file RECORDS what it did, in a machine-readable token inside its own
-- COMMENT, and the rollback reads it back:
--
--     [R8-0038 auth_admin_grant_added=true]   this file ADDED the named grant
--     [R8-0038 auth_admin_grant_added=false]  it already existed; untouched
--
-- If that token is ever edited away, the rollback fails SAFE — it leaves the
-- grant in place. Leaving staging marginally more closed is recoverable;
-- revoking production's only named path to its auth hook is an outage.
-- Standing Rule 21 cuts both ways: this comment is a control, so it must be
-- kept true.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $apply$
DECLARE
  fn_oid     oid := to_regprocedure('public.password_verification_hook(jsonb)')::oid;
  had_named  boolean;
  pub_before boolean;
BEGIN
  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'ABORT — public.password_verification_hook(jsonb) does not resolve. This file closes a grant; it does not create, drop or rename the function.';
  END IF;

  -- Record the pre-state BEFORE touching anything. This is the whole point.
  --
  -- ⚠ IDEMPOTENCE TRAP, FOUND BY THE FIXTURE AND FIXED HERE. A second run of
  -- this file would observe the grant IT ITSELF added on the first run, record
  -- `had_named = true`, and rewrite the marker as `added=false` — destroying
  -- the one fact the rollback needs and leaving staging's added grant
  -- permanent. So the FIRST observation wins: if a marker already exists, its
  -- value is authoritative and the live ACL is not re-read. The migration is
  -- idempotent in its ACL effect and now also in its record of what it did.
  IF coalesce(obj_description(fn_oid, 'pg_proc'), '') LIKE '%[R8-0038 auth_admin_grant_added=true]%' THEN
    had_named := false;   -- a previous run of THIS file added the grant
    RAISE NOTICE 'RE-RUN — existing marker says this file added the grant; preserving that.';
  ELSIF coalesce(obj_description(fn_oid, 'pg_proc'), '') LIKE '%[R8-0038 auth_admin_grant_added=false]%' THEN
    had_named := true;    -- a previous run found it already present
    RAISE NOTICE 'RE-RUN — existing marker says the grant pre-existed; preserving that.';
  ELSE
    SELECT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                    WHERE p.oid = fn_oid AND a::text LIKE 'supabase_auth_admin=%')
      INTO had_named;
  END IF;
  SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    INTO pub_before;

  RAISE NOTICE 'PRE-STATE on % — PUBLIC holds EXECUTE: % · supabase_auth_admin NAMED grant: %',
    current_database(), pub_before, had_named;

  -- F-62: PUBLIC first. anon and authenticated inherit through it, so revoking
  -- them alone would close nothing while it stands.
  REVOKE ALL ON FUNCTION public.password_verification_hook(event jsonb) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.password_verification_hook(event jsonb) FROM anon;
  REVOKE ALL ON FUNCTION public.password_verification_hook(event jsonb) FROM authenticated;

  GRANT EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) TO service_role;

  -- ⚠ THE LOAD-BEARING LINE. On staging there is no named grant for this role
  -- today; it reaches the hook through PUBLIC, which the statements above have
  -- just removed. Without this, GoTrue's password verification stops.
  GRANT EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) TO supabase_auth_admin;

  -- Record what was done, for the rollback. `had_named` is the pre-state, so
  -- `auth_admin_grant_added` is true exactly when this file created the entry.
  EXECUTE format(
    'COMMENT ON FUNCTION public.password_verification_hook(event jsonb) IS %L',
    'Supabase Auth "Password Verification" hook. Invoked by GoTrue, as supabase_auth_admin, on every sign-in. '
    || 'NOT executable by public, anon or authenticated — P32, corrected closure under Auditor ruling R-8, 2026-09-22. '
    || 'Supersedes withdrawn 0029, whose comment asserted that supabase_auth_admin''s EXECUTE survived the revokes; '
    || 'on staging it did not, because the role held no named grant and reached the function through PUBLIC. '
    || 'THE BODY IS UNCHANGED AND THE BODY-LEVEL DEFECT REMAINS: event->>''user_id'' is caller-supplied and '
    || 'unverified against the caller''s own identity. If recreated with DROP+CREATE this REOPENS to PUBLIC and '
    || 'LOSES the named grant (F-66); both must be re-applied and re-proved. '
    || '[R8-0038 auth_admin_grant_added=' || CASE WHEN had_named THEN 'false' ELSE 'true' END || ']');

  RAISE NOTICE 'MARKER WRITTEN — [R8-0038 auth_admin_grant_added=%]',
    CASE WHEN had_named THEN 'false' ELSE 'true' END;
END
$apply$;

-- Post-condition, in the same transaction: nothing commits unless the auth
-- admin can still execute the hook and the anonymous door is shut.
DO $verify$
DECLARE fn_oid oid := to_regprocedure('public.password_verification_hook(jsonb)')::oid; pub int;
BEGIN
  IF NOT has_function_privilege('supabase_auth_admin', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — supabase_auth_admin cannot EXECUTE the hook after this migration. GoTrue sign-in would break. This is exactly the failure 0029 would have caused. Transaction aborted.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = fn_oid AND a::text LIKE 'supabase_auth_admin=%') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — supabase_auth_admin has no NAMED entry. An effective privilege is not a grant; that confusion is what this unit exists to correct.';
  END IF;
  SELECT count(*) INTO pub FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF pub > 0 THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — PUBLIC still holds EXECUTE (% entr(y/ies)).', pub;
  END IF;
  IF has_function_privilege('anon', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — anon can still EXECUTE the hook.';
  END IF;
  IF has_function_privilege('authenticated', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — authenticated can still EXECUTE the hook.';
  END IF;
  IF obj_description(fn_oid, 'pg_proc') NOT LIKE '%[R8-0038 auth_admin_grant_added=%' THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED — the rollback marker was not written. The rollback would have no input.';
  END IF;
  RAISE NOTICE 'POST-CONDITION PASSED — PUBLIC/anon/authenticated closed; service_role and supabase_auth_admin hold NAMED EXECUTE; rollback marker present.';
END
$verify$;

COMMIT;
