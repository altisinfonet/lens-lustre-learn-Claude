-- Phase L: Certificate forensic audit RPC
CREATE OR REPLACE FUNCTION public.get_certificate_drift_admin(p_competition_id uuid DEFAULT NULL)
RETURNS TABLE (
  certificate_id uuid,
  cert_title text,
  cert_type text,
  cert_user_id uuid,
  reference_id uuid,
  entry_id uuid,
  entry_user_id uuid,
  entry_status text,
  entry_placement text,
  entry_certificate_ready boolean,
  competition_id uuid,
  issued_at timestamptz,
  drift_type text,
  severity text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  RETURN QUERY
  WITH cert_entry AS (
    SELECT
      c.id AS cert_id,
      c.title AS c_title,
      c.type AS c_type,
      c.user_id AS c_user,
      c.reference_id AS c_ref,
      c.issued_at AS c_issued,
      e.id AS e_id,
      e.user_id AS e_user,
      e.status AS e_status,
      e.placement AS e_placement,
      e.certificate_ready AS e_ready,
      e.competition_id AS comp_id
    FROM public.certificates c
    LEFT JOIN public.competition_entries e ON e.id = c.reference_id
    WHERE c.reference_id IS NOT NULL
      AND c.type IN ('competition_winner','winner','finalist','participation')
      AND (p_competition_id IS NULL OR e.competition_id = p_competition_id)
  )
  -- D1: Orphan cert (entry deleted)
  SELECT
    cert_id, c_title, c_type, c_user, c_ref,
    NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::boolean, NULL::uuid,
    c_issued,
    'orphan_entry'::text,
    'critical'::text,
    'Certificate references a deleted or missing entry'::text
  FROM cert_entry WHERE e_id IS NULL

  UNION ALL
  -- D2: Wrong recipient
  SELECT
    cert_id, c_title, c_type, c_user, c_ref,
    e_id, e_user, e_status, e_placement, e_ready, comp_id,
    c_issued,
    'wrong_recipient'::text,
    'critical'::text,
    format('Certificate user_id (%s) does not match entry owner (%s)', c_user, e_user)
  FROM cert_entry
  WHERE e_id IS NOT NULL AND c_user IS DISTINCT FROM e_user

  UNION ALL
  -- D3: Stale eligibility — cert exists but entry no longer marked ready
  SELECT
    cert_id, c_title, c_type, c_user, c_ref,
    e_id, e_user, e_status, e_placement, e_ready, comp_id,
    c_issued,
    'stale_eligibility'::text,
    'high'::text,
    'Certificate issued but entry is no longer certificate_ready (entry may have been reverted)'::text
  FROM cert_entry
  WHERE e_id IS NOT NULL AND e_ready = false

  UNION ALL
  -- D4: Type mismatch — cert type doesn't match current entry standing
  SELECT
    cert_id, c_title, c_type, c_user, c_ref,
    e_id, e_user, e_status, e_placement, e_ready, comp_id,
    c_issued,
    'type_mismatch'::text,
    'elevated'::text,
    format('Cert type "%s" does not match entry placement "%s" / status "%s"', c_type, COALESCE(e_placement,'—'), COALESCE(e_status,'—'))
  FROM cert_entry
  WHERE e_id IS NOT NULL
    AND (
      (c_type IN ('winner','competition_winner') AND e_placement IS DISTINCT FROM 'winner')
      OR (c_type = 'finalist' AND e_status NOT IN ('finalist','round2_qualified','round1_qualified'))
    )

  ORDER BY 14, 13;
END;
$$;

REVOKE ALL ON FUNCTION public.get_certificate_drift_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_certificate_drift_admin(uuid) TO authenticated;