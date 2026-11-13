-- ═══════════════════════════════════════════════════════════════════════════
-- 20261113_0803 · the entry guard no longer refuses a PLAIN direct insert
--
-- 0800's guard required, on a member's direct INSERT, is_ai_advisory = true
-- and ai_detection_result IS NULL. validate_competition_entry_ai_advisory
-- (existing) refuses exactly that pair ("is_ai_advisory cannot be true without
-- ai_detection_result"), so together they refused EVERY direct insert — more
-- than 0800 meant to (found reading the triggers before the production apply;
-- the app submits through a server function, so no caller was affected).
--
-- Same function, same UPDATE rule, same trigger. The INSERT rule keeps every
-- result column (status, placement, stage_key, progression_decision, round,
-- certificate_ready, pin, trending, views, public_* derived) and drops only the
-- two AI-flag conditions — on insert they stay as they were before 0800
-- (enforce_ai_image_policy + validate_competition_entry_ai_advisory). After
-- insert both flags are frozen for the member by the UPDATE allow-list.
--
-- Rollback: supabase/rollback/20261113_0803_entry_guard_insert_ai_flags_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261113_0800_member_write_guards.sql (A8 refused, N4 not refused by the guard)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
END
$lane_guard$;

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
