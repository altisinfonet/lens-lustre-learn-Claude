-- ═══════════════════════════════════════════════════════════════════════════
-- TC-v3 · POST-APPLY VERIFICATION.  SELECT ONLY.  WRITES NOTHING.
--
-- Run immediately after applying supabase/migrations/20260903090000_top_contributors_v3.sql
-- to STAGING (ztzutckwdhetphwghuzj). Prepared by D1 for the Auditor, who applies
-- via the Supabase connection because apply-migration.yml on the staging lane is
-- blocked by H-4.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THIS IS NOT JUST A COPY OF THE PROBE
--
-- PROBE_top_contributors_v3_cross_member.sql wraps its five assertions in a
-- DO block and reports through RAISE NOTICE / RAISE EXCEPTION. That is right for
-- psql through apply-migration.yml, where NOTICEs land in the run log.
--
-- It is WRONG for the transport being used here. A DO block is not a SELECT, and
-- a Supabase SQL connection returns ROWS — a NOTICE is not shown, so a green run
-- would be invisible and a red one might read as success. The same five
-- assertions are therefore re-expressed below as SELECTs that RETURN a verdict
-- column. Same checks, same thresholds, same failure conditions; a shape the
-- reader can actually see.
--
-- ⚠ The DO-block probe remains the artefact of record for a psql run. This file
-- does not replace it; it is the same test for a different transport, and both
-- must agree. If they ever disagree, that is a finding.
--
-- ───────────────────────────────────────────────────────────────────────────
-- HOW TO READ IT
--
-- Every block returns a `verdict` column: PASS or FAIL. **The gate is that all
-- seven blocks read PASS.** Nothing here raises, so a FAIL does not stop the
-- script — read every block, do not stop at the first green one.
--
-- Blocks can be run one at a time or pasted whole. Each carries its own UTC
-- timestamp, because a negative statement is only true at the moment it is made.
--
-- ⚠ RUN THIS BEFORE THE HOME CARD IS SWITCHED TO v3. A green run is a
-- precondition of the behaviour step, not a report on it.
--
-- ⚠ THIS FILE WAS SHOWN FAILING BEFORE IT WAS ACCEPTED (C-34). Run on a
-- fixture built from staging's own catalogue shape — staging's default-privilege
-- rule, the same helper posture, v2 present — with the real migration file
-- applied verbatim, 2026-09-03:
--
--   all seven blocks green                                    → 9 PASS, 0 FAIL
--   PUBLIC left on v3 (the REVOKE omitted)                    → BLOCK 2 FAIL
--   `WHERE rk.pos <= 3` removed                               → BLOCK 3 FAIL,
--                                                                BLOCK 7 FAIL on
--                                                                every extra row
--   contributor_points_since granted to anon                  → BLOCK 5 FAIL
--   get_top_contributors_v2 renamed away                      → BLOCK 6 returns
--                                                                zero rows
--
-- A check that has never been seen to fail is not a control.
--
-- WHAT IT DOES NOT PROVE, stated so no one reads more into a green run:
--   * it does not call v3 over HTTP as an anonymous browser would, so PostgREST's
--     own exposure rules are untested;
--   * it does not prove the Home card renders — that is D2's half, and a browser
--     question (F-53: curl is not a browser);
--   * it says nothing about production. Staging and production are different
--     databases with different default-privilege rules (see block 2).
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 1 · THE pg_proc ROW — does v3 exist, and is it the frozen shape?
--
-- prorettype is 2249 (pg_catalog.record) for any RETURNS TABLE function, so the
-- type oid alone proves nothing. What identifies the shape is proretset (t = it
-- returns a set), pronargs (0 = no arguments, which is the reason there is no
-- parameter to point at a member), and the rendered signature.
--
-- Expected, per docs/gates/TC-v3-interface.md §2.2:
--   TABLE(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- ───────────────────────────────────────────────────────────────────────────
SELECT 'BLOCK 1 · pg_proc row and frozen signature'          AS check,
       p.oid                                                  AS oid,
       p.proname                                              AS name,
       p.prorettype                                           AS prorettype_oid,
       p.prorettype::regtype::text                            AS prorettype_name,
       p.proretset                                            AS returns_set,
       p.pronargs                                             AS n_arguments,
       p.proargnames                                          AS output_column_names,
       pg_get_function_result(p.oid)                          AS returns,
       l.lanname                                              AS language,
       p.provolatile::text                                    AS volatility,
       p.prosecdef                                            AS security_definer,
       p.proconfig                                            AS config,
       pg_get_userbyid(p.proowner)                            AS owner,
       CASE WHEN pg_get_function_result(p.oid) =
                 'TABLE(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)'
             AND l.lanname = 'sql'
             AND p.provolatile = 's'
             AND p.prosecdef
             AND p.proconfig @> ARRAY['search_path=public']
             AND p.pronargs = 0
            THEN 'PASS' ELSE 'FAIL' END                       AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                  AS measured_at_utc
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'get_top_contributors_v3';
-- Zero rows here is itself a FAIL: the function does not exist and the apply
-- did not take.


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 2 · proacl — the F-62 / F-66 check, and the one most likely to surprise
--
-- PREDICTED, and this was measured on a fixture built from staging's OWN
-- default-privilege rule rather than assumed:
--
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- service_role is in that list and the migration never mentions it. It arrives
-- from pg_default_acl. Staging carries TWO entries for public/functions — one
-- granted by supabase_admin, one by postgres — and the one that applies is the
-- grantor matching the creating role, i.e. postgres:
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- read from staging 2026-09-03 10:54:39Z. Production's differs (no postgres=X),
-- which is why this file predicts from staging's rule and not production's.
--
-- ⚠ THE LEADING `=X` MUST BE ABSENT. That is PUBLIC. Every function created in
-- this schema is born with it (F-66: ALTER DEFAULT PRIVILEGES ADDS TO the
-- built-in default rather than replacing it), and the migration's
-- `REVOKE ALL ... FROM public` is what removes it. If `=X` is still present the
-- revoke did not run, and a later `REVOKE ... FROM anon` on this function would
-- be a no-op (F-62).
-- ───────────────────────────────────────────────────────────────────────────
SELECT 'BLOCK 2 · proacl, PUBLIC absent, three roles present' AS check,
       coalesce(p.proacl::text, 'NULL')                       AS proacl,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE')  AS public_holds_execute,
       has_function_privilege('anon',         p.oid, 'EXECUTE')        AS anon_execute,
       has_function_privilege('authenticated',p.oid, 'EXECUTE')        AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE')        AS service_role_execute,
       '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
                                                              AS expected_proacl,
       CASE WHEN NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                              WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE')
             AND has_function_privilege('anon',          p.oid, 'EXECUTE')
             AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END                       AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                  AS measured_at_utc
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'get_top_contributors_v3';


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 3 · A1 — THE ROW CAP.  The one predicate that stands between a public
-- card and a full leaderboard dump.
--
-- Shown catching its own defect before it was accepted: with `WHERE rk.pos <= 3`
-- removed, production returned 44 rows instead of 3 — 41 members' recent and
-- lifetime scores to anonymous callers, from one dropped line (2026-09-03
-- 08:46:15Z). `would_be_exposed` below is that same denominator, so a PASS is
-- interpretable rather than merely green.
-- ───────────────────────────────────────────────────────────────────────────
SELECT 'BLOCK 3 · A1 row cap'                                 AS check,
       (SELECT count(*) FROM public.get_top_contributors_v3())            AS rows_returned,
       3                                                                   AS cap,
       (SELECT count(*) FROM public.contributor_points_since(
               ((now() AT TIME ZONE 'UTC')::date - 29)) r WHERE r.score > 0) AS members_above_zero,
       GREATEST((SELECT count(*) FROM public.contributor_points_since(
               ((now() AT TIME ZONE 'UTC')::date - 29)) r WHERE r.score > 0)
                - (SELECT count(*) FROM public.get_top_contributors_v3()), 0) AS would_be_exposed_without_cap,
       CASE WHEN (SELECT count(*) FROM public.get_top_contributors_v3()) BETWEEN 1 AND 3
            THEN 'PASS' ELSE 'FAIL' END                        AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                   AS measured_at_utc;
-- 0 rows is a FAIL too, not a safe result: if members rank above zero and the
-- card is empty, the function is broken rather than restrictive.


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 4 · A2 — NO PERSONALISATION.  The cross-member half of the gate.
--
-- Runs v3 three times inside ONE statement under three different jwt claims —
-- member A, an outsider who is not on the card, and anon — and compares the
-- fingerprints. If any differ, one member is learning something about another
-- that the public card does not already show.
--
-- set_config(..., true) is transaction-local, so the claims revert when the
-- statement's implicit transaction ends. Nothing is left set.
-- ───────────────────────────────────────────────────────────────────────────
WITH ids AS (
  SELECT (SELECT t.user_id FROM public.get_top_contributors_v3() t
           WHERE t.rank_position = 1)                                     AS member_a,
         (SELECT pr.id FROM public.profiles pr
           WHERE pr.id NOT IN (SELECT t2.user_id FROM public.get_top_contributors_v3() t2)
           ORDER BY pr.id LIMIT 1)                                        AS outsider
),
as_anon AS (
  SELECT set_config('request.jwt.claims',
                    json_build_object('role','anon')::text, true) AS s
),
fp_anon AS (
  SELECT string_agg(t.user_id::text||':'||t.rank_position||':'||t.contributor_score||':'||t.recent_score,
                    ',' ORDER BY t.rank_position) AS fp
    FROM as_anon, public.get_top_contributors_v3() t
),
as_a AS (
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', (SELECT member_a FROM ids),
                                      'role','authenticated')::text, true) AS s
),
fp_a AS (
  SELECT string_agg(t.user_id::text||':'||t.rank_position||':'||t.contributor_score||':'||t.recent_score,
                    ',' ORDER BY t.rank_position) AS fp
    FROM as_a, public.get_top_contributors_v3() t
),
as_b AS (
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', coalesce((SELECT outsider FROM ids),
                                                      (SELECT member_a FROM ids)),
                                      'role','authenticated')::text, true) AS s
),
fp_b AS (
  SELECT string_agg(t.user_id::text||':'||t.rank_position||':'||t.contributor_score||':'||t.recent_score,
                    ',' ORDER BY t.rank_position) AS fp
    FROM as_b, public.get_top_contributors_v3() t
),
reset AS (SELECT set_config('request.jwt.claims','',true) AS s)
SELECT 'BLOCK 4 · A2 caller independence'                     AS check,
       (SELECT fp FROM fp_anon) = (SELECT fp FROM fp_a)        AS anon_equals_member_a,
       (SELECT fp FROM fp_a)    = (SELECT fp FROM fp_b)        AS member_a_equals_outsider,
       left((SELECT fp FROM fp_a), 80) || '…'                  AS fingerprint_prefix,
       CASE WHEN (SELECT fp FROM fp_anon) IS NOT DISTINCT FROM (SELECT fp FROM fp_a)
             AND (SELECT fp FROM fp_a)    IS NOT DISTINCT FROM (SELECT fp FROM fp_b)
             AND (SELECT fp FROM fp_a) IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END                        AS verdict,
       (SELECT s FROM reset) IS NOT NULL                       AS claims_reset,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                   AS measured_at_utc;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 5 · A3 — THE HELPER STAYS SHUT.
