DELETE FROM judge_tag_assignments
WHERE entry_id='c696a97c-b811-4f18-86a8-14281f39409c'
  AND photo_index=0
  AND judge_id IN ('4c200b33-ae64-46f0-ba5d-1a97152e6a6c','5745a9c9-55ec-4f0b-8a75-3a55ab3064d8','a2742a5c-f573-4674-84f0-a17e29425cf4');

DELETE FROM judge_decisions
WHERE entry_id='c696a97c-b811-4f18-86a8-14281f39409c'
  AND photo_index=0
  AND judge_id IN ('4c200b33-ae64-46f0-ba5d-1a97152e6a6c','5745a9c9-55ec-4f0b-8a75-3a55ab3064d8','a2742a5c-f573-4674-84f0-a17e29425cf4');

DELETE FROM v3_mirror_log
WHERE entry_id='c696a97c-b811-4f18-86a8-14281f39409c'
  AND occurred_at >= now() - interval '1 hour';