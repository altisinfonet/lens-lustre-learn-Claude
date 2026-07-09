-- P-3: Score-cache AFTER trigger on judge_scores
-- Upgrade refresh_score_cache to average the 10 SOW criteria across all judges/photos for an entry.
-- Fallback to legacy `score` column when no criterion values are present (back-compat).

CREATE OR REPLACE FUNCTION public.refresh_score_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_entry_id UUID;
BEGIN
  target_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

  INSERT INTO public.entry_score_cache (entry_id, avg_score, total_scores, last_updated)
  SELECT
    target_entry_id,
    COALESCE(
      AVG(
        -- Per-row criterion average (NULL-safe). Falls back to legacy `score`
        -- if no criterion values exist on this row.
        COALESCE(
          (
            SELECT AVG(v)::numeric
            FROM unnest(ARRAY[
              js.line_score::numeric, js.shape_score::numeric, js.form_score::numeric,
              js.texture_score::numeric, js.space_score::numeric, js.tone_score::numeric,
              js.balance_score::numeric, js.light_score::numeric, js.depth_score::numeric
            ]) AS v
            WHERE v IS NOT NULL
          ),
          js.score::numeric
        )
      ),
      0
    ),
    COUNT(*),
    now()
  FROM public.judge_scores js
  WHERE js.entry_id = target_entry_id
  ON CONFLICT (entry_id) DO UPDATE SET
    avg_score = EXCLUDED.avg_score,
    total_scores = EXCLUDED.total_scores,
    last_updated = EXCLUDED.last_updated;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Backfill cache once so existing entries reflect the new formula immediately.
INSERT INTO public.entry_score_cache (entry_id, avg_score, total_scores, last_updated)
SELECT
  js.entry_id,
  COALESCE(
    AVG(
      COALESCE(
        (
          SELECT AVG(v)::numeric
          FROM unnest(ARRAY[
            js.line_score::numeric, js.shape_score::numeric, js.form_score::numeric,
            js.texture_score::numeric, js.space_score::numeric, js.tone_score::numeric,
            js.balance_score::numeric, js.light_score::numeric, js.depth_score::numeric
          ]) AS v
          WHERE v IS NOT NULL
        ),
        js.score::numeric
      )
    ),
    0
  ),
  COUNT(*),
  now()
FROM public.judge_scores js
GROUP BY js.entry_id
ON CONFLICT (entry_id) DO UPDATE SET
  avg_score = EXCLUDED.avg_score,
  total_scores = EXCLUDED.total_scores,
  last_updated = EXCLUDED.last_updated;