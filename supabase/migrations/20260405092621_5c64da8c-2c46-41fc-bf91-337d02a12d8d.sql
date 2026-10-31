
-- ============================================================
-- 1. CREATE judging_config TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.judging_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL DEFAULT 1,
  threshold NUMERIC NOT NULL DEFAULT 0.5,
  min_judges INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, round_number),
  CHECK (threshold > 0 AND threshold <= 1),
  CHECK (min_judges >= 1 AND min_judges <= 50)
);

ALTER TABLE public.judging_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage judging config"
  ON public.judging_config FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can view judging config"
  ON public.judging_config FOR SELECT
  USING (public.has_role(auth.uid(), 'judge'::app_role));

-- ============================================================
-- 2. FIX enforce_round_lock — UUID/text mismatch
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_round_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _entry_comp_id uuid;
  _entry_round text;
  _round_status text;
  _round_number int;
BEGIN
  -- Get the entry's current_round and competition_id
  SELECT current_round, competition_id INTO _entry_round, _entry_comp_id
  FROM public.competition_entries
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);

  IF _entry_round IS NOT NULL AND _entry_comp_id IS NOT NULL THEN
    -- Parse round number from text (e.g. "1", "2", "3", "4")
    BEGIN
      _round_number := _entry_round::int;
    EXCEPTION WHEN OTHERS THEN
      _round_number := NULL;
    END;

    IF _round_number IS NOT NULL THEN
      -- Match by competition_id + round_number (NOT by judging_rounds.id)
      SELECT status INTO _round_status
      FROM public.judging_rounds
      WHERE competition_id = _entry_comp_id
        AND round_number = _round_number;

      IF _round_status = 'completed' THEN
        IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
          RAISE EXCEPTION 'This round has been completed. Scoring is locked.';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Add missing round lock trigger on judge_decisions
DROP TRIGGER IF EXISTS trg_enforce_round_lock ON public.judge_decisions;
CREATE TRIGGER trg_enforce_round_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.judge_decisions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_round_lock();

-- ============================================================
-- 3. SUBMISSION PHASE ENFORCEMENT (RLS)
-- ============================================================
DROP POLICY IF EXISTS "Users can submit entries" ON public.competition_entries;
CREATE POLICY "Users can submit entries"
  ON public.competition_entries FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = competition_id
        AND c.phase = 'submission_open'
        AND now() <= c.ends_at
    )
  );

-- ============================================================
-- 4. RESTRICT ENTRY UPDATES — users cannot modify status/placement
-- ============================================================
DROP POLICY IF EXISTS "Users can update own entries" ON public.competition_entries;
CREATE POLICY "Users can update own metadata only"
  ON public.competition_entries FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND status = (SELECT ce.status FROM public.competition_entries ce WHERE ce.id = id)
    AND (placement IS NOT DISTINCT FROM (SELECT ce.placement FROM public.competition_entries ce WHERE ce.id = id))
  );

-- ============================================================
-- 5. PHOTO LIMIT ENFORCEMENT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_photo_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _max_photos int;
  _photo_count int;
BEGIN
  SELECT max_photos_per_entry INTO _max_photos
  FROM public.competitions
  WHERE id = NEW.competition_id;

  IF _max_photos IS NOT NULL THEN
    _photo_count := COALESCE(array_length(NEW.photos, 1), 0);
    IF _photo_count > _max_photos THEN
      RAISE EXCEPTION 'Photo limit exceeded. Maximum % photos allowed, got %', _max_photos, _photo_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_photo_limit ON public.competition_entries;
CREATE TRIGGER trg_enforce_photo_limit
  BEFORE INSERT OR UPDATE ON public.competition_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_photo_limit();

-- ============================================================
-- 6. FEEDBACK & COMMENT LENGTH CONSTRAINTS
-- ============================================================
ALTER TABLE public.judge_scores
  ADD CONSTRAINT feedback_length_check CHECK (feedback IS NULL OR length(feedback) <= 500);

ALTER TABLE public.judge_comments
  ADD CONSTRAINT comment_length_check CHECK (length(comment) <= 500);

-- ============================================================
-- 7. ACTIVE ROUND UNIQUENESS — only one active round per competition
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_round_per_competition
  ON public.judging_rounds (competition_id)
  WHERE status = 'active';

-- ============================================================
-- 8. SCORE RATE LIMITING — max 20 per minute per judge
-- ============================================================
CREATE OR REPLACE FUNCTION public.rate_limit_judge_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.judge_scores
  WHERE judge_id = NEW.judge_id
    AND created_at > now() - interval '1 minute';
  IF recent_count >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 20 score submissions per minute';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_judge_scores ON public.judge_scores;
CREATE TRIGGER trg_rate_limit_judge_scores
  BEFORE INSERT ON public.judge_scores
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_judge_scores();
