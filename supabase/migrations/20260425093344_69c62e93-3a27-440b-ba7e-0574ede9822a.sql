-- ============================================================
-- R5: Canonical current_phase(competition_id) RPC
-- Single source of truth for competition phase resolution.
-- Algorithm mirrors src/lib/competitionPhase.ts exactly.
-- ============================================================

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
  v_phase text;
  v_now timestamptz := now();
  v_voting_end timestamptz;
BEGIN
  SELECT status, starts_at, ends_at, voting_ends_at, judging_completed, phase
    INTO v_status, v_starts_at, v_ends_at, v_voting_ends_at, v_judging_completed, v_phase
  FROM public.competitions
  WHERE id = p_competition_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Archived is explicit and never overridden
  IF v_status = 'archived' THEN
    RETURN 'archived';
  END IF;

  -- Date-derived path (preferred)
  IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL THEN
    v_voting_end := COALESCE(v_voting_ends_at, v_ends_at);

    IF v_now < v_starts_at THEN
      RETURN 'upcoming';
    ELSIF v_now >= v_starts_at AND v_now <= v_ends_at THEN
      RETURN 'submission_open';
    ELSIF v_now > v_ends_at AND v_now <= v_voting_end THEN
      RETURN 'voting';
    ELSIF COALESCE(v_judging_completed, false) THEN
      RETURN 'result';
    ELSE
      RETURN 'judging';
    END IF;
  END IF;

  -- Legacy fallbacks
  IF v_phase IS NOT NULL AND v_phase <> '' THEN
    RETURN v_phase;
  END IF;

  IF v_status IS NOT NULL THEN
    RETURN CASE v_status
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

GRANT EXECUTE ON FUNCTION public.current_phase(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.current_phase(uuid) IS
'Phase R5 — Canonical phase resolver. Single source of truth used by edge functions and parity audits. Mirrors src/lib/competitionPhase.ts.';

-- ============================================================
-- audit_phase_parity — admin-only forensic harness
-- Returns inputs + DB-computed phase for parity comparison.
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_phase_parity(sample_limit int DEFAULT 100)
RETURNS TABLE (
  id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  voting_ends_at timestamptz,
  judging_completed boolean,
  legacy_phase text,
  db_phase text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.status,
    c.starts_at,
    c.ends_at,
    c.voting_ends_at,
    c.judging_completed,
    c.phase AS legacy_phase,
    public.current_phase(c.id) AS db_phase
  FROM public.competitions c
  ORDER BY c.created_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(sample_limit, 1000));
$$;

GRANT EXECUTE ON FUNCTION public.audit_phase_parity(int) TO authenticated, service_role;

COMMENT ON FUNCTION public.audit_phase_parity(int) IS
'Phase R5 — Returns inputs + DB-computed phase so client can verify identical output for parity testing.';
