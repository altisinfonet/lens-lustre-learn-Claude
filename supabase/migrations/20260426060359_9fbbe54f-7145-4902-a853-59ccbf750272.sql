-- U-5 Phase 1: Extend gated participant view with R4 sub-bucket statuses
-- Per Spec v3 §4 (auto-tier qualified_final) and §7 (mirror view shows Top 50/100 + Qualified Final)

-- Step 1: Recreate entry_public_status view with two changes:
--   (a) Add 'qualified_final' to the R4-publish branch of public_status CASE
--   (b) Add new public_r4_tags text[] column aggregating visible R4 tag labels
--       (Top 50 / Top 100 — Winner/RU/Honorary/Special Jury already surfaced via placement)
DROP VIEW IF EXISTS public.entry_public_status CASCADE;

CREATE VIEW public.entry_public_status AS
SELECT
  e.id AS entry_id,
  e.competition_id,
  CASE
    -- R4 published: winner, finalist, qualified_final all become public
    WHEN (e.status = ANY (ARRAY['winner'::text, 'finalist'::text, 'qualified_final'::text]))
      AND EXISTS (
        SELECT 1 FROM competition_round_publish p
        WHERE p.competition_id = e.competition_id
          AND p.round_number = 4
          AND p.published_at IS NOT NULL
      ) THEN e.status
    WHEN e.status = 'shortlisted'::text
      AND EXISTS (
        SELECT 1 FROM competition_round_publish p
        WHERE p.competition_id = e.competition_id
          AND p.round_number = 3
          AND p.published_at IS NOT NULL
      ) THEN e.status
    WHEN e.status = 'round2_qualified'::text
      AND EXISTS (
        SELECT 1 FROM competition_round_publish p
        WHERE p.competition_id = e.competition_id
          AND p.round_number = 2
          AND p.published_at IS NOT NULL
      ) THEN e.status
    WHEN (e.status = ANY (ARRAY['round1_qualified'::text, 'rejected'::text]))
      AND EXISTS (
        SELECT 1 FROM competition_round_publish p
        WHERE p.competition_id = e.competition_id
          AND p.round_number = 1
          AND p.published_at IS NOT NULL
      ) THEN e.status
    WHEN e.status = ANY (ARRAY['submitted'::text, 'needs_review'::text]) THEN e.status
    ELSE 'judging_in_progress'::text
  END AS public_status,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM competition_round_publish p
      WHERE p.competition_id = e.competition_id
        AND p.published_at IS NOT NULL
    ) THEN e.current_round
    ELSE NULL::text
  END AS public_round,
  CASE
    WHEN e.progression_decision = 'not_selected'::text
      AND EXISTS (
        SELECT 1 FROM competition_round_publish p
        WHERE p.competition_id = e.competition_id
          AND p.round_number = NULLIF(regexp_replace(COALESCE(e.current_round, ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer
          AND p.published_at IS NOT NULL
      ) THEN 'not_selected_for_next_round'::text
    ELSE NULL::text
  END AS public_progression_note,
  CASE
    WHEN e.placement IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM competition_round_publish p
        WHERE p.competition_id = e.competition_id
          AND p.round_number = 4
          AND p.published_at IS NOT NULL
      ) THEN e.placement
    ELSE NULL::text
  END AS public_placement,
  -- NEW: R4 visible tags (Top 50, Top 100) aggregated from judge_tag_assignments
  -- Only revealed once R4 is published. Winner/RU/Honorary/Special Jury are
  -- intentionally excluded here because they already surface via public_placement.
  CASE
    WHEN EXISTS (
      SELECT 1 FROM competition_round_publish p
      WHERE p.competition_id = e.competition_id
        AND p.round_number = 4
        AND p.published_at IS NOT NULL
    ) THEN (
      SELECT ARRAY_AGG(DISTINCT jt.label ORDER BY jt.label)
      FROM judge_tag_assignments jta
      JOIN judging_tags jt ON jt.id = jta.tag_id
      WHERE jta.entry_id = e.id
        AND jt.is_active = true
        AND jt.is_visible = true
        AND 4 = ANY(jt.visible_in_round)
        AND jt.label IN ('Top 50', 'Top 100')
    )
    ELSE NULL::text[]
  END AS public_r4_tags
FROM competition_entries e;

-- Step 2: Recreate gated RPC to expose new column
DROP FUNCTION IF EXISTS public.get_gated_entry_status(uuid[]);

CREATE OR REPLACE FUNCTION public.get_gated_entry_status(p_entry_ids uuid[])
RETURNS TABLE(
  entry_id uuid,
  competition_id uuid,
  public_status text,
  public_round text,
  public_placement text,
  public_progression_note text,
  public_r4_tags text[],
  has_pending_verification boolean,
  verification_overrides_status boolean,
  is_published_any_round boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      eps.entry_id,
      eps.competition_id,
      eps.public_status,
      eps.public_round,
      eps.public_placement,
      eps.public_progression_note,
      eps.public_r4_tags
    FROM public.entry_public_status eps
    WHERE eps.entry_id = ANY(p_entry_ids)
  ),
  pending_ver AS (
    SELECT entry_id, COUNT(*)::int AS n
    FROM public.photo_verification_requests
    WHERE entry_id = ANY(p_entry_ids)
      AND status IN ('pending', 'submitted')
      AND (expires_at IS NULL OR expires_at > now())
    GROUP BY entry_id
  ),
  any_pub AS (
    SELECT competition_id, bool_or(published_at IS NOT NULL) AS pub
    FROM public.competition_round_publish
    WHERE competition_id IN (SELECT competition_id FROM base)
    GROUP BY competition_id
  )
  SELECT
    b.entry_id,
    b.competition_id,
    b.public_status,
    b.public_round,
    b.public_placement,
    b.public_progression_note,
    b.public_r4_tags,
    COALESCE(pv.n, 0) > 0 AS has_pending_verification,
    COALESCE(pv.n, 0) > 0 AS verification_overrides_status,
    COALESCE(ap.pub, false) AS is_published_any_round
  FROM base b
  LEFT JOIN pending_ver pv ON pv.entry_id = b.entry_id
  LEFT JOIN any_pub ap ON ap.competition_id = b.competition_id;
$function$;