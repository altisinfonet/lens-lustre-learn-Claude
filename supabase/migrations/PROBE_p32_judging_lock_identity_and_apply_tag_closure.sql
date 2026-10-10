-- ═══════════════════════════════════════════════════════════════════════════
-- P32 SESSION A GATE PROBE — judging-lock identity spoofing closed (body),
-- judge_apply_single_tag closed to public/anon/authenticated (grant). READS
-- AND WRITES TEST DATA, ALL INSIDE ONE TRANSACTION THAT ENDS IN ROLLBACK —
-- follows the PROBE_p30_email_exists_closed.sql shape: BEGIN; DO $probe$ ...
-- END $probe$; ROLLBACK; — cannot persist anything, even if a future edit
-- introduces a write by accident. Unlike the grant-only P32 probes, this one
-- must also prove the BODY behaviour changed (C-34: a probe that only reads
-- has_function_privilege cannot catch a body-level identity-spoofing bug —
-- it has to actually attempt the spoof and see it rejected).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  acq_oid oid; hb_oid oid; rel_oid oid; tag_oid oid;
  acq_public boolean; acq_anon boolean; acq_auth boolean; acq_svc boolean;
  hb_public boolean; hb_anon boolean; hb_auth boolean; hb_svc boolean;
  rel_public boolean; rel_anon boolean; rel_auth boolean; rel_svc boolean;
  tag_public boolean; tag_anon boolean; tag_auth boolean; tag_svc boolean;
  judge_a uuid := gen_random_uuid();
  judge_b uuid := gen_random_uuid();
  no_role_user uuid := gen_random_uuid();
  fake_entry uuid := gen_random_uuid();
  real_entry uuid;
  lock_result jsonb;
  release_result boolean;
  caught boolean;
  caught_sqlstate text;
