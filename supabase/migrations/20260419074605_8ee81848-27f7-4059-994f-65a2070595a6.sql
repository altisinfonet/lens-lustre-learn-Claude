-- Phase 1: Per-photo metadata model for competition_entries
-- Decisions: D1 disable AI (advisory), D2 jsonb, D6 backfill, D7 RAW for shortlist

-- 1. Add new columns
ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS photo_meta jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_ai_advisory boolean NOT NULL DEFAULT true;

-- 2. Description becomes optional (it already is nullable; ensure default null)
ALTER TABLE public.competition_entries
  ALTER COLUMN description DROP NOT NULL;

-- 3. GIN index for jsonb queries (e.g. RAW required filter)
CREATE INDEX IF NOT EXISTS idx_competition_entries_photo_meta
  ON public.competition_entries USING GIN (photo_meta);

-- 4. Backfill photo_meta for every existing entry that has photos but empty meta
UPDATE public.competition_entries ce
SET photo_meta = sub.meta
FROM (
  SELECT
    e.id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'url', e.photos[g.idx + 1],
          'thumbnail_url', COALESCE(e.photo_thumbnails[g.idx + 1], e.photos[g.idx + 1]),
          'title', e.title,
          'exif', CASE WHEN g.idx = 0 THEN COALESCE(e.exif_data, '{}'::jsonb) ELSE '{}'::jsonb END,
          'exif_available', CASE WHEN g.idx = 0 AND e.exif_data IS NOT NULL AND e.exif_data <> '{}'::jsonb THEN true ELSE false END,
          'raw_required', false,
          'image_hash', null
        )
        ORDER BY g.idx
      ),
      '[]'::jsonb
    ) AS meta
  FROM public.competition_entries e
  CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(e.photos, 1), 0) - 1, 0)) AS g(idx)
  WHERE COALESCE(array_length(e.photos, 1), 0) > 0
    AND (e.photo_meta IS NULL OR e.photo_meta = '[]'::jsonb)
  GROUP BY e.id
) sub
WHERE ce.id = sub.id;

-- 5. Validation trigger: photo_meta length must match photos length
CREATE OR REPLACE FUNCTION public.validate_competition_entry_photo_meta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _photos_len  integer := COALESCE(array_length(NEW.photos, 1), 0);
  _meta_len    integer := COALESCE(jsonb_array_length(NEW.photo_meta), 0);
BEGIN
  -- Allow empty meta only if no photos (shouldn't happen, but defensive)
  IF _photos_len = 0 THEN
    RETURN NEW;
  END IF;

  -- Meta must match photo count exactly
  IF _meta_len <> _photos_len THEN
    RAISE EXCEPTION 'photo_meta length (%) must match photos length (%)', _meta_len, _photos_len
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_competition_entry_photo_meta ON public.competition_entries;
CREATE TRIGGER trg_validate_competition_entry_photo_meta
BEFORE INSERT OR UPDATE OF photos, photo_meta ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.validate_competition_entry_photo_meta();