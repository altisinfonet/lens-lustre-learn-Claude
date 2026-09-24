-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0033_p33_definer_view_write_revoke.sql
--
-- ⚠ READ THIS BEFORE RUNNING IT.
--
-- EXECUTING THIS FILE REOPENS anon AND authenticated WRITE ACCESS THROUGH
-- FIVE AUTO-UPDATABLE SECURITY DEFINER VIEWS THAT BYPASS RLS.
--
--   judge_comments_owner_safe        judge_decisions_owner_safe
--   judge_tag_assignments_owner_safe judge_tag_assignments_public_r4
--   profiles_public
--
-- Each of those five has pg_relation_is_updatable mask 28 — INSERT, UPDATE
-- and DELETE pass through to the base table — and none sets
-- `security_invoker`, so the write runs as the owner, `postgres`, which is
-- BYPASSRLS. An UPDATE issued by an unauthenticated visitor through one of
-- them does not consult the base table's policies at all. That is the state
-- this rollback restores. It is the state staging was in before 0033, and it
-- is not a state production has ever been asked to be in.
--
-- THE STAGING LANE GUARD IS THEREFORE MANDATORY, AND IT IS NOT DECORATION.
-- It is the only thing standing between this file and an exposure on the
-- production lane that the production lane never had.
--
-- ── What it restores, and what it does not ─────────────────────────────────
--
-- Restores, by grantee NAME: INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN to `anon` and `authenticated` on the eleven relations.
--
-- NEVER `TO PUBLIC`. The measured pre-state had no PUBLIC entry, so granting
-- to PUBLIC would not restore the pre-state — it would manufacture a wider
-- one, and would then be invisible to any later revoke that named `anon`
-- alone (F-62). The postcondition below asserts the ACL as a SET, which is
-- what catches that mistake rather than trusting the author not to make it.
--
-- Does not alter: SELECT · service_role · postgres · pg_default_acl · any
-- base table, policy or function.
--
-- ── Re-runnable ────────────────────────────────────────────────────────────
--
-- The precondition requires the post-revoke state, so a second consecutive
-- run refuses rather than silently doing nothing. Apply → rollback → apply
-- is exercised on a scratch PostgreSQL 17 fixture and recorded under
-- docs/evidence/d1/phase1/unitD-*.
--
-- PostgreSQL 17 or later. MAINTAIN does not exist before 17 and the file will
-- not parse on 16.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. ─────────────────────────────
-- Mechanism byte-identical to the #280-verified form; only the quoted
-- explanatory sentence is written for this file.
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback reopens anon and authenticated write access through five '
      'auto-updatable definer views that bypass RLS. On production that is an '
      'exposure the lane never had. The file cannot detect its own lane, so '
      'it refuses unless the lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — the post-0033 state must actually be in place. ─────────
DO $preconditions$
DECLARE
  rel        text;
  want_after text[] := (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[
                          'postgres=arwdDxtm/postgres',
                          'anon=r/postgres',
                          'authenticated=r/postgres',
                          'service_role=arwdDxtm/postgres']) x);
  got        text[];
  n          int := 0;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'entry_final_votes','entry_final_votes_legacy','entry_public_status',
    'entry_vote_counts','judge_comments_owner_safe','judge_decisions_owner_safe',
    'judge_tag_assignments_owner_safe','judge_tag_assignments_public_r4',
    'judging_progression_audit','profiles_public','v_judging_drift']
  LOOP
    n := n + 1;

    PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rel;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P33-0033-RB-PRE-001: public.% does not exist', rel
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT array_agg(a.x::text ORDER BY a.x::text) INTO got
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace,
           LATERAL unnest(c.relacl) AS a(x)
     WHERE ns.nspname = 'public' AND c.relname = rel;

    IF got IS DISTINCT FROM want_after THEN
      RAISE EXCEPTION
        'P33-0033-RB-PRE-002: public.% is not in the post-0033 state, so there '
        'is nothing for this file to roll back. want: %  got: %',
        rel, want_after, coalesce(got, '{NULL}'::text[])
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 11 THEN
    RAISE EXCEPTION 'P33-0033-RB-PRE-003: expected 11 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE RESTORATION — by grantee name, never TO PUBLIC. ───────────────────

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.entry_final_votes TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.entry_final_votes_legacy TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.entry_public_status TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.entry_vote_counts TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judge_comments_owner_safe TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judge_decisions_owner_safe TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judge_tag_assignments_owner_safe TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judge_tag_assignments_public_r4 TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.judging_progression_audit TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.profiles_public TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.v_judging_drift TO anon, authenticated;

-- ── POSTCONDITION — the measured pre-state, AS A SET, on all eleven. ──────
-- This is the assertion that catches a TO PUBLIC slip: a PUBLIC entry would
-- be a twelfth element and the set comparison would fail.
DO $postconditions$
DECLARE
  rel  text;
  want text[] := (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[
                    'postgres=arwdDxtm/postgres',
                    'anon=arwdDxtm/postgres',
                    'authenticated=arwdDxtm/postgres',
                    'service_role=arwdDxtm/postgres']) x);
  got  text[];
  n    int := 0;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'entry_final_votes','entry_final_votes_legacy','entry_public_status',
    'entry_vote_counts','judge_comments_owner_safe','judge_decisions_owner_safe',
    'judge_tag_assignments_owner_safe','judge_tag_assignments_public_r4',
    'judging_progression_audit','profiles_public','v_judging_drift']
  LOOP
    n := n + 1;

    SELECT array_agg(a.x::text ORDER BY a.x::text) INTO got
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace,
           LATERAL unnest(c.relacl) AS a(x)
     WHERE ns.nspname = 'public' AND c.relname = rel;

    IF got IS DISTINCT FROM want THEN
      RAISE EXCEPTION
        'P33-0033-RB-POST-001: public.% was not restored to the measured '
        'pre-state. want (as a set): %  got: %',
        rel, want, coalesce(got, '{NULL}'::text[])
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 11 THEN
    RAISE EXCEPTION 'P33-0033-RB-POST-002: expected 11 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