BEGIN
  RAISE NOTICE '--- P32 session-A judging-lock gate probe @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %  (current_database)', current_database();

  ---------------------------------------------------------------------------
  -- PART 1 — GRANT STATE (same shape as every other P32 probe)
  ---------------------------------------------------------------------------
  SELECT p.oid INTO acq_oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='acquire_judge_lock';
  SELECT p.oid INTO hb_oid  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='heartbeat_judge_lock';
  SELECT p.oid INTO rel_oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='release_judge_lock';
  SELECT p.oid INTO tag_oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='judge_apply_single_tag';

  IF acq_oid IS NULL OR hb_oid IS NULL OR rel_oid IS NULL OR tag_oid IS NULL THEN
    RAISE EXCEPTION 'B5 FAILED — one or more of the four functions does not exist (acquire=%, heartbeat=%, release=%, apply_tag=%). This unit changes bodies/grants; it does not drop functions.',
      acq_oid, hb_oid, rel_oid, tag_oid;
  END IF;
  RAISE NOTICE 'B5 all four functions exist ......... PASS';

  SELECT has_function_privilege('public', acq_oid, 'EXECUTE'), has_function_privilege('anon', acq_oid, 'EXECUTE'),
         has_function_privilege('authenticated', acq_oid, 'EXECUTE'), has_function_privilege('service_role', acq_oid, 'EXECUTE')
    INTO acq_public, acq_anon, acq_auth, acq_svc;
  SELECT has_function_privilege('public', hb_oid, 'EXECUTE'), has_function_privilege('anon', hb_oid, 'EXECUTE'),
         has_function_privilege('authenticated', hb_oid, 'EXECUTE'), has_function_privilege('service_role', hb_oid, 'EXECUTE')
    INTO hb_public, hb_anon, hb_auth, hb_svc;
  SELECT has_function_privilege('public', rel_oid, 'EXECUTE'), has_function_privilege('anon', rel_oid, 'EXECUTE'),
         has_function_privilege('authenticated', rel_oid, 'EXECUTE'), has_function_privilege('service_role', rel_oid, 'EXECUTE')
    INTO rel_public, rel_anon, rel_auth, rel_svc;
  SELECT has_function_privilege('public', tag_oid, 'EXECUTE'), has_function_privilege('anon', tag_oid, 'EXECUTE'),
         has_function_privilege('authenticated', tag_oid, 'EXECUTE'), has_function_privilege('service_role', tag_oid, 'EXECUTE')
    INTO tag_public, tag_anon, tag_auth, tag_svc;

  IF acq_public OR acq_anon OR hb_public OR hb_anon OR rel_public OR rel_anon THEN
    RAISE EXCEPTION 'B2 FAILED — public/anon can still EXECUTE one of the three lock functions (acquire public=%,anon=%; heartbeat public=%,anon=%; release public=%,anon=%).',
      acq_public, acq_anon, hb_public, hb_anon, rel_public, rel_anon;
  END IF;
  IF NOT (acq_auth AND hb_auth AND rel_auth) THEN
    RAISE EXCEPTION 'B4 FAILED — authenticated can no longer EXECUTE one of the three lock functions. This is an over-revoke: real judges call these directly from the browser (src/hooks/judging/useJudgingLock.ts) and would be broken. acquire=%, heartbeat=%, release=%',
      acq_auth, hb_auth, rel_auth;
  END IF;
  RAISE NOTICE 'B2/B4 lock functions: public/anon closed, authenticated retained .. PASS';

  IF tag_public OR tag_anon OR tag_auth THEN
    RAISE EXCEPTION 'B3 FAILED — judge_apply_single_tag still executable by public=%, anon=%, or authenticated=%. Its only sanctioned caller (submit-judge-tag edge fn) uses a service_role client and does not need authenticated/anon/public access; leaving any of these open re-opens the direct-RPC competition-integrity bypass.',
      tag_public, tag_anon, tag_auth;
  END IF;
  IF NOT tag_svc THEN
    RAISE EXCEPTION 'B4 FAILED — service_role can no longer EXECUTE judge_apply_single_tag (oid %). The submit-judge-tag edge function calls this RPC via a service_role client and would be broken.', tag_oid;
  END IF;
  RAISE NOTICE 'B3/B4 judge_apply_single_tag: closed to public/anon/authenticated, service_role retained .. PASS';

  ---------------------------------------------------------------------------
  -- PART 2 — BODY BEHAVIOUR: the actual spoof, attempted and shown rejected.
  -- Simulates PostgREST's JWT context via request.jwt.claim.sub, which is
  -- exactly what auth.uid() reads (confirmed via pg_get_functiondef this
  -- session). All calls are set-local to this transaction/probe.
  ---------------------------------------------------------------------------

  -- C1 — no JWT at all (anon-equivalent call, e.g. via a stolen/forged
  -- direct HTTP call with no Authorization header reaching this function)
  PERFORM set_config('request.jwt.claim.sub', '', true);
  caught := false;
  BEGIN
    PERFORM public.acquire_judge_lock(fake_entry, 0, judge_a, 5);
  EXCEPTION WHEN OTHERS THEN
    caught := true;
    caught_sqlstate := SQLSTATE;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'C1 FAILED — acquire_judge_lock succeeded with no auth.uid() at all. The unauthenticated-caller rejection is missing.';
  END IF;
  IF caught_sqlstate <> '28000' THEN
    RAISE EXCEPTION 'C1 FAILED — acquire_judge_lock rejected the no-JWT call, but with SQLSTATE % instead of the expected 28000 (authentication required). Some other check fired first, or the function errored for an unrelated reason.', caught_sqlstate;
  END IF;
  RAISE NOTICE 'C1 unauthenticated caller rejected (28000) .. PASS';

  -- C2 — THE GATE ITSELF: authenticated as judge_a, but claims to act as
  -- judge_b. This is the exact live vulnerability (impersonation).
  PERFORM set_config('request.jwt.claim.sub', judge_a::text, true);
  caught := false;
  BEGIN
    PERFORM public.release_judge_lock(fake_entry, 0, judge_b);
  EXCEPTION WHEN OTHERS THEN
    caught := true;
    caught_sqlstate := SQLSTATE;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'C2 FAILED — release_judge_lock let auth.uid()=% force-release a lock claimed as judge_id=%. This is the exact impersonation vulnerability this unit exists to close.',
      judge_a, judge_b;
  END IF;
  IF caught_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'C2 FAILED — release_judge_lock rejected the impersonation attempt, but with SQLSTATE % instead of the expected 42501 (judge_id must match caller). acl/role check may be firing for the wrong reason.', caught_sqlstate;
  END IF;
  RAISE NOTICE 'C2 impersonation rejected (THE GATE, 42501) .. PASS (auth.uid()=judge_a could not act as judge_b)';

  -- C3 — authenticated as a real uuid matching _judge_id, but holding
  -- neither judge nor admin role (e.g. a plain member account).
  PERFORM set_config('request.jwt.claim.sub', no_role_user::text, true);
  caught := false;
  BEGIN
    PERFORM public.acquire_judge_lock(fake_entry, 0, no_role_user, 5);
  EXCEPTION WHEN OTHERS THEN
    caught := true;
    caught_sqlstate := SQLSTATE;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'C3 FAILED — acquire_judge_lock succeeded for a caller with no judge or admin role.';
  END IF;
  IF caught_sqlstate <> '42501' THEN
    RAISE EXCEPTION 'C3 FAILED — acquire_judge_lock rejected the no-role caller, but with SQLSTATE % instead of the expected 42501 (judge or admin role required).', caught_sqlstate;
  END IF;
  RAISE NOTICE 'C3 non-judge/non-admin caller rejected (42501) .. PASS';

  ---------------------------------------------------------------------------
  -- PART 3 — POSITIVE PATH: a real judge, acting as themselves, still works.
  -- Proves this is not an over-fix (B4 already covered the grant layer;
  -- this covers the body layer the same way).
  ---------------------------------------------------------------------------
  SELECT id INTO real_entry FROM public.competition_entries LIMIT 1;
  IF real_entry IS NULL THEN
    RAISE NOTICE 'D1 SKIPPED — no rows in public.competition_entries on this lane to test the positive (successful lock) path against; C1-C3 above already prove the rejection paths, which is the security-relevant half of this unit. Not a failure — just nothing to lock.';
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (judge_a, 'judge');

    PERFORM set_config('request.jwt.claim.sub', judge_a::text, true);
    lock_result := public.acquire_judge_lock(real_entry, 0, judge_a, 5);
    IF NOT (lock_result->>'acquired')::boolean THEN
      RAISE EXCEPTION 'D1 FAILED — a real judge acting as themselves could not acquire a lock. This unit over-fixed the vulnerability and broke the legitimate path. result=%', lock_result;
    END IF;
    RAISE NOTICE 'D1 legitimate judge can still acquire their own lock .. PASS (result=%)', lock_result;

    release_result := public.release_judge_lock(real_entry, 0, judge_a);
    IF NOT release_result THEN
      RAISE EXCEPTION 'D2 FAILED — the same judge could not release their own just-acquired lock.';
    END IF;
    RAISE NOTICE 'D2 legitimate judge can still release their own lock .. PASS';
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED. Nothing was written (outer transaction rolls back). ---';
END
$probe$;

ROLLBACK;
