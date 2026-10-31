-- ──────────────────────────────────────────────────────────────────────────────
-- Preflight Validation: Single Source of Truth for "Eligible Photos"
-- ──────────────────────────────────────────────────────────────────────────────
-- The judge-side "Complete Round" button has historically computed the set of
-- eligible photos in the React layer, while the complete-round edge function
-- recomputes it server-side. Even minor SQL drift between the two has caused
-- judges to see "0 unjudged" while the server rejected the round close.
--
-- This migration introduces:
--   1. judging_preflight_log    — append-only audit trail of every preflight
--                                 call; lets admins forensically reconstruct
--                                 any UI↔DB mismatch a judge encountered.
--   2. get_round_judging_gate_self(uuid, int)
--      — a SECURITY DEFINER RPC callable by the judge themselves (or any
--        admin) that returns the SAME canonical eligibility data the existing
--        admin-only `get_round_judging_gate_admin` returns, but scoped to the
--        caller's assigned entries only. Both RPCs share the same SQL spine,
--        so UI, edge fn, and admin audit can never drift apart.
--
-- Read-only RPC; no writes. Audit logging is the only side effect (and it is
-- triggered explicitly by the edge function in `preflight` mode, NOT by this
-- read RPC).
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Audit log table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.judging_preflight_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID        NOT NULL,
  round_number    INT         NOT NULL,
  caller_id       UUID        NOT NULL,
  caller_role     TEXT        NOT NULL,    -- 'judge' | 'admin'
  ui_count        INT         NOT NULL,    -- # eligible photos UI thinks judge owns
  db_count        INT         NOT NULL,    -- # eligible photos canonical RPC returns
  diff_count      INT         NOT NULL,    -- |ui Δ db|
  ui_only_sample  JSONB       NOT NULL DEFAULT '[]'::jsonb, -- entry/photo pairs UI had, DB lacked
  db_only_sample  JSONB       NOT NULL DEFAULT '[]'::jsonb, -- entry/photo pairs DB had, UI lacked
  drift_detected  BOOLEAN     NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judging_preflight_log_comp_round
  ON public.judging_preflight_log (competition_id, round_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_judging_preflight_log_drift
  ON public.judging_preflight_log (drift_detected, created_at DESC)
  WHERE drift_detected = true;

ALTER TABLE public.judging_preflight_log ENABLE ROW LEVEL SECURITY;

-- Judges can read their OWN preflight history (debugging their own button);
-- admins can read all. Inserts are service-role only (edge fn).
DROP POLICY IF EXISTS "judging_preflight_log_self_read" ON public.judging_preflight_log;
CREATE POLICY "judging_preflight_log_self_read"
  ON public.judging_preflight_log
  FOR SELECT
  TO authenticated
  USING (caller_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 2. Self-scoped canonical eligibility RPC -------------------------------------
-- Mirrors get_round_judging_gate_admin's eligibility logic verbatim, but
-- scoped to (a) entries the caller is assigned to judge, and (b) decisions/
-- scores the caller has personally made. Returns one row per entry the
-- caller is responsible for, with the canonical UI-eligible photo set.
CREATE OR REPLACE FUNCTION public.get_round_judging_gate_self(
  _competition_id UUID,
  _round_number   INT
)
RETURNS TABLE (
  competition_id           UUID,
  round_number             INT,
  entry_id                 UUID,
  entry_title              TEXT,
  total_photos             INT,
  ui_eligible_photo_indices INT[],
  ui_eligible_photos       INT,
  my_decisions_present     INT,
  my_decisions_missing     INT,
  my_scores_missing        INT,
  ready_to_complete        BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _caller_id    UUID := auth.uid();
  _is_admin     BOOLEAN;
  _is_judge     BOOLEAN;
  _is_dist      BOOLEAN;
BEGIN
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be authenticated';
  END IF;

  SELECT public.has_role(_caller_id, 'admin') INTO _is_admin;

  -- Is the caller an assigned judge for this competition?
  SELECT EXISTS (
    SELECT 1 FROM public.competition_judges
    WHERE competition_id = _competition_id
      AND judge_id       = _caller_id
  ) INTO _is_judge;

  IF NOT (_is_admin OR _is_judge) THEN
    RAISE EXCEPTION 'Forbidden: not an assigned judge for this competition';
  END IF;

  -- Distributed-mode flag (per-entry assignment)
  SELECT (judge_assignment_mode = 'distributed')
    INTO _is_dist
    FROM public.competitions
   WHERE id = _competition_id;
  _is_dist := COALESCE(_is_dist, FALSE);

  RETURN QUERY
  WITH
  -- Step 1: resolve caller's assigned entries.
  -- In distributed mode, restrict to judge_entry_assignments.
  -- Otherwise the judge is responsible for every entry in the comp.
  my_entries AS (
    SELECT
      e.id           AS entry_id,
      e.title        AS entry_title,
      e.photos,
      e.photo_meta,
      COALESCE(jsonb_array_length(e.photos), 1) AS total_photos
    FROM public.competition_entries e
    WHERE e.competition_id = _competition_id
      AND (
        _is_admin
        OR NOT _is_dist
        OR EXISTS (
          SELECT 1 FROM public.judge_entry_assignments jea
          WHERE jea.competition_id = _competition_id
            AND jea.entry_id       = e.id
            AND jea.judge_id       = _caller_id
        )
      )
  ),
  -- Step 2: per-photo eligibility.
  -- R1 → every non-rejected photo of every assigned entry.
  -- R2+ → only photos that the judge personally shortlisted in round N-1.
  --       This mirrors the edge fn's `fetchEligiblePhotoKeys` exactly, scoped
  --       to the caller (instead of "any judge" for the admin-side audit).
  exploded AS (
    SELECT
      m.entry_id,
      m.entry_title,
      m.total_photos,
      gs.pi AS photo_index,
      COALESCE((m.photo_meta -> gs.pi ->> 'rejected')::boolean, FALSE) AS is_rejected
    FROM my_entries m
    CROSS JOIN LATERAL generate_series(0, m.total_photos - 1) AS gs(pi)
  ),
  eligible AS (
    SELECT
      x.entry_id,
      x.entry_title,
      x.total_photos,
      x.photo_index
    FROM exploded x
    WHERE x.is_rejected = FALSE
      AND (
        _round_number = 1
        OR EXISTS (
          SELECT 1 FROM public.judge_decisions jd
          WHERE jd.entry_id     = x.entry_id
            AND jd.photo_index  = x.photo_index
            AND jd.round_number = _round_number - 1
            AND jd.judge_id     = _caller_id
            AND lower(trim(jd.decision)) = ANY (
              CASE _round_number - 1
                WHEN 1 THEN ARRAY['shortlist','shortlisted']
                WHEN 2 THEN ARRAY['qualified_r3','shortlist','shortlisted','qualified','qualified_for_r3','qualified for r3']
                WHEN 3 THEN ARRAY['qualified_final','shortlisted_final','qualified','shortlist','shortlisted','finalist','shortlisted_for_final','shortlisted for final']
                ELSE ARRAY[]::text[]
              END
            )
        )
      )
  ),
  per_entry AS (
    SELECT
      el.entry_id,
      el.entry_title,
      el.total_photos,
      array_agg(el.photo_index ORDER BY el.photo_index) AS ui_eligible_photo_indices,
      COUNT(*)::int AS ui_eligible_photos
    FROM eligible el
    GROUP BY el.entry_id, el.entry_title, el.total_photos
  ),
  my_dec AS (
    SELECT
      pe.entry_id,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM public.judge_decisions jd
          WHERE jd.entry_id     = pe.entry_id
            AND jd.judge_id     = _caller_id
            AND jd.round_number = _round_number
            AND jd.photo_index  = ANY (pe.ui_eligible_photo_indices)
        )
      )::int AS dummy
    FROM per_entry pe
    GROUP BY pe.entry_id
  ),
  my_dec_real AS (
    SELECT
      pe.entry_id,
      COUNT(jd.*)::int AS present
    FROM per_entry pe
    LEFT JOIN public.judge_decisions jd
           ON jd.entry_id     = pe.entry_id
          AND jd.judge_id     = _caller_id
          AND jd.round_number = _round_number
          AND jd.photo_index  = ANY (pe.ui_eligible_photo_indices)
    GROUP BY pe.entry_id
  ),
  my_score_missing AS (
    -- For R2/R3/R4, every eligible photo needs a judge_scores row with all 10
    -- SOW criteria non-null. R1 has no score requirement.
    SELECT
      pe.entry_id,
      CASE
        WHEN _round_number = 1 THEN 0
        ELSE pe.ui_eligible_photos - COUNT(js.*) FILTER (
          WHERE js.line_score IS NOT NULL
            AND js.shape_score IS NOT NULL
            AND js.form_score IS NOT NULL
            AND js.texture_score IS NOT NULL
            AND js.color_palette_score IS NOT NULL
            AND js.space_score IS NOT NULL
            AND js.tone_score IS NOT NULL
            AND js.balance_score IS NOT NULL
            AND js.light_score IS NOT NULL
            AND js.depth_score IS NOT NULL
        )::int
      END AS missing
    FROM per_entry pe
    LEFT JOIN public.judge_scores js
           ON js.entry_id     = pe.entry_id
          AND js.judge_id     = _caller_id
          AND js.round_number = _round_number
          AND js.photo_index  = ANY (pe.ui_eligible_photo_indices)
    GROUP BY pe.entry_id, pe.ui_eligible_photos
  )
  SELECT
    _competition_id,
    _round_number,
    pe.entry_id,
    pe.entry_title,
    pe.total_photos,
    pe.ui_eligible_photo_indices,
    pe.ui_eligible_photos,
    md.present                                      AS my_decisions_present,
    GREATEST(pe.ui_eligible_photos - md.present, 0) AS my_decisions_missing,
    GREATEST(msm.missing, 0)                        AS my_scores_missing,
    (
      pe.ui_eligible_photos = md.present
      AND COALESCE(msm.missing, 0) = 0
    ) AS ready_to_complete
  FROM per_entry pe
  LEFT JOIN my_dec_real    md  ON md.entry_id  = pe.entry_id
  LEFT JOIN my_score_missing msm ON msm.entry_id = pe.entry_id
  ORDER BY pe.entry_title NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_round_judging_gate_self(UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_round_judging_gate_self(UUID, INT) TO authenticated;

COMMENT ON FUNCTION public.get_round_judging_gate_self IS
  'Judge-scoped twin of get_round_judging_gate_admin. Returns the canonical UI-eligible photo set per assigned entry plus the caller''s personal decision/score coverage. Backs the Complete Round preflight UI so it cannot drift from the complete-round edge fn gate.';

COMMENT ON TABLE public.judging_preflight_log IS
  'Append-only audit of every Complete Round preflight check. Lets admins forensically reproduce any UI↔DB drift a judge encountered.';