-- ═══════════════════════════════════════════════════════════════════════════
-- P33 · UNIT D — ELEVEN DEFINER VIEWS STOP ACCEPTING WRITES.
--
-- ── What is actually true today, measured, not assumed ─────────────────────
--
-- Eleven relations in `public` — ten views and one materialised view — carry
-- this ACL, identically, on staging (SELECT on pg_class, 2026-09-24):
--
--   {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--    authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--
-- `arwdDxtm` is every table-level privilege PostgreSQL 17 has: SELECT plus
-- INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN. `anon`
-- — an unauthenticated visitor — holds all of them.
--
-- ── Why that is not merely untidy ──────────────────────────────────────────
--
-- Five of the eleven are AUTO-UPDATABLE (pg_relation_is_updatable mask 28:
-- INSERT, UPDATE and DELETE all pass through to the base table):
--
--   judge_comments_owner_safe        judge_decisions_owner_safe
--   judge_tag_assignments_owner_safe judge_tag_assignments_public_r4
--   profiles_public
--
-- None of the five sets `security_invoker` (reloptions is NULL on all five),
-- so each runs as its owner, `postgres`, which is BYPASSRLS on Supabase. An
-- UPDATE issued by `anon` through one of these views is therefore executed
-- with the owner's rights: the base table's RLS policies are not consulted at
-- all. The view is not a wall with a small door in it. It is an open doorway
-- that happens to be shaped like a wall.
--
-- This is the same class of defect as the definer FUNCTIONS closed in P32 —
-- `SECURITY DEFINER` bypasses RLS entirely, so the WHERE clause is the only
-- control — except that a view has no WHERE clause governing writes. There is
-- nothing to tighten. The privilege itself has to go.
--
-- ── Why nothing breaks ─────────────────────────────────────────────────────
--
-- Measured at f6fe1a5, both halves:
--
--   CLIENT  11 call sites across src/** and supabase/functions/**. Every one
--           is `.from(<name>).select(...)`. Zero `.insert`, `.update`,
--           `.upsert` or `.delete`. Zero `rest/v1/<name>` paths.
--   DATABASE 0 functions in pg_proc write to or refresh any of the eleven,
--           and 0 cron jobs reference them. 11 functions MENTION one of the
--           names; every mention is a `FROM` or a `JOIN`. The instrument is
--           not blind: the same regex finds 6 functions writing to `profiles`,
--           and the same cron scan finds the one job that touches
--           cron.job_run_details.
--
-- SELECT is what the application uses, and SELECT is what this file leaves
-- exactly as it found it.
--
-- ── Why MAINTAIN is in the list ────────────────────────────────────────────
--
-- MAINTAIN is new in PostgreSQL 17 and carries REFRESH MATERIALIZED VIEW,
-- VACUUM, ANALYZE, CLUSTER, REINDEX and LOCK TABLE. `entry_vote_counts` is a
-- materialised view, so MAINTAIN held by `anon` is a standing invitation to
-- refresh it — or to take a lock on it — from an unauthenticated session.
-- Staging is 17.6 and production is the same major version, so the privilege
-- exists on both and must be named on both. A PostgreSQL 16 server rejects
-- the keyword outright; this file is therefore PG-17-only by construction.
--
-- ── Why PUBLIC is named even though PUBLIC holds nothing ───────────────────
--
-- The measured ACL has no bare `=…` entry, so PUBLIC currently holds none of
-- these privileges and the `FROM PUBLIC` clause is a no-op today. It is named
-- anyway, and the postconditions assert PUBLIC too, because F-62 is the
-- inverse mistake and it has already cost this project a unit: revoking from
-- `anon` alone is a no-op wherever PUBLIC is the actual holder. Naming both
-- means the file states its intent for either starting state, and the
-- assertion below fails loudly if PUBLIC ever acquires them.
--
-- ── What this file does NOT touch ──────────────────────────────────────────
--
-- SELECT · service_role · postgres · pg_default_acl · any base table · any
-- policy · any function. The rollback ships with it, in the same PR.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. ─────────────────────────────
-- Mechanism byte-identical to the #280-verified form. Only the quoted
-- explanatory sentence differs, because this file tightens rather than
-- restores; the test, the ERRCODE and the control lines are unchanged.
-- It is an ASSERTION, not a detection: the file cannot discover which lane it
-- is running against, so it refuses unless the operator states the lane.
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging (read: %). '
      'Staging always first: no SQL apply reaches production before the same '
      'file is green on staging. The file cannot detect its own lane, so it '
      'refuses unless the lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITIONS ─────────────────────────────────────────────────────────
-- The exact pre-state, asserted AS A SET. `relacl::text` is deliberately not
-- compared: aclitem ORDER inside the array is not a contract, and a file that
-- depends on it fails for a reason that has nothing to do with privilege.
DO $preconditions$
DECLARE
  want   text[] := (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[
                      'postgres=arwdDxtm/postgres',
                      'anon=arwdDxtm/postgres',
                      'authenticated=arwdDxtm/postgres',
                      'service_role=arwdDxtm/postgres']) x);
  got    text[];
  rec    record;
  n      int := 0;
BEGIN
  FOR rec IN
    SELECT t.relname, t.kind
    FROM (VALUES
      ('entry_final_votes','v'),
      ('entry_final_votes_legacy','v'),
      ('entry_public_status','v'),
      ('entry_vote_counts','m'),
      ('judge_comments_owner_safe','v'),
      ('judge_decisions_owner_safe','v'),
      ('judge_tag_assignments_owner_safe','v'),
      ('judge_tag_assignments_public_r4','v'),
      ('judging_progression_audit','v'),
      ('profiles_public','v'),
      ('v_judging_drift','v')
    ) AS t(relname, kind)
  LOOP
    n := n + 1;

    PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rec.relname;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P33-0033-PRE-001: public.% does not exist', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;

    PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rec.relname AND c.relkind = rec.kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P33-0033-PRE-002: public.% is not relkind %', rec.relname, rec.kind
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT array_agg(a.x::text ORDER BY a.x::text) INTO got
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace,
           LATERAL unnest(c.relacl) AS a(x)
     WHERE ns.nspname = 'public' AND c.relname = rec.relname;

    IF got IS DISTINCT FROM want THEN
      RAISE EXCEPTION
        'P33-0033-PRE-003: public.% ACL is not the measured pre-state. '
        'want (as a set): %  got: %', rec.relname, want, coalesce(got, '{NULL}'::text[])
        USING ERRCODE = 'raise_exception';
    END IF;

    IF NOT has_table_privilege('anon', format('public.%I', rec.relname), 'SELECT') THEN
      RAISE EXCEPTION 'P33-0033-PRE-004: anon does not hold SELECT on public.%', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_table_privilege('authenticated', format('public.%I', rec.relname), 'SELECT') THEN
      RAISE EXCEPTION 'P33-0033-PRE-005: authenticated does not hold SELECT on public.%', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 11 THEN
    RAISE EXCEPTION 'P33-0033-PRE-006: expected 11 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE REVOCATION — each relation named explicitly. ──────────────────────
-- No dynamic discovery as the target: a loop over a catalogue query would
-- revoke from whatever happens to match on the day it runs, which is a
-- different file every time it is executed.
-- SELECT is absent from every line below, deliberately.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.entry_final_votes FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.entry_final_votes_legacy FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.entry_public_status FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.entry_vote_counts FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judge_comments_owner_safe FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judge_decisions_owner_safe FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judge_tag_assignments_owner_safe FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judge_tag_assignments_public_r4 FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judging_progression_audit FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.profiles_public FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.v_judging_drift FROM PUBLIC, anon, authenticated;

-- ── POSTCONDITIONS ────────────────────────────────────────────────────────
-- Three assertions, each able to fail on its own:
--   1. no write-class privilege survives for PUBLIC, anon or authenticated;
--   2. SELECT survives for anon and authenticated;
--   3. the postgres and service_role entries are exactly what they were.
DO $postconditions$
DECLARE
  rel        text;
  grantee    text;
  priv       text;
  got        text[];
  want_after text[] := (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[
                          'postgres=arwdDxtm/postgres',
                          'anon=r/postgres',
                          'authenticated=r/postgres',
                          'service_role=arwdDxtm/postgres']) x);
  checks     int := 0;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'entry_final_votes','entry_final_votes_legacy','entry_public_status',
    'entry_vote_counts','judge_comments_owner_safe','judge_decisions_owner_safe',
    'judge_tag_assignments_owner_safe','judge_tag_assignments_public_r4',
    'judging_progression_audit','profiles_public','v_judging_drift']
  LOOP
    FOREACH grantee IN ARRAY ARRAY['public','anon','authenticated']
    LOOP
      FOREACH priv IN ARRAY ARRAY[
        'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
      LOOP
        checks := checks + 1;
        IF has_table_privilege(grantee, format('public.%I', rel), priv) THEN
          RAISE EXCEPTION
            'P33-0033-POST-001: % still holds % on public.%', grantee, priv, rel
            USING ERRCODE = 'raise_exception';
        END IF;
      END LOOP;
    END LOOP;

    IF NOT has_table_privilege('anon', format('public.%I', rel), 'SELECT') THEN
      RAISE EXCEPTION 'P33-0033-POST-002: anon lost SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_table_privilege('authenticated', format('public.%I', rel), 'SELECT') THEN
      RAISE EXCEPTION 'P33-0033-POST-003: authenticated lost SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT array_agg(a.x::text ORDER BY a.x::text) INTO got
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace,
           LATERAL unnest(c.relacl) AS a(x)
     WHERE ns.nspname = 'public' AND c.relname = rel;

    IF got IS DISTINCT FROM want_after THEN
      RAISE EXCEPTION
        'P33-0033-POST-004: public.% post-state ACL is not the expected set. '
        'want: %  got: %', rel, want_after, coalesce(got, '{NULL}'::text[])
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF checks <> 231 THEN
    RAISE EXCEPTION 'P33-0033-POST-005: expected 231 privilege checks, ran %', checks
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;

-- ── Verification after apply, for a human at a psql prompt ────────────────
-- Expect 0 rows. This is the recurrence detector, committed in full under
-- docs/evidence/d1/phase1/unitD-recurrence-detector.sql.
--
--   SELECT c.relname, g.grantee, g.priv
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   CROSS JOIN LATERAL (
--     SELECT grantee, priv
--     FROM unnest(ARRAY['public','anon','authenticated']) AS grantee
--     CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE',
--                             'REFERENCES','TRIGGER','MAINTAIN']) AS priv
--     WHERE has_table_privilege(grantee, c.oid, priv)) g
--   WHERE n.nspname = 'public' AND c.relkind IN ('v','m');
