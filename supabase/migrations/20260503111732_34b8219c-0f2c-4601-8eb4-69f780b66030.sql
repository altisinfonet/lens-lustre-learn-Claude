CREATE OR REPLACE FUNCTION public.get_photo_r4_awards(p_entry_ids uuid[])
RETURNS TABLE (
  entry_id uuid,
  photo_index int,
  stage_key text,
  participant_label text,
  all_stage_keys text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH priority(stage_key, rank) AS (
    VALUES
      ('r4_winner',           1),
      ('r4_runner_up_1',      2),
      ('r4_runner_up_2',      3),
      ('r4_special_jury',     4),
      ('r4_honorary_mention', 5),
      ('r4_top_50',           6),
      ('r4_top_100',          7),
      ('r4_finalist',         8)
  ),
  distinct_tags AS (
    SELECT DISTINCT t.entry_id, t.photo_index, t.stage_key
    FROM public.judge_award_tags t
    WHERE t.entry_id = ANY(p_entry_ids)
      AND t.round_number = 4
  ),
  ranked AS (
    SELECT d.entry_id, d.photo_index, d.stage_key, p.rank
    FROM distinct_tags d
    JOIN priority p USING (stage_key)
  ),
  best AS (
    SELECT DISTINCT ON (entry_id, photo_index)
      entry_id, photo_index, stage_key
    FROM ranked
    ORDER BY entry_id, photo_index, rank ASC
  )
  SELECT
    b.entry_id,
    b.photo_index,
    b.stage_key,
    cat.tag_label_canonical AS participant_label,
    ARRAY(
      SELECT r.stage_key
      FROM ranked r
      WHERE r.entry_id = b.entry_id AND r.photo_index = b.photo_index
      ORDER BY r.rank ASC
    ) AS all_stage_keys
  FROM best b
  JOIN public.v3_stage_catalog cat ON cat.stage_key = b.stage_key;
$$;

GRANT EXECUTE ON FUNCTION public.get_photo_r4_awards(uuid[]) TO authenticated, anon, service_role;