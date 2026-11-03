-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0109 old-photo credit (photo plan). READ-ONLY, ENDS IN ROLLBACK.
-- PASS when
--   C1 photo_old_credit exists with RLS on and no grant to anon / authenticated;
--   C2 the three worker functions exist, SECURITY DEFINER with search_path '',
--      executable by authenticated, NOT by anon / PUBLIC, and each body refuses
--      with PHOTO-OC-001 unless media_derivative_worker_ok();
--   C3 the lookup post_photo_credit_for is SECURITY DEFINER, search_path '',
--      executable by anon + authenticated, gated by can_view_post and by the
--      post still naming the source URL;
--   C4 the helpers are not executable by anon / authenticated; the class helper
--      reads only this lane's CDN (old photo / avatars / Supabase storage →
--      their class; a -l4 / -l5 photo, a credited copy, another host → NULL)
--      and the key helper derives the member-folder `posts/credit/` name.
-- FAIL before the apply (C1: the table does not exist).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE _cdn text; _f text; _def text; _uid text := '11111111-2222-4333-8444-555555555555';
        _pid text := 'aaaaaaaa-0000-4000-8000-000000000001'; _n bigint; _rec bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  -- C1
  IF to_regclass('public.photo_old_credit') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL C1: 20261110_0109 is not applied on this lane (table missing)';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.photo_old_credit'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL C1: RLS is off on photo_old_credit';
  END IF;
  IF has_table_privilege('anon', 'public.photo_old_credit', 'SELECT') OR has_table_privilege('authenticated', 'public.photo_old_credit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.photo_old_credit', 'INSERT') OR has_table_privilege('authenticated', 'public.photo_old_credit', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.photo_old_credit', 'DELETE') THEN
    RAISE EXCEPTION 'PROBE FAIL C1: photo_old_credit is granted to anon or authenticated';
  END IF;
  -- C2
  FOREACH _f IN ARRAY ARRAY['public.photo_old_credit_queue(integer,uuid)', 'public.photo_old_credit_target(uuid,integer)', 'public.photo_old_credit_record(uuid,integer,text)'] LOOP
    IF to_regprocedure(_f) IS NULL THEN RAISE EXCEPTION 'PROBE FAIL C2: % is missing', _f; END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(_f)) THEN RAISE EXCEPTION 'PROBE FAIL C2: % is not SECURITY DEFINER', _f; END IF;
    IF NOT coalesce((SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = to_regprocedure(_f)), false) THEN
      RAISE EXCEPTION 'PROBE FAIL C2: % has no empty search_path', _f;
    END IF;
    IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN RAISE EXCEPTION 'PROBE FAIL C2: authenticated cannot run %', _f; END IF;
    IF has_function_privilege('anon', _f, 'EXECUTE') THEN RAISE EXCEPTION 'PROBE FAIL C2: anon can run %', _f; END IF;
    _def := pg_get_functiondef(to_regprocedure(_f));
    IF position('media_derivative_worker_ok()' IN _def) = 0 OR position('PHOTO-OC-001' IN _def) = 0 THEN
      RAISE EXCEPTION 'PROBE FAIL C2: % does not refuse non-workers (PHOTO-OC-001)', _f;
    END IF;
  END LOOP;
  -- C3
  _f := 'public.post_photo_credit_for(uuid[])';
  IF to_regprocedure(_f) IS NULL THEN RAISE EXCEPTION 'PROBE FAIL C3: the lookup is missing'; END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(_f))
     OR NOT coalesce((SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = to_regprocedure(_f)), false) THEN
    RAISE EXCEPTION 'PROBE FAIL C3: the lookup is not SECURITY DEFINER with an empty search_path';
  END IF;
  IF NOT has_function_privilege('anon', _f, 'EXECUTE') OR NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL C3: anon / authenticated cannot run the lookup';
  END IF;
  _def := pg_get_functiondef(to_regprocedure(_f));
  IF position('can_view_post(_uid, p.user_id, p.privacy)' IN _def) = 0 OR position('p.image_urls[c.ord + 1] = c.src_url' IN _def) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL C3: the lookup is not gated by can_view_post and the current source URL';
  END IF;
  -- C4
  FOREACH _f IN ARRAY ARRAY['public.photo_old_credit_class(text)', 'public.photo_old_credit_key(uuid,uuid,integer,text)'] LOOP
    IF has_function_privilege('anon', _f, 'EXECUTE') OR has_function_privilege('authenticated', _f, 'EXECUTE') THEN
      RAISE EXCEPTION 'PROBE FAIL C4: % is executable by anon/authenticated', _f;
    END IF;
  END LOOP;
  _cdn := public.photo_set_backfill_cdn();
  IF public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/1700000000-abc.webp') IS DISTINCT FROM 'photos'
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/1700000000-abc-w1920h1280-l3.webp') IS DISTINCT FROM 'photos'
     OR public.photo_old_credit_class('https://' || _cdn || '/avatars/' || _uid || '/photos/1700000000.jpg') IS DISTINCT FROM 'avatars'
     OR public.photo_old_credit_class('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/post-images/x/1.jpg') IS DISTINCT FROM 'supabase'
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w2048h1365-l4.webp') IS NOT NULL
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w1080h720-l5.webp?cv=4') IS NOT NULL
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w1080h720-l5-r2048c.webp') IS NOT NULL
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/credit/' || _pid || '-0-0123456789ab.webp') IS NOT NULL
     OR public.photo_old_credit_class('https://evil.example.com/post-images/' || _uid || '/posts/1700000000-abc.webp') IS NOT NULL
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/../x.webp') IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL C4: the class helper accepts or refuses the wrong URLs on %', _cdn;
  END IF;
  IF public.photo_old_credit_key(_pid::uuid, _uid::uuid, 3, 'https://x/y.webp')
       IS DISTINCT FROM 'post-images/' || _uid || '/posts/credit/' || _pid || '-3-' || left(md5('https://x/y.webp'), 12) || '.webp' THEN
    RAISE EXCEPTION 'PROBE FAIL C4: the key helper does not derive the member-folder posts/credit/ name';
  END IF;
  -- counts only — no member data
  SELECT count(*) INTO _n FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY u(url, i)
   WHERE u.i <= 50 AND public.photo_old_credit_class(u.url) IS NOT NULL;
  SELECT count(*) INTO _rec FROM public.photo_old_credit;
  RAISE NOTICE 'old-photo credit (lane %, cdn %): old photos named by posts=% · recorded=%', current_setting('p32.lane'), _cdn, _n, _rec;
  RAISE NOTICE 'PROBE PASS: 20261110_0109 — table closed, writer gated, lookup gated by can_view_post, helpers read only this lane (lane %)', current_setting('p32.lane');
END
$p$;
ROLLBACK;
