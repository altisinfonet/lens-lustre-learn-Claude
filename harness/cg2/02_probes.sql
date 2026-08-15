-- ═══════════════════════════════════════════════════════════════════════════
-- CG-2 PROBES — run after 01_schema_seed.sql, as superuser.
-- Every probe runs as a NON-superuser role (SET LOCAL ROLE authenticated +
-- request.jwt.claim.sub GUC) inside its own transaction — the V11 lesson.
-- Superuser steps are labelled [SUPERUSER] and exist only to stage state.
--
-- Expected outcomes are printed BEFORE each probe; the transcript is the
-- evidence. DENY probes on competition_round_publish are sound despite its
-- omitted side-effect triggers (harness more permissive ⊆ production).
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP off
\set QUIET off
\pset footer off

\echo ''
\echo '════ FAMILY A — JUDGE AUTHORIZATION ════'

\echo ''
\echo '── A1: plain member (no judge role) inserts a score as themselves — EXPECT: RLS denial'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a4', 7.0, 1, 0);
ROLLBACK;

\echo ''
\echo '── A2: judge_a (comp1 judge) scores entry e2 in comp2 — EXPECT: RLS denial (not that competition''s judge)'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', 7.0, 1, 0);
ROLLBACK;

\echo ''
\echo '── A3: judge_a forges judge_id = judge_b on own comp''s entry — EXPECT: RLS denial (judge_id must equal auth.uid())'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a3', 7.0, 1, 0);
ROLLBACK;

\echo ''
\echo '── A4a: judge_b in DISTRIBUTED comp2, entry e2 NOT assigned to them — EXPECT: RLS denial'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a3', 7.0, 1, 0);
ROLLBACK;

\echo ''
\echo '── A4b: [SUPERUSER] assign e2 to judge_b, then same insert — EXPECT: INSERT 0 1'
INSERT INTO judge_entry_assignments (competition_id, judge_id, entry_id)
VALUES ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e2');
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a3', 7.0, 1, 0);
ROLLBACK;

\echo ''
\echo '── A5 (positive control): judge_a scores e1 in comp1, round 1 open — EXPECT: INSERT 0 1, COMMITTED'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 8.5, 1, 0);
COMMIT;
SELECT 'A5 committed rows' AS check, count(*) FROM judge_scores
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e1' AND judge_id = '00000000-0000-0000-0000-0000000000a2';

\echo ''
\echo '════ FAMILY B — PARTICIPANT ISOLATION (judge who is also a participant) ════'

\echo ''
\echo '── B1: judge_p scores THEIR OWN entry ep — policy reading predicts ALLOWED (no self-exclusion anywhere). Outcome decides the finding.'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a5', 10.0, 1, 0);
SELECT 'B1 self-score rows visible to judge_p' AS check, count(*) FROM judge_scores
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e5' AND judge_id = '00000000-0000-0000-0000-0000000000a5';
ROLLBACK;

\echo ''
\echo '── B2: judge_p R4-award-tags THEIR OWN entry ep (Winner) — same prediction: ALLOWED'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
INSERT INTO judge_tag_assignments (entry_id, tag_id, judge_id, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000a5', 4, 0);
SELECT 'B2 own-entry award rows (definer-written)' AS check, count(*) FROM judge_award_tags
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e5' AND stage_key = 'r4_winner';
ROLLBACK;

\echo ''
\echo '════ FAMILY C — AWARD WRITE PATH + STACKING ════'

\echo ''
\echo '── C0: judge_a INSERTs judge_award_tags DIRECTLY — EXPECT: RLS denial (mirror is the only write path)'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judge_award_tags (entry_id, judge_id, photo_index, round_number, stage_key, decision_token, tag_label)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 0, 4, 'r4_winner', 'winner', 'Winner');
ROLLBACK;

