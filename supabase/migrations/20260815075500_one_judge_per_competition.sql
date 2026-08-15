-- ============================================================================
-- ONE JUDGE, ONE COMPETITION — stated as a hard rule, now enforced as one.
--
-- OWNER INSTRUCTION, 2026-08-15: "in any situation two judges wont be happen.
-- One Judge One Competition this is hard rule."
--
-- WHAT WAS ACTUALLY IN PLACE, measured before writing this:
--   competition_judges_competition_id_judge_id_key
--     UNIQUE (competition_id, judge_id)
-- That stops the SAME judge being added to one competition twice. It does
-- nothing at all about a SECOND, DIFFERENT judge — which is the rule the owner
-- actually stated. The constraint that existed looked like the rule and was not
-- the rule, which is the most expensive kind of near-miss: everybody reads the
-- table definition, sees a unique index mentioning judges, and moves on.
--
-- SAFE TO APPLY NOW, and this is why the timing matters: production holds
--   competitions            0
--   competition_judges      0
--   competitions with >1 judge   0
-- so there is nothing to conflict with and no data to reconcile. The same
-- change after a season of competitions would need a decision about every
-- competition that had picked up a second judge.
--
-- WHY TWO MECHANISMS, WHICH IS NORMALLY A SMELL:
--   * The UNIQUE INDEX is the guarantee. It holds against every writer —
--     the app, an admin script, a future edge function, a hand-typed INSERT —
--     because it is enforced by the storage engine and cannot be bypassed.
--   * The TRIGGER exists only to produce a sentence a human can act on. A raw
--     index violation reads "duplicate key value violates unique constraint
--     competition_judges_one_per_competition", which tells an admin nothing
--     about what they did wrong or what to do instead.
-- The trigger is not load-bearing: delete it and the rule still holds. That is
-- the test of whether a second mechanism is a smell or a courtesy.
--
-- REASSIGNING A JUDGE remains possible and is deliberately a two-step action:
-- remove the existing row, then add the new one. There is no silent overwrite,
-- because silently replacing who judged a competition is exactly the kind of
-- change that should leave a mark.
-- ============================================================================

-- ── The message, raised before the index gets a chance to be cryptic ──
CREATE OR REPLACE FUNCTION public.tg_one_judge_per_competition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _existing uuid;
BEGIN
  SELECT judge_id INTO _existing
    FROM public.competition_judges
   WHERE competition_id = NEW.competition_id
     AND (TG_OP = 'INSERT' OR id <> NEW.id)
   LIMIT 1;

  IF _existing IS NOT NULL AND _existing <> NEW.judge_id THEN
    RAISE EXCEPTION
      'This competition already has a judge assigned. One judge per competition is a platform rule — remove the current judge first, then assign the new one.'
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_one_judge_per_competition ON public.competition_judges;
CREATE TRIGGER trg_one_judge_per_competition
  BEFORE INSERT OR UPDATE ON public.competition_judges
  FOR EACH ROW EXECUTE FUNCTION public.tg_one_judge_per_competition();

-- ── The guarantee. This is the line that actually enforces the rule. ──
CREATE UNIQUE INDEX IF NOT EXISTS competition_judges_one_per_competition
  ON public.competition_judges (competition_id);

COMMENT ON INDEX public.competition_judges_one_per_competition IS
  'One judge per competition — owner rule of 2026-08-15. The pre-existing UNIQUE (competition_id, judge_id) only prevented the same judge twice; it did not prevent a second judge.';
