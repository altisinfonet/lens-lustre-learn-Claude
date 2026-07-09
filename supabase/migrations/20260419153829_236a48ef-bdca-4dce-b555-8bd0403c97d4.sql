CREATE OR REPLACE FUNCTION public.validate_competition_entry_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _allowed text[] := ARRAY[
    'draft','submitted','approved','round1_qualified','round2_qualified',
    'finalist','winner','rejected','hold','shortlisted','needs_review'
  ];
  _ok boolean := false;
BEGIN
  IF NOT (NEW.status = ANY(_allowed)) THEN
    RAISE EXCEPTION 'Unknown entry status %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft','submitted','approved') THEN
      RAISE EXCEPTION 'New entries must start as draft, submitted, or approved (got %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Per-photo policy: Round 1 decisions can move entries to any R1 outcome
  -- (shortlisted / needs_review / round1_qualified / rejected) from any
  -- pre-R2 state, and these states can also revise to one another as
  -- judges change their minds. Aggregation rules are handled in app logic.
  _ok := CASE OLD.status
    WHEN 'draft'             THEN NEW.status IN ('submitted','rejected')
    WHEN 'submitted'         THEN NEW.status IN ('approved','rejected','hold','round1_qualified','shortlisted','needs_review')
    WHEN 'approved'          THEN NEW.status IN ('round1_qualified','rejected','hold','shortlisted','needs_review')
    WHEN 'round1_qualified'  THEN NEW.status IN ('round2_qualified','rejected','hold','shortlisted','needs_review')
    WHEN 'shortlisted'       THEN NEW.status IN ('round1_qualified','round2_qualified','rejected','hold','needs_review')
    WHEN 'needs_review'      THEN NEW.status IN ('round1_qualified','shortlisted','rejected','hold','submitted','approved')
    WHEN 'round2_qualified'  THEN NEW.status IN ('finalist','rejected','hold','shortlisted')
    WHEN 'finalist'          THEN NEW.status IN ('winner','rejected','hold')
    WHEN 'hold'              THEN NEW.status IN ('approved','submitted','rejected','round1_qualified','round2_qualified','finalist','shortlisted','needs_review')
    WHEN 'rejected'          THEN NEW.status IN ('hold','submitted','needs_review','shortlisted','round1_qualified')
    WHEN 'winner'            THEN NEW.status IN ('hold')
    ELSE false
  END;

  IF NOT _ok THEN
    RAISE EXCEPTION 'Illegal status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;