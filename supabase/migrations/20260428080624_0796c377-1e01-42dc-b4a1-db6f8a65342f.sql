SELECT set_config('app.bypass_round_lock', 'on', true);

WITH payload AS (
  SELECT
    'f59076bc-a7e5-46e2-ba3b-f218a660dd64'::uuid AS entry_id,
    '4c200b33-ae64-46f0-ba5d-1a97152e6a6c'::uuid AS judge_id,
    1::integer AS round_number,
    pi::integer AS photo_index,
    '13f2d1bd-06cd-40e8-a086-64762d6fa372'::uuid AS tag_id
  FROM unnest(ARRAY[10, 11, 12]) AS pi
)
INSERT INTO public.judge_tag_assignments (entry_id, tag_id, judge_id, photo_index, round_number)
SELECT entry_id, tag_id, judge_id, photo_index, round_number
FROM payload
ON CONFLICT (entry_id, tag_id, judge_id, round_number, photo_index) DO NOTHING;

WITH payload AS (
  SELECT
    'f59076bc-a7e5-46e2-ba3b-f218a660dd64'::uuid AS entry_id,
    '4c200b33-ae64-46f0-ba5d-1a97152e6a6c'::uuid AS judge_id,
    1::integer AS round_number,
    pi::integer AS photo_index,
    'shortlist'::text AS decision
  FROM unnest(ARRAY[10, 11, 12]) AS pi
)
INSERT INTO public.judge_decisions (entry_id, judge_id, round_number, photo_index, decision)
SELECT entry_id, judge_id, round_number, photo_index, decision
FROM payload
ON CONFLICT (entry_id, judge_id, round_number, photo_index)
DO UPDATE SET decision = EXCLUDED.decision, updated_at = now()
WHERE public.judge_decisions.decision IS DISTINCT FROM EXCLUDED.decision;