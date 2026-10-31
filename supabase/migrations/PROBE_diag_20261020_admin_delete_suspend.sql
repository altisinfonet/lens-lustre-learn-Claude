-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · DIAGNOSIS 2026-10-20 · why admin Delete and Suspend fail on live.
--
-- The Owner reported (live, 2026-10-20): Admin → Users → Delete shows
-- "Edge Function returned a non-2xx status code" and Suspend fails too.
-- delete-user calls public.admin_delete_auth_user(uuid) (DELETE FROM auth.users,
-- cascades); Suspend is a client UPDATE of public.profiles under RLS as the admin.
--
-- This file REPRODUCES both, inside ONE transaction that ends in ROLLBACK, and
-- each step also runs inside its own EXCEPTION block (a sub-transaction that is
-- undone on error). NOTHING it does survives: no suspension, no deletion.
-- It only reports the SQLSTATE + message of each step as a NOTICE.
--
-- The target member is matched by md5(lower(email)) so no member email is in git.
-- The acting admin is the earliest 'admin' row in user_roles.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $diag$
DECLARE
  _target_md5 constant text := '96138c9fe3e918fe7fe66ec1d9293462';
  _t    uuid;
  _adm  uuid;
  _n    bigint;
  _a    text := 'not run';
  _b    text := 'not run';
  _st   text;
  _msg  text;
  _det  text;
  _ctx  text;
BEGIN
  SELECT u.id INTO _t FROM auth.users u WHERE md5(lower(u.email)) = _target_md5;
  SELECT ur.user_id INTO _adm FROM public.user_roles ur WHERE ur.role::text = 'admin'
   ORDER BY ur.user_id LIMIT 1;
  IF _t IS NULL THEN
    RAISE NOTICE 'DIAG: target member not on this lane — nothing to reproduce';
    RETURN;
  END IF;

  -- A · Suspend, exactly as AdminUsers.tsx does it: UPDATE profiles as the admin (RLS on).
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _adm, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', _adm::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.profiles
       SET is_suspended = true, suspension_reason = 'DIAG (rolled back)', suspended_until = now() + interval '7 days'
     WHERE id = _t;
    GET DIAGNOSTICS _n = ROW_COUNT;
    RESET ROLE;
    _a := 'OK rows=' || _n;
    RAISE EXCEPTION 'diag-undo-A';   -- undo step A's work right here
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _st = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _det = PG_EXCEPTION_DETAIL, _ctx = PG_EXCEPTION_CONTEXT;
    IF _msg <> 'diag-undo-A' THEN
      _a := 'FAIL ' || _st || ': ' || _msg || coalesce(' | detail: ' || nullif(_det, ''), '') || ' | ctx: ' || left(coalesce(_ctx, ''), 300);
    END IF;
  END;
  RESET ROLE;

  -- B · Delete, exactly as delete-user does it (service role → definer function).
  BEGIN
    PERFORM public.admin_delete_auth_user(_t);
    _b := 'OK (would delete)';
    RAISE EXCEPTION 'diag-undo-B';   -- undo the deletion right here
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _st = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _det = PG_EXCEPTION_DETAIL, _ctx = PG_EXCEPTION_CONTEXT;
    IF _msg <> 'diag-undo-B' THEN
      _b := 'FAIL ' || _st || ': ' || _msg || coalesce(' | detail: ' || nullif(_det, ''), '') || ' | ctx: ' || left(coalesce(_ctx, ''), 300);
    END IF;
  END;

  RAISE NOTICE 'DIAG A suspend: %', _a;
  RAISE NOTICE 'DIAG B delete:  %', _b;
END
$diag$;
ROLLBACK;
