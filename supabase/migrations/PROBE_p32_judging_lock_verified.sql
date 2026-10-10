-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · JUDGING-LOCK VERIFICATION PROBE — asserts that the BODY FIX in
-- 20260910_0030_p32_judging_lock_identity_and_apply_tag_closure.sql is
-- actually installed, not merely merged.
-- READS ONLY. Ends in ROLLBACK. Calls nothing.
--
-- ⚠ THIS DOES NOT DUPLICATE #276's OWN PROBE. That file
-- (PROBE_p32_judging_lock_identity_and_apply_tag_closure.sql) asserts the ACL.
-- This one asserts what an ACL check cannot see: that the three guard clauses
-- are present in the INSTALLED function body. The distinction is not academic
-- here — this lane currently carries four merged-but-unapplied revokes
-- (delete_email, emit_notification, move_to_dlq, set_write_path; kickoff
-- §4.1), so "the migration is on staging" and "the change is in the database"
-- are demonstrably different states in this repository, today.
--
-- ⚠ AUTHORED TO FAIL FIRST. Against origin/staging f0377af all four objects
-- fail at V3 (no identity check in the body) and V6 (anon holds EXECUTE, with
-- a PUBLIC entry). See docs/evidence/d1/phase1/probe-fail-first-20260922.txt
-- for the V6-class evidence across the whole P32 population, and
-- docs/evidence/d1/phase1/function-readings.md for the V3-class reading.
--
-- ⚠ WHAT V3–V5 ARE WORTH, SAID PLAINLY. They are source-text assertions over
-- pg_proc.prosrc. They prove the guard is PRESENT. They do not prove it is
-- CORRECT, they can be defeated by a comment containing the same text, and
-- they will need updating if the guard is ever rewritten in equivalent but
-- differently-spelled terms. The real proof of correctness is the
-- cross-member test plan in docs/evidence/d1/phase1/pr276-verification-
-- package.md §4, which needs two real judge sessions over HTTP and cannot be
-- expressed in SQL at all. This probe is the cheap continuous check that sits
-- underneath that test, not a replacement for it.
--
-- ⚠ AND IT WILL NOT CATCH THE PREREQUISITE. The unload path in
-- src/hooks/judging/useJudgingLock.ts:183-200 posts to
-- /rest/v1/rpc/release_judge_lock with `apikey` only and NO Authorization
-- header, i.e. as anon. Every assertion below can pass while that path is
-- broken. It is D2's lane and it is written up in the package, §2.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  rec         record;
  fn_oid      oid;
  fn_src      text;
  fn_acl      text;
  fn_secdef   boolean;
  fn_volatile "char";
  fn_schema   text;
  fn_anon     boolean;
  fn_auth     boolean;
  fn_svc      boolean;
  fn_public   integer;
  checked     integer := 0;
