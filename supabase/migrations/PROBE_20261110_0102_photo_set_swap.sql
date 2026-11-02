-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0102 photo-set URL swap (photo plan U5). READ-ONLY, ENDS IN ROLLBACK.
-- Reports: photo_set_v2 mode, swapped posts, posts ready but not swapped.
-- PASS when
--   S1 no post is READY (every in-scope photo recorded) and still unswapped;
--   S2 every swapped post still shows exactly what the swap wrote, and every
--      URL it now holds for a swapped photo is that photo's recorded new_url;
--   S3 no swapped post points at an old in-scope photo any more.
-- FAIL before the swap whenever something is ready (expected), and after a
-- rollback (the restored posts are ready again).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE _mode text; _ready bigint; _swapped bigint; _drift bigint; _old bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.photo_set_swap') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL S0: 20261110_0101 is not applied on this lane';
  END IF;
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'photo_set_v2';
  SELECT count(*) INTO _swapped FROM public.photo_set_swap;
  SELECT count(*) INTO _ready FROM public.posts p
   WHERE NOT EXISTS (SELECT 1 FROM public.photo_set_swap w WHERE w.post_id = p.id)
     AND EXISTS (SELECT 1 FROM public.photo_set_backfill b WHERE b.post_id = p.id AND b.old_url = p.image_urls[b.ord + 1])
     AND NOT EXISTS (SELECT 1 FROM unnest(p.image_urls) WITH ORDINALITY u(url, i)
                      WHERE public.photo_set_backfill_source_key(u.url) IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM public.photo_set_backfill b
                                         WHERE b.post_id = p.id AND b.ord = u.i - 1 AND b.old_url = u.url));
  SELECT count(*) INTO _drift FROM public.photo_set_swap w JOIN public.posts p ON p.id = w.post_id
   WHERE p.image_urls IS DISTINCT FROM w.new_image_urls OR p.thumbnail_urls IS DISTINCT FROM w.new_thumbnail_urls
      OR p.image_url IS DISTINCT FROM w.new_image_url OR p.thumbnail_url IS DISTINCT FROM w.new_thumbnail_url
      OR EXISTS (SELECT 1 FROM public.photo_set_backfill b WHERE b.post_id = w.post_id
                  AND w.old_image_urls[b.ord + 1] = b.old_url AND p.image_urls[b.ord + 1] IS DISTINCT FROM b.new_url);
  SELECT count(*) INTO _old FROM public.photo_set_swap w JOIN public.posts p ON p.id = w.post_id
   WHERE EXISTS (SELECT 1 FROM unnest(p.image_urls) u(url) WHERE public.photo_set_backfill_source_key(u.url) IS NOT NULL);

  RAISE NOTICE 'swap (lane %, photo_set_v2 = %): swapped posts=% · ready, not swapped=% · drifted=% · swapped but still old=%',
    current_setting('p32.lane'), coalesce(_mode, '<none>'), _swapped, _ready, _drift, _old;
  IF _ready > 0 THEN RAISE EXCEPTION 'PROBE FAIL S1: % post(s) have every photo''s v2 set recorded but are not swapped', _ready; END IF;
  IF _drift > 0 THEN RAISE EXCEPTION 'PROBE FAIL S2: % swapped post(s) no longer show what the swap wrote', _drift; END IF;
  IF _old > 0 THEN RAISE EXCEPTION 'PROBE FAIL S3: % swapped post(s) still point at an old in-scope photo', _old; END IF;
  RAISE NOTICE 'PROBE PASS: 20261110_0102 — % post(s) swapped, none ready and waiting, none drifted (lane %)', _swapped, current_setting('p32.lane');
END
$p$;

ROLLBACK;
