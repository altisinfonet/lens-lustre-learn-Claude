-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0044_p33_plpgsql_check_out_of_public.sql
-- Identical stem, as required. PRODUCTION LANE ONLY, like the file it undoes.
--
-- ⚠ EXECUTING THIS FILE PUTS plpgsql_check BACK INTO `public`.
--
-- Every one of its functions — plpgsql_check_function, which analyses any
-- function body by oid, and the VOLATILE profiler controls
-- plpgsql_profiler_reset_all and plpgsql_profiler_install_fake_queryid_hook
-- among them — returns to the schema PostgREST exposes as the RPC surface,
-- with the EXECUTE grants supabase_admin's `public` default privileges give
-- new functions. On staging those defaults include anon.
--
-- ── WHY THE GUARD IS `= 'production'` AND NOT R-9 STAGING-ONLY ───────────
--
-- The same exception, for the same reason, as 20260910_0037's rollback: the
-- state this restores exists ONLY on production. On staging plpgsql_check has
-- always been in `extensions`; run there, this file would not undo anything —
-- it would MOVE staging's copy INTO `public` and create the exposure P33
-- clause 4 exists to remove. A staging-only guard would point the file at the
-- one lane where it does pure damage.
--
-- ── WHAT IT RESTORES ─────────────────────────────────────────────────────
--
-- The schema and the version. The version is captured before the DROP and
-- asserted after the CREATE, exactly as the forward file does.
--
-- Function ACLs are restored the way they were produced in the first place:
-- by `supabase_admin` creating the functions under its own default privileges
-- for `public`. This file does not GRANT anything and cannot reproduce an ACL
-- that was hand-edited after the original install — the production reading of
-- 2026-09-25 did not include these functions' ACLs, so there is no pre-image
-- to assert against. The fixture shows the round trip is byte-exact under
-- staging's measured supabase_admin defaults; on production it is as exact as
-- production's defaults are.
--
-- DROP ... RESTRICT, never CASCADE, and the same dependents check as the
-- forward file: if anything came to depend on the extension in `extensions`
-- since the move, this refuses rather than take it down.
--
-- ── IT REFUSES WHEN THERE IS NOTHING TO UNDO ─────────────────────────────
-- The precondition requires 0044's post-state: the extension in `extensions`.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE GUARD — PRODUCTION ONLY. See the header for why this is not R-9. ──
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'production' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as production (read: %). '
      'This file puts plpgsql_check back into public, a state that exists only on '
      'production. On staging it would not undo anything: it would move staging''s '
      'copy INTO public and expose its functions on the RPC surface.',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — 0044's post-state must be in place. ────────────────────
DO $preconditions$
DECLARE
  ext_oid   oid;
  ext_owner text;
  dep_count int;
  dep_list  text;
BEGIN
  SELECT e.oid, pg_get_userbyid(e.extowner) INTO ext_oid, ext_owner
    FROM pg_extension e WHERE e.extname = 'plpgsql_check';
  IF ext_oid IS NULL THEN
    RAISE EXCEPTION 'P33-0044-RB-PRE-001: extension plpgsql_check is not installed'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT extnamespace FROM pg_extension WHERE oid = ext_oid) <> 'extensions'::regnamespace THEN
    RAISE EXCEPTION
      'P33-0044-RB-PRE-002: plpgsql_check is in schema %, not extensions, so 0044 is '
      'not in effect and there is nothing for this file to roll back',
      (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE oid = ext_oid)
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NOT (
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    OR pg_has_role(current_user, ext_owner, 'MEMBER')
    OR ( 'plpgsql_check' = ANY (string_to_array(
             replace(coalesce(current_setting('supautils.privileged_extensions', true), ''), ' ', ''), ','))
         AND coalesce(current_setting('supautils.privileged_extensions_superuser', true), '') <> '' )
  ) THEN
    RAISE EXCEPTION
      'P33-0044-RB-PRE-003: % cannot drop and re-create plpgsql_check (owner %, '
      'supautils.privileged_extensions = %)', current_user, ext_owner,
      coalesce(nullif(current_setting('supautils.privileged_extensions', true), ''), '(unset)')
      USING ERRCODE = 'raise_exception';
  END IF;

  SELECT count(*), string_agg(DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid), '; ')
    INTO dep_count, dep_list
    FROM pg_depend d
   WHERE d.deptype IN ('n', 'a')
     AND ( (d.refclassid = 'pg_extension'::regclass AND d.refobjid = ext_oid)
        OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid IN (
              SELECT objid FROM pg_depend
               WHERE classid = 'pg_proc'::regclass AND refclassid = 'pg_extension'::regclass
                 AND refobjid = ext_oid AND deptype = 'e')) )
     AND NOT EXISTS (SELECT 1 FROM pg_depend m
                      WHERE m.classid = d.classid AND m.objid = d.objid
                        AND m.refclassid = 'pg_extension'::regclass
                        AND m.refobjid = ext_oid AND m.deptype = 'e');
  IF dep_count > 0 THEN
    RAISE EXCEPTION
      'P33-0044-RB-PRE-004: % object(s) outside plpgsql_check depend on it: %. '
      'This file never uses CASCADE', dep_count, dep_list
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

CREATE TEMP TABLE p33_0044_rb_preimage ON COMMIT DROP AS
SELECT e.extversion AS version,
       ARRAY(SELECT DISTINCT p.proname::text
               FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
              WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_extension'::regclass
                AND d.refobjid = e.oid AND d.deptype = 'e'
              ORDER BY 1) AS member_names,
       (SELECT count(*) FROM pg_depend d
         WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_extension'::regclass
           AND d.refobjid = e.oid AND d.deptype = 'e') AS member_count
  FROM pg_extension e WHERE e.extname = 'plpgsql_check';

-- ── THE RESTORATION ──────────────────────────────────────────────────────
DROP EXTENSION plpgsql_check RESTRICT;

CREATE EXTENSION plpgsql_check WITH SCHEMA public;

-- ── POSTCONDITION ────────────────────────────────────────────────────────
DO $postconditions$
DECLARE pre record; ext_oid oid; v text; n int;
BEGIN
  SELECT * INTO pre FROM p33_0044_rb_preimage;
  SELECT e.oid, e.extversion INTO ext_oid, v FROM pg_extension e WHERE e.extname = 'plpgsql_check';
  IF ext_oid IS NULL OR (SELECT extnamespace FROM pg_extension WHERE oid = ext_oid) <> 'public'::regnamespace THEN
    RAISE EXCEPTION 'P33-0044-RB-POST-001: plpgsql_check is not back in public'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF v IS DISTINCT FROM pre.version THEN
    RAISE EXCEPTION 'P33-0044-RB-POST-002: plpgsql_check was % and is now %; a rollback must not upgrade',
      pre.version, v USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO n
    FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
   WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_extension'::regclass
     AND d.refobjid = ext_oid AND d.deptype = 'e'
     AND p.pronamespace = 'public'::regnamespace;
  IF n <> pre.member_count THEN
    RAISE EXCEPTION 'P33-0044-RB-POST-003: % member function(s) before, % in public after',
      pre.member_count, n USING ERRCODE = 'raise_exception';
  END IF;
  -- by the member NAMES captured before the DROP, not by a name pattern: the
  -- functions are not all called plpgsql_check_* (plpgsql_make_pragma,
  -- __plpgsql_show_dependency_tb, the profiler and coverage families).
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'extensions'::regnamespace
     AND p.proname = ANY (pre.member_names);
  IF n <> 0 THEN
    RAISE EXCEPTION 'P33-0044-RB-POST-004: % plpgsql_check function(s) remain in extensions', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
