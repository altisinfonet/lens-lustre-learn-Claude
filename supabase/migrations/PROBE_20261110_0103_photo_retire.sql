-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0103 photo retire (photo plan U6). ENDS IN ROLLBACK.
-- Reports FIRST (the measurement U6 rests on): competitions, how many have
-- FINAL results (round 4 published) and since when, entry photos that are v2
-- full-size files, how many are due now, the retire list by state, the switch.
-- A · catalog: switch row 'off' and allowed by the check; photo_retire RLS on,
--     nothing granted to anon / authenticated; mark / claim / done SECURITY
--     DEFINER search_path="", authenticated only (not anon, not PUBLIC);
--     helpers executable by no client role; the daily job is scheduled exactly.
-- B · behaviour (simulated callers, rolled back): a plain member is refused
--     PHOTO-RT-001 by mark and claim; anon cannot execute; an admin's dry run
--     and an admin's "run" while the switch is off change nothing.
-- C · the reference scan finds a key that a live post names (when one exists).
-- Before the apply it FAILS at the first missing object (expected).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE
  _mode text; _x uuid := gen_random_uuid(); _admin uuid; _err text; _j jsonb; _n bigint; _m bigint; _k text;
  _comps bigint; _final bigint; _v2 bigint; _first timestamptz; _last timestamptz;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- ── report ────────────────────────────────────────────────────────────────
  SELECT count(*) INTO _comps FROM public.competitions;
  SELECT count(DISTINCT crp.competition_id), min(crp.published_at), max(crp.published_at) INTO _final, _first, _last
    FROM public.competition_round_publish crp WHERE crp.round_number = 4 AND crp.published_at IS NOT NULL;
  SELECT count(*) INTO _v2 FROM public.competition_entries e CROSS JOIN LATERAL unnest(e.photos) u(url)
   WHERE u.url ~ '-w[0-9]{1,5}h[0-9]{1,5}-l4f\.webp(\?.*)?$';
  RAISE NOTICE 'U6 measure (lane %): competitions=% · results final (round 4 published)=% (first %, last %) · v2 full-size entry photos=% · entry photos in total=%',
    current_setting('p32.lane'), _comps, _final, _first, _last, _v2,
    (SELECT count(*) FROM public.competition_entries e CROSS JOIN LATERAL unnest(e.photos) u(url));

  IF to_regclass('public.photo_retire') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL A1: photo_retire missing (0103 not applied)';
  END IF;
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'competition_fullsize_purge';
  RAISE NOTICE 'switch competition_fullsize_purge=% · retire list: due=% kept=% deleted=% (bytes %)', coalesce(_mode, '<none>'),
    (SELECT count(*) FROM public.photo_retire WHERE state = 'due'), (SELECT count(*) FROM public.photo_retire WHERE state = 'kept'),
    (SELECT count(*) FROM public.photo_retire WHERE state = 'deleted'), (SELECT coalesce(sum(bytes), 0) FROM public.photo_retire WHERE state = 'deleted');

  -- ── A · catalog ───────────────────────────────────────────────────────────
  IF _mode IS DISTINCT FROM 'off' THEN RAISE EXCEPTION 'PROBE FAIL A2: competition_fullsize_purge is % (want off)', coalesce(_mode, '<no row>'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feature_access'::regclass
                  AND conname = 'feature_access_feature_check' AND pg_get_constraintdef(oid) ~ '''competition_fullsize_purge''') THEN
    RAISE EXCEPTION 'PROBE FAIL A3: feature_access_feature_check does not allow competition_fullsize_purge';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.photo_retire'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL A4: RLS is not on for photo_retire';
  END IF;
  IF has_table_privilege('anon', 'public.photo_retire', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.photo_retire', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'PROBE FAIL A5: anon/authenticated hold a privilege on photo_retire';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.oid IN (to_regprocedure('public.competition_fullsize_mark(boolean)'),
                       to_regprocedure('public.photo_retire_claim(integer,text,bigint)'),
                       to_regprocedure('public.photo_retire_done(bigint,bigint)'))
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) <> 3 THEN
    RAISE EXCEPTION 'PROBE FAIL A6: mark / claim / done missing or not SECURITY DEFINER search_path=""';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN ('public.competition_fullsize_mark(boolean)'::regprocedure, 'public.photo_retire_claim(integer,text,bigint)'::regprocedure,
                              'public.photo_retire_done(bigint,bigint)'::regprocedure, 'public.photo_retire_referenced(text[])'::regprocedure,
                              'public.competition_results_final_at(uuid)'::regprocedure, 'public.photo_retire_cdn()'::regprocedure)
                AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PROBE FAIL A7: PUBLIC can execute a retire function';
  END IF;
  IF has_function_privilege('anon', 'public.competition_fullsize_mark(boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_retire_claim(integer,text,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_retire_done(bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_retire_referenced(text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.competition_results_final_at(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_retire_cdn()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.photo_retire_claim(integer,text,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.photo_retire_done(bigint,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.competition_fullsize_mark(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL A8: a retire function has the wrong EXECUTE grants';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'competition-fullsize-retire' AND schedule = '10 4 * * *'
        AND command = 'SELECT public.competition_fullsize_mark(false)' AND active) <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL A9: the daily job competition-fullsize-retire is missing or not exactly as written';
  END IF;
  IF public.photo_retire_cdn() IS DISTINCT FROM (CASE current_setting('p32.lane') WHEN 'production' THEN 'cdn.50mmretina.com' ELSE 'cdn-staging.50mmretina.com' END) THEN
    RAISE EXCEPTION 'PROBE FAIL A10: the CDN host % is not this lane''s', public.photo_retire_cdn();
  END IF;

  -- ── B · behaviour ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _x::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.competition_fullsize_mark(true);
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-RT-001%' THEN RAISE EXCEPTION 'PROBE FAIL B1: a plain member could mark (%)', _err; END IF;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM * FROM public.photo_retire_claim(1, NULL);
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-RT-001%' THEN RAISE EXCEPTION 'PROBE FAIL B2: a plain member could read the retire list (%)', _err; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.photo_retire_done(1, 1);
    _err := 'no error';
  EXCEPTION WHEN insufficient_privilege THEN _err := 'refused';
  END;
  RESET ROLE;
  IF _err <> 'refused' THEN RAISE EXCEPTION 'PROBE FAIL B3: anon could record a deletion'; END IF;

  SELECT ur.user_id INTO _admin FROM public.user_roles ur WHERE ur.role::text = 'admin' ORDER BY ur.created_at LIMIT 1;
  IF _admin IS NULL THEN
    RAISE NOTICE 'B4–B5 skipped: no admin on this lane';
  ELSE
    SELECT count(*) INTO _n FROM public.photo_retire;
    SELECT count(*) INTO _m FROM public.competition_entries e CROSS JOIN LATERAL unnest(e.photos) u(url) WHERE u.url ~ '-l4f-r2048\.webp';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', _admin::text, true);
    SET LOCAL ROLE authenticated;
    _j := public.competition_fullsize_mark(true);
    RESET ROLE;
    RAISE NOTICE 'dry run (lane %): %', current_setting('p32.lane'), _j;
    IF NOT (_j ->> 'dry_run')::boolean THEN RAISE EXCEPTION 'PROBE FAIL B4: a dry run did not say so (%)', _j; END IF;
    SET LOCAL ROLE authenticated;
    _j := public.competition_fullsize_mark(false);
    RESET ROLE;
    IF NOT (_j ->> 'dry_run')::boolean
       OR (SELECT count(*) FROM public.photo_retire) <> _n
       OR (SELECT count(*) FROM public.competition_entries e CROSS JOIN LATERAL unnest(e.photos) u(url) WHERE u.url ~ '-l4f-r2048\.webp') <> _m THEN
      RAISE EXCEPTION 'PROBE FAIL B5: a "run" while the switch is off changed something (%)', _j;
    END IF;
  END IF;

  -- ── C · the reference scan ────────────────────────────────────────────────
  SELECT (regexp_match(u.url, '((?:post-images)/[0-9a-f-]{36}/[A-Za-z0-9_./-]+?\.webp)'))[1] INTO _k
    FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) u(url)
   WHERE u.url ~ '/post-images/[0-9a-f-]{36}/' LIMIT 1;
  IF _k IS NULL THEN
    RAISE NOTICE 'C skipped: no post-images photo on this lane';
  ELSIF NOT EXISTS (SELECT 1 FROM public.photo_retire_referenced(ARRAY[_k, 'post-images/00000000-0000-4000-8000-000000000000/never.webp']) f
                     WHERE f.object_key = _k AND f.found_in LIKE 'posts.%') THEN
    RAISE EXCEPTION 'PROBE FAIL C1: the reference scan does not see a key a live post names';
  ELSIF EXISTS (SELECT 1 FROM public.photo_retire_referenced(ARRAY['post-images/00000000-0000-4000-8000-000000000000/never.webp'])) THEN
    RAISE EXCEPTION 'PROBE FAIL C2: the reference scan names a key nothing holds';
  END IF;

  RAISE NOTICE 'PROBE PASS: 20261110_0103 photo retire — switch off, catalog, refusals, dry run, reference scan hold on %', current_setting('p32.lane');
END
$p$;

ROLLBACK;
