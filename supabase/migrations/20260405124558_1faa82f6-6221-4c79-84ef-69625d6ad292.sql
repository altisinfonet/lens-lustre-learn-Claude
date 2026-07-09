
-- ============================================================
-- MIGRATION: System Critical Hardening Layer
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. FIX BROKEN RLS ON competition_entries UPDATE (TAUTOLOGY)
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can update own metadata only" ON public.competition_entries;

CREATE POLICY "Users can update own metadata only"
ON public.competition_entries
FOR UPDATE
TO public
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND status = (
    SELECT ce2.status FROM public.competition_entries ce2
    WHERE ce2.id = competition_entries.id
  )
  AND placement IS NOT DISTINCT FROM (
    SELECT ce2.placement FROM public.competition_entries ce2
    WHERE ce2.id = competition_entries.id
  )
);

-- ─────────────────────────────────────────────────────────────
-- 2. ENFORCE JUDGE ENTRY ASSIGNMENT IN RLS
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.judge_can_access_entry(_entry_id uuid, _judge_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_judges cj ON cj.competition_id = ce.competition_id AND cj.judge_id = _judge_id
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.id = _entry_id
      AND (
        c.judge_assignment_mode != 'distributed'
        OR EXISTS (
          SELECT 1 FROM judge_entry_assignments ja
          WHERE ja.entry_id = _entry_id AND ja.judge_id = _judge_id
        )
      )
  );
$$;

-- judge_scores policies
DROP POLICY IF EXISTS "Judges can insert own scores" ON public.judge_scores;
CREATE POLICY "Judges can insert own scores"
ON public.judge_scores FOR INSERT TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

DROP POLICY IF EXISTS "Judges can update own scores" ON public.judge_scores;
CREATE POLICY "Judges can update own scores"
ON public.judge_scores FOR UPDATE TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

DROP POLICY IF EXISTS "Judges can delete own scores" ON public.judge_scores;
CREATE POLICY "Judges can delete own scores"
ON public.judge_scores FOR DELETE TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

-- judge_comments policies
DROP POLICY IF EXISTS "Judges can create own comments" ON public.judge_comments;
CREATE POLICY "Judges can create own comments"
ON public.judge_comments FOR INSERT TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

DROP POLICY IF EXISTS "Judges can update own comments" ON public.judge_comments;
CREATE POLICY "Judges can update own comments"
ON public.judge_comments FOR UPDATE TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

DROP POLICY IF EXISTS "Judges can delete own comments" ON public.judge_comments;
CREATE POLICY "Judges can delete own comments"
ON public.judge_comments FOR DELETE TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

-- judge_tag_assignments policies
DROP POLICY IF EXISTS "Judges can assign tags" ON public.judge_tag_assignments;
CREATE POLICY "Judges can assign tags"
ON public.judge_tag_assignments FOR INSERT TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

DROP POLICY IF EXISTS "Judges can remove own tag assignments" ON public.judge_tag_assignments;
CREATE POLICY "Judges can remove own tag assignments"
ON public.judge_tag_assignments FOR DELETE TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

-- judge_decisions policies
DROP POLICY IF EXISTS "Judges can insert own decisions" ON public.judge_decisions;
CREATE POLICY "Judges can insert own decisions"
ON public.judge_decisions FOR INSERT TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

DROP POLICY IF EXISTS "Judges can update own decisions" ON public.judge_decisions;
CREATE POLICY "Judges can update own decisions"
ON public.judge_decisions FOR UPDATE TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
);

-- ─────────────────────────────────────────────────────────────
-- 3. ENFORCE ROUND LOCK — REMOVE ADMIN BYPASS
-- ─────────────────────────────────────────────────────────────

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
  SELECT current_round, competition_id INTO _entry_round, _entry_comp_id
  FROM public.competition_entries
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);

  IF _entry_round IS NOT NULL AND _entry_comp_id IS NOT NULL THEN
    BEGIN
      _round_number := _entry_round::int;
    EXCEPTION WHEN OTHERS THEN
      _round_number := NULL;
    END;

    IF _round_number IS NOT NULL THEN
      SELECT status INTO _round_status
      FROM public.judging_rounds
      WHERE competition_id = _entry_comp_id
        AND round_number = _round_number;

      IF _round_status = 'completed' THEN
        RAISE EXCEPTION 'This round has been completed. Scoring is locked.';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. FIX SELF-VOTE BYPASS (REMOVE DUPLICATE INSERT POLICY)
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can vote" ON public.competition_votes;

-- ─────────────────────────────────────────────────────────────
-- 5. ENFORCE MAX ENTRIES PER USER (BACKEND TRIGGER)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_max_entries_per_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _max_entries int;
  _current_count int;
BEGIN
  SELECT max_entries_per_user INTO _max_entries
  FROM public.competitions
  WHERE id = NEW.competition_id;

  IF _max_entries IS NOT NULL THEN
    SELECT COUNT(*) INTO _current_count
    FROM public.competition_entries
    WHERE user_id = NEW.user_id
      AND competition_id = NEW.competition_id;

    IF _current_count >= _max_entries THEN
      RAISE EXCEPTION 'Entry limit exceeded. Maximum % entries per user allowed.', _max_entries;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_max_entries ON public.competition_entries;
CREATE TRIGGER trg_enforce_max_entries
  BEFORE INSERT ON public.competition_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_entries_per_user();

