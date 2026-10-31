-- ═══════════════════════════════════════════════════════════════════════════
-- F-98c + F-105a — THE BIRTHDAY RPC CARRIES THE HANDLE **AND** STOPS BEING
-- MEMBER-CALLABLE, IN ONE TRANSACTION, SO THERE IS NO WINDOW BETWEEN THEM.
--
-- Owner authorised closing the leak: against "a logged-in member can read
-- another member's private birthday list", his words were "6 do it".
--
-- ⚠ WHY THIS FILE EXISTS AT ALL, INSTEAD OF DISPATCHING 0015 THEN 0016.
--
-- 0015 is a DROP + CREATE. A recreate resets the ACL: the built-in
-- EXECUTE-to-PUBLIC default lands (F-66) and ALTER DEFAULT PRIVILEGES for role
-- postgres in schema public re-grants anon, authenticated and service_role.
-- 0015's own revoke names PUBLIC and anon — it does NOT name authenticated.
-- So the moment 0015 commits, `authenticated` holds EXECUTE again, which is
-- exactly the leak 0016 exists to close.
--
-- Dispatched as two files that is a REAL EXPOSURE WINDOW, and its length is not
-- seconds. apply-migration.yml runs one file per dispatch, each dispatch waits
-- on its own production environment approval, and psql is invoked WITHOUT
-- --single-transaction (verified: `--set ON_ERROR_STOP=1 --echo-errors
-- --no-psqlrc -f "$MIGRATION_PATH"`). The window therefore runs from 0015
-- committing until a human clicks the second gate and that job finishes —
-- minutes at best, unbounded in practice. The P31 run sat on that gate for a
-- day and a half.
--
-- In ONE transaction the window is ZERO. Postgres DDL is transactional, so the
-- DROP, the CREATE and every grant change commit together; no other session can
-- observe the intermediate state, because uncommitted DDL is not visible. This
-- file therefore carries an explicit BEGIN/COMMIT — psql is in autocommit here,
-- so without it each statement would commit on its own and the window would
-- reappear inside a single dispatch.
--
-- ⚠ WHAT THIS IS NOT. It is not a rewrite of 0015 or 0016. The function body
-- below is lifted BYTE-IDENTICALLY from
-- supabase/migrations/20260910_0015_f98c_birthdays_carry_handle.sql as applied
-- to staging, and the grant statements are 0015's two followed by 0016's one,
-- in that order and unaltered. The end state is exactly staging's current ACL:
-- postgres and service_role, nothing else.
--
-- ⚠ ONE HAPPY SIDE EFFECT, STATED SO IT IS NOT MISTAKEN FOR AN EDIT. 0016's
-- COMMENT asserts "Returns custom_url (F-98c)". On production that sentence was
-- FALSE while 0016 was held, because the column did not exist there yet — it
-- was accepted as a known-false comment. Applied in this transaction the column
-- is added first, so the sentence is true the instant it is written. The
-- known-false-comment finding is closed by the ordering, not by editing text.
--
-- SAFE FOR THE DEPLOYED CLIENT, re-verified rather than assumed: dashboard-init
-- v28 on production builds its client with SUPABASE_SERVICE_ROLE_KEY and calls
-- this RPC as `admin`, spreading whole rows into the response. An EXTRA column
-- is ignored by the deployed version and consumed by the next. service_role
-- keeps EXECUTE below, and G5 fails the whole transaction if it ever does not.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0015: the handle travels with the name ──
DROP FUNCTION IF EXISTS public.get_todays_birthdays(uuid);

CREATE FUNCTION public.get_todays_birthdays(_viewer uuid)
RETURNS TABLE (id uuid, full_name text, avatar_url text, custom_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.avatar_url, p.custom_url
  FROM public.profiles p
  WHERE p.is_suspended = false
    AND p.date_of_birth IS NOT NULL
    AND to_char(p.date_of_birth, 'MM-DD') = to_char(now(), 'MM-DD')
    AND (
      -- You always see your own.
      p.id = _viewer
      -- Explicitly public.
      OR COALESCE(NULLIF(p.privacy_settings->>'dob_day_month', ''), 'friends') = 'public'
      -- Friends-only (and the DEFAULT, because that is what Edit Profile shows
      -- a member who has never touched the control).
      OR (
        COALESCE(NULLIF(p.privacy_settings->>'dob_day_month', ''), 'friends') = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.requester_id = _viewer AND f.addressee_id = p.id)
              OR (f.addressee_id = _viewer AND f.requester_id = p.id)
            )
        )
      )
      -- 'only_me' falls through to nothing, which is the point.
    )
  ORDER BY p.full_name NULLS LAST;