--
-- contributor_points_since returns EVERY eligible member's score for any date
-- the caller chooses. v3 reaches it only because v3 is SECURITY DEFINER. If this
-- ever reads executable, the leaderboard has become an enumeration endpoint for
-- the whole membership.
--
-- Checked through has_function_privilege, which follows PUBLIC as well as named
-- grants — the F-62 lesson: reading proacl for a role name misses the PUBLIC
-- path entirely. Staging measured 2026-09-03 10:54:18Z:
-- proacl {postgres=X/postgres,service_role=X/postgres}, anon false.
-- ───────────────────────────────────────────────────────────────────────────
SELECT 'BLOCK 5 · A3 helper not directly callable'            AS check,
       coalesce(p.proacl::text,'NULL')                        AS helper_proacl,
       has_function_privilege('anon',          p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid,'EXECUTE') AS authenticated_execute,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) x
                WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') AS public_holds_execute,
       CASE WHEN NOT has_function_privilege('anon',          p.oid,'EXECUTE')
             AND NOT has_function_privilege('authenticated', p.oid,'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END                       AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                  AS measured_at_utc
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'contributor_points_since';


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 6 · A5 — v2 IS INTACT AND STILL THE ROLLBACK.  F-64 applies: no DROP
-- of v2, and v2 must remain anon-executable or the rollback path is broken.
--
-- The migration does not touch v2 at all. This block proves that from the
-- catalogue rather than from the file.
-- ───────────────────────────────────────────────────────────────────────────
SELECT 'BLOCK 6 · A5 v2 intact, rollback path alive'          AS check,
       p.proname                                              AS name,
       pg_get_function_result(p.oid)                          AS returns,
       p.provolatile::text                                    AS volatility,
       p.prosecdef                                            AS security_definer,
       coalesce(p.proacl::text,'NULL')                        AS proacl,
       has_function_privilege('anon', p.oid,'EXECUTE')        AS anon_execute,
       CASE WHEN pg_get_function_result(p.oid) =
                 'TABLE(user_id uuid, rank_position integer, contributor_score integer)'
             AND has_function_privilege('anon', p.oid,'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END                       AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                  AS measured_at_utc
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'get_top_contributors_v2';
-- Zero rows = FAIL. v2 is gone and the rollback path with it.


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 7 · THE EQUIVALENCE PROOF, interface §2.5 — v2 and v3 side by side.
--
-- **The same three user_ids in the same order.** If the order differs, that is a
-- finding to report, NOT something to tune until it matches. The lifetime column
-- must be identical too: v3 copied v2's ranking and lifetime logic unchanged and
-- only added a column.
--
-- recent_score is the new column and has no v2 counterpart, so it is shown for
-- the record rather than compared. On production 2026-09-03 08:45:05Z the three
-- were 7055 / 6978 / 6823 against lifetimes 9551 / 8888 / 11546 — the bronze
-- position holding the largest lifetime figure, which is the ruling's own
-- justification. Staging's numbers will differ; the ORDER is what must match.
-- ───────────────────────────────────────────────────────────────────────────
WITH v2 AS (SELECT * FROM public.get_top_contributors_v2()),
     v3 AS (SELECT * FROM public.get_top_contributors_v3())
SELECT 'BLOCK 7 · equivalence, §2.5'                          AS check,
       coalesce(v2.rank_position, v3.rank_position)           AS pos,
       v2.user_id::text                                       AS v2_user_id,
       v3.user_id::text                                       AS v3_user_id,
       (v2.user_id IS NOT DISTINCT FROM v3.user_id)           AS same_user,
       v2.contributor_score                                   AS v2_lifetime,
       v3.contributor_score                                   AS v3_lifetime,
       (v2.contributor_score IS NOT DISTINCT FROM v3.contributor_score) AS same_lifetime,
       v3.recent_score                                        AS v3_recent_30d,
       CASE WHEN v2.user_id IS NOT DISTINCT FROM v3.user_id
             AND v2.contributor_score IS NOT DISTINCT FROM v3.contributor_score
            THEN 'PASS' ELSE 'FAIL' END                       AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                  AS measured_at_utc
  FROM v2 FULL OUTER JOIN v3 ON v3.rank_position = v2.rank_position
 ORDER BY 2;
-- Every row must read PASS. A NULL on either side means one function returned a
-- position the other did not — the ranking moved, and that is the finding §2.5
-- names.


-- ═══════════════════════════════════════════════════════════════════════════
-- THE GATE: blocks 1–7 all read PASS, and block 7 shows three rows with
-- same_user and same_lifetime true on every one.
--
-- If any block reads FAIL, the rollback is
-- supabase/rollback/20260903090000_top_contributors_v3_ROLLBACK.sql — and read
-- its header first: CLIENT FIRST, DATABASE SECOND. v2 is untouched by this
-- apply, so reverting the Home card to v2 is the whole rollback for anything a
-- member can see, with this file's DROP never run.
-- ═══════════════════════════════════════════════════════════════════════════
