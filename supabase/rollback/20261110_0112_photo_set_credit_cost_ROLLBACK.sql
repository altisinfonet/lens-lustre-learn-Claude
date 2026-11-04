-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0112 — target and record go back to 0111's bodies (each
-- reads photo_set_credit_named() in full again), and the helper and the two
-- indexes go. No row was changed by 0112, so no row changes here. DROP INDEX
-- waits for ACCESS EXCLUSIVE on posts and competition_entries: lock_timeout 5 s.
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
BEGIN
  IF to_regprocedure('public.photo_set_credit_is_named(text)') IS NULL THEN
    RAISE EXCEPTION 'SC-0112-RB-PRE-001: 20261110_0112 is not applied on this lane — nothing to roll back';
  END IF;
END
$rb$;

CREATE OR REPLACE FUNCTION public.photo_set_credit_target(_key text)
RETURNS TABLE(done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may write credited copies' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT EXISTS (SELECT 1 FROM public.photo_set_credit c WHERE c.photo_key = _key)
    FROM public.photo_set_credit_named() n
   WHERE n.photo_key = _key;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.photo_set_credit_record(_key text, _version integer, _drawn boolean, _origin text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may record credited copies' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_set_credit_named() n WHERE n.photo_key = _key) THEN
    RAISE EXCEPTION 'PHOTO-SC-002 no post or entry names this photo' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.photo_set_credit (photo_key, credit_version, drawn, origin, recorded_by)
  VALUES (_key, _version, _drawn, _origin, auth.uid())
  ON CONFLICT (photo_key) DO UPDATE
     SET credit_version = EXCLUDED.credit_version, drawn = EXCLUDED.drawn, origin = EXCLUDED.origin,
         recorded_by = EXCLUDED.recorded_by, recorded_at = now()
   WHERE public.photo_set_credit.credit_version < EXCLUDED.credit_version;
  DELETE FROM public.photo_credit_failure f WHERE f.subject = _key;
END;
$fn$;

DROP FUNCTION public.photo_set_credit_is_named(text);
DROP INDEX public.idx_competition_entries_photos_gin;
DROP INDEX public.idx_posts_image_urls_gin;

DO $done$ BEGIN RAISE NOTICE 'SC-0112 rolled back on %', current_setting('p32.lane'); END $done$;

COMMIT;
