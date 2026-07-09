-- V1: Lock down recompute_entry_public_status to service_role/postgres only
REVOKE EXECUTE ON FUNCTION public.recompute_entry_public_status(uuid) FROM PUBLIC, anon, authenticated;

-- V2: Recompute trigger on v3_stage_catalog edits
CREATE OR REPLACE FUNCTION public._tg_v3_catalog_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  affected_key text;
BEGIN
  -- On UPDATE/DELETE consider OLD; on UPDATE also consider NEW (key rename)
  IF TG_OP = 'DELETE' THEN
    affected_key := OLD.stage_key;
  ELSE
    affected_key := NEW.stage_key;
  END IF;

  FOR r IN
    SELECT id FROM public.competition_entries
    WHERE progression_decision = affected_key
       OR (TG_OP = 'UPDATE' AND progression_decision = OLD.stage_key)
  LOOP
    PERFORM public.recompute_entry_public_status(r.id);
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_v3_catalog_recompute ON public.v3_stage_catalog;
CREATE TRIGGER trg_v3_catalog_recompute
AFTER UPDATE OR DELETE ON public.v3_stage_catalog
FOR EACH ROW
EXECUTE FUNCTION public._tg_v3_catalog_recompute();