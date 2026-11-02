-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan U5 · 20261110_0102 — the URL SWAP: old post photos → their v2 set.
-- Lanes: staging and production. RE-RUNNABLE (each run swaps what is ready).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ THIS CHANGES WHAT MEMBERS SEE. After it, an old photo is shown from its
-- credited 2048 copy (full screen) and the 1080 / 600 / 320 copies — even for
-- members on old app versions. So on PRODUCTION it REFUSES while the switch
-- photo_set_v2 is 'off' (PRE-003): it runs there only after the Owner has
-- switched the new photos on himself and said "swap OK". Staging is the test
-- lane: there it runs with the switch as it is.
--
-- GATE: a post is swapped only when EVERY in-scope photo of it has its whole
-- v2 set recorded (photo_set_backfill, written by the `done` route after one
-- HEAD per copy), and the whole before/after is kept in photo_set_swap so
-- 20261110_0102_photo_set_swap_ROLLBACK.sql restores it exactly.
--
-- PER POST, in its own sub-transaction (a refusal — e.g. a moderation trigger
-- that rejects an old caption on UPDATE — skips that post with a NOTICE and the
-- run goes on):
--   image_urls[i]     old photo → its new_url           (out-of-scope photos unchanged)
--   thumbnail_urls[i] → its new_thumb                     (array built to image_urls' length;
--                                                         unchanged slots keep their value)
--   image_url         if it equals an old photo of the post → that photo's new_url
--   thumbnail_url     if it equals that photo's old thumb, or image_url was swapped
--                     and it is set → that photo's new_thumb
--   only if image_urls is still exactly what was read (no race with an edit).
-- Nothing else on the row changes. No row is deleted. No file is touched.
--
-- ROLLBACK: supabase/rollback/20261110_0102_photo_set_swap_ROLLBACK.sql (any time, any lane)
-- PROBE:    supabase/migrations/PROBE_20261110_0102_photo_set_swap.sql (FAIL while a ready post is unswapped)
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

DO $swap$
DECLARE
  _mode text; _r record; _old_t text[]; _new_u text[]; _new_t text[]; _n int; _i int; _m record;
  _new_iu text; _new_tu text; _swapped int := 0; _photos int := 0; _skipped int := 0; _ready int := 0;
BEGIN
  -- PRE-001 · 0101 is applied.
  IF to_regclass('public.photo_set_backfill') IS NULL OR to_regclass('public.photo_set_swap') IS NULL THEN
    RAISE EXCEPTION 'U5-0102-PRE-001: 20261110_0101 is not applied on this lane';
  END IF;
  -- PRE-003 · production: only after the Owner switched the new photos on.
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'photo_set_v2';
  IF current_setting('p32.lane') = 'production' AND coalesce(_mode, 'off') = 'off' THEN
    RAISE EXCEPTION 'U5-0102-PRE-003: photo_set_v2 is off on production — the swap changes what members see, so it runs only after the Owner has switched the new photos on and said "swap OK"';
  END IF;
  RAISE NOTICE 'U5-0102 on % (photo_set_v2 = %)', current_setting('p32.lane'), coalesce(_mode, '<no switch>');

  FOR _r IN
    SELECT p.id, p.image_urls, p.thumbnail_urls, p.image_url, p.thumbnail_url
      FROM public.posts p
     WHERE NOT EXISTS (SELECT 1 FROM public.photo_set_swap w WHERE w.post_id = p.id)
       AND EXISTS (SELECT 1 FROM public.photo_set_backfill b WHERE b.post_id = p.id AND b.old_url = p.image_urls[b.ord + 1])
       AND NOT EXISTS (
             SELECT 1 FROM unnest(p.image_urls) WITH ORDINALITY u(url, i)
              WHERE public.photo_set_backfill_source_key(u.url) IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.photo_set_backfill b
                                 WHERE b.post_id = p.id AND b.ord = u.i - 1 AND b.old_url = u.url))
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
    FOR _m IN SELECT b.ord, b.old_url, b.new_url, b.new_thumb FROM public.photo_set_backfill b
               WHERE b.post_id = _r.id AND b.old_url = _r.image_urls[b.ord + 1] ORDER BY b.ord
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
      INSERT INTO public.photo_set_swap (post_id, old_image_urls, old_thumbnail_urls, old_image_url, old_thumbnail_url,
                                         new_image_urls, new_thumbnail_urls, new_image_url, new_thumbnail_url, photos_swapped)
      VALUES (_r.id, _r.image_urls, _old_t, _r.image_url, _r.thumbnail_url, _new_u, _new_t, _new_iu, _new_tu, _i);
      UPDATE public.posts p
         SET image_urls = _new_u, thumbnail_urls = _new_t, image_url = _new_iu, thumbnail_url = _new_tu
       WHERE p.id = _r.id AND p.image_urls = _r.image_urls;
      IF NOT FOUND THEN RAISE EXCEPTION 'the post changed while it was being swapped'; END IF;
      _swapped := _swapped + 1;
      _photos := _photos + _i;
    EXCEPTION WHEN OTHERS THEN
      _skipped := _skipped + 1;
      RAISE NOTICE 'U5-0102 skipped post % (%: %)', _r.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'U5-0102 done on %: ready posts % · swapped % (% photos) · skipped % · swapped in total %',
    current_setting('p32.lane'), _ready, _swapped, _photos, _skipped, (SELECT count(*) FROM public.photo_set_swap);
END
$swap$;

COMMIT;
