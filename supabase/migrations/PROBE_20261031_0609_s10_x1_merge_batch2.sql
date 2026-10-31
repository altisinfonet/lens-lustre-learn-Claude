-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0609 — S10 X1 batch 2 (staging and production).
-- READ ONLY, ROLLBACK. Prints counts and table names only (public log).
-- FAILS before 0609 (the 11 batch-2 tables have duplicate permissive policies);
-- PASSES after.
--   G0 · lane asserted.
--   G1 · the 11 batch-2 tables exist with RLS on.
--   G2 · none has two permissive policies for the same (role, action).
--   G3 · their only permissive policies are the x1_merged_* ones.
--   G4 · the policy backup exists, holds this batch, and is owner-only
--        (owner postgres, no other grantee — not even service_role).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  tables constant text[] := ARRAY['ad_creatives', 'ai_chat_usage', 'certificates', 'comment_reports', 'course_enrollments',
                                  'custom_url_history', 'post_reports', 'reports', 'support_tickets',
                                  'user_devices', 'v3_tag_label_alias'];
  _bad text := '';
  t text; rel oid; n int; dups text := ''; other text := ''; backup_rows int := 0;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    IF rel IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      _bad := _bad || format(' G1(%s missing or RLS off)', t);
      CONTINUE;
    END IF;
    SELECT count(*) INTO n FROM (
      SELECT a FROM pg_policy p, unnest(ARRAY['r', 'a', 'w', 'd']) a
       WHERE p.polrelid = rel AND p.polpermissive AND (p.polcmd = '*' OR p.polcmd::text = a)
       GROUP BY a HAVING count(*) > 1) z;
    IF n > 0 THEN dups := dups || ' ' || t; END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname NOT LIKE 'x1\_merged\_%') THEN
      other := other || ' ' || t;
    END IF;
  END LOOP;
  IF dups <> '' THEN _bad := _bad || ' G2(duplicates on:' || dups || ')'; END IF;
  IF other <> '' THEN _bad := _bad || ' G3(unmerged permissive policies on:' || other || ')'; END IF;

  IF to_regclass('public.x1_policy_backup_20261031') IS NULL THEN
    _bad := _bad || ' G4(no policy backup table)';
  ELSE
    EXECUTE 'SELECT count(*) FROM public.x1_policy_backup_20261031 WHERE batch = $1' INTO backup_rows USING '0609_batch2';
    IF backup_rows = 0 THEN _bad := _bad || ' G4(backup holds no 0609_batch2 rows)'; END IF;
    IF (SELECT c0.relowner FROM pg_class c0 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass) <> 'postgres'::regrole
       OR EXISTS (SELECT 1 FROM pg_class c0, aclexplode(c0.relacl) x
                   WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass AND x.grantee <> c0.relowner) THEN
      _bad := _bad || ' G4(backup is not owner-only: owner postgres, no other grantee)';
    END IF;
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0609 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0609 (lane %): 11 batch-2 tables have one permissive policy per action (x1_merged_*), 0 duplicates; backup holds % original policies, no member access',
    current_setting('p32.lane'), backup_rows;
END
$probe$;

ROLLBACK;
