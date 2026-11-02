-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE GATE · photo-set swap (20261110_0102) — the exact posts after a
-- complete swap, on the lane shape in 10_shape.sql (the fixture worker records
-- every set with a 100×80 "2048" copy). Run with p32.lane set, inside a
-- transaction the runner rolls back.
-- ═══════════════════════════════════════════════════════════════════════════
DO $g$
DECLARE
  _h text := CASE current_setting('p32.lane', true) WHEN 'staging' THEN 'cdn-staging.50mmretina.com' ELSE 'cdn.50mmretina.com' END;
  _other text := CASE current_setting('p32.lane', true) WHEN 'staging' THEN 'cdn.50mmretina.com' ELSE 'cdn-staging.50mmretina.com' END;
  _a text := '00000000-0000-4000-8000-0000000000a1';
  _b text := '00000000-0000-4000-8000-0000000000a2';
  _base text; _p record; _n int;
BEGIN
  _base := 'https://' || _h || '/post-images/';
  IF to_regclass('public.photo_set_swap') IS NULL OR NOT EXISTS (SELECT 1 FROM public.photo_set_swap) THEN
    RAISE EXCEPTION 'FIXTURE FAIL G-0: nothing is swapped';
  END IF;

  SELECT * INTO _p FROM public.posts WHERE id = '00000000-0000-4000-8000-0000000000f1';
  IF _p.image_urls IS DISTINCT FROM ARRAY[_base || _a || '/posts/1793-aa-w2170h1479-l3-w100h80-l4.webp']
     OR _p.thumbnail_urls IS DISTINCT FROM ARRAY[_base || _a || '/posts/1793-aa-w2170h1479-l3-w100h80-l4-thumb.webp']
     OR _p.image_url IS DISTINCT FROM _base || _a || '/posts/1793-aa-w2170h1479-l3-w100h80-l4.webp'
     OR _p.thumbnail_url IS DISTINCT FROM _base || _a || '/posts/1793-aa-w2170h1479-l3-w100h80-l4-thumb.webp' THEN
    RAISE EXCEPTION 'FIXTURE FAIL G-1: F1 (one -l3 photo + singletons) is not swapped exactly: %', row_to_json(_p);
  END IF;

  SELECT * INTO _p FROM public.posts WHERE id = '00000000-0000-4000-8000-0000000000f2';
  IF _p.image_urls IS DISTINCT FROM ARRAY[_base || _b || '/posts/e4c9-0-w1080h719-w100h80-l4.webp', _base || _b || '/1775573669531_0-w100h80-l4.webp']
     OR _p.thumbnail_urls IS DISTINCT FROM ARRAY[_base || _b || '/posts/e4c9-0-w1080h719-w100h80-l4-thumb.webp', _base || _b || '/1775573669531_0-w100h80-l4-thumb.webp']
     OR _p.image_url IS NOT NULL OR _p.thumbnail_url IS NOT NULL THEN
    RAISE EXCEPTION 'FIXTURE FAIL G-2: F2 (two photos, query string, root folder) is not swapped exactly: %', row_to_json(_p);
  END IF;

  SELECT * INTO _p FROM public.posts WHERE id = '00000000-0000-4000-8000-0000000000f3';
  IF _p.image_urls IS DISTINCT FROM ARRAY['https://' || _h || '/avatars/' || _a || '/my-photos/x/1788-jb.webp', _base || _a || '/posts/1786-js-w100h80-l4.webp']
     OR _p.thumbnail_urls IS DISTINCT FROM ARRAY['https://' || _h || '/avatars/' || _a || '/my-photos/x/1788-jb-thumb.webp', _base || _a || '/posts/1786-js-w100h80-l4-thumb.webp'] THEN
    RAISE EXCEPTION 'FIXTURE FAIL G-3: F3 (mixed) — the avatars file must stay, the old photo must swap: %', row_to_json(_p);
  END IF;

  SELECT * INTO _p FROM public.posts WHERE id = '00000000-0000-4000-8000-0000000000f7';
  IF _p.image_urls IS DISTINCT FROM ARRAY[_base || _b || '/posts/f7-w600h400-w100h80-l4.webp']
     OR _p.thumbnail_urls IS DISTINCT FROM ARRAY[_base || _b || '/posts/f7-w600h400-w100h80-l4-thumb.webp'] THEN
    RAISE EXCEPTION 'FIXTURE FAIL G-7: F7 (no thumbnail_urls) must get a one-slot thumb array: %', row_to_json(_p);
  END IF;

  SELECT * INTO _p FROM public.posts WHERE id = '00000000-0000-4000-8000-0000000000f6';
  IF _p.image_urls IS DISTINCT FROM ARRAY[_base || _a || '/posts/f6-w100h80-l4.webp'] THEN
    RAISE EXCEPTION 'FIXTURE FAIL G-6: F6 is not swapped after its caption stopped being refused: %', row_to_json(_p);
  END IF;

  -- untouched: Supabase storage, already v2, the other lane's host, picsum, media-graph-only
  SELECT count(*) INTO _n FROM public.posts p
   WHERE p.id IN ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5',
                  '00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-0000000000f9',
                  '00000000-0000-4000-8000-0000000000fa')
     AND (EXISTS (SELECT 1 FROM public.photo_set_swap w WHERE w.post_id = p.id)
          OR EXISTS (SELECT 1 FROM public.photo_set_backfill b WHERE b.post_id = p.id));
  IF _n <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL G-8: % out-of-scope post(s) were recorded or swapped', _n; END IF;
  IF (SELECT image_urls FROM public.posts WHERE id = '00000000-0000-4000-8000-0000000000f8')
       IS DISTINCT FROM ARRAY['https://' || _other || '/post-images/' || _a || '/posts/elsewhere.webp'] THEN
    RAISE EXCEPTION 'FIXTURE FAIL G-9: the other lane''s URL changed';
  END IF;

  SELECT count(*) INTO _n FROM public.photo_set_swap;
  IF _n <> 5 THEN RAISE EXCEPTION 'FIXTURE FAIL G-10: % posts swapped (want 5: F1 F2 F3 F6 F7)', _n; END IF;
  RAISE NOTICE 'FIXTURE PASS: the swap wrote exactly the expected posts on %', current_setting('p32.lane');
END
$g$;