BEGIN
  RAISE NOTICE '--- P32 judging-lock verification probe @ % UTC, lane % ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'), current_database();

  FOR rec IN
    -- want_body · true for the three lock functions, whose BODIES were
    --   rewritten by 0030. FALSE for judge_apply_single_tag, whose body was
    --   deliberately NOT touched — it is reached only by a service_role edge
    --   client, where auth.uid() is NULL by design, so adding the same guard
    --   there would break the only sanctioned caller. Asserting the guard on
    --   all four would be wrong, and wrong in the direction that causes an
    --   outage.
    -- want_auth · authenticated retained on the locks (the judge UI calls
    --   them directly); REVOKED on judge_apply_single_tag, so that the
    --   scoring write cannot be reached over PostgREST at all and the edge
    --   function's validation cannot be bypassed.
    SELECT * FROM (VALUES
      ('public.acquire_judge_lock(uuid, integer, uuid, integer)',            true,  true ),
      ('public.heartbeat_judge_lock(uuid, integer, uuid, integer)',          true,  true ),
      ('public.release_judge_lock(uuid, integer, uuid)',                     true,  true ),
      ('public.judge_apply_single_tag(uuid, integer, integer, uuid, uuid)',  false, false)
    ) AS t(sig, want_body, want_auth)
  LOOP
    -- V1 · resolves to exactly one function.
    fn_oid := to_regprocedure(rec.sig)::oid;
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'V1 FAILED — % does not resolve to exactly one function.', rec.sig;
    END IF;

    SELECT p.prosrc, p.proacl::text, p.prosecdef, p.provolatile, n.nspname
      INTO fn_src, fn_acl, fn_secdef, fn_volatile, fn_schema
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.oid = fn_oid;

    checked := checked + 1;

    -- V2 · still the object the fix was reasoned about.
    IF fn_schema <> 'public' THEN
      RAISE EXCEPTION 'V2 FAILED — % is in schema %, expected public.', rec.sig, fn_schema;
    END IF;
    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'V2 FAILED — % is no longer SECURITY DEFINER. The identity guard is the ONLY control on a definer function (RLS is bypassed); if it is no longer a definer, the whole premise has changed.', rec.sig;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'V2 FAILED — % is no longer VOLATILE (provolatile=%).', rec.sig, fn_volatile;
    END IF;

    IF rec.want_body THEN
      -- V3 · THE IDENTITY CHECK. This is the vulnerability 0030 exists to
      -- close: _judge_id was caller-supplied and never compared to the
      -- authenticated caller, so any caller could force-release, extend or
      -- squat any judge's lock.
      IF fn_src !~ '_judge_id\s*<>\s*auth\.uid\(\)' THEN
        RAISE EXCEPTION
          'V3 FAILED — the installed body of % does NOT contain the `_judge_id <> auth.uid()` identity check. The migration may be merged without being applied: on this lane four other revokes are in exactly that state. A grant-only probe would have passed here.',
          rec.sig;
      END IF;

      -- V4 · the unauthenticated guard.
      IF fn_src !~ '28000' THEN
        RAISE EXCEPTION 'V4 FAILED — the installed body of % does not raise 28000 for a NULL auth.uid().', rec.sig;
      END IF;

      -- V5 · the role guard. Identity alone is not authorisation: without
      -- this, any authenticated member could lock an entry under their own id.
      IF fn_src !~ 'has_role\s*\(\s*auth\.uid\(\)\s*,\s*''judge''' THEN
        RAISE EXCEPTION 'V5 FAILED — the installed body of % does not check for the judge role. Matching identity is not the same as holding authority.', rec.sig;
      END IF;
    ELSE
      -- V3b · the inverse assertion, and it matters as much. If someone
      -- "helpfully" adds the auth.uid() guard to judge_apply_single_tag, its
      -- only caller — a service_role edge client, where auth.uid() is NULL —
      -- starts failing every judge tag submission.
      IF fn_src ~ 'auth\.uid\(\)' THEN
        RAISE EXCEPTION
          'V3b FAILED — % now references auth.uid(). Its only caller is supabase/functions/submit-judge-tag/index.ts:144 on a service_role client, where auth.uid() is NULL. An identity guard here breaks every judge tag submission. The body is meant to stay unchanged; the closure for this object is grant-only.',
          rec.sig;
      END IF;
    END IF;

    SELECT has_function_privilege('anon',          fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role',  fn_oid, 'EXECUTE')
      INTO fn_anon, fn_auth, fn_svc;

    -- V6 · grant layer, including the F-62 trap.
    IF fn_anon THEN
      RAISE EXCEPTION 'V6 FAILED — anon can still EXECUTE % . acl = %', rec.sig, COALESCE(fn_acl,'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;
    IF fn_acl IS NULL THEN
      RAISE EXCEPTION 'V6 FAILED — proacl is NULL on %. NULL is the BUILT-IN DEFAULT, i.e. EXECUTE TO PUBLIC. The function has been recreated with DROP+CREATE and BOTH the grant and the body fix must be re-applied and re-proved (F-66).', rec.sig;
    END IF;
    SELECT count(*) INTO fn_public
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
    IF fn_public > 0 THEN
      RAISE EXCEPTION 'V6 FAILED — PUBLIC holds EXECUTE on % (% entry); anon inherits through PUBLIC. acl = %', rec.sig, fn_public, fn_acl;
    END IF;

    -- V7 · authenticated, in the direction each object wants.
    IF rec.want_auth AND NOT fn_auth THEN
      RAISE EXCEPTION 'V7 FAILED (OVERSHOOT) — authenticated has lost EXECUTE on %. The judge UI calls this directly; the judging panel is now broken. acl = %', rec.sig, fn_acl;
    END IF;
    IF (NOT rec.want_auth) AND fn_auth THEN
      RAISE EXCEPTION 'V7 FAILED (UNDERSHOOT) — authenticated still holds EXECUTE on %. The scoring write remains reachable directly over PostgREST, bypassing the edge function''s JWT, role, assignment, round-lock, tag-visibility and R4-unique-award checks. acl = %', rec.sig, fn_acl;
    END IF;

    -- V8 · service_role retained on all four.
    IF NOT fn_svc THEN
      RAISE EXCEPTION 'V8 FAILED — service_role has lost EXECUTE on %. acl = %', rec.sig, fn_acl;
    END IF;

    RAISE NOTICE '% ...... PASS (oid %, body_guard=%, anon=false, public=0, authenticated=%, service_role=true)',
      rpad(rec.sig, 62), fn_oid, rec.want_body, fn_auth;
  END LOOP;

  IF checked <> 4 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected 4 functions, checked %.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED on %. Nothing was written. ---', current_database();
  RAISE NOTICE '    NOT PROVED HERE: that the guards are CORRECT. That needs the two-judge cross-member test over HTTP with real JWTs — docs/evidence/d1/phase1/pr276-verification-package.md §4, tests X3/X4/X5.';
  RAISE NOTICE '    NOT PROVED HERE: the beforeunload release path, which posts as anon with no Authorization header and is expected to FAIL until D2 fixes src/hooks/judging/useJudgingLock.ts:189-196.';
END
$probe$;

ROLLBACK;
