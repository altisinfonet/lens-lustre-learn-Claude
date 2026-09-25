-- ═══════════════════════════════════════════════════════════════════════════
-- P33 · FIVE DEFINER VIEWS STOP BEING READABLE BY anon AND authenticated.
--
-- 0033 removed WRITE access on all eleven P33 relations. This file is about
-- READ access, and it closes the five that no client reads and that no
-- database reader needs a grant for.
--
--   judging_progression_audit    v_judging_drift    entry_public_status
--   entry_vote_counts            entry_final_votes_legacy
--
-- The other six are KEPT and justified one by one in
-- docs/evidence/d1/phase1/p33-view-justifications.md. Two of those six carry
-- an OPEN defect, fixed by 20260910_0042, and two carry an Owner question.
-- None of that is this file's business; this file closes five doors.
--
-- ── WHY THESE FIVE, MEASURED ON STAGING 2026-09-25, SELECT ONLY ────────────
--
-- Each is SECURITY DEFINER (reloptions NULL, so security_invoker is unset)
-- and owned by `postgres`, which is BYPASSRLS on Supabase. A definer view
-- does not consult the base table's RLS, so the SELECT grant is the only
-- control there is.
--
--   judging_progression_audit   NO row filter at all. Returns every entry's
--                               title, status, stored progression decision
--                               AND the decision the tags imply — before
--                               publication. A logged-out visitor could read
--                               the outcome of a competition still being
--                               judged.
--   v_judging_drift             NO row filter. Returns judge_id alongside the
--                               tag and the decision, per entry, per round.
--                               Anonymous readers could reconstruct who
--                               judged what, before publication.
--   entry_public_status         Filtered to a status allow-list OR admin, but
--                               every one of its eight database readers is
--                               SECURITY DEFINER and no client reads it.
--   entry_vote_counts           Materialised view. NO row filter. Exposes
--                               real_votes, adjustment_votes and final_votes
--                               per entry.
--   entry_final_votes_legacy    NO row filter. An aggregate over
--                               entry_final_votes. No reader of any kind.
--
-- ── WHY NOTHING BREAKS ────────────────────────────────────────────────────
--
-- APP READERS, re-derived at c583431 with a shape-independent `.from()` scan
-- across src/**, supabase/functions/**, functions/**, scripts/**:
--   all five: ZERO. Not one call site, test or production.
--
-- DATABASE READERS, from pg_depend, pg_proc and pg_policy:
--   entry_public_status ....... 8 functions, ALL SECURITY DEFINER
--                               (get_derived_status_drift_admin,
--                                get_entry_status_drift_admin,
--                                get_entry_status_drift_summary_admin,
--                                get_gated_entry_status,
--                                get_gated_status_runtime_drift_admin,
--                                get_result_visibility_invariant_admin,
--                                recompute_entry_public_status,
--                                trg_recompute_publish_fanout)
--   v_judging_drift ........... get_judging_drift_admin      (DEFINER)
--   entry_vote_counts ......... get_entry_vote_counts        (DEFINER)
--   entry_final_votes_legacy .. none
--   judging_progression_audit . none
--   0 pg_policy references. 0 cron jobs.
--
-- A SECURITY DEFINER function runs as its owner, so revoking SELECT from
-- anon and authenticated cannot affect any of them. That is asserted on the
-- fixture, not assumed: a definer wrapper still reads each of the five after
-- this file runs, while a direct read as anon or authenticated raises 42501.
--
-- ── WHAT THIS FILE DOES NOT DO ────────────────────────────────────────────
--
-- It does not touch the six KEPT relations, any view definition, any policy,
-- pg_default_acl, or `postgres`. service_role is granted SELECT explicitly so
-- the end state is stated rather than inherited.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE ASSERTION — TWO-LANE. This file closes doors, so it is meant for
-- both lanes. It still fails closed outside the dispatch workflow, which
-- since #293 is the only thing that sets p32.lane.
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

-- ── PRECONDITION — the five exist with the expected relkind. ──────────────
-- The ACL is deliberately NOT asserted: production is a different shape from
-- staging (the Owner's 2026-09-25 reading) and this file must be correct on
-- both lanes.
DO $preconditions$
DECLARE
  rec record;
  n   int := 0;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('judging_progression_audit','v'),
      ('v_judging_drift','v'),
      ('entry_public_status','v'),
      ('entry_vote_counts','m'),
      ('entry_final_votes_legacy','v')
    ) AS t(relname, kind)
  LOOP
    n := n + 1;
    PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rec.relname;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P33-0036-PRE-001: public.% does not exist', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
    PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rec.relname AND c.relkind = rec.kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P33-0036-PRE-002: public.% is not relkind %', rec.relname, rec.kind
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 5 THEN
    RAISE EXCEPTION 'P33-0036-PRE-003: expected 5 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE REVOCATION ────────────────────────────────────────────────────────
-- PUBLIC is named first even though the measured ACL has no PUBLIC entry
-- today (F-62: revoking anon alone is a no-op wherever PUBLIC is the holder,
-- and the postcondition asserts PUBLIC afterwards either way).

REVOKE SELECT ON TABLE public.judging_progression_audit FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON TABLE public.judging_progression_audit TO service_role;

REVOKE SELECT ON TABLE public.v_judging_drift FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON TABLE public.v_judging_drift TO service_role;

REVOKE SELECT ON TABLE public.entry_public_status FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON TABLE public.entry_public_status TO service_role;

REVOKE SELECT ON TABLE public.entry_vote_counts FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON TABLE public.entry_vote_counts TO service_role;

REVOKE SELECT ON TABLE public.entry_final_votes_legacy FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON TABLE public.entry_final_votes_legacy TO service_role;

-- ── ONE COMMENT PER VIEW, stating the disposition. ────────────────────────

COMMENT ON VIEW public.judging_progression_audit IS
  'P33 0036: CLOSED to anon and authenticated. No row filter; returns every entry''s title, status, stored and expected progression decision before publication. Zero app readers, zero database readers. service_role only. SECURITY DEFINER, so the grant is the only control (F-62/F-66 apply).';

COMMENT ON VIEW public.v_judging_drift IS
  'P33 0036: CLOSED to anon and authenticated. No row filter; returns judge_id with each judge''s tag and decision per entry, before publication. Zero app readers; the one database reader, get_judging_drift_admin, is SECURITY DEFINER and unaffected. service_role only.';

COMMENT ON VIEW public.entry_public_status IS
  'P33 0036: CLOSED to anon and authenticated. Status allow-list OR admin, but zero app readers and all eight database readers are SECURITY DEFINER, so no direct grant is needed. service_role only.';

COMMENT ON MATERIALIZED VIEW public.entry_vote_counts IS
  'P33 0036: CLOSED to anon and authenticated. No row filter; exposes real, adjustment and final vote counts per entry. Zero app readers; get_entry_vote_counts is SECURITY DEFINER and unaffected. service_role only.';

COMMENT ON VIEW public.entry_final_votes_legacy IS
  'P33 0036: CLOSED to anon and authenticated. No row filter; an aggregate over entry_final_votes. No reader of any kind, in the app or the catalogue. service_role only.';

-- ── POSTCONDITION ─────────────────────────────────────────────────────────
DO $postconditions$
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

    IF has_table_privilege('anon', oid_, 'SELECT') THEN
      RAISE EXCEPTION 'P33-0036-POST-001: anon still holds SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;
    IF has_table_privilege('authenticated', oid_, 'SELECT') THEN
      RAISE EXCEPTION 'P33-0036-POST-002: authenticated still holds SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;
    IF has_table_privilege('public', oid_, 'SELECT') THEN
      RAISE EXCEPTION 'P33-0036-POST-003: PUBLIC still holds SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_table_privilege('service_role', oid_, 'SELECT') THEN
      RAISE EXCEPTION 'P33-0036-POST-004: service_role lost SELECT on public.%', rel
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 5 THEN
    RAISE EXCEPTION 'P33-0036-POST-005: expected 5 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
