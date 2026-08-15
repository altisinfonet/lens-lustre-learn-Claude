-- ═══════════════════════════════════════════════════════════════════════════
-- CANDIDATE MIGRATION — CG-2 FINDING F1 — *** AWAITING OWNER GO — NOT APPLIED ***
--
-- Staged in harness/cg2/, NOT supabase/migrations/, because the migrations
-- directory holds only applied-and-version-matched files (protocol rule).
-- On GO this ships through the normal connector apply → verify → rename cycle.
--
-- WHAT IT CHANGES (product behavior — hence the GO gate):
--   A judge who has an entry in a competition can currently score, decide on,
--   and award-tag THEIR OWN entry (harness-demonstrated, probes B1/B2,
--   transcript in this directory). This adds `ce.user_id <> _judge_id` to
--   judge_can_access_entry() — the single choke point every judge-write
--   policy (judge_scores / judge_decisions / judge_tag_assignments) calls —
--   so a judge can never judge their own entry.
--
-- WHY THE GO GATE: if any CURRENT live competition has a judge with an own
-- entry mid-round, their in-flight self-judging stops working the moment this
-- applies. That is the point of the fix, but the owner decides the policy.
--
-- PRE-FLIGHT (run before apply; expect 0 rows — no live conflict):
--   SELECT cj.competition_id, cj.judge_id, ce.id AS own_entry
--     FROM competition_judges cj
--     JOIN competition_entries ce ON ce.competition_id = cj.competition_id
--                                AND ce.user_id = cj.judge_id;
--
-- HARNESS PROOF: 03_fix_proof.sql / fix_proof_transcript.txt —
--   P1 self-score DENIED · P2 self-award-tag DENIED ·
--   P3 normal judging ALLOWED · P4 distributed+assigned ALLOWED.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.judge_can_access_entry(_entry_id uuid, _judge_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_judges cj ON cj.competition_id = ce.competition_id AND cj.judge_id = _judge_id
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.id = _entry_id
      -- CG-2 F1: a judge never judges their own entry. The ownership check
      -- lives HERE (not per-policy) so scores, decisions and tags are all
      -- gated at the one function every judge-write policy already calls.
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
