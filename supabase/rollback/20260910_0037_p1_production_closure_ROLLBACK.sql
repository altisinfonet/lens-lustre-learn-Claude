-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0037_p1_production_closure.sql
-- Identical stem, as required. PRODUCTION LANE ONLY, like the file it undoes.
--
-- ⚠ EXECUTING THIS FILE REOPENS EVERY DOOR 0037 CLOSED, ON PRODUCTION:
--
--   * 29 SECURITY DEFINER VOLATILE functions become anon-executable again,
--     among them submit_competition_entry, judging_write_decision_atomic,
--     admin_search_users, admin_rewind_stage, admin_set_photo_rejected and
--     request_withdrawal;
--   * posts_dead_host_backup_20260812 becomes writable by anonymous visitors
--     again (INSERT, UPDATE, DELETE);
--   * ten SECURITY DEFINER relations become WRITABLE by anon and authenticated
--     again — and a definer view owned by `postgres`, which is BYPASSRLS, does
--     not consult the base tables' RLS;
--   * email_exists(text) becomes callable by any signed-in user again;
--   * every NEWLY CREATED function in `public` becomes anon-executable again.
--
-- It is not a safety net to be run casually. It exists so that 0037 is
-- reversible, and for the C-34 round trip that proves it.
--
-- ── WHY THE GUARD IS `= 'production'` AND NOT STAGING-ONLY ───────────────
--
-- Every other rollback in Phase 1 carries the R-9 staging-only guard, on the
-- principle that a door-opening file must not reach production. This one is
-- the exception, and deliberately so: the state it restores EXISTS ONLY ON
-- PRODUCTION. Run on staging it would not undo anything — it would CREATE
-- twenty-nine open doors that staging closed in 0034/0035 and eleven relations
-- staging closed in 0033. A staging-only guard here would point the file at
-- the one lane where it does pure damage. The guard matches the migration's.
--
-- ── WHAT IT RESTORES, AND THE ONE WAY IT IS NARROWER ─────────────────────
--
-- The pre-image is the Owner's production reading of 2026-09-25T09:13:48Z,
-- transcribed in docs/evidence/d1/phase1/p1-0037-production-reading-20260925.json
-- and used here as the literal source of every grantee below.
--
-- **Restored BY GRANTEE NAME. Never `TO PUBLIC`** — R-11 and F-62. Seven of
-- the functions carried a PUBLIC entry (`=X/postgres`) on production. Those are
-- restored as the NAMED roles instead, which for `anon`, `authenticated` and
-- `service_role` is access-equivalent, and the postcondition asserts exactly
-- that, role by role, against the reading.
--
-- For any role NOT named — a future role, or one outside this reading — the
-- restored state is NARROWER than the pre-image. That is intentional and is
-- the standing rule: a PUBLIC grant is not re-created to satisfy a rollback.
-- The postcondition asserts zero PUBLIC entries afterwards, so the difference
-- is enforced rather than hoped for.
--
-- ── IT REFUSES WHEN THERE IS NOTHING TO UNDO ─────────────────────────────
--
-- The precondition requires 0037's post-state. Run against the pre-0037 state
-- it refuses, so "it did nothing" and "it did its job" are never the same
-- outcome.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE GUARD — PRODUCTION ONLY. See the header for why this is not R-9. ──
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'production' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as production (read: %). '
      'This file restores a state that exists only on production. On staging it '
      'would not undo anything: it would OPEN twenty-nine functions and ten '
      'definer relations that staging closed in 0033/0034/0035.',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — 0037's post-state must be in place. ───────────────────
