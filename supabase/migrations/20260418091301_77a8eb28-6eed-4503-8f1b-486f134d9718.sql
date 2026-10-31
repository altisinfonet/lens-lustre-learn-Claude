-- R1 decisions: judge 1 + judge 2 both decide on all 10k entries
DO $$
DECLARE
  v_comp_id uuid := '00000000-0000-0000-0000-00000000a10c';
  v_judge1 uuid := '5745a9c9-55ec-4f0b-8a75-3a55ab3064d8';
  v_judge2 uuid := 'a2742a5c-f573-4674-84f0-a17e29425cf4';
BEGIN
  -- Both judges decide on each entry. Decision derived from row_number to give predictable mix.
  INSERT INTO public.judge_decisions (entry_id, judge_id, round_number, decision, photo_index)
  SELECT e.id, j.judge_id, 1,
    CASE
      WHEN (rn % 20) = 0 THEN 'needs_review'
      WHEN (rn % 10) = 1 THEN 'reject'
      WHEN (rn % 4)  = 0 THEN 'shortlist'
      ELSE 'accept'
    END, 0
  FROM (
    SELECT id, row_number() OVER (ORDER BY created_at) AS rn
    FROM public.competition_entries WHERE competition_id = v_comp_id
  ) e
  CROSS JOIN (VALUES (v_judge1), (v_judge2)) AS j(judge_id);
END $$;

SELECT decision, count(*) FROM public.judge_decisions
WHERE entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c')
  AND round_number=1
GROUP BY decision ORDER BY decision;