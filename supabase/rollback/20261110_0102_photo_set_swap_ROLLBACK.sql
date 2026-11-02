-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0102 photo-set URL swap (photo plan U5).
-- Puts every swapped post back EXACTLY as it was (image_urls, thumbnail_urls,
-- image_url, thumbnail_url from photo_set_swap.old_*) and removes its swap row,
-- so a later 0102 run can swap it again. Safe on any lane at any time: the old
-- files are still in the bucket until U7, which runs only after this point of
-- no return is confirmed by the Owner.
-- A post whose four values are no longer what the swap wrote (changed since)
-- is NOT touched; it is named in a NOTICE and counted, and the run goes on.
-- Nothing else changes; the backfill record and the copies stay.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb$
DECLARE _w record; _back int := 0; _kept int := 0;
BEGIN
  IF to_regclass('public.photo_set_swap') IS NULL THEN
    RAISE EXCEPTION 'U5-0102-RB-PRE-001: 20261110_0101 is not applied on this lane — nothing to roll back';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_set_swap) THEN
    RAISE EXCEPTION 'U5-0102-RB-PRE-002: no post is swapped on this lane — nothing to roll back';
  END IF;
  FOR _w IN SELECT * FROM public.photo_set_swap ORDER BY post_id LOOP
    BEGIN
      UPDATE public.posts p
         SET image_urls = _w.old_image_urls, thumbnail_urls = _w.old_thumbnail_urls,
             image_url = _w.old_image_url, thumbnail_url = _w.old_thumbnail_url
       WHERE p.id = _w.post_id
         AND p.image_urls IS NOT DISTINCT FROM _w.new_image_urls
         AND p.thumbnail_urls IS NOT DISTINCT FROM _w.new_thumbnail_urls
         AND p.image_url IS NOT DISTINCT FROM _w.new_image_url
         AND p.thumbnail_url IS NOT DISTINCT FROM _w.new_thumbnail_url;
      IF FOUND THEN
        DELETE FROM public.photo_set_swap s WHERE s.post_id = _w.post_id;
        _back := _back + 1;
      ELSE
        _kept := _kept + 1;
        RAISE NOTICE 'U5-0102 rollback: post % changed since the swap (or is gone) — not touched', _w.post_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _kept := _kept + 1;
      RAISE NOTICE 'U5-0102 rollback: post % refused (%: %) — not touched', _w.post_id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'U5-0102 rolled back on %: % post(s) restored · % not touched', current_setting('p32.lane'), _back, _kept;
END
$rb$;

COMMIT;
