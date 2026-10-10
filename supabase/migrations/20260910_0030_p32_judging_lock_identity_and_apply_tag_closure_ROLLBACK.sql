-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0030_p32_judging_lock_identity_and_apply_tag_closure.sql
--
-- Restores the exact original bodies (byte-identical to pg_get_functiondef's
-- live output, captured this session, 2026-09-21, before the forward
-- migration) for the three lock functions, and restores the original
-- wide-open grants (PUBLIC/anon/authenticated/service_role EXECUTE) on all
-- four functions, matching the pre-migration measured proacl shape exactly.
--
-- This re-opens the identity-spoofing gap and the direct-RPC bypass of
-- submit-judge-tag's validation. Use only if the forward migration causes a
-- regression that needs immediate reversal while a fix is prepared — not a
-- routine operation.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer DEFAULT 5)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE judge_entry_locks
  SET expires_at = now() + (_ttl_minutes || ' minutes')::interval
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$function$;

-- Restore original wide-open grants (measured live, 2026-09-21, before the
-- forward migration) on all four functions.
GRANT EXECUTE ON FUNCTION public.acquire_judge_lock(uuid, integer, uuid, integer) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_judge_lock(uuid, integer, uuid, integer) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_judge_lock(uuid, integer, uuid) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.judge_apply_single_tag(uuid, integer, integer, uuid, uuid) TO public, anon, authenticated, service_role;

COMMIT;
