-- ═══════════════════════════════════════════════════════════════════════════
-- P32 MAIL GROUP GATE PROBE — enqueue_email, read_email_batch, delete_email,
-- emit_notification and move_to_dlq closed to PUBLIC and anon, authenticated
-- also closed (privileged-only, unlike the identity group's claim_username/
-- change_custom_url which stay member-callable), service_role untouched.
-- READS ONLY. Ends in ROLLBACK.
--
-- ⚠ THIS PROBE COVERS THREE SEPARATE FORWARD MIGRATIONS, NOT ONE.
--   20260910_0024_p32mail_delete_email_revoke.sql          -> delete_email
--   20260910_0025_p32mail_emit_notification_revoke.sql     -> emit_notification
--   20260910_0026_p32mail_move_to_dlq_mail_only_revoke.sql -> move_to_dlq
--   20260814042609_email_queue_authority.sql (pre-existing) -> enqueue_email,
--                                                                read_email_batch
-- All five share one intended final ACL shape (PUBLIC=false, anon=false,
-- authenticated=false, service_role=true), which is why one probe covers all
-- five rather than one per migration — but each assertion below is still
-- per-function, per the gate's own rule quoted next, not written against the
-- group as a class.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE'S OWN RULE — docs/gates/P1-revocation-list.md §1, frozen:
--
--   "A closure is proved per function, by
--    has_function_privilege('anon', <oid>, 'EXECUTE') = false, on the lane it
--    is claimed for. No gate on this list may be written against a *class*."
--
-- ⚠ F-62 GENUINELY BITES HERE, ON ALL FIVE. Measured on staging
-- (fpszggreishhuvdpkmdr, 2026-09-17, this session, read-only): PUBLIC holds
-- EXECUTE on all five today (the leading `=X/postgres` in proacl, aclexplode
-- grantee=0 count = 1 on every one) — the pre-revoke state, since none of
-- 20260814042609, 20260910_0024, 20260910_0025 or 20260910_0026 has been
-- dispatched on this lane since the 2026-09-11 full-schema bootstrap reset
-- every function's ACL to the Postgres default (F-66; that bootstrap's own
-- header confirms it carries zero GRANT/REVOKE statements). So today this
-- probe is EXPECTED TO FAIL at C2/C3 for all five functions — that is what
-- "not yet applied" looks like, and it is the correct, honest state for this
-- file to report before the four migrations above are dispatched. It is
-- committed now, unrun and failing by design against the current live state,
-- so that dispatching them has a gate ready to prove the result rather than a
-- gate written afterward to match whatever happened (C-34: a test written
-- after the fact, that could not have been shown failing first, is not
-- evidence).
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It reads the catalogue only. It does not
-- call any of the five functions — all are VOLATILE and several mutate real
-- state (pgmq queues, notification_emit_log, user_notifications), so
-- exercising them here would write data inside what is supposed to be a
-- read-only gate; that is not this file's job. It does not exercise
-- /rest/v1/rpc over HTTP as a real browser would (F-53). It does not re-run
-- the caller-safety analysis — that is recorded separately in this session's
-- forensic reports, not duplicated here as SQL.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  rec          record;
  fn_oid       oid;
  fn_acl       text;
  fn_secdef    boolean;
  fn_volatile  "char";
  fn_schema    text;
  fn_anon      boolean;
  fn_auth      boolean;
  fn_svc       boolean;
  fn_public    integer;
  checked      integer := 0;
