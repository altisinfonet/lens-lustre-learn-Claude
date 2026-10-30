-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0401 — restores the three lock functions exactly as
-- 20260326091904 created them (no caller check). Grants restated as 0035 left
-- them. Refuses unless 0401 is applied.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb_pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = 'public.release_judge_lock(uuid, integer, uuid)'::regprocedure
                    AND p.prosrc ~ 'JUDGE-LOCK-403: a lock can only be held in your own name') THEN
    RAISE EXCEPTION 'S11-0401-RB-PRE: 20261031_0401 is not applied on this lane — nothing to roll back';
  END IF;
END
$rb_pre$;

CREATE OR REPLACE FUNCTION public.acquire_judge_lock(
  _entry_id uuid,
  _photo_index integer,
  _judge_id uuid,
  _ttl_minutes integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing record;
  _result jsonb;
BEGIN
  -- Clear expired locks for this entry+photo
  DELETE FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND expires_at < now();

  -- Check if lock exists
  SELECT * INTO _existing FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index;

  IF _existing IS NOT NULL THEN
    IF _existing.judge_id = _judge_id THEN
      -- Extend own lock
      UPDATE judge_entry_locks
      SET expires_at = now() + (_ttl_minutes || ' minutes')::interval,
          locked_at = now()
      WHERE id = _existing.id;
      RETURN jsonb_build_object('acquired', true, 'lock_id', _existing.id);
    ELSE
      -- Locked by another judge
      RETURN jsonb_build_object(
        'acquired', false,
        'locked_by', _existing.judge_id,
        'expires_at', _existing.expires_at
      );
    END IF;
  END IF;

  -- No lock exists, create one
  INSERT INTO judge_entry_locks (entry_id, photo_index, judge_id, expires_at)
  VALUES (_entry_id, _photo_index, _judge_id, now() + (_ttl_minutes || ' minutes')::interval)
  RETURNING id INTO _existing;

  RETURN jsonb_build_object('acquired', true, 'lock_id', _existing.id);
END;
$$;
CREATE OR REPLACE FUNCTION public.release_judge_lock(
  _entry_id uuid,
  _photo_index integer,
  _judge_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$$;
CREATE OR REPLACE FUNCTION public.heartbeat_judge_lock(
  _entry_id uuid,
  _photo_index integer,
  _judge_id uuid,
  _ttl_minutes integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE judge_entry_locks
  SET expires_at = now() + (_ttl_minutes || ' minutes')::interval
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) TO authenticated, service_role;

DO $rb_post$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.proname, md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) AS h FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('acquire_judge_lock', 'heartbeat_judge_lock', 'release_judge_lock')
  LOOP
    IF r.h <> ('{"acquire_judge_lock": "71069d4a19a3defd0bec06969efd76bb", "heartbeat_judge_lock": "3cc9bc3e203a01fb91497aa52275cbf9", "release_judge_lock": "672c3b49b8e874b5fd75d0f79ce8f279"}'::jsonb ->> r.proname) THEN
      RAISE EXCEPTION 'S11-0401-RB-POST: % is not back to its pre-0401 body', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'S11 0401 rolled back (lane %)', current_setting('p32.lane');
END
$rb_post$;

COMMIT;
