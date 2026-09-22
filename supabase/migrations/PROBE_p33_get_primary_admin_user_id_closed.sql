-- ═══════════════════════════════════════════════════════════════════════════
-- P33 GATE PROBE — get_primary_admin_user_id() is closed to anon. READS ONLY.
--
-- The `PROBE_` prefix follows PROBE_p30_email_exists_closed.sql: not part of
-- the ordered migration sequence, dispatched through apply-migration.yml like
-- any other reviewed file, safe on either lane, any number of times. It ends
-- in ROLLBACK.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE
--
-- `docs/gates/GATE_REGISTER.md` P33 (verbatim, clause 5): "...
-- `get_primary_admin_user_id` either closed or its exposure written down."
-- This probe proves the closure branch, per has_function_privilege on this
-- lane — not a class-level check (F-62's lesson: class checks disagree
-- between lanes).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  fn_oid     oid;
  fn_count   integer;
  anon_exec  boolean;
  auth_exec  boolean;
  svc_exec   boolean;
  public_entries integer;
  acl_text   text;
  is_secdef  boolean;
BEGIN
  RAISE NOTICE '--- P33 gate probe: get_primary_admin_user_id() @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %  (current_database)', current_database();

  ---------------------------------------------------------------------------
  -- B5 · EXACTLY ONE get_primary_admin_user_id IN public.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO fn_count
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_primary_admin_user_id';

  IF fn_count = 0 THEN
    RAISE EXCEPTION 'B5 FAILED — public.get_primary_admin_user_id does not exist. P33 closes a grant; it does not drop the function, and two views (feed_stories_bar, public_stories_and_view_counts) call it internally.';
  END IF;
  IF fn_count > 1 THEN
    RAISE EXCEPTION 'B5 FAILED — % functions named public.get_primary_admin_user_id exist. The gate is per-function.', fn_count;
  END IF;

  SELECT p.oid, p.proacl::text, p.prosecdef
    INTO fn_oid, acl_text, is_secdef
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_primary_admin_user_id';
  RAISE NOTICE 'B5 exactly one function ............ PASS (oid %, acl %)', fn_oid, COALESCE(acl_text, 'NULL');

  ---------------------------------------------------------------------------
  -- B2 · THE GATE ITSELF.
  ---------------------------------------------------------------------------
  SELECT has_function_privilege('anon',          fn_oid, 'EXECUTE'),
         has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
         has_function_privilege('service_role',  fn_oid, 'EXECUTE')
    INTO anon_exec, auth_exec, svc_exec;

  IF anon_exec THEN
    RAISE EXCEPTION 'B2 FAILED — anon can still EXECUTE public.get_primary_admin_user_id() (oid %). A real admin user_id is resolvable by anyone with the public API key, one call, no argument. acl = %',
      fn_oid, COALESCE(acl_text, 'NULL (built-in default = EXECUTE TO PUBLIC)');
  END IF;
  RAISE NOTICE 'B2 anon cannot execute (THE GATE) .. PASS (has_function_privilege anon = false)';

  ---------------------------------------------------------------------------
  -- B3 · PUBLIC HOLDS NOTHING (F-62/F-66 trap).
  ---------------------------------------------------------------------------
  SELECT count(*) INTO public_entries
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';

  IF acl_text IS NULL THEN
    RAISE EXCEPTION 'B3 FAILED — proacl is NULL on oid %. NULL is the built-in default (EXECUTE TO PUBLIC). The function has been recreated (DROP+CREATE, F-66) and P33 has silently reopened. Re-apply 20260910_0041.', fn_oid;
  END IF;
  IF public_entries > 0 THEN
    RAISE EXCEPTION 'B3 FAILED — PUBLIC holds EXECUTE on oid % (% entry). anon inherits through PUBLIC (F-62). acl = %', fn_oid, public_entries, acl_text;
  END IF;
  RAISE NOTICE 'B3 PUBLIC holds no EXECUTE ......... PASS (0 PUBLIC entries, proacl not NULL)';

  ---------------------------------------------------------------------------
  -- B4 · NO OVER-REVOKE — authenticated and service_role must survive; two
  -- internal callers (feed_stories_bar, public_stories_and_view_counts) need
  -- authenticated to keep working.
  ---------------------------------------------------------------------------
  IF NOT auth_exec THEN
    RAISE EXCEPTION 'B4 FAILED — authenticated can no longer EXECUTE oid %. This migration only ever revoked PUBLIC and anon; an over-revoke here breaks feed_stories_bar / public_stories_and_view_counts, which call this function internally from an authenticated-reachable context. acl = %', fn_oid, acl_text;
  END IF;
  IF NOT svc_exec THEN
    RAISE EXCEPTION 'B4 FAILED — service_role can no longer EXECUTE oid %. Not part of this unit''s intended change. acl = %', fn_oid, acl_text;
  END IF;
  RAISE NOTICE 'B4 no over-revoke .................. PASS (authenticated=true, service_role=true)';

  ---------------------------------------------------------------------------
  -- B1 · THE FUNCTION IS UNCHANGED IN KIND.
  ---------------------------------------------------------------------------
  IF NOT is_secdef THEN
    RAISE EXCEPTION 'B1 FAILED — oid % is no longer SECURITY DEFINER. This unit changes grants only.', fn_oid;
  END IF;
  RAISE NOTICE 'B1 function unchanged in kind ...... PASS (SECURITY DEFINER)';

  RAISE NOTICE '--- ALL FIVE ASSERTIONS PASSED. P33 clause 5 holds on this lane. Nothing was written. ---';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
