-- Stateless variant for parity testing & for current_phase(uuid) to delegate to.
CREATE OR REPLACE FUNCTION public.current_phase_for(
  p_status text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_voting_ends_at timestamptz,
  p_judging_completed boolean,
  p_legacy_phase text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_voting_end timestamptz;
BEGIN
  IF p_status = 'archived' THEN RETURN 'archived'; END IF;

  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL THEN
    v_voting_end := COALESCE(p_voting_ends_at, p_ends_at);
    IF v_now < p_starts_at THEN RETURN 'upcoming';
    ELSIF v_now >= p_starts_at AND v_now <= p_ends_at THEN RETURN 'submission_open';
    ELSIF v_now > p_ends_at AND v_now <= v_voting_end THEN RETURN 'voting';
    ELSIF COALESCE(p_judging_completed, false) THEN RETURN 'result';
    ELSE RETURN 'judging';
    END IF;
  END IF;

  IF p_legacy_phase IS NOT NULL AND p_legacy_phase <> '' THEN RETURN p_legacy_phase; END IF;

  IF p_status IS NOT NULL THEN
    RETURN CASE p_status
      WHEN 'draft' THEN 'submission_open'
      WHEN 'open' THEN 'submission_open'
      WHEN 'upcoming' THEN 'submission_open'
      WHEN 'active' THEN 'judging'
      WHEN 'judging' THEN 'judging'
      WHEN 'closed' THEN 'result'
      WHEN 'completed' THEN 'result'
      ELSE 'submission_open'
    END;
  END IF;

  RETURN 'submission_open';
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_phase_for(text, timestamptz, timestamptz, timestamptz, boolean, text)
  TO anon, authenticated, service_role;

-- Refactor current_phase(uuid) to delegate — guarantees lockstep
CREATE OR REPLACE FUNCTION public.current_phase(p_competition_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_voting_ends_at timestamptz;
  v_judging_completed boolean;
  v_legacy_phase text;
BEGIN
  SELECT status, starts_at, ends_at, voting_ends_at, judging_completed, phase
    INTO v_status, v_starts_at, v_ends_at, v_voting_ends_at, v_judging_completed, v_legacy_phase
  FROM public.competitions
  WHERE id = p_competition_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN public.current_phase_for(
    v_status, v_starts_at, v_ends_at, v_voting_ends_at, v_judging_completed, v_legacy_phase
  );
END;
$$;