$$;
COMMENT ON FUNCTION public.get_todays_birthdays(uuid) IS
  'Members whose birthday is today, filtered by their own privacy_settings->>''dob_day_month'' (default: friends). No row limit — replaces a LIMIT 50 in dashboard-init that hid 28 of 68 members. Returns custom_url (F-98c) so the name can be a link. SERVER-SIDE ONLY (F-105a): revoked from PUBLIC, anon and authenticated. It is SECURITY DEFINER and takes _viewer as an argument without checking it against auth.uid(), so a member-callable grant lets anyone read anyone else''s friend-filtered birthday list. The only caller is dashboard-init, which holds service_role.';

-- 0015's grants, verbatim and in order.
REVOKE ALL    ON FUNCTION public.get_todays_birthdays(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_todays_birthdays(uuid) TO service_role;

-- ── 0016: and it stops being member-callable, in the SAME transaction ──
REVOKE EXECUTE ON FUNCTION public.get_todays_birthdays(uuid) FROM PUBLIC, anon, authenticated;

-- ── The end state is asserted BEFORE COMMIT, so a wrong ACL rolls the whole
--    thing back rather than shipping. proacl is the instrument;
--    has_function_privilege cannot tell a direct grant from an inherited one
--    and reported F-98's revoke as done when it was not (C-89).
DO $gate$
DECLARE _oid oid; _n int; _acl text; _pub int; _anon int; _auth int; _svc int; _cols int;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='get_todays_birthdays';
  IF _n <> 1 THEN
    RAISE EXCEPTION 'G1 FAILED — % functions named get_todays_birthdays after the recreate; expected exactly 1.', _n;
  END IF;

  SELECT oid, array_to_string(proacl,' | ') INTO _oid,_acl FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='get_todays_birthdays';

  SELECT count(*) FILTER (WHERE a.grantee=0),
         count(*) FILTER (WHERE a.grantee='anon'::regrole),
         count(*) FILTER (WHERE a.grantee='authenticated'::regrole),
         count(*) FILTER (WHERE a.grantee='service_role'::regrole)
    INTO _pub,_anon,_auth,_svc
    FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid=_oid;

  IF _pub  > 0 THEN RAISE EXCEPTION 'G3 FAILED — PUBLIC holds EXECUTE (F-62/F-66). acl = %', _acl; END IF;
  IF _auth > 0 THEN RAISE EXCEPTION 'G2 FAILED — authenticated holds EXECUTE; the leak is still open. acl = %', _acl; END IF;
  IF _anon > 0 THEN RAISE EXCEPTION 'G4 FAILED — anon holds EXECUTE. acl = %', _acl; END IF;
  IF _svc  = 0 THEN RAISE EXCEPTION 'G5 FAILED — service_role lost EXECUTE; dashboard-init would be DOWN. acl = %', _acl; END IF;

  SELECT count(*) INTO _cols
    FROM unnest(string_to_array(pg_get_function_result(_oid), ',')) c
   WHERE btrim(c) LIKE 'custom_url %';
  IF _cols <> 1 THEN
    RAISE EXCEPTION 'G6 FAILED — result type carries % custom_url column(s); expected 1. result = %',
      _cols, pg_get_function_result(_oid);
  END IF;

  RAISE NOTICE 'G1 ok — exactly one function, oid %', _oid;
  RAISE NOTICE 'G6 ok — custom_url present in the result type (0015 landed)';
  RAISE NOTICE 'G3 ok — no PUBLIC entry';
  RAISE NOTICE 'G2 ok — authenticated CANNOT execute (0016 landed, same transaction)';
  RAISE NOTICE 'G4 ok — anon CANNOT execute';
  RAISE NOTICE 'G5 ok — service_role retains EXECUTE (dashboard-init works)';
  RAISE NOTICE 'final acl = %', _acl;
END
$gate$;

COMMIT;