\echo ''
\echo '── C1: STACKING — judge_a assigns Winner THEN 1st Runner-Up to the SAME entry/photo (R4).'
\echo '       DB constraints permit both (unique key includes tag_id / stage_key). Outcome decides the finding.'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judge_tag_assignments (entry_id, tag_id, judge_id, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000a2', 4, 0);
INSERT INTO judge_tag_assignments (entry_id, tag_id, judge_id, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000f0a2', '00000000-0000-0000-0000-0000000000a2', 4, 0);
RESET ROLE; -- superuser view of what the definer trigger wrote
SELECT 'C1 award rows for e1/judge_a' AS check, stage_key, decision_token
  FROM judge_award_tags
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e1' AND judge_id = '00000000-0000-0000-0000-0000000000a2'
 ORDER BY stage_key;
SELECT 'C1 final decision (last-write-wins?)' AS check, decision, stage_key
  FROM judge_decisions
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e1' AND judge_id = '00000000-0000-0000-0000-0000000000a2' AND round_number = 4;
ROLLBACK;

\echo ''
\echo '── C2: TWO Winners in ONE competition — judge_a Winner on e1; judge_p Winner on ep. Outcome decides the finding.'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judge_tag_assignments (entry_id, tag_id, judge_id, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000a2', 4, 0);
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
INSERT INTO judge_tag_assignments (entry_id, tag_id, judge_id, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000a5', 4, 0);
RESET ROLE;
SELECT 'C2 Winner award rows in comp1' AS check, jat.entry_id, jat.judge_id
  FROM judge_award_tags jat
  JOIN competition_entries ce ON ce.id = jat.entry_id
 WHERE ce.competition_id = '00000000-0000-0000-0000-0000000000c1' AND jat.stage_key = 'r4_winner';
ROLLBACK;

\echo ''
\echo '── C3: FAIL-LOUD CHECK — uncatalogued tag mirrors to NOTHING but logs noop_alias_miss'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judge_tag_assignments (entry_id, tag_id, judge_id, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000f0a3', '00000000-0000-0000-0000-0000000000a2', 4, 0);
RESET ROLE;
SELECT 'C3 mirror log' AS check, action, error_message FROM v3_mirror_log
 WHERE tag_id = '00000000-0000-0000-0000-00000000f0a3' ORDER BY occurred_at DESC LIMIT 1;
SELECT 'C3 award rows created (expect 0)' AS check, count(*) FROM judge_award_tags
 WHERE tag_id = '00000000-0000-0000-0000-00000000f0a3';
SELECT 'C3 decisions created (expect 0)' AS check, count(*) FROM judge_decisions
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e1' AND judge_id = '00000000-0000-0000-0000-0000000000a2' AND round_number = 4;
ROLLBACK;

\echo ''
\echo '════ FAMILY D — ROUND-ROW PROTECTION + ROUND LOCK ════'

\echo ''
\echo '── D1: judge_a UPDATEs judging_rounds status — EXPECT: UPDATE 0 (RLS filters all rows)'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
UPDATE judging_rounds SET status = 'completed'
 WHERE competition_id = '00000000-0000-0000-0000-0000000000c1' AND round_number = 4;
ROLLBACK;

\echo ''
\echo '── D2: judge_a INSERTs a judging_rounds row — EXPECT: RLS denial'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judging_rounds (competition_id, round_number, name, status)
VALUES ('00000000-0000-0000-0000-0000000000c2', 2, 'rogue round', 'active');
ROLLBACK;

\echo ''
\echo '── D3: member_m UPDATEs competition_round_publish.published_at — EXPECT: UPDATE 0 (DENY-only probe, see fidelity ledger #4)'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
UPDATE competition_round_publish SET published_at = now()
 WHERE competition_id = '00000000-0000-0000-0000-0000000000c1' AND round_number = 1;
ROLLBACK;

\echo ''
\echo '── D4: [SUPERUSER] complete comp1 round 1, then:'
UPDATE judging_rounds SET status = 'completed'
 WHERE competition_id = '00000000-0000-0000-0000-0000000000c1' AND round_number = 1;

\echo '   D4a: judge_a UPDATEs their committed A5 score — EXPECT: UPDATE 0 (policy qual now false)'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
UPDATE judge_scores SET score = 1.0
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e1' AND judge_id = '00000000-0000-0000-0000-0000000000a2' AND round_number = 1;
ROLLBACK;

\echo '   D4b: judge_a INSERTs a new R1 score — EXPECT: RLS denial (WITH CHECK fails)'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 2.0, 1, 1);
ROLLBACK;

\echo '   D4c: SUPERUSER (bypasses RLS) updates the same score — EXPECT: trigger exception ''Scoring is locked.'' (defense in depth)'
BEGIN;
UPDATE judge_scores SET score = 1.0
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e1' AND judge_id = '00000000-0000-0000-0000-0000000000a2' AND round_number = 1;
ROLLBACK;

\echo ''
\echo '── D5a: judge_a sets app.bypass_round_lock=on THEMSELVES, retries D4b insert — EXPECT: STILL RLS denial (policy does not honor the GUC)'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
SET LOCAL app.bypass_round_lock = 'on';
INSERT INTO judge_scores (entry_id, judge_id, score, round_number, photo_index)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 2.0, 1, 1);
ROLLBACK;

\echo '── D5b: SUPERUSER with the GUC — EXPECT: UPDATE 1 (documents the bypass is real for trusted definer paths only)'
BEGIN;
SET LOCAL app.bypass_round_lock = 'on';
UPDATE judge_scores SET score = 1.0
 WHERE entry_id = '00000000-0000-0000-0000-0000000000e1' AND judge_id = '00000000-0000-0000-0000-0000000000a2' AND round_number = 1;
ROLLBACK;

\echo ''
\echo '── E1: needs_review decision at round 2 — EXPECT: guard exception (Spec V3, R1 only) even for SUPERUSER'
BEGIN;
INSERT INTO judge_decisions (entry_id, judge_id, round_number, decision)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 2, 'needs_review');
ROLLBACK;

\echo ''
\echo '════ CG-2 PROBES COMPLETE ════'
