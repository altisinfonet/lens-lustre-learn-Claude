-- Per-photo rejection RPC. Atomically flips photo_meta[i].rejected and
-- auto-derives entry-level status from the per-photo state.
-- Admin-only. Logged to db_audit_logs.

CREATE OR REPLACE FUNCTION public.admin_set_photo_rejected(
  _entry_id   uuid,
  _photo_index integer,
  _rejected   boolean,
  _reason     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin    boolean;
  _meta        jsonb;
  _photos_len  integer;
  _meta_len    integer;
  _new_meta    jsonb;
  _item        jsonb;
  _i           integer;
  _all_rejected boolean := true;
  _any_active  boolean := false;
  _old_status  text;
  _new_status  text;
  _old_meta    jsonb;
BEGIN
  -- Admin gate (uses existing has_role helper)
  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RAISE EXCEPTION 'forbidden: admin role required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Load entry
  SELECT photo_meta, status, COALESCE(array_length(photos,1),0)
    INTO _old_meta, _old_status, _photos_len
  FROM public.competition_entries
  WHERE id = _entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'no_data_found';
  END IF;

  _meta_len := COALESCE(jsonb_array_length(_old_meta), 0);
  IF _photo_index < 0 OR _photo_index >= _meta_len THEN
    RAISE EXCEPTION 'photo_index % out of range (0..%)', _photo_index, _meta_len - 1
      USING ERRCODE = 'check_violation';
  END IF;

  -- Set rejected flag on the target index
  _item := _old_meta -> _photo_index;
  _item := _item || jsonb_build_object(
    'rejected', _rejected,
    'rejected_at', CASE WHEN _rejected THEN to_jsonb(now()) ELSE 'null'::jsonb END,
    'rejected_by', CASE WHEN _rejected THEN to_jsonb(auth.uid()) ELSE 'null'::jsonb END,
    'rejected_reason', CASE WHEN _rejected THEN to_jsonb(_reason) ELSE 'null'::jsonb END
  );
  _new_meta := jsonb_set(_old_meta, ARRAY[_photo_index::text], _item, false);

  -- Derive entry-level status
  FOR _i IN 0.._meta_len - 1 LOOP
    IF COALESCE(((_new_meta -> _i) ->> 'rejected')::boolean, false) THEN
      -- still rejected — track
      NULL;
    ELSE
      _all_rejected := false;
      _any_active := true;
    END IF;
  END LOOP;

  IF _all_rejected THEN
    _new_status := 'rejected';
  ELSIF _old_status = 'rejected' AND _any_active THEN
    -- Restore from full-rejection state back to pending
    _new_status := 'pending';
  ELSE
    _new_status := _old_status;
  END IF;

  UPDATE public.competition_entries
     SET photo_meta = _new_meta,
         status     = _new_status,
         updated_at = now()
   WHERE id = _entry_id;

  -- Audit
  INSERT INTO public.db_audit_logs (table_name, operation, row_id, changed_by, old_data, new_data)
  VALUES (
    'competition_entries',
    'photo_reject_toggle',
    _entry_id::text,
    auth.uid(),
    jsonb_build_object('photo_index', _photo_index, 'old_status', _old_status, 'old_meta_item', _old_meta -> _photo_index),
    jsonb_build_object('photo_index', _photo_index, 'new_status', _new_status, 'new_meta_item', _new_meta -> _photo_index, 'reason', _reason)
  );

  RETURN jsonb_build_object(
    'entry_id', _entry_id,
    'photo_index', _photo_index,
    'rejected', _rejected,
    'old_status', _old_status,
    'new_status', _new_status,
    'all_rejected', _all_rejected
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_photo_rejected(uuid, integer, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_photo_rejected(uuid, integer, boolean, text) TO authenticated;