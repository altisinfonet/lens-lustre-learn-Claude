-- ═══════════════════════════════════════════════════════════════════════════
-- P-1 · PRODUCTION CLOSURE. PRODUCTION LANE ONLY.
--
-- This file refuses on staging BY DESIGN. Staging already holds every state it
-- installs; production does not. It is the one Phase-1 unit whose target lane
-- D1 cannot measure — production is unreachable from any session — so every
-- object in it is derived from a single artefact and from nothing else:
--
--   docs/evidence/d1/phase1/p1-0037-production-reading-20260925.json
--
-- the Auditor's transcription of the read-only query the Owner ran on
-- production (jtdtehuqtinjxropkkcn) at 2026-09-25T09:13:48Z. The lists below
-- are DERIVED from it by docs/evidence/d1/phase1/p1-0037-derive.py, not typed
-- out, and that script's set-equality check — closing set plus the four
-- justified retentions equals the 33 anon-executable VOLATILE functions the
-- reading contains, in both directions — is what proves the lists are neither
-- short nor invented.
--
-- ── PRODUCTION IS NOT STAGING, AND THIS FILE IS THE CONSEQUENCE ───────────
--
-- R-50: production is TIGHTER than staging in places, so replaying the staging
-- files would LOOSEN it. Specifically, and this is why 0037 exists at all:
--
--   * 0032 must never run on production. Six of its money functions are
--     {postgres, service_role} there; 0032 would GRANT authenticated to them.
--   * 0033 must never run on production. Its precondition refuses, because
--     judging_progression_audit is already {postgres, service_role}.
--   * 0034 and 0035 must never run on production. Their populations differ.
--
-- Hence: tailored, and REVOKE ONLY. There is not one GRANT in this file. A
-- file that cannot grant cannot widen access, whatever else is wrong with it,
-- and the static scan asserts that property rather than trusting it.
--
-- ── WHAT IT CLOSES ───────────────────────────────────────────────────────
--
-- P32 — 29 signatures, from the 33 anon-executable SECURITY DEFINER VOLATILE
-- functions the reading found in `public`:
--
--   GROUP A (21)  REVOKE … FROM PUBLIC, anon      — `authenticated` is KEPT
--   GROUP B (8)   REVOKE … FROM PUBLIC, anon, authenticated
--
-- Seven of the 29 reach `anon` THROUGH PUBLIC rather than by a named grant
-- (change_custom_url, register_push_token, unregister_push_token,
-- claim_username, apply_decision_to_remaining,
-- recompute_entry_from_tag_assignments, clear_custom_url). On those,
-- `REVOKE … FROM anon` alone would be a silent no-op. **PUBLIC is named first
-- in every statement below** — F-62, without exception.
--
-- The four that stay open are the four already justified in
-- docs/evidence/d1/phase1/p32-dispositions.md, unchanged on both lanes:
-- increment_managed_page_view, log_app_event, log_client_error,
-- record_test_agent_run. The postcondition asserts the survivors are EXACTLY
-- those four, so a list that were short by one would abort this file rather
-- than close 28 doors and report success.
--
-- P30 — email_exists(text) loses `authenticated`. Production has it; staging
-- is service_role-only. PR #252 removed the client call, and a caller scan at
-- c583431 finds zero call sites of any kind.
--
-- P33 —
--   get_primary_admin_user_id() loses PUBLIC and anon. Zero client callers.
--   posts_dead_host_backup_20260812 loses ALL from PUBLIC, anon and
--     authenticated. The reading has it as anon=arwdm, authenticated=arwdm:
--     on production today, any anonymous visitor can INSERT, UPDATE and DELETE
--     rows in a backup table.
--   all 11 definer relations lose the seven write privileges from PUBLIC,
--     anon and authenticated, leaving SELECT. This is 0033's effect, reached
--     by a file whose precondition does not refuse on production.
--     judging_progression_audit already has no such grants; the statement is
--     a no-op there, which is correct and not a mistake.
--
-- RECURRENCE — ALTER DEFAULT PRIVILEGES removes anon from the postgres/public
-- function default, which the reading has as {anon=X, authenticated=X,
-- service_role=X}: on production today, every newly created function is born
-- anon-executable.
--
--   ⚠ R-51 (C-A20): that statement is NECESSARY BUT NOT SUFFICIENT. A
--   per-schema default can only ADD to the global default; it cannot subtract
--   from it, and the global default still gives PUBLIC EXECUTE, which anon
--   inherits (F-65). **20260910_0043 carries the global statement that
--   actually closes the gap, and repeats this one idempotently.** This file is
--   not the recurrence control on its own and does not claim to be.
--
-- ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
--
-- No GRANT of any kind. No definition, policy, trigger, cron job or row. It
-- does not touch `postgres`, `service_role` or `supabase_auth_admin`. It does
-- not touch verify_staff_id or the leaked-password setting (Owner-deferred),
-- or plpgsql_check's schema (0031, a contract step). It asserts no exact ACL:
-- production is measured once, at 09:13:48Z on 2026-09-25, and an ACL
-- assertion would turn any later drift into a refusal instead of a closure.
-- Existence, kind and signature are asserted; privileges are not.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE ASSERTION — PRODUCTION ONLY, `= 'production'` EXACTLY. ───────────
-- Not two-lane. This file's object list is production's, measured once. On
-- staging most of it is already done and the rest would be wrong, so running
-- it there is an error, not a no-op. It also fails closed outside the dispatch
-- workflow, which since PR #293 (R-13) is the only thing that sets p32.lane.
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'production' THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as production (read: %). '
      '20260910_0037 is a PRODUCTION-ONLY file: its object list was measured on '
      'production on 2026-09-25 and is not staging''s. Staging needs none of it.',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

