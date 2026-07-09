
-- ================================================================
-- JUDGING ENGINE OPTIMIZATION: Score Cache + Indexes + Batch Ready
-- ================================================================

-- 1. ENTRY SCORE CACHE TABLE (precomputed aggregates)
CREATE TABLE IF NOT EXISTS public.entry_score_cache (
  entry_id UUID PRIMARY KEY REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  avg_score NUMERIC(5,2) DEFAULT 0,
  total_scores INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.entry_score_cache ENABLE ROW LEVEL SECURITY;

-- Read: anyone authenticated can read cache
CREATE POLICY "Authenticated users can read score cache"
  ON public.entry_score_cache FOR SELECT TO authenticated USING (true);

-- Write: only service role (triggers) — no direct user writes
-- No INSERT/UPDATE/DELETE policies for authenticated users

-- 2. TRIGGER: Auto-update cache on score insert/update/delete
CREATE OR REPLACE FUNCTION public.refresh_score_cache()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_entry_id UUID;
BEGIN
  target_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

  INSERT INTO public.entry_score_cache (entry_id, avg_score, total_scores, last_updated)
  SELECT
    target_entry_id,
    COALESCE(AVG(score), 0),
    COUNT(*),
    now()
  FROM public.judge_scores
  WHERE entry_id = target_entry_id
  ON CONFLICT (entry_id) DO UPDATE SET
    avg_score = EXCLUDED.avg_score,
    total_scores = EXCLUDED.total_scores,
    last_updated = EXCLUDED.last_updated;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_refresh_score_cache
AFTER INSERT OR UPDATE OR DELETE ON public.judge_scores
FOR EACH ROW EXECUTE FUNCTION public.refresh_score_cache();

-- 3. PERFORMANCE INDEXES
-- competition_entries composite indexes
CREATE INDEX IF NOT EXISTS idx_ce_comp_status ON public.competition_entries (competition_id, status);
CREATE INDEX IF NOT EXISTS idx_ce_comp_round ON public.competition_entries (competition_id, current_round);
CREATE INDEX IF NOT EXISTS idx_ce_comp_created ON public.competition_entries (competition_id, created_at DESC);

-- judge_scores indexes
CREATE INDEX IF NOT EXISTS idx_js_entry ON public.judge_scores (entry_id);
CREATE INDEX IF NOT EXISTS idx_js_judge ON public.judge_scores (judge_id);
CREATE INDEX IF NOT EXISTS idx_js_entry_judge ON public.judge_scores (entry_id, judge_id);

-- judge_decisions indexes
CREATE INDEX IF NOT EXISTS idx_jd_entry_round ON public.judge_decisions (entry_id, round_number);
CREATE INDEX IF NOT EXISTS idx_jd_judge_round ON public.judge_decisions (judge_id, round_number);

-- judge_tag_assignments indexes
CREATE INDEX IF NOT EXISTS idx_jta_entry ON public.judge_tag_assignments (entry_id);
CREATE INDEX IF NOT EXISTS idx_jta_entry_judge ON public.judge_tag_assignments (entry_id, judge_id);

-- judge_comments indexes
CREATE INDEX IF NOT EXISTS idx_jc_entry ON public.judge_comments (entry_id);

-- competition_votes index
CREATE INDEX IF NOT EXISTS idx_cv_entry ON public.competition_votes (entry_id);

-- admin_vote_adjustments index
CREATE INDEX IF NOT EXISTS idx_ava_entry ON public.admin_vote_adjustments (entry_id);

-- judge_entry_assignments indexes
CREATE INDEX IF NOT EXISTS idx_jea_comp_judge ON public.judge_entry_assignments (competition_id, judge_id);
CREATE INDEX IF NOT EXISTS idx_jea_entry ON public.judge_entry_assignments (entry_id);

-- judge_activity_logs indexes
CREATE INDEX IF NOT EXISTS idx_jal_judge ON public.judge_activity_logs (judge_id);
CREATE INDEX IF NOT EXISTS idx_jal_comp ON public.judge_activity_logs (competition_id);

-- entry_score_cache index for sorting
CREATE INDEX IF NOT EXISTS idx_esc_avg ON public.entry_score_cache (avg_score DESC);

-- 4. BACKFILL existing scores into cache
INSERT INTO public.entry_score_cache (entry_id, avg_score, total_scores, last_updated)
SELECT
  entry_id,
  ROUND(AVG(score)::numeric, 2),
  COUNT(*),
  now()
FROM public.judge_scores
GROUP BY entry_id
ON CONFLICT (entry_id) DO UPDATE SET
  avg_score = EXCLUDED.avg_score,
  total_scores = EXCLUDED.total_scores,
  last_updated = EXCLUDED.last_updated;
