-- ═══════════════════════════════════════════════════════════════════════════
-- P33 · CLAUSE 4 · plpgsql_check OUT OF `public`. PRODUCTION LANE ONLY.
--
-- On production the plpgsql_check extension lives in schema `public` (the
-- Owner's reading, 2026-09-25, R-50). On staging it lives in `extensions`.
-- This file moves production's copy to where staging's is, and does nothing
-- else. It refuses on staging by design: staging has nothing to move.
--
-- ── WHY IT MATTERS, AND WHAT IS MEASURED VERSUS ASSUMED ──────────────────
--
-- MEASURED on staging 2026-09-25, SELECT only: plpgsql_check 2.8 installs 24
-- functions, none SECURITY DEFINER, all with the ACL
--     {=X/supabase_admin, supabase_admin=X/supabase_admin, postgres=X*/supabase_admin}
-- i.e. EXECUTE for PUBLIC and therefore for `anon`. Several are VOLATILE and
-- act on server-wide state: plpgsql_profiler_reset_all(),
-- plpgsql_profiler_install_fake_queryid_hook(), plpgsql_check_tracer(...).
-- plpgsql_check_function(regprocedure, ...) statically analyses ANY function
-- by oid and reports on its body.
--
-- In `extensions` that is harmless: the schema is not an API schema. In
-- `public` it is not, because `public` is the schema PostgREST exposes as the
-- RPC surface — every one of those functions becomes callable at
-- /rest/v1/rpc/<name> by an anonymous visitor. That exposure is Supabase's
-- default API-schema configuration (public, graphql_public), NOT something a
-- SQL session can read; it is stated here as the platform default, not as a
-- measurement. Production's plpgsql_check ACLs were not in the 2026-09-25
-- reading either. The Owner's read-only query in the evidence file settles
-- both halves for production before this runs; the move is correct either way.
--
-- ── WHY DROP + CREATE, AND NOT ALTER EXTENSION ... SET SCHEMA ─────────────
--
-- MEASURED on PostgreSQL 17.11 with plpgsql_check installed in `public`:
--
--     ALTER EXTENSION plpgsql_check SET SCHEMA extensions;
--     ERROR:  extension "plpgsql_check" does not support SET SCHEMA
--
-- Its control file declares `relocatable = false`, and staging's
-- pg_extension row agrees (extrelocatable = false, versions 2.7 and 2.8). So
-- the one-statement move does not exist, and the extension must be dropped and
-- created again in the other schema.
--
-- ── HOW STAGING'S COPY GOT INTO `extensions` ─────────────────────────────
--
-- Not by any migration. staging's supabase_migrations.schema_migrations has no
-- statement mentioning plpgsql_check, and no file in this repository creates
-- it. It is owned by `supabase_admin`, which is staging's
-- supautils.privileged_extensions_superuser, and plpgsql_check is on
-- supautils.privileged_extensions. That is the signature of the platform path:
-- a CREATE EXTENSION issued by `postgres` (dashboard or SQL) that supautils
-- delegates to `supabase_admin`, which then owns the result. The schema was
-- chosen at creation; production's was created with `public` and staging's
-- with `extensions`.
--
-- ── WHO IS ALLOWED TO DO THIS — the one thing no fixture can prove ────────
--
-- plpgsql_check is superuser = true, trusted = false. The dispatch workflow
-- connects as `postgres`, which on Supabase is NOT a superuser and is NOT a
-- member of `supabase_admin` (both measured on staging). The DROP and CREATE
-- below therefore work only because supautils delegates them: its README says
-- privileged-extension creation is delegated to supautils.superuser, and that
-- "this also works for updating and dropping privileged extensions".
--
-- That is DOCUMENTED platform behaviour, consistent with staging's measured
-- ownership, and NOT exercised by this unit's fixture, which has no supautils.
-- The precondition below checks that the delegation is configured for this
-- extension and refuses with a sentence if it is not. If the delegation were
-- to refuse the DROP anyway, the statement fails with "must be owner of
-- extension plpgsql_check" inside this transaction and nothing changes.
--
-- ── WHAT IS PRESERVED ─────────────────────────────────────────────────────
--
--   * the VERSION. It is captured before the DROP and the postcondition
--     asserts the re-created extension has the same one. CREATE EXTENSION
--     without VERSION installs the image's default; if that differs from what
--     production runs, this file refuses rather than upgrade as a side effect.
--     A move is a move.
--   * the ACL SHAPE, by construction rather than by statement: the functions
--     are re-created by `supabase_admin` under its own default privileges for
--     `extensions`, which is exactly how staging's copy got its ACL. 0043's
--     default-privilege changes are FOR ROLE postgres and do not apply.
--
-- ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────
--
-- DROP EXTENSION ... RESTRICT, spelled out, and never CASCADE. Anything that
-- depends on the extension or on one of its functions makes the DROP fail
-- rather than disappear with it. The precondition looks for those dependents
-- first and names the problem; RESTRICT is the second line.
-- It also refuses if any function body or cron job outside the extension
-- calls one of the extension's functions, matched on the MEMBER NAMES —
-- plpgsql_check_*, but also plpgsql_profiler_*, plpgsql_coverage_* and
-- __plpgsql_show_dependency_tb, which do not contain the string
-- "plpgsql_check" at all. A schema-qualified call such as
-- public.plpgsql_profiler_reset_all() would break silently after the move, and
-- pg_depend records none of them. On staging there are none. The check is
-- textual and deliberately over-cautious — a mention in a comment also
-- refuses, and a refusal is the safe error.
--
-- No GRANT. No REVOKE. No other extension. No other object.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE ASSERTION — PRODUCTION ONLY, `= 'production'` EXACTLY. ───────────
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'production' THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as production (read: %). '
      '20260910_0044 moves plpgsql_check out of public, where only production '
      'has it. Staging''s copy is already in extensions.',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

-- ── PRECONDITION ─────────────────────────────────────────────────────────
DO $preconditions$
DECLARE
  ext_oid   oid;
  ext_owner text;
  dep_count int;
  dep_list  text;
  member_rx text;
BEGIN
  -- 1 · the extension exists, and it is in `public`. A second dispatch after
  -- a successful one refuses here, with nothing changed.
  SELECT e.oid, pg_get_userbyid(e.extowner) INTO ext_oid, ext_owner
    FROM pg_extension e WHERE e.extname = 'plpgsql_check';
  IF ext_oid IS NULL THEN
    RAISE EXCEPTION 'P33-0044-PRE-001: extension plpgsql_check is not installed'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT extnamespace FROM pg_extension WHERE oid = ext_oid) <> 'public'::regnamespace THEN
    RAISE EXCEPTION
      'P33-0044-PRE-002: plpgsql_check is in schema %, not public. There is nothing '
      'for this file to move', (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE oid = ext_oid)
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 2 · the target schema exists.
  PERFORM 1 FROM pg_namespace WHERE nspname = 'extensions';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P33-0044-PRE-003: schema "extensions" does not exist'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 3 · this session is able to drop and re-create a superuser-only extension:
  -- as a superuser, as a member of its owner, or through supautils delegation
  -- configured for THIS extension. Anything else would fail at DROP with a
  -- permission error; this says why first.
  IF NOT (
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    OR pg_has_role(current_user, ext_owner, 'MEMBER')
    OR ( 'plpgsql_check' = ANY (string_to_array(
             replace(coalesce(current_setting('supautils.privileged_extensions', true), ''), ' ', ''), ','))
         AND coalesce(current_setting('supautils.privileged_extensions_superuser', true), '') <> '' )
  ) THEN
    RAISE EXCEPTION
      'P33-0044-PRE-004: % cannot drop and re-create plpgsql_check. It is a '
      'superuser-only extension owned by %, this role is not a superuser or a member '
      'of that role, and supautils is not configured to delegate it '
      '(supautils.privileged_extensions = %)', current_user, ext_owner,
      coalesce(nullif(current_setting('supautils.privileged_extensions', true), ''), '(unset)')
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 4 · nothing outside the extension depends on it or on any of its members.
  -- RESTRICT would refuse too; this names the objects first.
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
      'P33-0044-PRE-005: % object(s) outside plpgsql_check depend on it and would be '
      'dropped with it: %. Move or remove them first; this file never uses CASCADE',
      dep_count, dep_list
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 5 · no function body outside the extension calls any of its functions.
  -- Matched on the MEMBERS' NAMES, not on the extension's name: the first
  -- draft searched for the string 'plpgsql_check' and let a body calling
  -- public.plpgsql_profiler_reset_all() straight through, because that name
  -- does not contain it. The harness caught it (step 8b). Names are matched as
  -- whole words, case-insensitively; pg_depend records none of these calls, so
  -- text is the only evidence there is, and a mention in a comment also
  -- refuses — deliberately.
  SELECT '\m(' || string_agg(DISTINCT p.proname, '|') || ')\M'
    INTO member_rx
    FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
   WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_extension'::regclass
     AND d.refobjid = ext_oid AND d.deptype = 'e';
  SELECT count(*), string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname)
    INTO dep_count, dep_list
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND (p.prosrc ~* member_rx OR p.prosrc ILIKE '%plpgsql_check%')
     AND NOT EXISTS (SELECT 1 FROM pg_depend m
                      WHERE m.classid = 'pg_proc'::regclass AND m.objid = p.oid
                        AND m.refclassid = 'pg_extension'::regclass
                        AND m.refobjid = ext_oid AND m.deptype = 'e');
  IF dep_count > 0 THEN
    RAISE EXCEPTION
      'P33-0044-PRE-006: % function body(ies) outside the extension call one of its '
      'functions: %. A schema-qualified call would break after the move. '
      'Re-derive before running', dep_count, dep_list
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 6 · no cron job mentions it, if pg_cron is present.
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job WHERE command ~* $1 OR command ILIKE ''%plpgsql_check%'''
      INTO dep_count USING member_rx;
    IF dep_count > 0 THEN
      RAISE EXCEPTION
        'P33-0044-PRE-007: % cron job(s) call a plpgsql_check function. Re-derive before running',
        dep_count
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
END
$preconditions$;

-- ── PRE-IMAGE — the version, and the names of the functions that move. ────
CREATE TEMP TABLE p33_0044_preimage ON COMMIT DROP AS
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

-- ── THE MOVE ──────────────────────────────────────────────────────────────
-- Top-level statements, not dynamic SQL: this is the form supautils delegates.
-- No VERSION clause: the postcondition compares against the pre-image instead,
-- so a different default version refuses the whole transaction rather than
-- upgrading the extension as a side effect.

DROP EXTENSION plpgsql_check RESTRICT;

CREATE EXTENSION plpgsql_check WITH SCHEMA extensions;

-- ── POSTCONDITION ─────────────────────────────────────────────────────────
DO $postconditions$
DECLARE
  pre       record;
  ext_oid   oid;
  v         text;
  moved     int;
  left_mem  int;
  left_name text;
BEGIN
  SELECT * INTO pre FROM p33_0044_preimage;
  SELECT e.oid, e.extversion INTO ext_oid, v FROM pg_extension e WHERE e.extname = 'plpgsql_check';

  -- 1 · extnamespace = extensions.
  IF ext_oid IS NULL THEN
    RAISE EXCEPTION 'P33-0044-POST-001: plpgsql_check is not installed after the move'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT extnamespace FROM pg_extension WHERE oid = ext_oid) <> 'extensions'::regnamespace THEN
    RAISE EXCEPTION 'P33-0044-POST-002: plpgsql_check is in %, not extensions',
      (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE oid = ext_oid)
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 2 · the same version. A move, not an upgrade.
  IF v IS DISTINCT FROM pre.version THEN
    RAISE EXCEPTION
      'P33-0044-POST-003: plpgsql_check was % and is now %. CREATE EXTENSION installed '
      'the image''s default version instead of the one production ran. This file moves '
      'the extension and must not upgrade it; nothing has been changed', pre.version, v
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 3 · 0 plpgsql_check functions in public: none of the extension's members…
  SELECT count(*) INTO left_mem
    FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
   WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_extension'::regclass
     AND d.refobjid = ext_oid AND d.deptype = 'e'
     AND p.pronamespace = 'public'::regnamespace;
  IF left_mem <> 0 THEN
    RAISE EXCEPTION 'P33-0044-POST-004: % plpgsql_check member function(s) are still in public', left_mem
      USING ERRCODE = 'raise_exception';
  END IF;
  -- …and no function in public carrying any name the extension had before.
  SELECT string_agg(p.proname, ', ') INTO left_name
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (pre.member_names);
  IF left_name IS NOT NULL THEN
    RAISE EXCEPTION 'P33-0044-POST-005: function(s) named % remain in public', left_name
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 4 · everything that moved arrived: the same number of members, all in
  -- extensions. A partial install would otherwise pass checks 1-3.
  SELECT count(*) INTO moved
    FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
   WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_extension'::regclass
     AND d.refobjid = ext_oid AND d.deptype = 'e'
     AND p.pronamespace = 'extensions'::regnamespace;
  IF moved <> pre.member_count THEN
    RAISE EXCEPTION 'P33-0044-POST-006: % member function(s) before, % in extensions after',
      pre.member_count, moved
      USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'P33-0044: plpgsql_check % moved to extensions — % functions, 0 left in public',
    v, moved;
END
$postconditions$;

COMMIT;
