BEGIN;
ALTER TABLE public.judge_scores DISABLE TRIGGER USER;

DO $$
DECLARE
  v_comp_id uuid := '00000000-0000-0000-0000-00000000a10c';
  v_judge1 uuid := '5745a9c9-55ec-4f0b-8a75-3a55ab3064d8';
  v_judge2 uuid := 'a2742a5c-f573-4674-84f0-a17e29425cf4';
BEGIN
  INSERT INTO public.judge_scores (
    entry_id, judge_id, photo_index,
    line_score, shape_score, form_score, texture_score, space_score,
    tone_score, balance_score, light_score, depth_score, color_palette_score,
    composition_score, technique_score
  )
  SELECT e.id, j.judge_id, 0,
    1 + (rn % 10), 1 + ((rn+1) % 10), 1 + ((rn+2) % 10),
    1 + ((rn+3) % 10), 1 + ((rn+4) % 10), 1 + ((rn+5) % 10),
    1 + ((rn+6) % 10), 1 + ((rn+7) % 10), 1 + ((rn+8) % 10),
    1 + ((rn+9) % 10), 1 + ((rn+1) % 10), 1 + ((rn+2) % 10)
  FROM (
    SELECT ce.id, row_number() OVER (ORDER BY ce.created_at) AS rn
    FROM public.competition_entries ce
    WHERE ce.competition_id = v_comp_id
      AND EXISTS (
        SELECT 1 FROM public.judge_decisions jd
        WHERE jd.entry_id = ce.id AND jd.round_number = 1
          AND jd.decision IN ('accept','shortlist')
        LIMIT 1
      )
  ) e
  CROSS JOIN (VALUES (v_judge1), (v_judge2)) AS j(judge_id);
END $$;

ALTER TABLE public.judge_scores ENABLE TRIGGER USER;

-- Manually refresh score cache for all audit entries (since trigger was bypassed during bulk insert)
INSERT INTO public.entry_score_cache (entry_id, avg_score, total_scores, last_updated)
SELECT
  js.entry_id,
  ROUND(AVG((
    COALESCE(js.line_score, 0) + COALESCE(js.shape_score, 0) + COALESCE(js.form_score, 0) +
    COALESCE(js.texture_score, 0) + COALESCE(js.space_score, 0) + COALESCE(js.tone_score, 0) +
    COALESCE(js.balance_score, 0) + COALESCE(js.light_score, 0) + COALESCE(js.depth_score, 0) +
    COALESCE(js.color_palette_score, 0)
  ) / 10.0)::numeric, 2),
  count(*),
  now()
FROM public.judge_scores js
JOIN public.competition_entries ce ON ce.id = js.entry_id
WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c'
GROUP BY js.entry_id
ON CONFLICT (entry_id) DO UPDATE
  SET avg_score = EXCLUDED.avg_score,
      total_scores = EXCLUDED.total_scores,
      last_updated = EXCLUDED.last_updated;

COMMIT;

SELECT count(*) AS r2_score_rows FROM public.judge_scores
WHERE entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c');

SELECT count(*) AS cached_entries, round(avg(avg_score)::numeric, 2) AS avg_of_avgs,
       min(avg_score) AS min_avg, max(avg_score) AS max_avg
FROM public.entry_score_cache
WHERE entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c');