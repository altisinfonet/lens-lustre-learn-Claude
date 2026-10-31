-- ROLLBACK for 20260814210100_media_takedown_consistency.sql
--
-- ⚠ Restores both functions verbatim as they stood before the fix and drops
-- the uniqueness guarantee. Running this re-opens the measured takedown race
-- (a live post can reference quarantined bytes) and allows the same photo to
-- occupy two carousel positions. Emergency reversion only.

CREATE OR REPLACE FUNCTION public.tg_post_media_requires_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _state text;
BEGIN
  SELECT state INTO _state FROM public.media_objects WHERE id = NEW.media_id;
  IF _state IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'post_media: media % is in state %, only ready may be referenced',
      NEW.media_id, coalesce(_state, '<missing>')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.media_quarantine(_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'a quarantine must record a reason' USING ERRCODE = '22023';
  END IF;

  UPDATE public.media_objects
     SET state = 'quarantined', quarantine_reason = _reason
   WHERE id = _id AND state <> 'quarantined';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % does not exist or is already quarantined', _id
      USING ERRCODE = '23514';
  END IF;
END $function$;

DROP INDEX IF EXISTS public.post_media_post_media_uniq;

-- The revokes are NOT undone: the pre-migration state was also revoked, so
-- re-granting would create a hole this migration never opened.