DO $preconditions$
DECLARE sig text; n int := 0;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'admin_flag_entry_for_review(uuid)',
    'admin_rewind_stage(uuid,text,text)',
    'admin_search_users(text,text)',
    'admin_set_photo_rejected(uuid,integer,boolean,text)',
    'backfill_judging_notifications(integer,boolean)',
    'backfill_tag_decision_drift_admin()',
    'change_custom_url(text)',
    'claim_username(text)',
    'fix_certificate_readiness_admin(uuid)',
    'fix_gift_drift_admin(uuid)',
    'fix_referral_drift_admin(uuid)',
    'get_broadcast_feed(uuid[],integer)',
    'get_broadcast_feed(uuid[],integer,integer)',
    'get_broadcast_feed(uuid[],integer,integer,text[])',
    'get_certificate_drift_admin(uuid)',
    'get_judge_collusion_admin(uuid,integer,numeric)',
    'get_judging_tag_assignment_counts()',
    'register_push_token(text,text)',
    'request_withdrawal(numeric,jsonb)',
    'submit_competition_entry(uuid,text,text,text[],text[],jsonb,boolean,jsonb)',
    'unregister_push_token(text)',
    '_gen_competition_order_no()',
    'apply_decision_to_remaining(uuid,integer,text)',
    'clear_custom_url()',
    'get_derived_status_drift_admin()',
    'judging_write_decision_atomic(uuid,text,text)',
    'recompute_entry_from_tag_assignments(uuid)',
    'recompute_entry_public_status(uuid)',
    'set_write_path(text)'
  ]
  LOOP
    n := n + 1;
    IF to_regprocedure('public.' || sig) IS NULL THEN
      RAISE EXCEPTION 'P1-0037-RB-PRE-001: public.% does not exist', sig
        USING ERRCODE = 'raise_exception';
    END IF;
    IF has_function_privilege('anon', ('public.' || sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION
        'P1-0037-RB-PRE-002: anon can already execute public.%, so 0037 is not in '
        'effect and there is nothing for this file to roll back', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;
  IF n <> 29 THEN
    RAISE EXCEPTION 'P1-0037-RB-PRE-003: expected 29 signatures, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ══ P32 · GROUP A — anon back, by name. `authenticated` was never revoked. ═
-- The four that reached anon through PUBLIC (change_custom_url,
-- register_push_token, unregister_push_token, claim_username) are restored to
-- anon by NAME. authenticated and service_role hold named grants on all of
-- them in the reading, so no access they had is lost.

GRANT EXECUTE ON FUNCTION public.admin_flag_entry_for_review(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_rewind_stage(uuid,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_set_photo_rejected(uuid,integer,boolean,text) TO anon;
GRANT EXECUTE ON FUNCTION public.backfill_judging_notifications(integer,boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.backfill_tag_decision_drift_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.change_custom_url(text) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_username(text) TO anon;
GRANT EXECUTE ON FUNCTION public.fix_certificate_readiness_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fix_gift_drift_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fix_referral_drift_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[],integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[],integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[],integer,integer,text[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_certificate_drift_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_judge_collusion_admin(uuid,integer,numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.get_judging_tag_assignment_counts() TO anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric,jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_competition_entry(uuid,text,text,text[],text[],jsonb,boolean,jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO anon;

-- ══ P32 · GROUP B — anon and authenticated back, by name. ════════════════
-- service_role is named in the reading on every one of these, so it is
-- untouched here.

GRANT EXECUTE ON FUNCTION public._gen_competition_order_no() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_decision_to_remaining(uuid,integer,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_custom_url() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_derived_status_drift_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judging_write_decision_atomic(uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_entry_from_tag_assignments(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_entry_public_status(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_write_path(text) TO anon, authenticated;

-- ══ P30 ═══════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.email_exists(text) TO authenticated;

-- ══ P33 ═══════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.get_primary_admin_user_id() TO anon;

-- The reading has anon=arwdm and authenticated=arwdm: INSERT, SELECT, UPDATE,
-- DELETE, MAINTAIN. Restoring this makes a backup table anonymously writable
-- again, which is what 0037 was closing.
GRANT INSERT, SELECT, UPDATE, DELETE, MAINTAIN ON TABLE public.posts_dead_host_backup_20260812 TO anon, authenticated;

-- The TEN relations that carried the full write ACL in the reading.
-- judging_progression_audit is deliberately ABSENT: the reading has it as
-- {postgres, service_role}, so granting it here would not restore the
-- pre-image, it would manufacture a wider one.

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.entry_final_votes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.entry_final_votes_legacy TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.entry_public_status TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.entry_vote_counts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judge_comments_owner_safe TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judge_decisions_owner_safe TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judge_tag_assignments_owner_safe TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judge_tag_assignments_public_r4 TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles_public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.v_judging_drift TO anon, authenticated;

-- ══ RECURRENCE ════════════════════════════════════════════════════════════
-- Back to {anon=X, authenticated=X, service_role=X}: every new function born
-- anon-executable again.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;

-- ── POSTCONDITION — access-equivalence to the reading, role by role. ──────
DO $postconditions$
DECLARE
  sig text; rel text; role_ text; p text; n int := 0;
  writes text[] := ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
BEGIN
  -- 1 · every closed function executes for anon again.
  FOREACH sig IN ARRAY ARRAY[
    'admin_flag_entry_for_review(uuid)',
    'admin_rewind_stage(uuid,text,text)',
    'admin_search_users(text,text)',
    'admin_set_photo_rejected(uuid,integer,boolean,text)',
    'backfill_judging_notifications(integer,boolean)',
    'backfill_tag_decision_drift_admin()',
    'change_custom_url(text)',
    'claim_username(text)',
    'fix_certificate_readiness_admin(uuid)',
    'fix_gift_drift_admin(uuid)',
    'fix_referral_drift_admin(uuid)',
    'get_broadcast_feed(uuid[],integer)',
    'get_broadcast_feed(uuid[],integer,integer)',
    'get_broadcast_feed(uuid[],integer,integer,text[])',
    'get_certificate_drift_admin(uuid)',
    'get_judge_collusion_admin(uuid,integer,numeric)',
    'get_judging_tag_assignment_counts()',
    'register_push_token(text,text)',
    'request_withdrawal(numeric,jsonb)',
    'submit_competition_entry(uuid,text,text,text[],text[],jsonb,boolean,jsonb)',
    'unregister_push_token(text)',
    '_gen_competition_order_no()',
    'apply_decision_to_remaining(uuid,integer,text)',
    'clear_custom_url()',
    'get_derived_status_drift_admin()',
    'judging_write_decision_atomic(uuid,text,text)',
    'recompute_entry_from_tag_assignments(uuid)',
    'recompute_entry_public_status(uuid)',
    'set_write_path(text)'
  ]
  LOOP
    n := n + 1;
    IF NOT has_function_privilege('anon', ('public.' || sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'P1-0037-RB-POST-001: anon did not regain EXECUTE on public.%', sig
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', ('public.' || sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'P1-0037-RB-POST-002: service_role lost EXECUTE on public.%', sig
        USING ERRCODE = 'raise_exception';
    END IF;
    -- NEVER by re-creating a PUBLIC grant. This is the assertion that makes
    -- "restored by name" a fact rather than a claim in the header.
    PERFORM 1 FROM pg_proc pr, LATERAL aclexplode(pr.proacl) a
     WHERE pr.oid = to_regprocedure('public.' || sig) AND a.grantee = 0;
    IF FOUND THEN
      RAISE EXCEPTION
        'P1-0037-RB-POST-003: public.% has a PUBLIC ACL entry. This file restores '
        'by grantee NAME and must never grant to PUBLIC (R-11, F-62)', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;
  IF n <> 29 THEN
    RAISE EXCEPTION 'P1-0037-RB-POST-004: expected 29 signatures, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 2 · GROUP B's authenticated grants are back.
  FOREACH sig IN ARRAY ARRAY[
    '_gen_competition_order_no()',
    'apply_decision_to_remaining(uuid,integer,text)',
    'clear_custom_url()',
    'get_derived_status_drift_admin()',
    'judging_write_decision_atomic(uuid,text,text)',
    'recompute_entry_from_tag_assignments(uuid)',
    'recompute_entry_public_status(uuid)',
    'set_write_path(text)'
  ]
  LOOP
    IF NOT has_function_privilege('authenticated', ('public.' || sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'P1-0037-RB-POST-005: authenticated did not regain EXECUTE on public.%', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  -- 3 · P30 and P33 singletons
  IF NOT has_function_privilege('authenticated', 'public.email_exists(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'P1-0037-RB-POST-006: authenticated did not regain email_exists(text)'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_primary_admin_user_id()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'P1-0037-RB-POST-007: anon did not regain get_primary_admin_user_id()'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 4 · the backup table is back to anon=arwdm / authenticated=arwdm.
  FOREACH role_ IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['INSERT','SELECT','UPDATE','DELETE','MAINTAIN'] LOOP
      IF NOT has_table_privilege(role_, 'public.posts_dead_host_backup_20260812', p) THEN
        RAISE EXCEPTION 'P1-0037-RB-POST-008: % did not regain % on posts_dead_host_backup_20260812', role_, p
          USING ERRCODE = 'raise_exception';
      END IF;
    END LOOP;
    -- the reading has arwdm, NOT arwdDxtm: TRUNCATE, REFERENCES and TRIGGER
    -- were never granted and must not appear now.
    FOREACH p IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(role_, 'public.posts_dead_host_backup_20260812', p) THEN
        RAISE EXCEPTION
          'P1-0037-RB-POST-009: % gained % on posts_dead_host_backup_20260812, which '
          'the production reading does not have', role_, p
          USING ERRCODE = 'raise_exception';
      END IF;
    END LOOP;
  END LOOP;

  -- 5 · the ten relations are writable again; judging_progression_audit is NOT.
  n := 0;
  FOREACH rel IN ARRAY ARRAY[
    'entry_final_votes',
    'entry_final_votes_legacy',
    'entry_public_status',
    'entry_vote_counts',
    'judge_comments_owner_safe',
    'judge_decisions_owner_safe',
    'judge_tag_assignments_owner_safe',
    'judge_tag_assignments_public_r4',
    'profiles_public',
    'v_judging_drift'
  ]
  LOOP
    n := n + 1;
    FOREACH role_ IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH p IN ARRAY writes LOOP
        IF NOT has_table_privilege(role_, ('public.' || quote_ident(rel))::regclass, p) THEN
          RAISE EXCEPTION 'P1-0037-RB-POST-010: % did not regain % on public.%', role_, p, rel
            USING ERRCODE = 'raise_exception';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF n <> 10 THEN
    RAISE EXCEPTION 'P1-0037-RB-POST-011: expected 10 writable relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;

  FOREACH role_ IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH p IN ARRAY writes LOOP
      IF has_table_privilege(role_, 'public.judging_progression_audit', p) THEN
        RAISE EXCEPTION
          'P1-0037-RB-POST-012: % gained % on judging_progression_audit, which the '
          'production reading has as {postgres, service_role}', role_, p
          USING ERRCODE = 'raise_exception';
      END IF;
    END LOOP;
  END LOOP;

  -- 6 · no relation this file touched acquired a PUBLIC entry.
  FOREACH rel IN ARRAY ARRAY[
    'entry_final_votes',
    'entry_final_votes_legacy',
    'entry_public_status',
    'entry_vote_counts',
    'judge_comments_owner_safe',
    'judge_decisions_owner_safe',
    'judge_tag_assignments_owner_safe',
    'judge_tag_assignments_public_r4',
    'profiles_public',
    'v_judging_drift'
  ] || ARRAY['posts_dead_host_backup_20260812']
  LOOP
    PERFORM 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
     WHERE c.oid = ('public.' || quote_ident(rel))::regclass AND a.grantee = 0;
    IF FOUND THEN
      RAISE EXCEPTION 'P1-0037-RB-POST-013: public.% acquired a PUBLIC ACL entry', rel
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  -- 7 · the function default grants anon again, and still not PUBLIC.
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype = 'f' AND a.grantee = 'anon'::regrole;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0037-RB-POST-014: the postgres/public FUNCTION default does not grant anon'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype = 'f' AND a.grantee = 0;
  IF FOUND THEN
    RAISE EXCEPTION
      'P1-0037-RB-POST-015: the postgres/public FUNCTION default acquired a PUBLIC '
      'item. This file restores by name'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
