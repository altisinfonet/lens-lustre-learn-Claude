CREATE OR REPLACE FUNCTION public.admin_flag_entry_for_review(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is admin
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  UPDATE public.competition_entries
  SET status = 'needs_review', updated_at = now()
  WHERE id = _entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry not found';
  END IF;
END;
$$;