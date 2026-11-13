-- ROLLBACK of 20261113_0803: the guard function exactly as 20261113_0800 created it
-- (its INSERT rule also pins the two AI flags, which refuses every direct insert).
BEGIN;
CREATE OR REPLACE FUNCTION public.tg_entry_member_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _changed text[];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;  -- server code, definer functions, edge functions, cron
  END IF;
  IF _uid IS NOT NULL AND public.has_role(_uid, 'admin'::public.app_role) THEN
    RETURN NEW;  -- admin screens
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO _changed
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.key NOT IN ('title', 'description', 'photos', 'photo_thumbnails', 'photo_meta',
                         'exif_data', 'updated_at', 'current_round_int')
       AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
    IF _changed IS NOT NULL THEN
      RAISE EXCEPTION 'Only the title, description and photos of an entry can be changed by its owner (not: %)',
        array_to_string(_changed, ', ') USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.status NOT IN ('draft', 'submitted')
       OR NEW.placement IS NOT NULL OR NEW.stage_key IS NOT NULL OR NEW.progression_decision IS NOT NULL
       OR coalesce(NEW.current_round, '1') <> '1'
       OR coalesce(NEW.certificate_ready, false) OR coalesce(NEW.is_pinned, false) OR coalesce(NEW.is_trending, false)
       OR coalesce(NEW.view_count, 0) <> 0
       OR NEW.ai_detection_result IS NOT NULL OR NEW.is_ai_advisory IS DISTINCT FROM true
       OR NEW.public_status_derived IS NOT NULL OR NEW.public_round_derived IS NOT NULL
       OR NEW.public_placement_derived IS NOT NULL OR NEW.public_progression_note_derived IS NOT NULL
       OR NEW.public_r4_tags_derived IS NOT NULL THEN
      RAISE EXCEPTION 'A new entry starts as submitted with no result — results are set by the judges'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_entry_member_write_guard() FROM PUBLIC, anon, authenticated;
COMMIT;
