-- ============================================================================
-- ROLLBACK for 20260815999998_one_judge_per_competition.sql
--
-- Fully reversible: nothing about this migration changes data. It adds one
-- index and one trigger, both of which are dropped here, returning
-- competition_judges to the state where a second judge on a competition is
-- accepted silently.
--
-- The pre-existing UNIQUE (competition_id, judge_id) is NOT touched by this
-- file, in either direction — it was not created by the migration and it still
-- does its own (different, narrower) job of preventing the same judge being
-- added twice.
-- ============================================================================

DROP INDEX IF EXISTS public.competition_judges_one_per_competition;
DROP TRIGGER IF EXISTS trg_one_judge_per_competition ON public.competition_judges;
DROP FUNCTION IF EXISTS public.tg_one_judge_per_competition();