-- ── PRECONDITION — existence, kind and signature. NEVER an ACL. ───────────
DO $preconditions$
DECLARE
  sig text;
  rel text;
  kind "char";
  n   int := 0;
BEGIN
  -- MAINTAIN is PostgreSQL 17+. The reading's relation ACLs are `arwdDxtm`,
  -- whose `m` is MAINTAIN, so production is 17+; this asserts it rather than
  -- inferring it, because a `REVOKE … MAINTAIN` on 16 is a syntax error and
  -- would take the whole transaction down at parse time.
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION
      'P1-0037-PRE-000: server_version_num is %, and this file revokes MAINTAIN, '
      'which requires PostgreSQL 17 or later',
      current_setting('server_version_num')
      USING ERRCODE = 'raise_exception';
  END IF;

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
    'set_write_path(text)',
    'email_exists(text)',
    'get_primary_admin_user_id()'
  ]
  LOOP
    n := n + 1;
    IF to_regprocedure('public.' || sig) IS NULL THEN
      RAISE EXCEPTION
        'P1-0037-PRE-001: public.% does not exist with that exact signature. The '
        'object list comes from the production reading of 2026-09-25; production '
        'has changed since, and this file must be re-derived, not forced', sig
        USING ERRCODE = 'raise_exception';
    END IF;
    IF (SELECT prokind FROM pg_proc WHERE oid = to_regprocedure('public.' || sig)) <> 'f' THEN
      RAISE EXCEPTION 'P1-0037-PRE-002: public.% is not a plain function', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;
  IF n <> 31 THEN
    RAISE EXCEPTION 'P1-0037-PRE-003: expected 31 function signatures, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;

  -- the backup table
  PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'posts_dead_host_backup_20260812'
     AND c.relkind = 'r';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0037-PRE-004: public.posts_dead_host_backup_20260812 is not a table'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- the eleven definer relations, with the relkind the reading recorded
  n := 0;
  FOR rel, kind IN SELECT * FROM (VALUES
    ('entry_final_votes', 'v'::"char"),
    ('entry_final_votes_legacy', 'v'::"char"),
    ('entry_public_status', 'v'::"char"),
    ('entry_vote_counts', 'm'::"char"),
    ('judge_comments_owner_safe', 'v'::"char"),
    ('judge_decisions_owner_safe', 'v'::"char"),
    ('judge_tag_assignments_owner_safe', 'v'::"char"),
    ('judge_tag_assignments_public_r4', 'v'::"char"),
    ('judging_progression_audit', 'v'::"char"),
    ('profiles_public', 'v'::"char"),
    ('v_judging_drift', 'v'::"char")
  ) AS t(relname, k)
  LOOP
    n := n + 1;
    PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rel AND c.relkind = kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P1-0037-PRE-005: public.% is missing or not relkind %', rel, kind
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;
  IF n <> 11 THEN
    RAISE EXCEPTION 'P1-0037-PRE-006: expected 11 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── PRE-IMAGE — what `authenticated` may execute among the GROUP A functions.