-- ─────────────────────────────────────────────────────────────
-- 6. AI IMAGE ENFORCEMENT (BACKEND TRIGGER)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_ai_image_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _ai_allowed boolean;
BEGIN
  SELECT ai_images_allowed INTO _ai_allowed
  FROM public.competitions
  WHERE id = NEW.competition_id;

  IF _ai_allowed = false AND NEW.is_ai_generated = true THEN
    RAISE EXCEPTION 'AI-generated images are not allowed in this competition.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ai_image ON public.competition_entries;
CREATE TRIGGER trg_enforce_ai_image
  BEFORE INSERT OR UPDATE ON public.competition_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ai_image_policy();

-- ─────────────────────────────────────────────────────────────
-- 7. VOTING RATE LIMIT (BACKEND TRIGGER)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rate_limit_competition_votes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _hourly_count integer;
  _minute_count integer;
BEGIN
  SELECT COUNT(*) INTO _minute_count
  FROM public.competition_votes
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 minute';

  IF _minute_count >= 10 THEN
    RAISE EXCEPTION 'Slow down: too many votes in a short time. Please wait.';
  END IF;

  SELECT COUNT(*) INTO _hourly_count
  FROM public.competition_votes
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF _hourly_count >= 50 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 50 votes per hour.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_votes ON public.competition_votes;
CREATE TRIGGER trg_rate_limit_votes
  BEFORE INSERT ON public.competition_votes
  FOR EACH ROW
  EXECUTE FUNCTION rate_limit_competition_votes();

-- ─────────────────────────────────────────────────────────────
-- 8. MATERIALIZED VIEW: entry_vote_counts
-- ─────────────────────────────────────────────────────────────

DROP MATERIALIZED VIEW IF EXISTS public.entry_vote_counts;

CREATE MATERIALIZED VIEW public.entry_vote_counts AS
SELECT
  cv.entry_id,
  COUNT(cv.id)::int AS real_votes,
  COALESCE(adj.total_adjustment, 0)::int AS adjustment_votes,
  (COUNT(cv.id) + COALESCE(adj.total_adjustment, 0))::int AS final_votes
FROM public.competition_votes cv
LEFT JOIN (
  SELECT entry_id, SUM(adjustment_value) AS total_adjustment
  FROM public.admin_vote_adjustments
  GROUP BY entry_id
) adj ON adj.entry_id = cv.entry_id
GROUP BY cv.entry_id, adj.total_adjustment;

CREATE UNIQUE INDEX idx_entry_vote_counts_entry_id ON public.entry_vote_counts (entry_id);

-- ─────────────────────────────────────────────────────────────
-- 9. AUDIT TRIGGERS FOR REMAINING TABLES
-- ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS audit_judge_scores ON public.judge_scores;
CREATE TRIGGER audit_judge_scores
  AFTER INSERT OR UPDATE OR DELETE ON public.judge_scores
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table();

DROP TRIGGER IF EXISTS audit_judge_decisions ON public.judge_decisions;
CREATE TRIGGER audit_judge_decisions
  AFTER INSERT OR UPDATE OR DELETE ON public.judge_decisions
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table();

DROP TRIGGER IF EXISTS audit_competition_votes ON public.competition_votes;
CREATE TRIGGER audit_competition_votes
  AFTER INSERT OR UPDATE OR DELETE ON public.competition_votes
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table();

DROP TRIGGER IF EXISTS audit_judge_comments ON public.judge_comments;
CREATE TRIGGER audit_judge_comments
  AFTER INSERT OR UPDATE OR DELETE ON public.judge_comments
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table();

DROP TRIGGER IF EXISTS audit_judge_tag_assignments ON public.judge_tag_assignments;
CREATE TRIGGER audit_judge_tag_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.judge_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table();

-- ─────────────────────────────────────────────────────────────
-- 10. ENTRY FEE ENFORCEMENT (TRIGGER)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_entry_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _entry_fee numeric;
BEGIN
  SELECT entry_fee INTO _entry_fee
  FROM public.competitions
  WHERE id = NEW.competition_id;

  IF _entry_fee IS NOT NULL AND _entry_fee > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.wallet_transactions
      WHERE user_id = NEW.user_id
        AND reference_id = NEW.competition_id
        AND reference_type = 'competition_entry_fee'
        AND status = 'completed'
        AND amount < 0
    ) THEN
      RAISE EXCEPTION 'Entry fee of $% has not been paid for this competition.', _entry_fee;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_entry_fee ON public.competition_entries;
CREATE TRIGGER trg_enforce_entry_fee
  BEFORE INSERT ON public.competition_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_entry_fee();

-- ─────────────────────────────────────────────────────────────
-- 11. STATUS-ROUND CONSISTENCY ENFORCEMENT
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_status_round_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.status = 'finalist' AND NEW.current_round IS NOT NULL AND NEW.current_round::int < 3 THEN
    RAISE EXCEPTION 'Finalist status requires round 3 or higher, got round %', NEW.current_round;
  END IF;

  IF NEW.status = 'winner' AND NEW.current_round IS NOT NULL AND NEW.current_round::int < 4 THEN
    RAISE EXCEPTION 'Winner status requires round 4, got round %', NEW.current_round;
  END IF;

  IF NEW.status = 'submitted' AND NEW.current_round IS NOT NULL AND NEW.current_round::int > 1 THEN
    RAISE EXCEPTION 'Submitted entries cannot be in round %', NEW.current_round;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_status_round ON public.competition_entries;
CREATE TRIGGER trg_enforce_status_round
  BEFORE UPDATE ON public.competition_entries
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.current_round IS DISTINCT FROM NEW.current_round)
  EXECUTE FUNCTION enforce_status_round_consistency();
