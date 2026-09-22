/* ═══════════════════════════════════════════════════════════════════════════
   TC-v3 · POST-APPLY VERIFICATION — PRODUCTION jtdtehuqtinjxropkkcn.
   SELECT ONLY. WRITES NOTHING. Safe to run any number of times.

   Run immediately after v3_PRODUCTION_paste.sql commits on production.

   ───────────────────────────────────────────────────────────────────────────
   WHY EVERY COMMENT IN THIS FILE IS A BLOCK COMMENT

   The Supabase SQL editor swallowed a leading double-hyphen on paste today,
   which turns a comment line into executable garbage. A block comment has no
   leading-marker to lose: if any character inside it is mangled the text is
   still inside the comment. So this file uses block comments exclusively and
   contains no line comments at all.

   Its companion, v3_PRODUCTION_paste.sql, carries no comments whatsoever as
   the Auditor instructed. That instruction can be relaxed if wanted: the same
   block-comment treatment would restore its header safely. Said here rather
   than acted on unilaterally.

   ───────────────────────────────────────────────────────────────────────────
   HOW TO READ IT

   Every block returns a verdict column: PASS or FAIL. THE GATE IS THAT ALL
   EIGHT BLOCKS READ PASS. Nothing here raises, so a FAIL does not stop the
   script. Read every block. Do not stop at the first green one.

   Each block carries its own UTC timestamp, because a negative statement is
   only true at the moment it is made.

   RUN THIS BEFORE THE HOME CARD IS SWITCHED TO v3. A green run is a
   precondition of the behaviour step, not a report on it.

   ───────────────────────────────────────────────────────────────────────────
   WHAT CHANGED FROM THE STAGING FILE, AND WHY

   This is verify-after-apply.sql adapted, not copied. Three real differences:

     1. BLOCK 0 is new. It asserts the cluster fingerprint, because this file
        and its paste companion are the only production-lane artefacts in this
        unit and pasting into the wrong project is the failure that costs most.
     2. BLOCK 2 predicts from PRODUCTION's default-privilege rule, which is not
        staging's. Production carries ONE entry for public functions, granted by
        postgres. Staging carries two. Predicting production from staging's rule
        would give a wrong expected string. Read 2026-09-03 12:29:14Z.
     3. The reference readings quoted throughout are production's own, taken
        read-only on 2026-09-03, not staging's.

   WHAT A GREEN RUN DOES NOT PROVE, stated so nobody reads more into it:
     it does not call v3 over HTTP as an anonymous browser would, so PostgREST's
     own exposure rules are untested; it does not prove the Home card renders,
     which is D2's half and a browser question (F-53: curl is not a browser);
     and it says nothing about staging.
   ═══════════════════════════════════════════════════════════════════════════ */


