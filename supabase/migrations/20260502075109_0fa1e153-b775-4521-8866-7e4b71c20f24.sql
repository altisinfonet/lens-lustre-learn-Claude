CREATE OR REPLACE FUNCTION public.get_per_photo_placement(p_entry_ids uuid[])
RETURNS TABLE (
  entry_id uuid,
  photo_index integer,
  round_number integer,
  status text,
  status_legacy text,
  award_label text,
  declared boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH label_to_key AS (
    SELECT * FROM (VALUES
      ('Winner',                    'r4_winner',           1),
      ('1st Runner-Up',             'r4_runner_up_1',      2),
      ('2nd Runner-Up',             'r4_runner_up_2',      3),
      ('Top 50',                    'r4_top_50',           4),
      ('Top 100',                   'r4_top_100',          5),
      ('Qualified for Final Round', 'r4_finalist',         6),
      ('Honorary Mention',          'r4_honorary_mention', 7),
      ('Special Jury Award',        'r4_special_jury',     8)
    ) AS t(label, canonical_key, priority)
  ),
  raw AS (
    SELECT
      jta.entry_id,
      jta.photo_index,
      ce.competition_id,
      ce.user_id        AS owner_id,
      l.canonical_key,
      l.label,
      l.priority
    FROM public.judge_tag_assignments jta
    JOIN public.judging_tags jt    ON jt.id = jta.tag_id
    JOIN label_to_key       l      ON l.label = jt.label
    JOIN public.competition_entries ce ON ce.id = jta.entry_id
    WHERE jta.round_number = 4
      AND jta.entry_id = ANY(p_entry_ids)
  ),
  ranked AS (
    SELECT
      entry_id, photo_index, competition_id, owner_id,
      canonical_key, label,
      ROW_NUMBER() OVER (
        PARTITION BY entry_id, photo_index
        ORDER BY priority ASC
      ) AS rn
    FROM raw
  ),
  picked AS (
    SELECT entry_id, photo_index, competition_id, owner_id, canonical_key, label
    FROM ranked WHERE rn = 1
  ),
  publish AS (
    SELECT competition_id,
           (published_at IS NOT NULL) AS declared
    FROM public.competition_round_publish
    WHERE round_number = 4
  ),
  viewer AS (
    SELECT
      auth.uid()                                                  AS uid,
      public.has_role(auth.uid(), 'admin'::public.app_role)       AS is_admin
  )
  SELECT
    p.entry_id,
    p.photo_index,
    4                                   AS round_number,
    p.canonical_key                     AS status,
    NULL::text                          AS status_legacy,
    p.label                             AS award_label,
    COALESCE(pub.declared, false)       AS declared
  FROM picked p
  LEFT JOIN publish pub USING (competition_id)
  CROSS JOIN viewer v
  WHERE
    COALESCE(pub.declared, false) = true
    OR v.is_admin = true
    OR p.owner_id = v.uid
    OR EXISTS (
      SELECT 1 FROM public.competition_judges cj
      WHERE cj.competition_id = p.competition_id
        AND cj.judge_id = v.uid
    );
$$;

REVOKE ALL ON FUNCTION public.get_per_photo_placement(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_per_photo_placement(uuid[]) TO authenticated, anon;

COMMENT ON FUNCTION public.get_per_photo_placement(uuid[]) IS
  'Phase 3 sibling to get_per_photo_consensus. Returns R4 award placements per photo using the 8 Frozen Contract v3 canonical R4 keys: r4_winner, r4_runner_up_1, r4_runner_up_2, r4_top_50, r4_top_100, r4_finalist, r4_honorary_mention, r4_special_jury. Source: judge_tag_assignments (round_number=4) JOIN judging_tags. Privacy: declared (published_at IS NOT NULL) gate for non-admin/non-judge/non-owner viewers. Tie-break: priority winner > runner_up_1 > runner_up_2 > top_50 > top_100 > finalist > honorary_mention > special_jury.';