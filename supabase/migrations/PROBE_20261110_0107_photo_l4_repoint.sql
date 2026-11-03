-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0107 repoint of the `-l4` posts (photo plan). READ-ONLY, ENDS IN ROLLBACK.
-- PASS when
--   P1 no post names a LARGE `-l4` photo any more (the credited 2048 with the
--      big credit) — a small one (no clean 1080) is reported, not counted;
--   P2 every repointed post still shows exactly what 0107 wrote, and each of
--      its rectified photos is that photo's recorded `-l5` URL and thumb;
-- The counts (repointed, recorded, still named, small) are printed with every
-- result, so a PASS from a lane that had nothing to do is visible as such.
-- FAIL before the repoint while any post names a large `-l4` photo (expected),
-- and after the rollback.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE _large bigint; _small bigint; _swapped bigint; _drift bigint; _rec bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.photo_l4_rectify_swap') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P0: 20261110_0106 is not applied on this lane';
  END IF;
  SELECT count(*) INTO _large FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) u(url)
   WHERE public.photo_l4_rectify_source_key(u.url) IS NOT NULL;
  SELECT count(*) INTO _small FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) u(url)
   WHERE u.url ~ '-w[0-9]{1,4}h[0-9]{1,4}-l4\.webp(\?.*)?$' AND public.photo_l4_rectify_source_key(u.url) IS NULL;
  SELECT count(*) INTO _swapped FROM public.photo_l4_rectify_swap;
  SELECT count(*) INTO _rec FROM public.photo_l4_rectify;
  SELECT count(*) INTO _drift FROM public.photo_l4_rectify_swap w JOIN public.posts p ON p.id = w.post_id
   WHERE p.image_urls IS DISTINCT FROM w.new_image_urls OR p.thumbnail_urls IS DISTINCT FROM w.new_thumbnail_urls
      OR p.image_url IS DISTINCT FROM w.new_image_url OR p.thumbnail_url IS DISTINCT FROM w.new_thumbnail_url
      OR EXISTS (SELECT 1 FROM public.photo_l4_rectify x WHERE x.post_id = w.post_id
                  AND w.old_image_urls[x.ord + 1] = x.old_url
                  AND (p.image_urls[x.ord + 1] IS DISTINCT FROM x.new_url OR p.thumbnail_urls[x.ord + 1] IS DISTINCT FROM x.new_thumb));

  RAISE NOTICE 'repoint (lane %): posts repointed=% · photos recorded=% · large -l4 photos still named=% · small -l4 (not rectifiable, shown clean by the app)=% · drifted=%',
    current_setting('p32.lane'), _swapped, _rec, _large, _small, _drift;
  IF _large > 0 THEN RAISE EXCEPTION 'PROBE FAIL P1: % large -l4 photo(s) are still named by a post', _large; END IF;
  IF _drift > 0 THEN RAISE EXCEPTION 'PROBE FAIL P2: % repointed post(s) no longer show what 0107 wrote', _drift; END IF;
  RAISE NOTICE 'PROBE PASS: 20261110_0107 — % post(s) repointed (% photos recorded), no large -l4 photo named, none drifted (lane %)',
    _swapped, _rec, current_setting('p32.lane');
END
$p$;

ROLLBACK;
