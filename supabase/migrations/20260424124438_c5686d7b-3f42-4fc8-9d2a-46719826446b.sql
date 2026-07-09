CREATE OR REPLACE FUNCTION public.enforce_status_round_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _round_int integer;
BEGIN
  -- current_round is TEXT and historically stores values like 'round2', '3', 'r4', etc.
  -- Extract digits before casting; NULL if no digits found.
  _round_int := NULLIF(regexp_replace(COALESCE(NEW.current_round, ''), '\D', '', 'g'), '')::integer;

  IF NEW.status = 'finalist' AND _round_int IS NOT NULL AND _round_int < 3 THEN
    RAISE EXCEPTION 'Finalist status requires round 3 or higher, got round %', NEW.current_round;
  END IF;

  IF NEW.status = 'winner' AND _round_int IS NOT NULL AND _round_int < 4 THEN
    RAISE EXCEPTION 'Winner status requires round 4, got round %', NEW.current_round;
  END IF;

  IF NEW.status = 'submitted' AND _round_int IS NOT NULL AND _round_int > 1 THEN
    RAISE EXCEPTION 'Submitted entries cannot be in round %', NEW.current_round;
  END IF;

  RETURN NEW;
END;
$function$;