/* ───────────────────────────────────────────────────────────────────────────
   BLOCK 0 · LANE. Production cluster 7656985631720456337.
   Staging is 7666007964130682852. If this reads FAIL, stop: every other block
   below is measuring the wrong database and a PASS from them means nothing.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT 'BLOCK 0 · lane is production'                          AS check,
       system_identifier::text                                 AS cluster_fingerprint,
       '7656985631720456337'                                   AS expected_production,
       '7666007964130682852'                                   AS staging_for_contrast,
       current_database()                                      AS database,
       CASE WHEN system_identifier::text = '7656985631720456337'
            THEN 'PASS' ELSE 'FAIL' END                        AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                    AS measured_at_utc
  FROM pg_control_system();


/* ───────────────────────────────────────────────────────────────────────────
   BLOCK 1 · THE pg_proc ROW — does v3 exist, and is it the frozen shape?

   prorettype is 2249 (pg_catalog.record) for any RETURNS TABLE function, so
   the type oid alone proves nothing. What identifies the shape is proretset
   (t), pronargs (0, which is why there is no parameter to point at a member),
   and the rendered signature.

   Expected, per the frozen interface:
     TABLE(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'

   Zero rows here is itself a FAIL: the function does not exist and the apply
   did not take.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT 'BLOCK 1 · pg_proc row and frozen signature'            AS check,
       p.oid                                                   AS oid,
       p.proname                                               AS name,
       p.prorettype::regtype::text                             AS prorettype_name,
       p.proretset                                             AS returns_set,
       p.pronargs                                              AS n_arguments,
       pg_get_function_result(p.oid)                           AS returns,
       l.lanname                                               AS language,
       p.provolatile::text                                     AS volatility,
       p.prosecdef                                             AS security_definer,
       p.proconfig                                             AS config,
       pg_get_userbyid(p.proowner)                             AS owner,
       CASE WHEN pg_get_function_result(p.oid) =
                 'TABLE(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)'
             AND l.lanname = 'sql'
             AND p.provolatile = 's'
             AND p.prosecdef
             AND p.proconfig @> ARRAY['search_path=public']
             AND p.pronargs = 0
            THEN 'PASS' ELSE 'FAIL' END                        AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                    AS measured_at_utc
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
 WHERE p.oid = to_regprocedure('public.get_top_contributors_v3()')::oid;


/* ───────────────────────────────────────────────────────────────────────────
   BLOCK 2 · proacl — the F-62 / F-66 check, and the one most likely to surprise.

   PREDICTED FOR PRODUCTION:
     {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

   service_role is in that list and the paste file never mentions it. It arrives
   from pg_default_acl. Production carries exactly ONE entry for public
   functions, granted by postgres, read 2026-09-03 12:29:14Z:
     {anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

   That rule ADDS TO PostgreSQL's built-in default rather than replacing it
   (F-66), so v3 is born carrying PUBLIC as well, and the paste file's
   REVOKE ALL FROM public is what removes it. The predicted string above was
   reproduced on a scratch PostgreSQL 16.13 carrying production's exact rule,
   with the paste file applied verbatim, 2026-09-03.

   THE LEADING EQUALS-SIGN ENTRY MUST BE ABSENT. That entry is PUBLIC. If it is
   still present the revoke did not run, and a later REVOKE FROM anon on this
   function would be a silent no-op (F-62).
   ─────────────────────────────────────────────────────────────────────────── */
