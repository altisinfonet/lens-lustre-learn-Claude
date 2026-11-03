-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0107 — put the repointed posts back on their `-l4` URLs, byte for byte.
-- Any time, any lane. A post is restored only if it still shows exactly what
-- 0107 wrote (an edit since then is left alone, with a NOTICE). The old `-l4`
-- files were never touched, so they are all still there. The records in
-- photo_l4_rectify stay (re-running 0107 repoints again).
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
  IF to_regclass('public.photo_l4_rectify_swap') IS NULL THEN
    RAISE EXCEPTION 'RX-0107-RB-PRE-001: 20261110_0106 is not applied on this lane — nothing to roll back';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_l4_rectify_swap) THEN
    RAISE EXCEPTION 'RX-0107-RB-PRE-002: no post is repointed on this lane — nothing to roll back';
  END IF;
  FOR _w IN SELECT * FROM public.photo_l4_rectify_swap ORDER BY post_id LOOP
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
        DELETE FROM public.photo_l4_rectify_swap s WHERE s.post_id = _w.post_id;
        _back := _back + 1;
      ELSE
        _kept := _kept + 1;
        RAISE NOTICE 'RX-0107 rollback: post % changed since the repoint (or is gone) — not touched', _w.post_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _kept := _kept + 1;
      RAISE NOTICE 'RX-0107 rollback: post % refused (%: %) — not touched', _w.post_id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'RX-0107 rolled back on %: % post(s) restored · % not touched', current_setting('p32.lane'), _back, _kept;
END
$rb$;

COMMIT;