BEGIN
  RAISE NOTICE '--- P32 mail-group gate probe: queue/notification functions @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  -- sig · the exact signature each migration targets, full argument list, so
  -- to_regprocedure cannot resolve an unintended overload. All five share the
  -- same intended final state: privileged-only (service_role), closed to
  -- PUBLIC, anon and authenticated alike — unlike the identity group's
  -- claim_username/change_custom_url, nothing in this group is member-facing.
  FOR rec IN
    SELECT * FROM (VALUES
      ('public.enqueue_email(text, jsonb)'),
      ('public.read_email_batch(text, integer, integer)'),
      ('public.delete_email(text, bigint)'),
      ('public.emit_notification(text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text)'),
      ('public.move_to_dlq(text, text, bigint, jsonb)')
    ) AS t(sig)
  LOOP
    -- C1 · the exact signature this migration set targets still resolves to
    -- exactly one function. to_regprocedure returns NULL rather than erroring
    -- on no-match/ambiguous-match, so both cases are caught here rather than
    -- as an opaque cast failure — the ambiguous-overload trap PART 8 of the
    -- authoring instruction calls out by name.
    fn_oid := to_regprocedure(rec.sig)::oid;
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'C1 FAILED — % does not resolve to exactly one function. This group closes a grant; it does not drop or rename the function, and the signature must match exactly what its migration targets.', rec.sig;
    END IF;

    SELECT p.proacl::text, p.prosecdef, p.provolatile, n.nspname
      INTO fn_acl, fn_secdef, fn_volatile, fn_schema
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid = fn_oid;

    checked := checked + 1;

    -- C2 · schema. Every function in this group is expected in public — a
    -- schema drift here would mean the signature resolved to a same-named
    -- function somewhere else, silently checking the wrong object.
    IF fn_schema <> 'public' THEN
      RAISE EXCEPTION 'C2 FAILED — % (oid %) lives in schema %, expected public.', rec.sig, fn_oid, fn_schema;
    END IF;

    -- C3 · THE GATE. anon must not be able to execute any of the five.
    SELECT has_function_privilege('anon',          fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role',  fn_oid, 'EXECUTE')
      INTO fn_anon, fn_auth, fn_svc;

    IF fn_anon THEN
      RAISE EXCEPTION
        'C3 FAILED — anon can still EXECUTE % (oid %). A queue/notification-mutating RPC is open to any holder of the public anon key. acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    -- C4 · THE F-62 TRAP. PUBLIC held EXECUTE on all five, measured
    -- 2026-09-17 (this session, read-only, before any of the four migrations
    -- ran).
    SELECT count(*) INTO fn_public
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';

    IF fn_acl IS NULL THEN
      RAISE EXCEPTION
        'C4 FAILED — proacl is NULL on % (oid %). NULL is the BUILT-IN DEFAULT, which IS EXECUTE TO PUBLIC, not "no grants". The function has been recreated (DROP+CREATE re-applies the default — F-66) and this closure has silently reopened.',
        rec.sig, fn_oid;
    END IF;
    IF fn_public > 0 THEN
      RAISE EXCEPTION
        'C4 FAILED — PUBLIC holds EXECUTE on % (oid %, % entry). anon inherits through PUBLIC, so revoking from anon alone would have closed NOTHING here (F-62). acl = %',
        rec.sig, fn_oid, fn_public, fn_acl;
    END IF;

    -- C5 · authenticated is ALSO closed for every function in this group —
    -- the one respect in which this group differs from the identity group's
    -- mixed expectation. None of these five has a legitimate member-facing
    -- caller; every real caller is a service_role edge function or a
    -- postgres-owned SECURITY DEFINER internal caller (which bypasses this
    -- check entirely as the object owner, so it is unaffected either way).
    IF fn_auth THEN
      RAISE EXCEPTION
        'C5 FAILED — authenticated can still EXECUTE % (oid %). This entire group is privileged-only: no member session has a legitimate reason to call it directly. acl = %',
        rec.sig, fn_oid, fn_acl;
    END IF;

    -- C6 · NO OVER-REVOKE ON THE SERVER-SIDE PATH. Every migration in this
    -- group grants EXECUTE to service_role explicitly.
    IF NOT fn_svc THEN
      RAISE EXCEPTION 'C6 FAILED — service_role can no longer EXECUTE % (oid %). None of this group''s migrations authorised removing this. acl = %', rec.sig, fn_oid, fn_acl;
    END IF;

    -- C7 · THE FUNCTION IS UNCHANGED IN KIND. This gate is a grant change
    -- only for delete_email, emit_notification and move_to_dlq (their
    -- migrations do not touch the body); enqueue_email and read_email_batch
    -- already carry their queue-allow-list body fix independently of this
    -- probe, and are still expected to be SECURITY DEFINER / VOLATILE like
    -- every function in this group.
    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer SECURITY DEFINER. This group changes grants only (or, for enqueue_email/read_email_batch/move_to_dlq, an allow-list body fix already live before this probe) — something else edited the function.', rec.sig, fn_oid;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer VOLATILE (provolatile=%).', rec.sig, fn_oid, fn_volatile;
    END IF;

    RAISE NOTICE '% ........ PASS (oid %, anon=false, public_entries=0, authenticated=false, service_role=true, SECURITY DEFINER, VOLATILE, schema=public)',
      rpad(rec.sig, 72), fn_oid;
  END LOOP;

  IF checked <> 5 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected to check exactly 5 functions, checked %. The VALUES list above was edited without updating this guard, or a signature failed to resolve silently.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for all 5 functions. enqueue_email, read_email_batch, delete_email, emit_notification and move_to_dlq are all closed to PUBLIC/anon/authenticated and retained for service_role only. Nothing was written. ---';
  RAISE NOTICE '    Not tested here: PostgREST HTTP exposure (F-53), and calling any of the five (all VOLATILE — this probe never mutates data).';
  RAISE NOTICE '    Caller safety already established separately this session (git grep across src/, supabase/functions/, functions/, tests/, scripts/, plus live pg_proc checks confirming every internal DB caller is postgres-owned SECURITY DEFINER) — a source/catalogue-level analysis, not duplicated here as SQL.';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
