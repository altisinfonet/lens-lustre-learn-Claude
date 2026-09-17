-- ═══════════════════════════════════════════════════════════════════════════
-- P32 MEDIA PIPELINE GATE PROBE — the 8 VOLATILE media-pipeline functions
-- closed to PUBLIC and anon, authenticated matching each function's own
-- intended design, service_role untouched. READS ONLY. Ends in ROLLBACK.
--
-- Companion migration: 20260917140000_p32_media_pipeline_acl_reassertion.sql
-- Companion rollback:  20260917140000_p32_media_pipeline_acl_reassertion_ROLLBACK.sql
-- Forensic basis: claude/2026-09-17-P32-media-pipeline-FORENSICS.md
--
-- ⚠ THE 8 FUNCTIONS DO NOT SHARE ONE INTENDED authenticated STATE.
-- media_begin_upload, post_publish_with_media and publish_post_draft stay
-- member-callable — real browser callers verified in the forensic report
-- (src/lib/media/postMediaWrite.ts, src/hooks/feed/usePostDrafts.ts). The
-- other five (media_mark_ready, media_mark_verified, media_migrate_post,
-- media_quarantine, post_attach_media) are revoked from authenticated as
-- well — every real caller of those five is a service_role edge function,
-- or in post_attach_media's case an internal SECURITY DEFINER call from
-- publish_post_draft that executes as the function owner and does not need
-- the authenticated role to hold EXECUTE. A probe using one expected value
-- for all eight would silently pass an over-revoke on the first three or an
-- under-revoke on the other five. expect_auth is per function for exactly
-- that reason, and C4 fails loudly either direction.
--
-- ⚠ F-62 / F-66 GENUINELY BIT HERE, ON ALL EIGHT, BEFORE THIS MIGRATION.
-- Measured live on staging (fpszggreishhuvdpkmdr, 2026-09-17, this session,
-- read-only, before the companion migration ran): PUBLIC held EXECUTE on
-- all eight (the leading `=X/postgres` in proacl), and anon/authenticated
-- were both explicitly TRUE via has_function_privilege on all eight — this
-- despite every one of the eight having its own `REVOKE ... FROM anon` (five
-- of the eight also `FROM authenticated`) already committed in the migration
-- that defines its current body. Root cause, measured: this project's
-- 2026-09-11 full-schema bootstrap
-- (UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql) carries
-- zero GRANT/REVOKE statements anywhere in its 19,101 lines, and
-- `mcp__Supabase__list_migrations` against this project shows none of these
-- eight functions' defining migrations as ever applied through the tracked
-- mechanism — so the bodies arrived (confirmed byte-for-byte via
-- pg_get_functiondef on media_mark_ready) but the accompanying grants never
-- did. This probe is committed as part of the same PR as the migration that
-- fixes it, not written afterward to match whatever happened (C-34: a test
-- written after the fact, that could not have been shown failing first, is
-- not evidence) — it is expected to FAIL against pre-migration state and
-- PASS only after the companion migration runs.
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It reads the catalogue only. It does not
-- call any of the eight functions — all are VOLATILE and mutate
-- media_objects/posts/post_media/post_drafts/scheduled_posts, so exercising
-- them here would write data inside what is supposed to be a read-only gate.
-- It does not exercise /rest/v1/rpc over HTTP as a real browser would
-- (F-53), and it does not re-verify any src/ caller's behaviour — that is
-- already evidenced separately by the existing test suite
-- (src/__tests__/mediaWritePath.test.ts and neighbours), which asserts the
-- migration SOURCE TEXT, not the live database — this probe is the
-- live-database half that those tests do not cover.
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
  fn_owner     text;
  fn_anon      boolean;
  fn_auth      boolean;
  fn_svc       boolean;
  fn_public_n  integer;
  checked      integer := 0;
