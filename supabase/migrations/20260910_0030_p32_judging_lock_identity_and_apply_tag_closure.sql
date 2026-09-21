-- ═══════════════════════════════════════════════════════════════════════════
-- P32 SESSION A, NEXT UNIT — judging-lock identity spoofing (BODY fix) +
-- judge_apply_single_tag exposure (GRANT-only fix)
--
-- Re-measured live on staging (fpszggreishhuvdpkmdr), 2026-09-21, this
-- session, before this migration: still 75 anon-executable non-trigger
-- VOLATILE functions (unchanged from the count taken before PR #274 was
-- authored — expected, since nothing has been dispatched to this database
-- yet). staging's own migration-history table (list_migrations) still shows
-- only the same 8 pre-P32 entries. Nothing from P32 has been applied live.
--
-- Ordinal: staging's Phase-1 tree currently ends at `_0026` (`_0023` remains
-- absent, `_0027`-`_0029` are reserved by open PR #274, not yet merged).
-- This unit takes `_0030` — the first ordinal free of BOTH the merged tree
-- and PR #274's reservation, so this file will not collide with #274 when
-- it lands.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING — acquire_judge_lock / heartbeat_judge_lock / release_judge_lock
-- (confirmed via pg_get_functiondef, this session, on all three):
--
--   acquire_judge_lock(_entry_id, _photo_index, _judge_id, _ttl_minutes)
--   heartbeat_judge_lock(_entry_id, _photo_index, _judge_id, _ttl_minutes)
--   release_judge_lock(_entry_id, _photo_index, _judge_id)
--
-- All three are SECURITY DEFINER, VOLATILE, and take `_judge_id` as a bare
-- caller-supplied parameter with NO verification anywhere in the body that
-- it matches the actual authenticated caller. All three are anon+authenticated
-- executable today (measured: proacl grants PUBLIC/anon/authenticated/
-- service_role EXECUTE on all three). Concretely, over
-- rpc/{acquire,heartbeat,release}_judge_lock, any authenticated caller —
-- judge or not — can today:
--   - RELEASE any other judge's active lock at will (direct DoS: force a
--     judge off an entry they are actively scoring, repeatedly);
--   - HEARTBEAT (indefinitely extend) a lock they do not hold, keeping a
--     stale/abandoned lock alive forever and starving the legitimate judge
--     queue for that entry+photo;
--   - ACQUIRE a lock under another judge's _judge_id, which is reported back
--     to OTHER clients as "locked_by": that judge's id — a false "this judge
--     is reviewing this photo" signal with no real judge present.
--
-- None of this requires knowing a password or session token — only another
-- judge's user id, which is not treated as a secret elsewhere in this
-- codebase (it's a public uuid, e.g. visible in judging_tag_assignments).
--
-- BLAST RADIUS, MEASURED — the only caller of all three is
-- src/hooks/judging/useJudgingLock.ts, and it is invoked exactly once, at
-- src/pages/JudgePanel.tsx:385:
--
--   useJudgingLock(user?.id, selectedPhoto?.entryId || null, ...)
--
-- i.e. `judgeId` is always `user?.id` — the CURRENT authenticated session's
-- own id — never the admin "seat mode" `effectiveJudgeId`/`seatJudgeId`
-- used elsewhere in this same file's siblings (useJudgeActions.ts,
-- useDebouncedFeedbackSave.ts) for actual tag/comment writes. Seat mode does
-- not touch locking at all (grepped this session, confirmed zero references
-- to as_judge_id/seatJudgeId in useJudgingLock.ts or its only call site).
-- So `_judge_id = auth.uid()` is not a new rule being invented here — it is
-- the invariant every real caller already satisfies; this migration makes
-- the database enforce what the client already assumes.
--
-- FIX (BODY-LEVEL, not grant-only — a spoofable identity parameter cannot be
-- closed by a REVOKE): each of the three now rejects, before doing anything
-- else, when the caller has no JWT (`auth.uid() IS NULL`), when `_judge_id`
-- does not equal the caller's own `auth.uid()`, or when the caller holds
-- neither the `judge` nor `admin` role — the same `has_role` pattern and the
-- same judge-or-admin gate already used by this feature's own edge function
-- (`supabase/functions/_shared/judgingAuth.ts:authenticateJudge`, read this
-- session), not a newly invented rule. No other logic in any of the three
-- bodies is touched.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING — judge_apply_single_tag(_entry_id, _photo_index, _round_number,
-- _tag_id, _judge_id)
--
-- SECURITY DEFINER, VOLATILE, same caller-supplied `_judge_id` with no
-- identity check in the body. Directly writes/deletes judge_tag_assignments
-- AS the given `_judge_id` — the actual competition-scoring write, not just
-- a UI lock. Currently anon+authenticated-executable (measured, same proacl
-- shape as the lock functions).
--
-- BLAST RADIUS, MEASURED — its only caller in the entire tree (grepped
-- src/, supabase/functions/, functions/, this session) is
-- supabase/functions/submit-judge-tag/index.ts, which — read in full this
-- session — already does everything correctly before calling this RPC:
-- validates the caller's JWT (`authenticateJudge`), resolves and validates
-- `effectiveJudgeId` (admin-gated seat mode only, via `as_judge_id`),
-- validates the judge's real assignment to the entry
-- (`validateJudgeAssignment`), validates the round is not locked
-- (`validateRoundNotLocked`), validates the tag exists and is visible in
-- that round, and enforces the R4 unique-award rule — THEN calls this RPC
-- through `admin.rpc(...)`, where `admin` (confirmed this session, reading
-- `_shared/judgingAuth.ts`) is `createClient(supabaseUrl, serviceKey)` — a
-- genuine `service_role` Postgres-level client, not an authenticated-user
-- client. Postgres EXECUTE privilege is still enforced for service_role
-- (it is a real role with its own ACL entry, not superuser), so revoking
-- PUBLIC/anon/authenticated EXECUTE here and keeping only service_role's
-- existing grant does not touch this edge function's call path at all — it
-- removes only the ability to call this RPC DIRECTLY over PostgREST,
-- bypassing every one of the edge function's checks above (the actual
-- competition-integrity vulnerability: fabricating or altering another
-- judge's tags without any of that validation).
--
-- FIX (GRANT-ONLY — the sanctioned path is a service_role caller, so no body
-- change is needed or wanted here): REVOKE ALL FROM public, anon,
-- authenticated; retain service_role only. Body is untouched.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT DECIDED HERE — flagged, not acted on
--
-- Whether lock ACQUISITION should also require the specific judge be
-- assigned to that entry (the deeper check `validateJudgeAssignment`
-- performs for the actual tag write) is a product question this migration
-- does not answer: today any judge/admin can preview-lock any entry's UI,
-- and only the actual scoring write (now closed above) is assignment-gated.
-- That may be intentional (browsing without an assignment is harmless once
-- the write path is closed) or may not be. Recorded for the Owner/Auditor;
-- not touched by this migration.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SEQUENCE — Expand→Behaviour→Contract: this is a BEHAVIOUR step for the
-- three lock functions (their logic changes) and a grant-only step for
-- judge_apply_single_tag. CREATE OR REPLACE FUNCTION always reopens EXECUTE
-- to PUBLIC (F-66/F-65 — the built-in default), so the REVOKE/GRANT block
-- below runs AFTER every CREATE OR REPLACE in this file, never before.
-- Rollback (20260910_0030_..._ROLLBACK.sql) restores the exact original
-- three bodies (byte-identical to what pg_get_functiondef returned live,
-- this session, before this migration) and the original wide-open grants.

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF _judge_id <> auth.uid() THEN
    RAISE EXCEPTION 'judge_id must match the authenticated caller' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'judge') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'judge or admin role required' USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer DEFAULT 5)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF _judge_id <> auth.uid() THEN
    RAISE EXCEPTION 'judge_id must match the authenticated caller' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'judge') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'judge or admin role required' USING ERRCODE = '42501';
  END IF;

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF _judge_id <> auth.uid() THEN
    RAISE EXCEPTION 'judge_id must match the authenticated caller' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'judge') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'judge or admin role required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM judge_entry_locks
  WHERE entry_id = _entry_id AND photo_index = _photo_index AND judge_id = _judge_id;
  RETURN FOUND;
