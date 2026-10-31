-- =====================================================================
-- STEP 4 (Ruleset v4) — Certificate Backfill + R4-Only Cert Trigger
-- =====================================================================

-- 1) Allow new R4 certificate types in the CHECK constraint
ALTER TABLE public.certificates DROP CONSTRAINT IF EXISTS certificates_type_check;
ALTER TABLE public.certificates ADD CONSTRAINT certificates_type_check CHECK (
  type = ANY (ARRAY[
    'course_completion',
    'competition_winner',
    'competition_runner_up_1',
    'competition_runner_up_2',
    'competition_honorary_mention',
    'competition_special_jury',
    'competition_top_50',
    'competition_top_100',
    -- legacy values kept readable so historical rows don't break
    'winner','finalist','participation_r1','participation_r2','participation_r3','participation_r4'
  ])
);

-- 2) Revoke all existing NON-R4 competition certificates (Ruleset v4: certs R4-only)
--    Keep course_completion certificates intact (course certs are unrelated).
UPDATE public.certificates
SET is_revoked = true,
    revoked_at = now(),
    revoked_reason = 'Ruleset v4: certificates are issued exclusively in Round 4. This certificate predates the policy and has been revoked.'
WHERE is_revoked = false
  AND type IN ('finalist','participation_r1','participation_r2','participation_r3','participation_r4','winner')
  AND type <> 'course_completion';

-- 3) Replace auto_certificate_on_winner with R4-only multi-award trigger
CREATE OR REPLACE FUNCTION public.auto_certificate_on_r4_award()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _comp_title text;
  _cert_type text;
  _cert_title text;
  _cert_desc text;
  _placement text;
  _round_text text;
BEGIN
  -- Only act when status or placement transitions on an R4 entry
  IF (NEW.status IS DISTINCT FROM OLD.status)
     OR (NEW.placement IS DISTINCT FROM OLD.placement) THEN

    -- Hard gate: certificates are only issued from Round 4
    _round_text := COALESCE(NEW.current_round, '');
    IF _round_text NOT IN ('4','round4','r4') THEN
      RETURN NEW;
    END IF;

    -- Map status/placement → cert type
    _placement := COALESCE(NEW.placement, '');
    IF NEW.status = 'winner' THEN
      _cert_type := 'competition_winner';
      _cert_title := 'Winner Certificate';
    ELSIF _placement = 'runner_up_1' THEN
      _cert_type := 'competition_runner_up_1';
      _cert_title := '1st Runner-Up Certificate';
    ELSIF _placement = 'runner_up_2' THEN
      _cert_type := 'competition_runner_up_2';
      _cert_title := '2nd Runner-Up Certificate';
    ELSIF _placement = 'honorary_mention' THEN
      _cert_type := 'competition_honorary_mention';
      _cert_title := 'Honorary Mention Certificate';
    ELSIF _placement = 'special_jury' THEN
      _cert_type := 'competition_special_jury';
      _cert_title := 'Special Jury Award Certificate';
    ELSIF _placement = 'top_50' THEN
      _cert_type := 'competition_top_50';
      _cert_title := 'Top 50 Certificate';
    ELSIF _placement = 'top_100' THEN
      _cert_type := 'competition_top_100';
      _cert_title := 'Top 100 Certificate';
    ELSE
      RETURN NEW;
    END IF;

    -- Skip duplicate
    IF EXISTS (
      SELECT 1 FROM public.certificates
      WHERE user_id = NEW.user_id
        AND reference_id = NEW.competition_id
        AND type = _cert_type
        AND is_revoked = false
    ) THEN
      RETURN NEW;
    END IF;

    SELECT title INTO _comp_title FROM public.competitions WHERE id = NEW.competition_id;
    _cert_desc := 'Awarded in ' || COALESCE(_comp_title, 'competition') || ' (Round 4)';

    INSERT INTO public.certificates (user_id, title, description, type, reference_id)
    VALUES (
      NEW.user_id,
      COALESCE(_comp_title, 'Competition') || ' — ' || _cert_title,
      _cert_desc,
      _cert_type,
      NEW.competition_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) Swap trigger: drop old single-winner, install new R4-only multi-award
DROP TRIGGER IF EXISTS trg_auto_certificate_winner ON public.competition_entries;
DROP FUNCTION IF EXISTS public.auto_certificate_on_winner();

CREATE TRIGGER trg_auto_certificate_r4_award
AFTER UPDATE ON public.competition_entries
FOR EACH ROW EXECUTE FUNCTION public.auto_certificate_on_r4_award();
