-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0036_p33_definer_view_read_closure.sql
-- Identical stem, as required. Five relations.
--
-- ⚠ EXECUTING THIS FILE MAKES FIVE SECURITY DEFINER RELATIONS READABLE AGAIN
-- BY anon AND authenticated. Three of the five have NO ROW FILTER AT ALL:
--
--   judging_progression_audit  every entry's title, status, stored AND
--                              expected progression decision, before publication
--   v_judging_drift            judge_id with each judge's tag and decision,
--                              per entry, per round, before publication
--   entry_vote_counts          real, adjustment and final vote counts per entry
--
-- Each runs as its owner, `postgres`, which is BYPASSRLS, so the base tables'
-- RLS is not consulted. After this file runs, a LOGGED-OUT visitor can read
-- the outcome of a competition that is still being judged.
--
-- THE STAGING LANE GUARD BELOW IS THEREFORE MANDATORY, AND IT IS NOT
-- DECORATION. 0036 is two-lane because it closes; this file opens, so it is
-- staging-only. The two assertions are deliberately different and neither
-- form should be copied into the other.
--
-- ── WHAT IT RESTORES ──────────────────────────────────────────────────────
--
-- SELECT to `anon` and `authenticated`, BY NAME, on the five. NEVER
-- `TO PUBLIC`: the measured pre-state had no PUBLIC entry on any of them, so
-- granting to PUBLIC would not restore the pre-state, it would manufacture a
-- wider one — and it would then be invisible to any later revoke naming anon
-- alone (F-62). The postcondition asserts zero PUBLIC entries after granting,
-- which is what catches that, and which "anon can read it" alone would not.
--
-- Does not touch service_role, postgres, any definition, or any COMMENT.
--
-- ── IT REFUSES WHEN THERE IS NOTHING TO UNDO ──────────────────────────────
--
-- The precondition requires 0036's post-state. Run against the pre-0036 state
-- it refuses, so "it did nothing" and "it did its job" are never the same
-- outcome.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. STAGING ONLY. ──────────────
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback reopens anon and authenticated SELECT on five SECURITY '
      'DEFINER relations, three of which have no row filter and expose '
      'pre-publication judging outcomes. The file cannot detect its own lane, '
      'so it refuses unless the lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — 0036's post-state must be in place. ────────────────────
DO $preconditions$
DECLARE
  rel   text;
  oid_  oid;
  n     int := 0;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'judging_progression_audit','v_judging_drift','entry_public_status',
    'entry_vote_counts','entry_final_votes_legacy']
  LOOP
    n := n + 1;
    SELECT c.oid INTO oid_ FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rel;
    IF oid_ IS NULL THEN
      RAISE EXCEPTION 'P33-0036-RB-PRE-001: public.% does not exist', rel
        USING ERRCODE = 'raise_exception';
    END IF;
    IF has_table_privilege('anon', oid_, 'SELECT') THEN
      RAISE EXCEPTION
        'P33-0036-RB-PRE-002: anon already holds SELECT on public.%, so 0036 is '
        'not in effect and there is nothing for this file to roll back', rel
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_table_privilege('service_role', oid_, 'SELECT') THEN
      RAISE EXCEPTION 'P33-0036-RB-PRE-003: service_role is missing SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 5 THEN
    RAISE EXCEPTION 'P33-0036-RB-PRE-004: expected 5 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE RESTORATION — by grantee name. Never TO PUBLIC. ───────────────────

GRANT SELECT ON TABLE public.judging_progression_audit TO anon, authenticated;
GRANT SELECT ON TABLE public.v_judging_drift TO anon, authenticated;
GRANT SELECT ON TABLE public.entry_public_status TO anon, authenticated;
GRANT SELECT ON TABLE public.entry_vote_counts TO anon, authenticated;
GRANT SELECT ON TABLE public.entry_final_votes_legacy TO anon, authenticated;

-- ── POSTCONDITION — anon and authenticated read again; PUBLIC does not. ───
DO $postconditions$
DECLARE
  rel   text;
  oid_  oid;
  pub_n int;
  n     int := 0;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'judging_progression_audit','v_judging_drift','entry_public_status',
    'entry_vote_counts','entry_final_votes_legacy']
  LOOP
    n := n + 1;
    SELECT c.oid INTO oid_ FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rel;

    IF NOT has_table_privilege('anon', oid_, 'SELECT') THEN
      RAISE EXCEPTION 'P33-0036-RB-POST-001: anon did not regain SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_table_privilege('authenticated', oid_, 'SELECT') THEN
      RAISE EXCEPTION 'P33-0036-RB-POST-002: authenticated did not regain SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT count(*) INTO pub_n FROM pg_class c, LATERAL aclexplode(c.relacl) a
     WHERE c.oid = oid_ AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION
        'P33-0036-RB-POST-003: public.% acquired a PUBLIC ACL entry. This file '
        'grants by name and must never grant to PUBLIC', rel
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_table_privilege('service_role', oid_, 'SELECT') THEN
      RAISE EXCEPTION 'P33-0036-RB-POST-004: service_role lost SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 5 THEN
    RAISE EXCEPTION 'P33-0036-RB-POST-005: expected 5 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