END;
$function$;

-- judge_apply_single_tag: body UNCHANGED (its only caller is a service_role
-- edge function that already validates everything). Grant-only closure.

REVOKE ALL ON FUNCTION public.acquire_judge_lock(uuid, integer, uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.acquire_judge_lock(uuid, integer, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.acquire_judge_lock(uuid, integer, uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.heartbeat_judge_lock(uuid, integer, uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.heartbeat_judge_lock(uuid, integer, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_judge_lock(uuid, integer, uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.release_judge_lock(uuid, integer, uuid) FROM public;
REVOKE ALL ON FUNCTION public.release_judge_lock(uuid, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_judge_lock(uuid, integer, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.judge_apply_single_tag(uuid, integer, integer, uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.judge_apply_single_tag(uuid, integer, integer, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.judge_apply_single_tag(uuid, integer, integer, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.judge_apply_single_tag(uuid, integer, integer, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.acquire_judge_lock(uuid, integer, uuid, integer) IS
  'Acquires/extends a UI editing lock for a judge on one entry+photo. P32, Session A, body fix 2026-09-21: now rejects when _judge_id does not match the authenticated caller (auth.uid()) or when the caller holds neither judge nor admin role. Prior state let any authenticated caller impersonate any judge_id, force-releasing or squatting another judge''s lock. Only real caller (src/pages/JudgePanel.tsx via useJudgingLock.ts) already always passes the caller''s own id. NOT executable by anon or public. If recreated with DROP+CREATE this REOPENS to PUBLIC (F-66) and both the identity check and the grant must be re-applied.';

COMMENT ON FUNCTION public.heartbeat_judge_lock(uuid, integer, uuid, integer) IS
  'Extends a judge lock TTL. P32, Session A, body fix 2026-09-21: same auth.uid()-match and judge/admin-role checks as acquire_judge_lock, same finding and same caller. NOT executable by anon or public.';

COMMENT ON FUNCTION public.release_judge_lock(uuid, integer, uuid) IS
  'Releases a judge lock. P32, Session A, body fix 2026-09-21: same auth.uid()-match and judge/admin-role checks as acquire_judge_lock — this was the most directly exploitable of the three (a bare caller-controlled _judge_id let anyone force-release any judge''s active lock). NOT executable by anon or public.';

COMMENT ON FUNCTION public.judge_apply_single_tag(uuid, integer, integer, uuid, uuid) IS
  'Applies a single judge tag (the actual scoring write). P32, Session A, grant-only fix 2026-09-21: NOT executable by anon, public, or authenticated. Body unchanged. Its only caller, supabase/functions/submit-judge-tag/index.ts, uses a service_role client and already validates JWT, role, entry assignment, round-lock state, tag visibility, and the R4 unique-award rule before calling this RPC — closing the grant here removes the ability to call it directly over PostgREST and bypass all of that validation, without affecting the sanctioned path. If recreated with DROP+CREATE this REOPENS to PUBLIC (F-66) and the grant must be re-applied.';

COMMIT;