BEGIN
  RAISE NOTICE '--- P32 media-pipeline gate probe: 8 functions @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  -- sig · the exact signature the companion migration targets.
  -- expect_auth · THIS FUNCTION'S OWN intended authenticated state, not a
  -- shared constant. true for the three with a real browser caller
  -- (media_begin_upload, post_publish_with_media, publish_post_draft).
  -- false for the five that are service_role-only by design.
  FOR rec IN
    SELECT * FROM (VALUES
      ('public.media_begin_upload(bytea, integer, integer, bigint, text)',                          true),
      ('public.media_mark_ready(uuid, jsonb)',                                                       false),
      ('public.media_mark_verified(uuid)',                                                           false),
      ('public.media_migrate_post(uuid, uuid, jsonb)',                                                false),
      ('public.media_quarantine(uuid, text)',                                                        false),
      ('public.post_attach_media(uuid, uuid[])',                                                     false),
      ('public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[])',           true),
      ('public.publish_post_draft(uuid)',                                                            true)
    ) AS t(sig, expect_auth)
  LOOP
    -- C1 · the exact signature resolves to exactly one function.
    -- to_regprocedure returns NULL rather than erroring on no-match or an
    -- ambiguous match, so both cases are caught here rather than as an
    -- opaque cast failure. This migration never touches signatures, so a
    -- mismatch here means the wrong function was targeted, not that one was
    -- dropped by this unit.
    fn_oid := to_regprocedure(rec.sig)::oid;
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'C1 FAILED — % does not resolve to exactly one function. This unit closes a grant; it does not drop or rename the function, and the signature must match exactly what supabase/migrations/20260917140000_p32_media_pipeline_acl_reassertion.sql targets.', rec.sig;
    END IF;

    SELECT p.proacl::text, p.prosecdef, p.provolatile, n.nspname, pg_get_userbyid(p.proowner)
      INTO fn_acl, fn_secdef, fn_volatile, fn_schema, fn_owner
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid = fn_oid;

    checked := checked + 1;

    -- C2 · schema is public.
    IF fn_schema <> 'public' THEN
      RAISE EXCEPTION 'C2 FAILED — % (oid %) lives in schema %, expected public.', rec.sig, fn_oid, fn_schema;
    END IF;

    SELECT has_function_privilege('anon',          fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role',  fn_oid, 'EXECUTE')
      INTO fn_anon, fn_auth, fn_svc;

    -- C3 · THE GATE. anon must not be able to execute any of the eight.
    IF fn_anon THEN
      RAISE EXCEPTION
        'C3 FAILED — anon can still EXECUTE % (oid %). A mutating media-pipeline RPC is open to any holder of the public anon key. acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    -- C4 · THE F-62/F-66 TRAP. PUBLIC held EXECUTE on all eight, measured
    -- 2026-09-17 (this session, read-only, before the companion migration
    -- ran). A NULL proacl is the Postgres built-in default (EXECUTE TO
    -- PUBLIC), not "no grants" — and a DROP+CREATE re-applies it silently.
    IF fn_acl IS NULL THEN
      RAISE EXCEPTION
        'C4 FAILED — proacl is NULL on % (oid %). NULL is the BUILT-IN DEFAULT, which IS EXECUTE TO PUBLIC. The function has been recreated (DROP+CREATE re-applies the default — F-66) and this closure has silently reopened.',
        rec.sig, fn_oid;
    END IF;
    SELECT count(*) INTO fn_public_n
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
    IF fn_public_n > 0 THEN
      RAISE EXCEPTION
        'C4 FAILED — PUBLIC holds a named EXECUTE ACL entry on % (oid %, % entry). anon inherits through PUBLIC, so a revoke from anon alone would have closed NOTHING here (F-62). acl = %',
        rec.sig, fn_oid, fn_public_n, fn_acl;
    END IF;

    -- C5 · authenticated MATCHES THIS FUNCTION'S OWN INTENDED STATE, not a
    -- shared constant. Fails loudly on an over-revoke (media_begin_upload,
    -- post_publish_with_media or publish_post_draft losing authenticated —
    -- that would break the real composer/draft-publish browser flows) AND
    -- on an under-revoke (any of the other five regaining authenticated —
    -- that reopens exactly the "member calls a service_role-only media
    -- write-path function directly" gap this unit exists to close).
    IF fn_auth <> rec.expect_auth THEN
      RAISE EXCEPTION
        'C5 FAILED — % (oid %): authenticated EXECUTE = %, expected %. % acl = %',
        rec.sig, fn_oid, fn_auth, rec.expect_auth,
        CASE WHEN rec.expect_auth THEN 'This function must stay member-callable — an over-revoke breaks a real browser publish/upload path.'
             ELSE 'This function must stay service_role-only — under-revoke reopens a direct-call gap with no internal ownership check in several of these bodies (media_quarantine, media_migrate_post, media_mark_ready, media_mark_verified have no auth.uid() reference at all).' END,
        fn_acl;
    END IF;

    -- C6 · service_role keeps EXECUTE on all eight — this unit revokes
    -- nothing from service_role.
    IF NOT fn_svc THEN
      RAISE EXCEPTION 'C6 FAILED — service_role can no longer EXECUTE % (oid %). This unit never authorised removing this. acl = %', rec.sig, fn_oid, fn_acl;
    END IF;

    -- C7 · the function is unchanged in kind and ownership — this gate is a
    -- grant change only.
    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer SECURITY DEFINER. This unit changes grants only; something else edited the function.', rec.sig, fn_oid;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer VOLATILE (provolatile=%). This unit changes grants only.', rec.sig, fn_oid, fn_volatile;
    END IF;
    IF fn_owner <> 'postgres' THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) owner is %, expected postgres. This unit changes grants only.', rec.sig, fn_oid, fn_owner;
    END IF;

    RAISE NOTICE '% ........ PASS (oid %, schema=public, owner=postgres, PUBLIC=false, anon=false, authenticated=%, service_role=true, SECURITY DEFINER, VOLATILE)',
      rpad(rec.sig, 72), fn_oid, rec.expect_auth;
  END LOOP;

  IF checked <> 8 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected to check exactly 8 functions, checked %. The VALUES list above was edited without updating this guard, or a signature failed to resolve silently.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for all 8 functions. media_begin_upload / post_publish_with_media / publish_post_draft closed to PUBLIC/anon and retained for authenticated + service_role; media_mark_ready / media_mark_verified / media_migrate_post / media_quarantine / post_attach_media additionally closed to authenticated, service_role only. Nothing was written. ---';
  RAISE NOTICE '    Not tested here: PostgREST HTTP exposure (F-53), and calling any of the eight (all VOLATILE — this probe never mutates data).';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if
-- a future edit to the block above introduces a write by accident.
ROLLBACK;
