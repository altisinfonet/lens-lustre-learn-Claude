-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0614 — S10 X1 heavy-write tables (staging and production).
-- READ ONLY, ROLLBACK. Prints counts and table names only (public log).
-- FAILS before 0614 (activity_logs and feed_events have duplicate permissive policies);
-- PASSES after.
--   G0 · lane asserted.
--   G1 · public.activity_logs and public.feed_events exist with RLS on.
--   G2 · neither has two permissive policies for the same action.
--   G3 · their only permissive policies are the x1_merged_* ones.
--   G4 · the policy backup exists, holds this batch, and is owner-only
--        (owner postgres, no other grantee — not even service_role).
--   G5 · each has at least one x1_merged_* policy, and the merged actions are
--        exactly the actions its backed-up original policies granted (so a
--        table left with no permissive policy — everyone denied — fails).
--   G6 · each merged policy is granted to exactly the originals' role set.
--        (Shape only: the access proof is the migration's E1/BIND/E2.)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  tables constant text[] := ARRAY['activity_logs', 'feed_events'];
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
    EXECUTE 'SELECT count(*) FROM public.x1_policy_backup_20261031 WHERE batch = $1' INTO backup_rows USING '0614_heavy';
    IF backup_rows = 0 THEN _bad := _bad || ' G4(backup holds no 0614_heavy rows)'; END IF;
    IF (SELECT c0.relowner FROM pg_class c0 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass) <> 'postgres'::regrole
       OR EXISTS (SELECT 1 FROM pg_class c0, aclexplode(c0.relacl) x
                   WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass AND x.grantee <> c0.relowner) THEN
      _bad := _bad || ' G4(backup is not owner-only: owner postgres, no other grantee)';
    END IF;
  END IF;

  -- nested so the backup table is only named once it is known to exist
  IF backup_rows > 0 THEN
    FOREACH t IN ARRAY tables LOOP
      rel := to_regclass(format('public.%I', t));
      CONTINUE WHEN rel IS NULL;
      IF (NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel
                        AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%')
         OR (SELECT array_agg(DISTINCT a2 ORDER BY a2) FROM public.x1_policy_backup_20261031 bk, unnest(ARRAY['r', 'a', 'w', 'd']) a2
              WHERE bk.batch = '0614_heavy' AND bk.tbl = t AND (bk.cmd = '*' OR bk.cmd = a2))
            IS DISTINCT FROM
            (SELECT array_agg(p.polcmd::text ORDER BY p.polcmd::text) FROM pg_policy p
              WHERE p.polrelid = rel AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%')) THEN
        _bad := _bad || format(' G5(%s: merged policies missing or their actions differ from the backed-up originals)', t);
      END IF;
      -- G6 · every merged policy is granted to exactly the role set of the originals
      IF EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = rel AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%'
                    AND (CASE WHEN p.polroles = '{0}'::oid[] THEN ARRAY['PUBLIC']
                              ELSE (SELECT array_agg(rr.rolname::text ORDER BY rr.rolname) FROM pg_roles rr WHERE rr.oid = ANY (p.polroles)) END)
                        IS DISTINCT FROM (SELECT bk.roles FROM public.x1_policy_backup_20261031 bk
                                           WHERE bk.batch = '0614_heavy' AND bk.tbl = t LIMIT 1))
         OR (SELECT count(DISTINCT bk.roles) FROM public.x1_policy_backup_20261031 bk
              WHERE bk.batch = '0614_heavy' AND bk.tbl = t) <> 1 THEN
        _bad := _bad || format(' G6(%s: merged policies are not granted to the original role set)', t);
      END IF;
    END LOOP;
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0614 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0614 (lane %): activity_logs and feed_events have one permissive policy per action (x1_merged_*), 0 duplicates; backup holds % original policies, no member access',
    current_setting('p32.lane'), backup_rows;
END
$probe$;

ROLLBACK;
