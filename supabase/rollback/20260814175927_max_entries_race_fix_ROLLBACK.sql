-- ROLLBACK for 20260814175927_max_entries_race_fix.sql
--
-- Restores the pre-fix function VERBATIM (COUNT without the advisory lock) —
-- which restores the demonstrated race: two concurrent submissions by the
-- same member can both be admitted past max_entries_per_user. Run this only
-- if the lock itself misbehaves; the race returns with it.

CREATE OR REPLACE FUNCTION public.enforce_max_entries_per_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _max_entries int;
  _current_count int;
BEGIN
  SELECT max_entries_per_user INTO _max_entries
  FROM public.competitions
  WHERE id = NEW.competition_id;

  IF _max_entries IS NOT NULL THEN
    SELECT COUNT(*) INTO _current_count
    FROM public.competition_entries
    WHERE user_id = NEW.user_id
      AND competition_id = NEW.competition_id;

    IF _current_count >= _max_entries THEN
      RAISE EXCEPTION 'Entry limit exceeded. Maximum % entries per user allowed.', _max_entries;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
