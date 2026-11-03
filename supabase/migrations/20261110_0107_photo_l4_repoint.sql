-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan · 20261110_0107 — REPOINT the rectified `-l4` posts to their `-l5` set.
-- Lanes: staging and production. RE-RUNNABLE (each run repoints what is ready).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner-approved data fix (3 Nov 2026). A post that names a large `-l4` photo
-- (the URL IS the credited 2048 with the big credit) is repointed to that
-- photo's `-l5` set, recorded by the rectify writer (20261110_0106 +
-- /api/media/photoset/rectify) only after one HEAD per copy:
--   image_urls[i] → the clean 1080 (`-l5`), thumbnail_urls[i] → its `-l5-thumb`;
--   image_url / thumbnail_url follow when they named that photo / its thumb.
-- What members see afterwards: the clean copy everywhere (also in old app
-- versions, which show the URL itself); the small-credit copy is only the
-- web full-screen "save image" file. Not behind the New Photos switch: it
-- REMOVES a credit from screens, it switches nothing on.
--
-- GATE: a post is repointed only when EVERY large `-l4` photo of it is
-- recorded; the whole before/after goes to photo_l4_rectify_swap.
-- PER POST in its own sub-transaction (a refusal skips that post with a NOTICE),
-- and only if image_urls is still exactly what was read. No row is deleted.
-- No file is touched: the old `-l4` files stay (unreferenced; deleted only via
-- the held delete path, never here).
--
-- ROLLBACK: supabase/rollback/20261110_0107_photo_l4_repoint_ROLLBACK.sql (restores byte for byte)
-- PROBE:    supabase/migrations/PROBE_20261110_0107_photo_l4_repoint.sql (FAIL while a post names a large -l4 photo)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $repoint$
DECLARE
  _r record; _m record; _new_u text[]; _new_t text[]; _old_t text[]; _n int; _i int;
  _new_iu text; _new_tu text; _done int := 0; _photos int := 0; _skipped int := 0; _ready int := 0; _left bigint;
BEGIN
  IF to_regclass('public.photo_l4_rectify') IS NULL OR to_regclass('public.photo_l4_rectify_swap') IS NULL THEN
    RAISE EXCEPTION 'RX-0107-PRE-001: 20261110_0106 is not applied on this lane';
  END IF;

  FOR _r IN
    SELECT p.id, p.image_urls, p.thumbnail_urls, p.image_url, p.thumbnail_url
      FROM public.posts p
     WHERE EXISTS (SELECT 1 FROM public.photo_l4_rectify x WHERE x.post_id = p.id AND x.old_url = p.image_urls[x.ord + 1])
       AND NOT EXISTS (
             SELECT 1 FROM unnest(p.image_urls) WITH ORDINALITY u(url, i)
              WHERE public.photo_l4_rectify_source_key(u.url) IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.photo_l4_rectify x
                                 WHERE x.post_id = p.id AND x.ord = u.i - 1 AND x.old_url = u.url))
     ORDER BY p.id
     FOR UPDATE OF p
  LOOP
    _ready := _ready + 1;
    _n := cardinality(_r.image_urls);
    _new_u := _r.image_urls;
    _new_t := ARRAY(SELECT _r.thumbnail_urls[g] FROM generate_series(1, _n) g ORDER BY g);
    _old_t := _r.thumbnail_urls;
    _new_iu := _r.image_url;
    _new_tu := _r.thumbnail_url;
    _i := 0;
    FOR _m IN SELECT x.ord, x.old_url, x.new_url, x.new_thumb FROM public.photo_l4_rectify x
               WHERE x.post_id = _r.id AND x.old_url = _r.image_urls[x.ord + 1] ORDER BY x.ord
    LOOP
      _new_u[_m.ord + 1] := _m.new_url;
      _new_t[_m.ord + 1] := _m.new_thumb;
      IF _r.image_url IS NOT DISTINCT FROM _m.old_url AND _new_iu IS NOT DISTINCT FROM _r.image_url THEN
        _new_iu := _m.new_url;
        IF _r.thumbnail_url IS NOT NULL THEN _new_tu := _m.new_thumb; END IF;
      ELSIF _r.thumbnail_url IS NOT NULL AND _r.thumbnail_url IS NOT DISTINCT FROM _r.thumbnail_urls[_m.ord + 1]
            AND _new_tu IS NOT DISTINCT FROM _r.thumbnail_url THEN
        _new_tu := _m.new_thumb;
      END IF;
      _i := _i + 1;
    END LOOP;
    BEGIN
      -- a post repointed before and edited back to -l4 since: keep the FIRST before-state for the rollback
      INSERT INTO public.photo_l4_rectify_swap (post_id, old_image_urls, old_thumbnail_urls, old_image_url, old_thumbnail_url,
                                                new_image_urls, new_thumbnail_urls, new_image_url, new_thumbnail_url, photos_swapped)
      VALUES (_r.id, _r.image_urls, _old_t, _r.image_url, _r.thumbnail_url, _new_u, _new_t, _new_iu, _new_tu, _i)
      ON CONFLICT (post_id) DO UPDATE
         SET new_image_urls = EXCLUDED.new_image_urls, new_thumbnail_urls = EXCLUDED.new_thumbnail_urls,
             new_image_url = EXCLUDED.new_image_url, new_thumbnail_url = EXCLUDED.new_thumbnail_url,
             photos_swapped = EXCLUDED.photos_swapped, swapped_at = now();
      UPDATE public.posts p
         SET image_urls = _new_u, thumbnail_urls = _new_t, image_url = _new_iu, thumbnail_url = _new_tu
       WHERE p.id = _r.id AND p.image_urls = _r.image_urls;
      IF NOT FOUND THEN RAISE EXCEPTION 'the post changed while it was being repointed'; END IF;
      _done := _done + 1;
      _photos := _photos + _i;
      RAISE NOTICE 'RX-0107 repointed post % (% photo(s))', _r.id, _i;
    EXCEPTION WHEN OTHERS THEN
      _skipped := _skipped + 1;
      RAISE NOTICE 'RX-0107 skipped post % (%: %)', _r.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  SELECT count(*) INTO _left FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) u(url)
   WHERE public.photo_l4_rectify_source_key(u.url) IS NOT NULL;
  RAISE NOTICE 'RX-0107 done on %: ready posts % · repointed % (% photos) · skipped % · large -l4 photos still named %',
    current_setting('p32.lane'), _ready, _done, _photos, _skipped, _left;
END
$repoint$;

COMMIT;