SELECT 'BLOCK 2 · proacl, PUBLIC absent, three roles present'  AS check,
       coalesce(p.proacl::text, 'NULL')                        AS proacl,
       '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
                                                               AS expected_proacl,
       (coalesce(p.proacl::text,'NULL') =
        '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
                                                               AS matches_prediction_exactly,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE')  AS public_holds_execute,
       has_function_privilege('anon',         p.oid, 'EXECUTE')        AS anon_execute,
       has_function_privilege('authenticated',p.oid, 'EXECUTE')        AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE')        AS service_role_execute,
       CASE WHEN NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                              WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE')
             AND has_function_privilege('anon',          p.oid, 'EXECUTE')
             AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END                        AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                    AS measured_at_utc
  FROM pg_proc p
 WHERE p.oid = to_regprocedure('public.get_top_contributors_v3()')::oid;
/* matches_prediction_exactly is reported separately from the verdict on
   purpose. A mismatch there is a finding to report, not automatically a
   failure: a role added to this database since 12:29:14Z would change the
   string without weakening anything. The verdict tests the properties that
   matter. The string tests whether the world still looks the way it did. */


/* ───────────────────────────────────────────────────────────────────────────
   BLOCK 3 · A1 — THE ROW CAP. The one predicate between a public card and a
   full leaderboard dump.

   Shown catching its own defect before it was accepted: with the row cap
   removed, PRODUCTION returned 44 rows instead of 3 at 2026-09-03 08:46:15Z.
   41 members' recent and lifetime scores to anonymous callers, from one
   dropped line. would_be_exposed_without_cap below is that same denominator,
   so a PASS is interpretable rather than merely green.

   0 rows is a FAIL too, not a safe result: if members rank above zero and the
   card is empty, the function is broken rather than restrictive.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT 'BLOCK 3 · A1 row cap'                                  AS check,
       (SELECT count(*) FROM public.get_top_contributors_v3())             AS rows_returned,
       3                                                                    AS cap,
       (SELECT count(*) FROM public.contributor_points_since(
               ((now() AT TIME ZONE 'UTC')::date - 29)) r WHERE r.score > 0) AS members_above_zero,
       GREATEST((SELECT count(*) FROM public.contributor_points_since(
               ((now() AT TIME ZONE 'UTC')::date - 29)) r WHERE r.score > 0)
                - (SELECT count(*) FROM public.get_top_contributors_v3()), 0) AS would_be_exposed_without_cap,
       41                                                                   AS reference_exposure_0846z,
       CASE WHEN (SELECT count(*) FROM public.get_top_contributors_v3()) BETWEEN 1 AND 3
            THEN 'PASS' ELSE 'FAIL' END                         AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                     AS measured_at_utc;


/* ───────────────────────────────────────────────────────────────────────────
   BLOCK 4 · A2 — NO PERSONALISATION. The cross-member half of the gate.

   Runs v3 three times inside ONE statement under three different jwt claims:
   member A, an outsider who is not on the card, and anon. Then compares the
   fingerprints. If any differ, one member is learning something about another
   that the public card does not already show.

   set_config with the third argument true is transaction-local, so the claims
   revert when the statement's implicit transaction ends. Nothing is left set,
   and this block writes nothing.
   ─────────────────────────────────────────────────────────────────────────── */
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
SELECT 'BLOCK 4 · A2 caller independence'                      AS check,
       (SELECT fp FROM fp_anon) = (SELECT fp FROM fp_a)         AS anon_equals_member_a,
       (SELECT fp FROM fp_a)    = (SELECT fp FROM fp_b)         AS member_a_equals_outsider,
       left((SELECT fp FROM fp_a), 80) || '…'                   AS fingerprint_prefix,
       CASE WHEN (SELECT fp FROM fp_anon) IS NOT DISTINCT FROM (SELECT fp FROM fp_a)
             AND (SELECT fp FROM fp_a)    IS NOT DISTINCT FROM (SELECT fp FROM fp_b)
             AND (SELECT fp FROM fp_a) IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END                         AS verdict,
       (SELECT s FROM reset) IS NOT NULL                        AS claims_reset,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                     AS measured_at_utc;


/* ───────────────────────────────────────────────────────────────────────────
   BLOCK 5 · A3 — THE HELPER STAYS SHUT.

   contributor_points_since returns EVERY eligible member's score for any date
   the caller chooses. v3 reaches it only because v3 is SECURITY DEFINER. If
   this ever reads executable, the leaderboard has become an enumeration
   endpoint for the whole membership.

   Checked through has_function_privilege, which follows PUBLIC as well as
   named grants. That is the F-62 lesson: reading proacl for a role name misses
   the PUBLIC path entirely.

   Production reference, 2026-09-03 08:44:30Z:
     proacl {postgres=X/postgres,service_role=X/postgres}, anon false, authenticated false.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT 'BLOCK 5 · A3 helper not directly callable'             AS check,
       coalesce(p.proacl::text,'NULL')                         AS helper_proacl,
       has_function_privilege('anon',          p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid,'EXECUTE') AS authenticated_execute,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) x
                WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') AS public_holds_execute,
       CASE WHEN NOT has_function_privilege('anon',          p.oid,'EXECUTE')
             AND NOT has_function_privilege('authenticated', p.oid,'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END                        AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                    AS measured_at_utc
  FROM pg_proc p
 WHERE p.oid = to_regprocedure('public.contributor_points_since(date)')::oid;


/* ───────────────────────────────────────────────────────────────────────────
   BLOCK 6 · A5 — v2 IS INTACT AND STILL THE ROLLBACK.

   F-64 applies: no DROP of v2, and v2 must remain anon-executable or the
   rollback path is broken. The paste file does not touch v2 at all. This block
   proves that from the catalogue rather than from the file.

   Production reference, 2026-09-03 08:44:30Z, v2 proacl:
     {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
   The leading equals-sign entry is PUBLIC and it is EXPECTED to still be there.
   v2 is not being cleaned up by this unit, and changing it would be a change
   nobody authorised.

   Zero rows here is a FAIL. v2 is gone and the rollback path with it.
   ─────────────────────────────────────────────────────────────────────────── */
SELECT 'BLOCK 6 · A5 v2 intact, rollback path alive'           AS check,
       p.proname                                               AS name,
       pg_get_function_result(p.oid)                           AS returns,
       p.provolatile::text                                     AS volatility,
       p.prosecdef                                             AS security_definer,
       coalesce(p.proacl::text,'NULL')                         AS proacl,
       has_function_privilege('anon', p.oid,'EXECUTE')         AS anon_execute,
       CASE WHEN pg_get_function_result(p.oid) =
                 'TABLE(user_id uuid, rank_position integer, contributor_score integer)'
             AND has_function_privilege('anon', p.oid,'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END                        AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                    AS measured_at_utc
  FROM pg_proc p
 WHERE p.oid = to_regprocedure('public.get_top_contributors_v2()')::oid;


/* ───────────────────────────────────────────────────────────────────────────
   BLOCK 7 · THE EQUIVALENCE PROOF — v2 and v3 side by side.

   The same three user_ids in the same order. IF THE ORDER DIFFERS, THAT IS A
   FINDING TO REPORT, NOT SOMETHING TO TUNE UNTIL IT MATCHES. The lifetime
   column must be identical too: v3 copied v2's ranking and lifetime logic
   unchanged and only added a column.

   recent_score is the new column and has no v2 counterpart, so it is shown for
   the record rather than compared. Production reference 2026-09-03 08:45:05Z:
     pos 1 recent 7055 lifetime 9551
     pos 2 recent 6978 lifetime 8888
     pos 3 recent 6823 lifetime 11546
   The bronze position holding the largest lifetime figure is the ruling's own
   justification. Those numbers will have moved by the time this runs; the
   ORDER and the v2-to-v3 agreement are what must hold.

   Every row must read PASS. A NULL on either side means one function returned
   a position the other did not, which is the ranking moving.
   ─────────────────────────────────────────────────────────────────────────── */
WITH v2 AS (SELECT * FROM public.get_top_contributors_v2()),
     v3 AS (SELECT * FROM public.get_top_contributors_v3())
SELECT 'BLOCK 7 · equivalence'                                 AS check,
       coalesce(v2.rank_position, v3.rank_position)            AS pos,
       v2.user_id::text                                        AS v2_user_id,
       v3.user_id::text                                        AS v3_user_id,
       (v2.user_id IS NOT DISTINCT FROM v3.user_id)            AS same_user,
       v2.contributor_score                                    AS v2_lifetime,
       v3.contributor_score                                    AS v3_lifetime,
       (v2.contributor_score IS NOT DISTINCT FROM v3.contributor_score) AS same_lifetime,
       v3.recent_score                                         AS v3_recent_30d,
       CASE WHEN v2.user_id IS NOT DISTINCT FROM v3.user_id
             AND v2.contributor_score IS NOT DISTINCT FROM v3.contributor_score
            THEN 'PASS' ELSE 'FAIL' END                        AS verdict,
       to_char(clock_timestamp() AT TIME ZONE 'utc',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                    AS measured_at_utc
  FROM v2 FULL OUTER JOIN v3 ON v3.rank_position = v2.rank_position
 ORDER BY 2;


/* ═══════════════════════════════════════════════════════════════════════════
   THE GATE: blocks 0 to 7 all read PASS, and block 7 shows three rows with
   same_user and same_lifetime true on every one.

   IF ANY BLOCK READS FAIL: the rollback is a one-line frontend revert to v2.
   CLIENT FIRST, DATABASE SECOND. v2 is untouched by this apply and still
   anon-executable, so nothing has to be dropped and no SQL has to run to
   restore what a member sees. Do not drop v3 to fix a failed verification
   before the Auditor has read the failing rows: dropping it destroys the
   evidence of why it failed.
   ═══════════════════════════════════════════════════════════════════════════ */
