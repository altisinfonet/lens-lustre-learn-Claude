-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0110 (review minors of 0109). READ-ONLY, ENDS IN ROLLBACK.
-- PASS when
--   M7 the class helper counts Supabase storage only in THIS lane's project
--      (another project's public URL → NULL; this lane's → 'supabase'), and
--      the rest of its classes are unchanged;
--   M8 post_photo_credit_for and post_photo_camera_for cap by cardinality(),
--      and an empty array returns no row without an error;
--   grants unchanged (lookups: anon + authenticated; helper: neither).
-- FAIL before the apply (M7: another project's URL is still 'supabase').
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE _cdn text; _own text; _other text; _uid text := '11111111-2222-4333-8444-555555555555'; _n bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regprocedure('public.photo_old_credit_class(text)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: 20261110_0109 is not applied on this lane';
  END IF;
  _own   := CASE current_setting('p32.lane') WHEN 'production' THEN 'jtdtehuqtinjxropkkcn' ELSE 'fpszggreishhuvdpkmdr' END;
  _other := CASE current_setting('p32.lane') WHEN 'production' THEN 'fpszggreishhuvdpkmdr' ELSE 'jtdtehuqtinjxropkkcn' END;
  _cdn := public.photo_set_backfill_cdn();
  -- M7
  IF public.photo_old_credit_class('https://' || _other || '.supabase.co/storage/v1/object/public/post-images/x/1.jpg') IS NOT NULL
     OR public.photo_old_credit_class('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/post-images/x/1.jpg') IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL M7: another Supabase project''s storage still counts as an old photo of this lane (%)', current_setting('p32.lane');
  END IF;
  IF public.photo_old_credit_class('https://' || _own || '.supabase.co/storage/v1/object/public/post-images/x/1.jpg') IS DISTINCT FROM 'supabase'
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/1700000000-abc.webp') IS DISTINCT FROM 'photos'
     OR public.photo_old_credit_class('https://' || _cdn || '/avatars/' || _uid || '/photos/1.jpg') IS DISTINCT FROM 'avatars'
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/1762-abc-w1080h720-l5.webp') IS NOT NULL
     OR public.photo_old_credit_class('https://' || _cdn || '/post-images/' || _uid || '/posts/credit/aaaaaaaa-0000-4000-8000-000000000001-0-0123456789ab.webp') IS NOT NULL
     OR public.photo_old_credit_class('https://' || _own || '.supabase.co/storage/v1/object/public/../x.jpg') IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL M7: the class helper changed beyond the Supabase pin';
  END IF;
  -- M8
  IF position('cardinality(p_post_ids) > 50' IN pg_get_functiondef('public.post_photo_credit_for(uuid[])'::regprocedure)) = 0
     OR position('cardinality(p_post_ids) > 50' IN pg_get_functiondef('public.post_photo_camera_for(uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL M8: a 50-id cap does not read cardinality()';
  END IF;
  SELECT count(*) INTO _n FROM public.post_photo_credit_for('{}'::uuid[]);
  IF _n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL M8: an empty id list returned rows'; END IF;
  SELECT count(*) INTO _n FROM public.post_photo_camera_for('{}'::uuid[]);
  IF _n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL M8: an empty id list returned camera rows'; END IF;
  -- grants
  IF NOT has_function_privilege('anon', 'public.post_photo_credit_for(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.post_photo_credit_for(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.post_photo_camera_for(uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_old_credit_class(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_old_credit_class(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: a grant changed';
  END IF;
  SELECT count(*) INTO _n FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY u(url, i)
   WHERE u.i <= 50 AND public.photo_old_credit_class(u.url) IS NOT NULL;
  RAISE NOTICE 'PROBE PASS: 20261110_0110 on % — Supabase sources = project %, caps by cardinality; old photos now %', current_setting('p32.lane'), _own, _n;
END
$p$;
ROLLBACK;
