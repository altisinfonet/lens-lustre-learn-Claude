-- =========================================================
-- B1.7  Derived-status invariant cache
-- =========================================================

-- 1. Cache column (nullable; backfilled below)
ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS public_status_derived text;

CREATE INDEX IF NOT EXISTS idx_competition_entries_public_status_derived
  ON public.competition_entries(public_status_derived);

-- 2. Single-entry recompute helper — pulls authoritative value from the view
CREATE OR REPLACE FUNCTION public.recompute_entry_public_status(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.competition_entries e
     SET public_status_derived = v.public_status
    FROM public.entry_public_status v
   WHERE v.entry_id = _entry_id
     AND e.id       = _entry_id
     AND e.public_status_derived IS DISTINCT FROM v.public_status;
END;
$$;

-- 3a. Entry-side trigger: recompute when judging-relevant fields move
CREATE OR REPLACE FUNCTION public.trg_recompute_entry_public_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_entry_public_status(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entry_public_status_recompute ON public.competition_entries;
CREATE TRIGGER trg_entry_public_status_recompute
AFTER INSERT OR UPDATE OF stage_key, status, current_round, placement, progression_decision
ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.trg_recompute_entry_public_status();

-- 3b. Publish-side trigger: recompute every entry of the competition when a round publish row changes
CREATE OR REPLACE FUNCTION public.trg_recompute_publish_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _comp uuid;
BEGIN
  _comp := COALESCE(NEW.competition_id, OLD.competition_id);
  UPDATE public.competition_entries e
     SET public_status_derived = v.public_status
    FROM public.entry_public_status v
   WHERE v.entry_id = e.id
     AND e.competition_id = _comp
     AND e.public_status_derived IS DISTINCT FROM v.public_status;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_round_publish_recompute ON public.competition_round_publish;
CREATE TRIGGER trg_round_publish_recompute
AFTER INSERT OR UPDATE OR DELETE
ON public.competition_round_publish
FOR EACH ROW
EXECUTE FUNCTION public.trg_recompute_publish_fanout();

-- 4. Backfill from canonical view
UPDATE public.competition_entries e
   SET public_status_derived = v.public_status
  FROM public.entry_public_status v
 WHERE v.entry_id = e.id
   AND e.public_status_derived IS DISTINCT FROM v.public_status;

-- 5. Drift audit RPC (admin-only) for the nightly invariant
CREATE OR REPLACE FUNCTION public.get_derived_status_drift_admin()
RETURNS TABLE(
  entry_id          uuid,
  competition_id    uuid,
  cached_value      text,
  canonical_value   text,
  status            text,
  current_round     text,
  stage_key         text,
  placement         text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT  e.id,
          e.competition_id,
          e.public_status_derived,
          v.public_status,
          e.status,
          e.current_round,
          e.stage_key,
          e.placement
    FROM  public.competition_entries e
    JOIN  public.entry_public_status v ON v.entry_id = e.id
   WHERE  e.public_status_derived IS DISTINCT FROM v.public_status;
END;
$$;

REVOKE ALL ON FUNCTION public.get_derived_status_drift_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_derived_status_drift_admin() TO authenticated;