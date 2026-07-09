-- B1.5 — stage_key immutability + admin-only rewind

-- 1) Numeric ordering of progression
CREATE OR REPLACE FUNCTION public.progression_order(_stage_key text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (round_number * 100)
              + CASE family
                  WHEN 'pending'   THEN 1
                  WHEN 'review'    THEN 2
                  WHEN 'qualified' THEN 3
                  WHEN 'shortlist' THEN 4
                  WHEN 'finalist'  THEN 5
                  WHEN 'winner'    THEN 6
                  WHEN 'rejected'  THEN 9
                  ELSE 0
                END
       FROM public.v3_stage_catalog
      WHERE stage_key = _stage_key
        AND is_active = true
      LIMIT 1),
    0
  );
$$;

-- 2) Trigger: block backwards stage_key moves unless admin_rewind_stage opened the gate
CREATE OR REPLACE FUNCTION public.guard_stage_key_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _allow text := current_setting('app.allow_stage_rewind', true);
  _old_order int;
  _new_order int;
BEGIN
  IF NEW.stage_key IS NULL OR OLD.stage_key IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stage_key = OLD.stage_key THEN
    RETURN NEW;
  END IF;

  _old_order := public.progression_order(OLD.stage_key);
  _new_order := public.progression_order(NEW.stage_key);

  IF _new_order >= _old_order THEN
    RETURN NEW;
  END IF;

  IF _allow IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'stage_key rewind blocked: % (%) -> % (%). Use admin_rewind_stage().',
      OLD.stage_key, _old_order, NEW.stage_key, _new_order
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.db_audit_logs(table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (
    'competition_entries',
    'stage_key_rewind',
    NEW.id::text,
    jsonb_build_object('stage_key', OLD.stage_key, 'order', _old_order),
    jsonb_build_object('stage_key', NEW.stage_key, 'order', _new_order),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_stage_key_immutability ON public.competition_entries;
CREATE TRIGGER trg_guard_stage_key_immutability
BEFORE UPDATE OF stage_key ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.guard_stage_key_immutability();

-- 3) Admin-only rewind RPC
CREATE OR REPLACE FUNCTION public.admin_rewind_stage(
  _entry_id     uuid,
  _to_stage_key text,
  _reason       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin bool;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin') INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RAISE EXCEPTION 'admin_rewind_stage requires admin role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN
    RAISE EXCEPTION 'admin_rewind_stage requires a reason (>=5 chars)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.v3_stage_catalog
     WHERE stage_key = _to_stage_key AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unknown or inactive stage_key %', _to_stage_key;
  END IF;

  PERFORM set_config('app.allow_stage_rewind', 'on', true);
  UPDATE public.competition_entries
     SET stage_key = _to_stage_key
   WHERE id = _entry_id;
  PERFORM set_config('app.allow_stage_rewind', 'off', true);

  INSERT INTO public.db_audit_logs(table_name, operation, row_id, new_data, changed_by)
  VALUES (
    'competition_entries',
    'admin_rewind_stage',
    _entry_id::text,
    jsonb_build_object('to_stage_key', _to_stage_key, 'reason', _reason),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_rewind_stage(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_rewind_stage(uuid,text,text) TO authenticated;