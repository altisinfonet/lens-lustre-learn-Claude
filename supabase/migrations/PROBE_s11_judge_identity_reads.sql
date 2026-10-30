-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S11 judging — who can read a judge's identity (staging and production).
-- READ ONLY, ENDS IN ROLLBACK. Counts and policy names only — never an id,
-- a score, a comment or a member's name.
--
-- Finding under test (S11 list): "an entry owner can read raw judge_id from
-- judge_scores / judge_comments". The client reads judge_scores directly for
-- the owner's dashboard, SubmissionDetail and PublicProfile; comments go
-- through judge_comments_owner_safe. This reports, per lane:
--   1. every SELECT policy on the judge tables and the roles it applies to;
--   2. table / column SELECT privileges for anon and authenticated;
--   3. which *_owner_safe views exist and whether they expose judge_id;
--   4. as a REAL entry owner (non-judge, non-admin, owns an entry that has at
--      least one score): rows readable from judge_scores / judge_comments and
--      how many of them carry a non-null judge_id;
--   5. the same reads as anon.
-- It never fails on what it finds — it measures. FAILS only if the lane is
-- not asserted or judge_scores is missing.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE
  r record; line text := ''; owner_id uuid; n int; n_id int; t text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.judge_scores') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.judge_scores missing';
  END IF;

  -- 1. SELECT / ALL policies
  FOR r IN
    SELECT tablename, policyname, cmd, permissive, array_to_string(roles, ',') AS roles
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('judge_scores', 'judge_comments', 'judge_decisions', 'judge_tag_assignments')
       AND cmd IN ('SELECT', 'ALL')
     ORDER BY tablename, policyname
  LOOP
    line := line || format(E'\n  policy %-22s %-6s %-11s [%s] %s', r.tablename, r.cmd, r.permissive, r.roles, r.policyname);
  END LOOP;

  -- 2. privileges
  FOREACH t IN ARRAY ARRAY['judge_scores', 'judge_comments', 'judge_decisions', 'judge_tag_assignments'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    line := line || format(E'\n  grant  %-22s anon table=%s judge_id=%s · authenticated table=%s judge_id=%s', t,
      has_table_privilege('anon', 'public.' || t, 'SELECT'),
      has_column_privilege('anon', 'public.' || t, 'judge_id', 'SELECT'),
      has_table_privilege('authenticated', 'public.' || t, 'SELECT'),
      has_column_privilege('authenticated', 'public.' || t, 'judge_id', 'SELECT'));
  END LOOP;

  -- 3. owner-safe views
  FOR r IN
    SELECT c.relname,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'judge_id' AND NOT a.attisdropped) AS has_judge_id,
           has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_sel,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'judge%owner_safe'
     ORDER BY c.relname
  LOOP
    line := line || format(E'\n  view   %-34s judge_id column=%s authenticated=%s anon=%s', r.relname, r.has_judge_id, r.auth_sel, r.anon_sel);
  END LOOP;

  -- 4. as a real entry owner
  SELECT ce.user_id INTO owner_id
    FROM public.competition_entries ce
    JOIN auth.users u ON u.id = ce.user_id
   WHERE EXISTS (SELECT 1 FROM public.judge_scores js WHERE js.entry_id = ce.id)
     AND NOT public.has_role(ce.user_id, 'admin'::public.app_role)
     AND NOT public.has_role(ce.user_id, 'judge'::public.app_role)
   LIMIT 1;
  IF owner_id IS NULL THEN
    line := line || E'\n  owner  (no non-judge, non-admin owner of a scored entry on this lane — owner read not measured)';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      SELECT count(*), count(*) FILTER (WHERE js.judge_id IS NOT NULL) INTO n, n_id FROM public.judge_scores js;
      line := line || format(E'\n  owner  judge_scores   rows=%s with judge_id=%s', n, n_id);
    EXCEPTION WHEN insufficient_privilege THEN
      line := line || E'\n  owner  judge_scores   refused (insufficient_privilege)';
    END;
    BEGIN
      SELECT count(*), count(*) FILTER (WHERE jc.judge_id IS NOT NULL) INTO n, n_id FROM public.judge_comments jc;
      line := line || format(E'\n  owner  judge_comments rows=%s with judge_id=%s', n, n_id);
    EXCEPTION WHEN insufficient_privilege THEN
      line := line || E'\n  owner  judge_comments refused (insufficient_privilege)';
    END;
    RESET ROLE;
  END IF;

  -- 5. anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*), count(*) FILTER (WHERE js.judge_id IS NOT NULL) INTO n, n_id FROM public.judge_scores js;
    line := line || format(E'\n  anon   judge_scores   rows=%s with judge_id=%s', n, n_id);
  EXCEPTION WHEN insufficient_privilege THEN
    line := line || E'\n  anon   judge_scores   refused (insufficient_privilege)';
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE 'JUDGE IDENTITY READS (lane %):%', current_setting('p32.lane'), line;
END
$p$;

ROLLBACK;