-- GROUP A revokes FROM PUBLIC and anon only. Four of its functions reach anon
-- through PUBLIC, and revoking PUBLIC is exactly the operation that could take
-- `authenticated` with it if any of them lacked a named grant. The
-- postcondition compares against this snapshot, per function, rather than
-- asserting a count.
CREATE TEMP TABLE p1_0037_auth_preimage ON COMMIT DROP AS
SELECT s AS sig, has_function_privilege('authenticated', ('public.' || s)::regprocedure, 'EXECUTE') AS could
  FROM unnest(ARRAY[
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
    'unregister_push_token(text)'
  ]) AS s;

-- ══ P32 · GROUP A — 21 signatures. `authenticated` is KEPT. ═══════════════════
-- PUBLIC first, always (F-62): change_custom_url, register_push_token,
-- unregister_push_token and claim_username reach anon through PUBLIC, so
-- naming anon alone would be a no-op on all four.

REVOKE EXECUTE ON FUNCTION public.admin_flag_entry_for_review(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_rewind_stage(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_search_users(text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_photo_rejected(uuid,integer,boolean,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.backfill_judging_notifications(integer,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.backfill_tag_decision_drift_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.change_custom_url(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_username(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fix_certificate_readiness_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fix_gift_drift_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fix_referral_drift_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[],integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[],integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[],integer,integer,text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_certificate_drift_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_judge_collusion_admin(uuid,integer,numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_judging_tag_assignment_counts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_push_token(text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(numeric,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_competition_entry(uuid,text,text,text[],text[],jsonb,boolean,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unregister_push_token(text) FROM PUBLIC, anon;

-- ══ P32 · GROUP B — 8 signatures. `authenticated` goes too. ═══════════════════
-- The 0034 class plus clear_custom_url, which staging keeps service_role-only.
-- clear_custom_url has ZERO client call sites (p1-0037-caller-derivation).

REVOKE EXECUTE ON FUNCTION public._gen_competition_order_no() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_decision_to_remaining(uuid,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_custom_url() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_derived_status_drift_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.judging_write_decision_atomic(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_entry_from_tag_assignments(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_entry_public_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_write_path(text) FROM PUBLIC, anon, authenticated;

-- ══ P30 ═══════════════════════════════════════════════════════════════════
-- Production grants `authenticated`; staging is service_role-only. The client
-- call went in PR #252 and the caller scan finds nothing at c583431.

REVOKE EXECUTE ON FUNCTION public.email_exists(text) FROM authenticated;

-- ══ P33 ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.get_primary_admin_user_id() FROM PUBLIC, anon;

-- anon=arwdm and authenticated=arwdm on a backup table: on production today an
-- anonymous visitor can write to it.
REVOKE ALL ON TABLE public.posts_dead_host_backup_20260812 FROM PUBLIC, anon, authenticated;

-- The eleven definer relations: the seven write privileges go, SELECT stays.
-- This is 0033's end state, reached by a file that does not refuse on
-- production. On judging_progression_audit it is already true, so the
-- statement is a no-op there — correct, and not a mistake.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.entry_final_votes FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.entry_final_votes_legacy FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.entry_public_status FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.entry_vote_counts FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judge_comments_owner_safe FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judge_decisions_owner_safe FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judge_tag_assignments_owner_safe FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judge_tag_assignments_public_r4 FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judging_progression_audit FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles_public FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.v_judging_drift FROM PUBLIC, anon, authenticated;

-- ══ RECURRENCE — necessary, NOT sufficient. See R-51 / 20260910_0043. ═════
-- Production's postgres/public function default is
-- {anon=X, authenticated=X, service_role=X}: every new function is born
-- anon-executable. This removes anon from that delta. It does NOT close the
-- built-in global default, which still gives PUBLIC EXECUTE (F-65, C-A20);
-- 20260910_0043 carries the global statement and repeats this one idempotently.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- ── POSTCONDITION ─────────────────────────────────────────────────────────
DO $postconditions$
DECLARE
  survivors text[];
  expected  text[] := ARRAY['increment_managed_page_view','log_app_event',
                            'log_client_error','record_test_agent_run'];
  sig  text;
  rel  text;
  rec  record;
  n    int := 0;
  privs text[] := ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
  p    text;
  role_ text;
BEGIN
  -- 1 · the anon-executable SECURITY DEFINER VOLATILE non-trigger functions in
  -- public are EXACTLY the four justified retentions. This is the check that
  -- makes a short object list fatal instead of quiet.
  SELECT coalesce(array_agg(DISTINCT p.proname ORDER BY p.proname), ARRAY[]::text[])
    INTO survivors
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind = 'f' AND p.provolatile = 'v' AND p.prosecdef
     AND p.prorettype <> 'trigger'::regtype
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF survivors <> (SELECT array_agg(x ORDER BY x) FROM unnest(expected) x) THEN
    RAISE EXCEPTION
      'P1-0037-POST-001: anon can still execute %, expected exactly %',
      survivors, (SELECT array_agg(x ORDER BY x) FROM unnest(expected) x)
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 2 · no function this file touched has a PUBLIC entry left (F-62).
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
    'set_write_path(text)',
    'email_exists(text)',
    'get_primary_admin_user_id()'
  ]
  LOOP
    n := n + 1;
    PERFORM 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = to_regprocedure('public.' || sig) AND a.grantee = 0;
    IF FOUND THEN
      RAISE EXCEPTION 'P1-0037-POST-002: public.% still has a PUBLIC ACL entry', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;
  IF n <> 31 THEN
    RAISE EXCEPTION 'P1-0037-POST-003: expected 31 signatures, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 3 · GROUP A did not take `authenticated` with PUBLIC, per function.
  FOR rec IN SELECT * FROM p1_0037_auth_preimage LOOP
    IF has_function_privilege('authenticated', ('public.' || rec.sig)::regprocedure, 'EXECUTE')
         IS DISTINCT FROM rec.could THEN
      RAISE EXCEPTION
        'P1-0037-POST-004: authenticated EXECUTE on public.% changed from % to %. '
        'GROUP A revokes PUBLIC and anon only', rec.sig, rec.could,
        has_function_privilege('authenticated', ('public.' || rec.sig)::regprocedure, 'EXECUTE')
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  -- 4 · P30
  IF has_function_privilege('authenticated', 'public.email_exists(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'P1-0037-POST-005: authenticated still executes email_exists(text)'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.email_exists(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'P1-0037-POST-006: service_role lost EXECUTE on email_exists(text)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 5 · P33 · the backup table
  FOREACH role_ IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege(role_, 'public.posts_dead_host_backup_20260812', p) THEN
        RAISE EXCEPTION 'P1-0037-POST-007: % still holds % on posts_dead_host_backup_20260812', role_, p
          USING ERRCODE = 'raise_exception';
      END IF;
    END LOOP;
  END LOOP;
  IF has_table_privilege('public', 'public.posts_dead_host_backup_20260812', 'SELECT') THEN
    RAISE EXCEPTION 'P1-0037-POST-008: PUBLIC still holds SELECT on posts_dead_host_backup_20260812'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 6 · P33 · the eleven relations keep SELECT and lose every write privilege.
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
    'judging_progression_audit',
    'profiles_public',
    'v_judging_drift'
  ]
  LOOP
    n := n + 1;
    FOREACH role_ IN ARRAY ARRAY['anon','authenticated','public'] LOOP
      FOREACH p IN ARRAY privs LOOP
        IF has_table_privilege(role_, ('public.' || quote_ident(rel))::regclass, p) THEN
          RAISE EXCEPTION 'P1-0037-POST-009: % still holds % on public.%', role_, p, rel
            USING ERRCODE = 'raise_exception';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF n <> 11 THEN
    RAISE EXCEPTION 'P1-0037-POST-010: expected 11 relations, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 7 · P33 · get_primary_admin_user_id
  IF has_function_privilege('anon', 'public.get_primary_admin_user_id()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'P1-0037-POST-011: anon still executes get_primary_admin_user_id()'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 8 · the postgres/public FUNCTION default has no anon and no PUBLIC item.
  -- The GLOBAL default is deliberately NOT asserted here: this file cannot
  -- close it (F-65, C-A20) and 20260910_0043 is the unit that does.
  PERFORM 1
     FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 'public'::regnamespace
      AND d.defaclobjtype = 'f'
      AND (a.grantee = 0 OR a.grantee = 'anon'::regrole);
  IF FOUND THEN
    RAISE EXCEPTION
      'P1-0037-POST-012: the postgres/public FUNCTION default still grants anon or PUBLIC'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
