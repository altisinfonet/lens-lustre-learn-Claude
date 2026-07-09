-- B1.9 (retry): drop B1.7 recompute fn first because parameter rename

DROP FUNCTION IF EXISTS public.recompute_entry_public_status(uuid) CASCADE;

ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS public_round_derived           text,
  ADD COLUMN IF NOT EXISTS public_placement_derived       text,
  ADD COLUMN IF NOT EXISTS public_progression_note_derived text,
  ADD COLUMN IF NOT EXISTS public_r4_tags_derived         text[];

CREATE INDEX IF NOT EXISTS idx_ce_public_round_derived
  ON public.competition_entries (public_round_derived);
CREATE INDEX IF NOT EXISTS idx_ce_public_placement_derived
  ON public.competition_entries (public_placement_derived);

CREATE FUNCTION public.recompute_entry_public_status(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.competition_entries ce
     SET public_status_derived           = v.public_status,
         public_round_derived            = v.public_round,
         public_placement_derived        = v.public_placement,
         public_progression_note_derived = v.public_progression_note,
         public_r4_tags_derived          = v.public_r4_tags
    FROM public.entry_public_status v
   WHERE ce.id = p_entry_id
     AND v.entry_id = ce.id
     AND (
          ce.public_status_derived           IS DISTINCT FROM v.public_status
       OR ce.public_round_derived            IS DISTINCT FROM v.public_round
       OR ce.public_placement_derived        IS DISTINCT FROM v.public_placement
       OR ce.public_progression_note_derived IS DISTINCT FROM v.public_progression_note
       OR ce.public_r4_tags_derived          IS DISTINCT FROM v.public_r4_tags
     );
END;
$$;

-- Recreate trigger fns + triggers that CASCADE may have dropped
CREATE OR REPLACE FUNCTION public._tg_entry_public_status_recompute()
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
AFTER INSERT OR UPDATE OF
  stage_key, status, current_round, placement, progression_decision
ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public._tg_entry_public_status_recompute();

CREATE OR REPLACE FUNCTION public._tg_round_publish_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
  e   record;
BEGIN
  cid := COALESCE(NEW.competition_id, OLD.competition_id);
  FOR e IN SELECT id FROM public.competition_entries WHERE competition_id = cid LOOP
    PERFORM public.recompute_entry_public_status(e.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_round_publish_recompute ON public.competition_round_publish;
CREATE TRIGGER trg_round_publish_recompute
AFTER INSERT OR UPDATE OR DELETE
ON public.competition_round_publish
FOR EACH ROW
EXECUTE FUNCTION public._tg_round_publish_recompute();

-- Backfill all 5 cached fields
UPDATE public.competition_entries ce
   SET public_status_derived           = v.public_status,
       public_round_derived            = v.public_round,
       public_placement_derived        = v.public_placement,
       public_progression_note_derived = v.public_progression_note,
       public_r4_tags_derived          = v.public_r4_tags
  FROM public.entry_public_status v
 WHERE v.entry_id = ce.id
   AND (
        ce.public_status_derived           IS DISTINCT FROM v.public_status
     OR ce.public_round_derived            IS DISTINCT FROM v.public_round
     OR ce.public_placement_derived        IS DISTINCT FROM v.public_placement
     OR ce.public_progression_note_derived IS DISTINCT FROM v.public_progression_note
     OR ce.public_r4_tags_derived          IS DISTINCT FROM v.public_r4_tags
   );

-- Rewire get_gated_entry_status to prefer the cache for ALL gated fields
CREATE OR REPLACE FUNCTION public.get_gated_entry_status(p_entry_ids uuid[])
RETURNS TABLE (
  entry_id uuid,
  competition_id uuid,
  public_status text,
  public_round text,
  public_placement text,
  public_progression_note text,
  public_r4_tags text[],
  has_pending_verification boolean,
  verification_overrides_status boolean,
  is_published_any_round boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    ce.id,
    ce.competition_id,
    COALESCE(ce.public_status_derived, v.public_status),
    COALESCE(ce.public_round_derived,  v.public_round),
    COALESCE(ce.public_placement_derived, v.public_placement),
    COALESCE(ce.public_progression_note_derived, v.public_progression_note),
    COALESCE(ce.public_r4_tags_derived, v.public_r4_tags),
    false,
    false,
    EXISTS (
      SELECT 1 FROM public.competition_round_publish crp
       WHERE crp.competition_id = ce.competition_id
         AND crp.published_at IS NOT NULL
    )
  FROM public.competition_entries ce
  LEFT JOIN public.entry_public_status v ON v.entry_id = ce.id
  WHERE ce.id = ANY(p_entry_ids);
$$;

-- Broaden runtime drift RPC to all 5 fields, admin-only
DROP FUNCTION IF EXISTS public.get_gated_status_runtime_drift_admin(uuid[]);

CREATE FUNCTION public.get_gated_status_runtime_drift_admin(p_entry_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  entry_id uuid,
  field text,
  cache_value text,
  view_value text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT ce.id, 'public_status'::text, ce.public_status_derived, v.public_status
    FROM public.competition_entries ce
    JOIN public.entry_public_status v ON v.entry_id = ce.id
   WHERE (p_entry_ids IS NULL OR ce.id = ANY(p_entry_ids))
     AND ce.public_status_derived IS DISTINCT FROM v.public_status
  UNION ALL
  SELECT ce.id, 'public_round', ce.public_round_derived, v.public_round
    FROM public.competition_entries ce
    JOIN public.entry_public_status v ON v.entry_id = ce.id
   WHERE (p_entry_ids IS NULL OR ce.id = ANY(p_entry_ids))
     AND ce.public_round_derived IS DISTINCT FROM v.public_round
  UNION ALL
  SELECT ce.id, 'public_placement', ce.public_placement_derived, v.public_placement
    FROM public.competition_entries ce
    JOIN public.entry_public_status v ON v.entry_id = ce.id
   WHERE (p_entry_ids IS NULL OR ce.id = ANY(p_entry_ids))
     AND ce.public_placement_derived IS DISTINCT FROM v.public_placement
  UNION ALL
  SELECT ce.id, 'public_progression_note',
         ce.public_progression_note_derived, v.public_progression_note
    FROM public.competition_entries ce
    JOIN public.entry_public_status v ON v.entry_id = ce.id
   WHERE (p_entry_ids IS NULL OR ce.id = ANY(p_entry_ids))
     AND ce.public_progression_note_derived IS DISTINCT FROM v.public_progression_note
  UNION ALL
  SELECT ce.id, 'public_r4_tags',
         array_to_string(ce.public_r4_tags_derived,','),
         array_to_string(v.public_r4_tags,',')
    FROM public.competition_entries ce
    JOIN public.entry_public_status v ON v.entry_id = ce.id
   WHERE (p_entry_ids IS NULL OR ce.id = ANY(p_entry_ids))
     AND ce.public_r4_tags_derived IS DISTINCT FROM v.public_r4_tags;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gated_status_runtime_drift_admin(uuid[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_gated_status_runtime_drift_admin(uuid[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_gated_status_runtime_drift_admin(uuid[]) TO authenticated;
