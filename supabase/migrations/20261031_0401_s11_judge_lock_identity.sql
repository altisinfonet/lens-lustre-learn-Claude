-- ═══════════════════════════════════════════════════════════════════════════
-- S11 · judging locks act only for the signed-in judge. Both lanes.
-- Re-cut of PR #276's BODY fix (its grant half already landed as 0034/0035).
--
-- FINDING (foundation audit 2026-10-30, PROBE 0902 on production; unchanged in
-- git since 20260326091904): acquire_judge_lock / heartbeat_judge_lock /
-- release_judge_lock are SECURITY DEFINER and take `_judge_id` from the caller
-- with no check. Any signed-in member can release or extend another judge's
-- lock, or take a lock in a judge's name (shown to other judges as
-- "locked by" that judge), stalling judging.
--
-- REAL CALLERS (inspected): only src/hooks/judging/useJudgingLock.ts, used once
-- at JudgePanel.tsx `useJudgingLock(user?.id, …)` — it always passes the
-- signed-in user's own id; JudgePanel is reachable only with the judge or
-- admin role. The teardown release sends the judge's JWT (#284). No edge
-- function, cron job or SQL function calls these three.
--
-- FIX: each body first refuses (1) no JWT, (2) `_judge_id` ≠ auth.uid(),
-- (3) a caller holding neither judge nor admin in user_roles (the same rule
-- as supabase/functions/_shared/judgingAuth.ts authenticateJudge). Nothing
-- else in the bodies changes. Grants restated exactly as 0035 left them.
-- user_roles.role is compared as text (staging text, production app_role).
--
-- DRIFT GUARD: refuses unless each live body is byte-for-byte (whitespace-
-- normalised) the git body from 20260326091904 that this file replaces.
--
-- PROBE:    supabase/migrations/PROBE_20261031_0401_s11_judge_lock_identity.sql
-- Rollback: supabase/rollback/20261031_0401_s11_judge_lock_identity_ROLLBACK.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT p.proname, md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) AS h
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('acquire_judge_lock', 'heartbeat_judge_lock', 'release_judge_lock')
  LOOP
    n := n + 1;
    IF r.h <> ('{"acquire_judge_lock": "71069d4a19a3defd0bec06969efd76bb", "heartbeat_judge_lock": "3cc9bc3e203a01fb91497aa52275cbf9", "release_judge_lock": "672c3b49b8e874b5fd75d0f79ce8f279"}'::jsonb ->> r.proname) THEN
      RAISE EXCEPTION 'S11-0401-PRE-001: the live body of % is not the pre-fix git body this file replaces (drift) — re-measure with PROBE_20261031_0401 before applying', r.proname;
    END IF;
  END LOOP;
  IF n <> 3 THEN
    RAISE EXCEPTION 'S11-0401-PRE-002: expected exactly 3 lock functions (one overload each), found %', n;
  END IF;
  PERFORM 1 FROM pg_class WHERE oid = 'public.user_roles'::regclass;
END
$pre$;

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
  -- 0401 · act only for the signed-in judge (or admin), never in someone else's name.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'JUDGE-LOCK-401: sign-in required' USING ERRCODE = '28000';
  END IF;
  IF _judge_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'JUDGE-LOCK-403: a lock can only be held in your own name' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid() AND ur.role::text IN ('judge', 'admin')) THEN
    RAISE EXCEPTION 'JUDGE-LOCK-403: judge or admin role required' USING ERRCODE = '42501';
  END IF;
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
  -- 0401 · act only for the signed-in judge (or admin), never in someone else's name.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'JUDGE-LOCK-401: sign-in required' USING ERRCODE = '28000';
  END IF;
  IF _judge_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'JUDGE-LOCK-403: a lock can only be held in your own name' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid() AND ur.role::text IN ('judge', 'admin')) THEN
    RAISE EXCEPTION 'JUDGE-LOCK-403: judge or admin role required' USING ERRCODE = '42501';
  END IF;
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
  -- 0401 · act only for the signed-in judge (or admin), never in someone else's name.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'JUDGE-LOCK-401: sign-in required' USING ERRCODE = '28000';
  END IF;
  IF _judge_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'JUDGE-LOCK-403: a lock can only be held in your own name' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid() AND ur.role::text IN ('judge', 'admin')) THEN
    RAISE EXCEPTION 'JUDGE-LOCK-403: judge or admin role required' USING ERRCODE = '42501';
  END IF;
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

DO $post$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.proname, p.prosrc FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('acquire_judge_lock', 'heartbeat_judge_lock', 'release_judge_lock')
  LOOP
    IF r.prosrc !~ 'JUDGE-LOCK-403: a lock can only be held in your own name' THEN
      RAISE EXCEPTION 'S11-0401-POST-001: % has no identity check', r.proname;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.release_judge_lock(uuid, integer, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.release_judge_lock(uuid, integer, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S11-0401-POST-002: grants are not as 0035 left them';
  END IF;
  RAISE NOTICE 'S11 0401 applied (lane %): judging locks act only for the signed-in judge', current_setting('p32.lane');
END
$post$;

COMMIT;
