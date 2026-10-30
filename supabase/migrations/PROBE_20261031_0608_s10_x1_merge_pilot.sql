-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0608 — S10 X1 pilot (staging and production).
-- READ ONLY, ROLLBACK. Prints counts and table names only (public log).
-- FAILS before 0608 (the 9 pilot tables have duplicate permissive policies);
-- PASSES after.
--   G0 · lane asserted.
--   G1 · the 9 pilot tables exist with RLS on.
--   G2 · none has two permissive policies for the same (role, action).
--   G3 · their only permissive policies are the x1_merged_* ones.
--   G4 · the policy backup exists, holds this batch, and is not readable by
--        anon or authenticated.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  tables constant text[] := ARRAY['blocked_keywords', 'categories', 'certificate_testimonials', 'courses',
                                  'gift_announcements', 'hero_banners', 'journal_articles', 'lessons',
                                  'photo_of_the_day'];
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
    EXECUTE 'SELECT count(*) FROM public.x1_policy_backup_20261031 WHERE batch = $1' INTO backup_rows USING '0608_pilot';
    IF backup_rows = 0 THEN _bad := _bad || ' G4(backup holds no 0608_pilot rows)'; END IF;
    IF has_table_privilege('anon', 'public.x1_policy_backup_20261031', 'SELECT')
       OR has_table_privilege('authenticated', 'public.x1_policy_backup_20261031', 'SELECT') THEN
      _bad := _bad || ' G4(backup readable by anon/authenticated)';
    END IF;
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0608 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0608 (lane %): 9 pilot tables have one permissive policy per action (x1_merged_*), 0 duplicates; backup holds % original policies, no member access',
    current_setting('p32.lane'), backup_rows;
END
$probe$;

ROLLBACK;
