BEGIN;
ALTER TABLE public.judge_scores DISABLE TRIGGER USER;

UPDATE public.judge_scores js
SET
  line_score        = 1 + ((sub.rn * 7 ) % 10),
  shape_score       = 1 + ((sub.rn * 11 + 1) % 10),
  form_score        = 1 + ((sub.rn * 13 + 2) % 10),
  texture_score     = 1 + ((sub.rn * 17 + 3) % 10),
  space_score       = 1 + ((sub.rn * 19 + 4) % 10),
  tone_score        = 1 + ((sub.rn * 23 + 5) % 10),
  balance_score     = 1 + ((sub.rn * 29 + 6) % 10),
  light_score       = 1 + ((sub.rn * 31 + 7) % 10),
  depth_score       = 1 + ((sub.rn * 37 + 8) % 10),
  color_palette_score = 1 + ((sub.rn * 41 + 9) % 10)
FROM (
  SELECT ce.id, row_number() OVER (ORDER BY ce.created_at) AS rn
  FROM public.competition_entries ce
  WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c'
) sub
WHERE js.entry_id = sub.id;

ALTER TABLE public.judge_scores ENABLE TRIGGER USER;

UPDATE public.entry_score_cache esc
SET avg_score = sub.new_avg, total_scores = sub.cnt, last_updated = now()
FROM (
  SELECT
    js.entry_id,
    ROUND(AVG((
      COALESCE(js.line_score, 0) + COALESCE(js.shape_score, 0) + COALESCE(js.form_score, 0) +
      COALESCE(js.texture_score, 0) + COALESCE(js.space_score, 0) + COALESCE(js.tone_score, 0) +
      COALESCE(js.balance_score, 0) + COALESCE(js.light_score, 0) + COALESCE(js.depth_score, 0) +
      COALESCE(js.color_palette_score, 0)
    ) / 10.0)::numeric, 2) AS new_avg,
    count(*) AS cnt
  FROM public.judge_scores js
  JOIN public.competition_entries ce ON ce.id = js.entry_id
  WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c'
  GROUP BY js.entry_id
) sub
WHERE esc.entry_id = sub.entry_id;

WITH top2k AS (
  SELECT esc.entry_id
  FROM public.entry_score_cache esc
  JOIN public.competition_entries ce ON ce.id = esc.entry_id
  WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c'
  ORDER BY esc.avg_score DESC LIMIT 2000
)
UPDATE public.competition_entries ce
SET status = 'round2_qualified', current_round = '3'
FROM top2k WHERE ce.id = top2k.entry_id;

INSERT INTO public.judge_decisions (entry_id, judge_id, round_number, decision, photo_index)
SELECT q.entry_id, j.judge_id, 3,
  CASE WHEN q.rk <= 500 THEN 'finalist' ELSE 'shortlist' END, 0
FROM (
  SELECT ce.id AS entry_id, row_number() OVER (ORDER BY esc.avg_score DESC) AS rk
  FROM public.competition_entries ce
  JOIN public.entry_score_cache esc ON esc.entry_id = ce.id
  WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c' AND ce.current_round = '3'
) q
CROSS JOIN (VALUES ('5745a9c9-55ec-4f0b-8a75-3a55ab3064d8'::uuid),
                   ('a2742a5c-f573-4674-84f0-a17e29425cf4'::uuid)) AS j(judge_id);

WITH top500 AS (
  SELECT esc.entry_id
  FROM public.entry_score_cache esc
  JOIN public.competition_entries ce ON ce.id = esc.entry_id
  WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c' AND ce.current_round = '3'
  ORDER BY esc.avg_score DESC LIMIT 500
)
UPDATE public.competition_entries ce
SET status = 'finalist', current_round = '4'
FROM top500 WHERE ce.id = top500.entry_id;

INSERT INTO public.judge_decisions (entry_id, judge_id, round_number, decision, photo_index)
SELECT ce.id, j.judge_id, 4, 'accept', 0
FROM public.competition_entries ce
CROSS JOIN (VALUES ('5745a9c9-55ec-4f0b-8a75-3a55ab3064d8'::uuid),
                   ('a2742a5c-f573-4674-84f0-a17e29425cf4'::uuid)) AS j(judge_id)
WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c' AND ce.current_round = '4';

WITH top3 AS (
  SELECT esc.entry_id, row_number() OVER (ORDER BY esc.avg_score DESC) AS rk
  FROM public.entry_score_cache esc
  JOIN public.competition_entries ce ON ce.id = esc.entry_id
  WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c' AND ce.current_round = '4'
  ORDER BY esc.avg_score DESC LIMIT 3
)
UPDATE public.competition_entries ce
SET placement = CASE top3.rk WHEN 1 THEN 'winner' WHEN 2 THEN 'first_runner_up' WHEN 3 THEN 'second_runner_up' END
FROM top3 WHERE ce.id = top3.entry_id;

COMMIT;

SELECT 'r2_distribution' AS check, count(DISTINCT avg_score) AS distinct_avgs,
       round(min(avg_score)::numeric,2) AS mn, round(max(avg_score)::numeric,2) AS mx
FROM public.entry_score_cache esc
JOIN public.competition_entries ce ON ce.id = esc.entry_id
WHERE ce.competition_id = '00000000-0000-0000-0000-00000000a10c';

SELECT 'r3_promoted' AS chk, count(*) FROM public.competition_entries
WHERE competition_id='00000000-0000-0000-0000-00000000a10c' AND current_round='3';

SELECT 'r4_promoted' AS chk, count(*) FROM public.competition_entries
WHERE competition_id='00000000-0000-0000-0000-00000000a10c' AND current_round='4';

SELECT 'awards' AS chk, placement, count(*) FROM public.competition_entries
WHERE competition_id='00000000-0000-0000-0000-00000000a10c' AND placement IS NOT NULL
GROUP BY placement ORDER BY placement;