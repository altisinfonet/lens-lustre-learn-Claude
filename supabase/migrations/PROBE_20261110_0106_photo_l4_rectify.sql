-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0106 rectify writer (photo plan). READ-ONLY, ENDS IN ROLLBACK.
-- PASS when
--   R1 both tables exist with RLS on and no grant to anon / authenticated;
--   R2 the three worker functions exist, SECURITY DEFINER with search_path '',
--      executable by authenticated, NOT by anon / PUBLIC, and each body refuses
--      with PHOTO-RX-001 unless media_derivative_worker_ok();
--   R3 the source-key helper is not executable by anon / authenticated and
--      reads only this lane's CDN (a large -l4 URL → its key; a small -l4, a
--      -l5, an old photo, another host → NULL);
--   R4 the queue sees exactly the large -l4 photos posts name (counted here).
-- FAIL before the apply (R1: the objects do not exist).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE _cdn text; _f text; _n bigint; _q bigint; _uid text := '11111111-2222-4333-8444-555555555555';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  -- R1
  IF to_regclass('public.photo_l4_rectify') IS NULL OR to_regclass('public.photo_l4_rectify_swap') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL R1: 20261110_0106 is not applied on this lane (tables missing)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN ('public.photo_l4_rectify'::regclass, 'public.photo_l4_rectify_swap'::regclass) AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'PROBE FAIL R1: RLS is off on a rectify table';
  END IF;
  IF has_table_privilege('anon', 'public.photo_l4_rectify', 'SELECT') OR has_table_privilege('authenticated', 'public.photo_l4_rectify', 'SELECT')
     OR has_table_privilege('anon', 'public.photo_l4_rectify_swap', 'SELECT') OR has_table_privilege('authenticated', 'public.photo_l4_rectify_swap', 'SELECT')
     OR has_table_privilege('authenticated', 'public.photo_l4_rectify', 'INSERT') OR has_table_privilege('authenticated', 'public.photo_l4_rectify_swap', 'UPDATE') THEN
    RAISE EXCEPTION 'PROBE FAIL R1: a rectify table is granted to anon or authenticated';
  END IF;
  -- R2
  FOREACH _f IN ARRAY ARRAY['public.photo_l4_rectify_queue()', 'public.photo_l4_rectify_target(uuid,integer)', 'public.photo_l4_rectify_record(uuid,integer,text)'] LOOP
    IF to_regprocedure(_f) IS NULL THEN RAISE EXCEPTION 'PROBE FAIL R2: % is missing', _f; END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(_f)) THEN RAISE EXCEPTION 'PROBE FAIL R2: % is not SECURITY DEFINER', _f; END IF;
    IF NOT coalesce((SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = to_regprocedure(_f)), false) THEN
      RAISE EXCEPTION 'PROBE FAIL R2: % has no empty search_path', _f;
    END IF;
    IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN RAISE EXCEPTION 'PROBE FAIL R2: authenticated cannot run %', _f; END IF;
    IF has_function_privilege('anon', _f, 'EXECUTE') THEN RAISE EXCEPTION 'PROBE FAIL R2: anon can run %', _f; END IF;
    IF position('media_derivative_worker_ok()' IN (SELECT pg_get_functiondef(to_regprocedure(_f)))) = 0
       OR position('PHOTO-RX-001' IN (SELECT pg_get_functiondef(to_regprocedure(_f)))) = 0 THEN
      RAISE EXCEPTION 'PROBE FAIL R2: % does not refuse non-workers (PHOTO-RX-001)', _f;
    END IF;
  END LOOP;
  -- R3
  IF has_function_privilege('anon', 'public.photo_l4_rectify_source_key(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_l4_rectify_source_key(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL R3: the source-key helper is executable by anon/authenticated';
  END IF;
  _cdn := public.photo_set_backfill_cdn();
  IF public.photo_l4_rectify_source_key('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w2048h1365-l4.webp')
       IS DISTINCT FROM 'post-images/' || _uid || '/posts/1762-abc-w2048h1365-l4.webp'
     OR public.photo_l4_rectify_source_key('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w1000h667-l4.webp') IS NOT NULL
     OR public.photo_l4_rectify_source_key('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w1080h720-l5.webp') IS NOT NULL
     OR public.photo_l4_rectify_source_key('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w2048h1365-l4-r1080.webp') IS NOT NULL
     OR public.photo_l4_rectify_source_key('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w1920h1280-l3.webp') IS NOT NULL
     OR public.photo_l4_rectify_source_key('https://evil.example.com/post-images/' || _uid || '/posts/1762-abc-w2048h1365-l4.webp') IS NOT NULL
     OR public.photo_l4_rectify_source_key('https://' || _cdn || '/avatars/' || _uid || '/posts/1762-abc-w2048h1365-l4.webp') IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL R3: the source-key helper accepts or refuses the wrong URLs on %', _cdn;
  END IF;
  -- R4 (counts only — no member data)
  SELECT count(*) INTO _n FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY u(url, i)
   WHERE u.i <= 50 AND public.photo_l4_rectify_source_key(u.url) IS NOT NULL;
  SELECT count(*) INTO _q FROM public.photo_l4_rectify;
  RAISE NOTICE 'rectify (lane %, cdn %): large -l4 photos named by posts=% · recorded=% · repointed posts=%',
    current_setting('p32.lane'), _cdn, _n, _q, (SELECT count(*) FROM public.photo_l4_rectify_swap);
  RAISE NOTICE 'PROBE PASS: 20261110_0106 — writer functions gated, tables closed, helper reads only this lane (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
