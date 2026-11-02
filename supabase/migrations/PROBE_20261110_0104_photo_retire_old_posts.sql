-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0104 old post files queued (photo plan U7). READ-ONLY, ENDS IN ROLLBACK.
-- Reports FIRST (the U7 dry-run list, in counts): photo_set_v2 mode, post photos
-- still showing an old file, swapped photos, their old photos not yet queued,
-- and post_old rows by state with the bytes already deleted.
-- PASS when every swapped photo's old file is in photo_retire (due, kept or
-- deleted), every post_old row is an allowed key, and no post_old row's file is
-- still what a post shows. FAIL before 0104 runs whenever something is swapped.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE _mode text; _old bigint; _swapped bigint; _missing bigint; _bad bigint; _shown bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.photo_set_swap') IS NULL OR to_regclass('public.photo_retire') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL U0: 20261110_0101 / 0103 are not applied on this lane';
  END IF;
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'photo_set_v2';
  SELECT count(*) INTO _old FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) u(url)
   WHERE public.photo_set_backfill_source_key(u.url) IS NOT NULL;
  SELECT count(*) INTO _swapped FROM public.photo_set_swap w JOIN public.photo_set_backfill b ON b.post_id = w.post_id
   WHERE w.old_image_urls[b.ord + 1] = b.old_url;
  SELECT count(*) INTO _missing FROM public.photo_set_swap w
    JOIN public.posts p ON p.id = w.post_id
    JOIN public.photo_set_backfill b ON b.post_id = w.post_id
   WHERE w.old_image_urls[b.ord + 1] = b.old_url AND p.image_urls[b.ord + 1] = b.new_url
     AND public.photo_set_backfill_source_key(b.old_url) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.photo_retire r WHERE r.object_key = public.photo_set_backfill_source_key(b.old_url));
  SELECT count(*) INTO _bad FROM public.photo_retire r
   WHERE r.kind = 'post_old' AND (r.object_key !~ '^post-images/[0-9a-f-]{36}/' OR r.object_key ~* '-l4f?(-thumb|-r[0-9]{3,4})?\.webp$');
  SELECT count(*) INTO _shown FROM public.photo_retire r
   WHERE r.kind = 'post_old' AND EXISTS (SELECT 1 FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls || coalesce(p.thumbnail_urls, '{}')) u(url)
                                          WHERE u.url LIKE '%/' || r.object_key || '%');

  RAISE NOTICE 'U7 list (lane %, photo_set_v2 = %): post photos still showing an old file=% · swapped photos=% · their old photo not queued=%',
    current_setting('p32.lane'), coalesce(_mode, '<none>'), _old, _swapped, _missing;
  RAISE NOTICE 'post_old files: due=% · kept (still named)=% · deleted=% (% bytes)',
    (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND state = 'due'),
    (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND state = 'kept'),
    (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND state = 'deleted'),
    (SELECT coalesce(sum(bytes), 0) FROM public.photo_retire WHERE kind = 'post_old' AND state = 'deleted');
  IF _missing > 0 THEN RAISE EXCEPTION 'PROBE FAIL U1: % swapped photo(s) have an old file that is not queued (run 20261110_0104)', _missing; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION 'PROBE FAIL U2: % post_old row(s) name a key outside the old-file rule', _bad; END IF;
  IF _shown > 0 THEN RAISE EXCEPTION 'PROBE FAIL U3: % post_old file(s) are still what a post shows', _shown; END IF;
  RAISE NOTICE 'PROBE PASS: 20261110_0104 — every swapped photo''s old file is queued, kept or deleted; none is still shown (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
