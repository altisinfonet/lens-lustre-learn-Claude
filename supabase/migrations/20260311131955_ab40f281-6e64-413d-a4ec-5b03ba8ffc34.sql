
ALTER TABLE public.competition_entries 
  ADD COLUMN IF NOT EXISTS ai_detection_result jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS exif_data jsonb DEFAULT NULL;
