-- Top Contributors V3 — the Home card displays the 30-day score.
--
-- =============================================================================
-- THE RULING THIS IMPLEMENTS
--
-- OWNER-RULING-2026-09-03-02: the Home page Top Contributors card must display
-- the 30-day score, not the lifetime score.
--
-- ⚠ THIS SUPERSEDES THE OWNER'S 2026-08-11 INSTRUCTION recorded in
-- supabase/migrations/20260811160000_top_contributors_v2.sql, which reads:
--
--     "The 30-day number is NEVER returned, so it cannot reach the UI by
--      accident."
--
-- THAT SENTENCE IS NOT DELETED AND MUST NOT BE. It was correct when it was
-- written and it is the record of a decision the Owner has now changed. Two
-- corrections in this project — C-46 and C-51 — came from a ruling that lived
-- only in a chat, so this one lives in the tree: the v2 file keeps its original
-- text, this file names the ruling that supersedes it, and a reader who finds
-- either one finds the other.
--
-- WHY THE OWNER CHANGED IT — visible in the data, measured 2026-09-03 08:45Z
-- on production, read-only:
--
--   pos 1  recent 7,055   lifetime  9,551
--   pos 2  recent 6,978   lifetime  8,888
--   pos 3  recent 6,823   lifetime 11,546   ← largest number, bottom of the card
--
-- The card ranks by the 30-day score and prints the lifetime score, so today it
-- shows 11,546 beneath 9,551 and 8,888. A member reads a leaderboard top to
-- bottom and expects the numbers to descend. They do not, and no explanation is
-- on the card. Displaying the number the ranking is actually made of removes
-- the contradiction without changing who appears or in what order.
--
-- =============================================================================
-- WHY A NEW FUNCTION RATHER THAN AN EDIT — MEASURED, NOT ASSUMED
--
-- PostgreSQL refuses to change a function's return type through CREATE OR
-- REPLACE (ERROR 42P13, "cannot change return type of existing function").
-- Verified against production 2026-09-03: get_top_contributors_v2 returns
-- TABLE(user_id uuid, rank_position integer, contributor_score integer), and
-- adding a column changes that type. So this is an EXPAND step in the
-- expand → behaviour → contract sequence:
--
--   EXPAND    (this file)  v3 is created ALONGSIDE v2. Additive. Nothing is
--                          dropped, nothing a member sees changes on apply.
--   BEHAVIOUR (D2's PR)    the Home card switches to v3 and reads recent_score.
--   CONTRACT  (later)      v2 is dropped, and ONLY after the Auditor authorises
--                          it — not in this PR, not in the next one.
--
-- ⚠ v2 IS THE ROLLBACK. It is left byte-for-byte as it is, still granted, still
-- working. If v3 or the client change goes wrong, the revert is a one-line
-- frontend change back to v2 with no database work at all. Dropping v2 in this
-- PR would throw that away for no gain.
--
-- =============================================================================
-- WHAT IS DELIBERATELY UNCHANGED FROM v2 — the list is the point
--
-- Everything below is copied, not rewritten. A "small improvement" made while
-- moving code is how a ranking silently shifts and nobody can say which change
-- did it.
--
--   * THE RANKING RULE.  ORDER BY recent.score DESC, uid. The uid tie-break is
--     what makes the order stable between calls rather than shuffling two equal
--     scores on every refresh.
--   * THE WINDOW.  (now() AT TIME ZONE 'UTC')::date - 29, i.e. today plus the
--     29 UTC days before it = 30 UTC days.
--   * THE ZERO RULE.  WHERE r.score > 0. A member with no activity in the last
--     30 days is excluded, exactly as in v2 — a leaderboard of zeroes is not a
--     leaderboard.
--   * THE TOP 3.  WHERE rk.pos <= 3.
--   * THE ADMIN EXCLUSION.  Stays where it already is, inside
--     contributor_points_since. It is NOT re-stated here. One definition, one
--     place: the leaderboard and the badge can never disagree about who is
--     eligible, which was the whole reason v2 factored it out.
--   * THE FORMULA.  Untouched. contributor_points_since is called, never
--     redefined, and its grants are not altered by this file.
--
-- The proof that none of this moved: v2 and v3 were run side by side against
-- production, read-only, at 2026-09-03 08:45:05Z. Same three user_ids, same
-- three positions, same three lifetime scores. Quoted in the PR body.
--
-- =============================================================================
-- WHAT v3 RETURNS, AND WHAT IT STILL REFUSES TO RETURN
--
--   user_id            uuid     the member
--   rank_position      integer  1, 2 or 3
--   contributor_score  integer  LIFETIME — unchanged meaning from v2
--   recent_score       integer  rolling last 30 UTC days — THE NEW COLUMN,
--                               and what the Home card displays
--
-- Still never returned, and this half of the Owner's 2026-08-11 instruction is
-- NOT superseded: no counts, no minutes, no engagement figures, no formula
-- internals, no per-day breakdown, no tier working. "The ranking should feel
-- like recognition, not a 'time spent on app' competition."
--
-- =============================================================================
-- SECURITY — THE WHERE CLAUSE IS THE ONLY CONTROL
--
-- v3 is SECURITY DEFINER and anon-executable, so RLS is bypassed entirely and
-- there is no second line of defence. Three deliberate properties:
--
--   1. NO ARGUMENTS. There is no parameter to manipulate, so there is no way to
--      ask this function about a member of the caller's choosing.
--   2. NO CALLER-DEPENDENT VALUE in the body — no auth.uid(), no current_user,
--      no request.jwt. Every caller gets the same three rows, which are the
--      three rows already printed on a public page. Measured caller-independent
--      2026-09-03 08:46:30Z across member A, member B and anon.
--   3. THE HELPER STAYS SHUT. contributor_points_since returns EVERY eligible
--      member's score for an arbitrary date. Its EXECUTE is revoked from
--      public, anon and authenticated (verified 2026-09-03 08:44:30Z:
--      anon=false, authenticated=false) and this file does not touch that.
--      v3 reaches it only because v3 is DEFINER. If that revoke were ever
--      undone, the leaderboard becomes an enumeration endpoint for the whole
--      membership — which is why the accompanying probe asserts it every run.
--
-- The one predicate that matters is `WHERE rk.pos <= 3`. Removed, this function
-- returns every eligible member's recent and lifetime score to anonymous
-- callers. Measured on production 2026-09-03 08:46:15Z: correct 3 rows,
-- loosened 44 rows — 41 members leaked by one dropped line. That is the exact
-- defect PROBE_top_contributors_v3_cross_member.sql is built to catch, and it
-- was shown catching it before this file was accepted.
--
-- =============================================================================
-- ⚠ INTERFACE FREEZE — STATED HONESTLY
--
-- The Owner froze this shape as docs/gates/TC-v3-interface.md. As of
-- 2026-09-03 that file exists on NO ref of this repository — every remote
-- branch and tag was scanned; docs/gates/ holds only GATE_REGISTER.md and
-- phase-0-kickoff.md. Until the Auditor commits it, THIS FILE IS THE ONLY
-- PLACE THE FROZEN SHAPE IS WRITTEN DOWN, and it is written by the developer
-- the freeze exists to constrain. Recorded rather than worked around; the
-- shape below is exactly as the Owner specified it and D1 has not varied it.

-- ─────────────────────────────────────────────────────────────────────────────
-- No index is created. idx_post_comments_user_created already exists from the
-- v2 migration and v3 reads through the same helper, so the access path is
-- identical. Adding an index here would be a change this unit did not measure.

CREATE OR REPLACE FUNCTION public.get_top_contributors_v3()
RETURNS TABLE (
  user_id           uuid,
  rank_position     integer,
  contributor_score integer,  -- lifetime, unchanged meaning from v2
  recent_score      integer   -- rolling last 30 UTC days — what the card shows
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH recent AS (
    -- 30 UTC days: today, plus the 29 before it. Identical to v2.
    SELECT r.uid, r.score
    FROM public.contributor_points_since(
      ((now() AT TIME ZONE 'UTC')::date - 29)
    ) r
    WHERE r.score > 0
  ),
  lifetime AS (
    SELECT l.uid, l.score FROM public.contributor_points_since(NULL::date) l
  ),
  ranked AS (
    -- uid is the tie-break so the order is stable between calls rather than
    -- shuffling two equal scores on every refresh. Identical to v2.
    SELECT rc.uid,
           rc.score AS recent,
           ROW_NUMBER() OVER (ORDER BY rc.score DESC, rc.uid) AS pos
    FROM recent rc
  )
  SELECT rk.uid,
         rk.pos::integer,
         ROUND(COALESCE(lf.score, 0))::integer,
         ROUND(rk.recent)::integer
  FROM ranked rk
  LEFT JOIN lifetime lf ON lf.uid = rk.uid
  WHERE rk.pos <= 3
  ORDER BY rk.pos;
$fn$;

COMMENT ON FUNCTION public.get_top_contributors_v3() IS
  'Home page Top Contributors. Ranked by rolling last 30 UTC days and returns BOTH that 30-day score (recent_score, what the card displays) and the lifetime Contributor Score (contributor_score). Per OWNER-RULING-2026-09-03-02, which supersedes the 2026-08-11 instruction that the 30-day number is never returned; that instruction is preserved unedited in 20260811160000_top_contributors_v2.sql. Never returns counts, minutes, engagement figures or formula internals. get_top_contributors_v2 is unchanged and remains the rollback until the Auditor authorises its removal.';


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS — MATCHED TO v2's REACH THROUGH THE API, AND NOT EXCEEDED.
--
-- v2's effective posture, read from pg_proc.proacl on production
-- 2026-09-03 08:44:30Z:
--
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}
--
-- ⚠ THE LEADING `=X/postgres` IS PUBLIC. v2 carries the default EXECUTE grant
-- to PUBLIC that CREATE FUNCTION applies and that its own migration revoked
-- only from the helper, never from the two wrappers. The v2 file's grant block
-- says "The Home page is public and get_top_contributors_v1 is already
-- anon-executable, so v2 matches it" and then names anon and authenticated —
-- so the file's stated intent and the catalogue's actual state differ.
-- STANDING RULE 21: an instructing comment is a control, and when a comment and
-- its code disagree that is a finding, not cosmetics. Raised for the Auditor;
-- v2 is not altered by this file.
--
-- ⚠ AND THE PUBLIC GRANT HAS A CONSEQUENCE THAT IS NOT COSMETIC. It was found
-- by a negative control that failed to fail, reproduced on a scratch PostgreSQL
-- 16 with v2's exact posture, 2026-09-03:
--
--     REVOKE EXECUTE ON FUNCTION public.get_top_contributors_v2() FROM anon;
--     -- has_function_privilege('anon', ..., 'EXECUTE')  ->  STILL TRUE
--
-- Revoking from `anon` does nothing while PUBLIC holds the grant, because anon
-- inherits it through PUBLIC. Only `REVOKE ... FROM public` actually closes it.
-- So the obvious command for taking v2 out of service on the day it must be
-- taken out of service silently does not work. That is worth knowing BEFORE
-- somebody needs it in a hurry, and it is why v3 does not inherit the same
-- shape: `REVOKE ... FROM anon` on v3 will do what it says.
--
-- v3 therefore does NOT copy the PUBLIC grant. It revokes PUBLIC explicitly and
-- grants the two roles the v2 migration intended. That is NARROWER than v2, not
-- wider — the instruction was "match, do not exceed", and a role set that is a
-- subset of v2's cannot exceed it. Through PostgREST the reachable roles are
-- anon, authenticated and service_role, so there is no behavioural difference
-- for the Home page; the difference is that a future role added to this
-- database does not silently inherit EXECUTE on v3.
--
-- If the Auditor wants v3's grant posture byte-identical to v2's instead, the
-- change is to delete the REVOKE line below. I recommend against it and have
-- said so rather than making the choice silently.
-- ─────────────────────────────────────────────────────────────────────────────
-- F-76 · THE DELIBERATELY-PUBLIC CLAIM, MADE HERE RATHER THAN IN AN ALLOW-LIST.
--
-- D2's guard (securityDefinerGrants.test.ts) has three ways for a SECURITY
-- DEFINER function to pass: revoked from anon by name, gated internally on the
-- caller's own identity, or proven PUBLIC-BY-DESIGN. v3 is the third. It is
-- neither revoked from anon nor internally gated, and that is correct rather
-- than a defect — so the claim is written where the grant is, and the developer
-- who wants to know "why is this public?" reads the answer next to the line
-- that made it public.
--
-- ⚠ THE MARKER IS NOT A WAIVER. The guard still enforces two things no reason
-- can excuse, and both are already satisfied below rather than by this comment:
--   (2) the F-62-safe shape — REVOKE ALL … FROM public BEFORE the GRANT … TO
--       anon. A bare GRANT fails even with a marker, because `REVOKE … FROM
--       anon` is a no-op while PUBLIC holds the grant. Satisfied: the REVOKE is
--       the line immediately below, and it precedes the GRANT.
--   (3) not VOLATILE. A public VOLATILE definer function is the amplification
--       class — an anonymous caller driving unbounded write work. Satisfied:
--       the function is declared STABLE, explicitly, because PostgreSQL's
--       default is VOLATILE and silence is not a claim.
--
-- Both re-checked against this file 2026-09-04 rather than assumed.
--
-- ⚠ A TRAP THIS COMMENT BLOCK FELL INTO ONCE, RECORDED SO THE NEXT WRITER DOES
-- NOT. The guard's "gates internally" test greps the RAW SQL — comments
-- included — for the caller-identity helpers, across the 8000 characters after
-- the function header. An earlier draft of this very block NAMED those helpers
-- in prose while explaining the three categories, and that alone made the guard
-- believe v3 gates itself. It went green for a reason that had nothing to do
-- with the marker: the negative control (delete the marker, expect red) came
-- back GREEN, which is how it was caught. Do not write those identifiers
-- literally anywhere after a SECURITY DEFINER header unless the function really
-- does call them. Raised for D2 as a guard weakness in its own right.

-- PUBLIC-BY-DESIGN: get_top_contributors_v3 — the Home page Top Contributors card is rendered for logged-out visitors, so anon MUST be able to execute this or the public home page shows an empty card; it takes no arguments, so there is no parameter through which a caller can ask about a member of their choosing, its output is caller-independent (measured identical for member A, member B and anon), and it returns only the three names and scores that are already printed on that public page.
--
-- The enumeration risk lives in the helper, not here: contributor_points_since
-- returns EVERY eligible member's score for an arbitrary date, and its EXECUTE
-- stays revoked from public, anon and authenticated. v3 reaches it only because
-- v3 is DEFINER. PROBE_top_contributors_v3_cross_member.sql asserts that on
-- every run (A3), along with the row cap (A1) whose removal was measured to
-- turn 3 rows into 44.
REVOKE ALL ON FUNCTION public.get_top_contributors_v3() FROM public;
GRANT EXECUTE ON FUNCTION public.get_top_contributors_v3() TO anon, authenticated;

-- contributor_points_since is NOT touched. Its EXECUTE stays revoked from
-- public, anon and authenticated. v3 reaches it as SECURITY DEFINER, exactly
-- as v2 does.
