-- ═══════════════════════════════════════════════════════════════════════════
-- CG-2 FINDING F1 — CANDIDATE FIX, PROVEN ON THE HARNESS (NOT APPLIED TO PROD)
--
-- F1: a judge who is also a participant can score / award-tag their OWN entry.
-- Root cause: judge_can_access_entry() checks competition membership and
-- (in distributed mode) entry assignment — never entry OWNERSHIP.
--
-- Fix: one line in ONE function — `ce.user_id <> _judge_id` — which gates
-- judge_scores, judge_decisions and judge_tag_assignments simultaneously,
-- because every judge-write policy calls this function.
--
-- Proof obligations:
--   P1: B1 replay (self-score)      → now DENIED
--   P2: B2 replay (self-award-tag)  → now DENIED
--   P3: A5 replay (judge scores someone else's entry) → STILL ALLOWED
--   P4: A4b replay (distributed, assigned)            → STILL ALLOWED
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP off
\set QUIET off

-- The candidate migration body (what would ship to production on GO):
CREATE OR REPLACE FUNCTION public.judge_can_access_entry(_entry_id uuid, _judge_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_judges cj ON cj.competition_id = ce.competition_id AND cj.judge_id = _judge_id
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.id = _entry_id
      -- CG-2 F1: a judge never judges their own entry. Ownership check added
      -- here (not per-policy) so scores, decisions and tags are all gated at
      -- the single choke point every judge-write policy already calls.
      AND ce.user_id <> _judge_id
      AND (
        c.judge_assignment_mode != 'distributed'
        OR EXISTS (
          SELECT 1 FROM judge_entry_assignments ja
          WHERE ja.entry_id = _entry_id AND ja.judge_id = _judge_id
        )
      )
  );
$function$;

\echo ''
\echo '── P1: B1 replay — judge_p scores OWN entry (round 4, OPEN — so denial is attributable to ownership, not the round lock) — EXPECT NOW: RLS denial'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a5', 10.0, 4, 0);
ROLLBACK;

\echo ''
\echo '── P2: B2 replay — judge_p award-tags OWN entry — EXPECT NOW: RLS denial'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
INSERT INTO judge_tag_assignments (entry_id, tag_id, judge_id, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000a5', 4, 0);
ROLLBACK;

\echo ''
\echo '── P3: A5-shape replay — judge_p scores member''s entry e1 (round 4 open) — EXPECT: INSERT 0 1 (legitimate judging intact)'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a5', 6.0, 4, 0);
ROLLBACK;

\echo ''
\echo '── P4: A4b replay — judge_b, distributed comp2, assigned entry e2 — EXPECT: INSERT 0 1'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a3', 7.0, 1, 0);
ROLLBACK;

\echo ''
\echo '── restore harness to production-faithful function (proof done)'
CREATE OR REPLACE FUNCTION public.judge_can_access_entry(_entry_id uuid, _judge_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_judges cj ON cj.competition_id = ce.competition_id AND cj.judge_id = _judge_id
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.id = _entry_id
      AND (
        c.judge_assignment_mode != 'distributed'
        OR EXISTS (
          SELECT 1 FROM judge_entry_assignments ja
          WHERE ja.entry_id = _entry_id AND ja.judge_id = _judge_id
        )
      )
  );
$function$;
\echo '════ F1 FIX PROOF COMPLETE ════'
