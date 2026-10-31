-- ═══════════════════════════════════════════════════════════════════════════
-- F-P35-1 · 20261005_0001 — take back table privileges no client uses (D1, T1)
-- Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- FINDINGS: F-P35-1 (SEC triage 2026-10-04, LOW · grant hygiene) and SEC-OFF2-2
-- (INFO, "fold into the F-P35-1 revoke"). Read on staging, 2026-10-05 (read-only):
--   _v3_preflight_snapshot_{competition_entries,judge_decisions,
--     judge_tag_assignments,judging_tags}   frozen rollback copies of judging
--     data. ACL anon/authenticated = arwdDxtm (ALL). RLS on; one admin-only
--     SELECT policy. Their only readers/writers are two edge functions
--     (hard-delete-competition, detect-orphan-files), both via the SERVICE-ROLE
--     client; src/ never queries them (only generated types name them).
--   post_comments   anon = ALL. Anon READS comments (policy "Users can view
--     comments on visible posts", TO public) — kept. Anon never writes.
--   reports         anon = ALL. No anon policy at all.
-- RLS is today the only barrier, and TRUNCATE is not subject to RLS: a role
-- holding TRUNCATE empties the table whatever the policies say (PostgREST never
-- issues it, so it needs a direct SQL session — shown in the evidence).
--
-- WHAT THIS FILE DOES (privileges only; no row, policy or column changes):
--   snapshots      REVOKE ALL FROM PUBLIC, anon, authenticated (service_role and
--                  postgres keep theirs; the admin SELECT policy stays, unused).
--   post_comments  anon keeps SELECT only; authenticated loses TRUNCATE,
--                  REFERENCES, TRIGGER, MAINTAIN (keeps SELECT/INSERT/UPDATE/DELETE).
--   reports        anon loses everything; authenticated as post_comments.
--   The ACL of every table touched is saved first in
--   public.f_p35_1_acl_before, so the rollback restores it exactly on any lane.
--   A snapshot table absent on a lane is skipped (NOTICE), never an error.
-- NOT DONE HERE: the physical DROP of the snapshots stays in A-4c (P35).
--
-- OBJECTS (reservation): new public.f_p35_1_acl_before; privileges on the six
-- tables above.
-- NOT RE-RUNNABLE: PRE-002 refuses once the saved ACL exists.
-- ROLLBACK: supabase/rollback/20261005_0001_f_p35_1_grant_revoke_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_f_p35_1_grants.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
BEGIN
  -- PRE-001 · the two live tables exist and keep RLS on.
  IF to_regclass('public.post_comments') IS NULL OR to_regclass('public.reports') IS NULL THEN
    RAISE EXCEPTION 'FP351-0001-PRE-001: public.post_comments or public.reports is missing' USING ERRCODE = 'raise_exception';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.post_comments'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reports'::regclass) THEN
    RAISE EXCEPTION 'FP351-0001-PRE-001: RLS is off on post_comments or reports — read first' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.f_p35_1_acl_before') IS NOT NULL THEN
    RAISE EXCEPTION 'FP351-0001-PRE-002: public.f_p35_1_acl_before exists — 20261005_0001 is applied' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the ACL before, for an exact rollback ───────────────────────────────
CREATE TABLE public.f_p35_1_acl_before (
  relname   text PRIMARY KEY,
  relacl    aclitem[],
  saved_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.f_p35_1_acl_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.f_p35_1_acl_before FROM PUBLIC;
REVOKE ALL ON public.f_p35_1_acl_before FROM anon;
REVOKE ALL ON public.f_p35_1_acl_before FROM authenticated;

INSERT INTO public.f_p35_1_acl_before (relname, relacl)
SELECT c.relname, c.relacl
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('_v3_preflight_snapshot_competition_entries', '_v3_preflight_snapshot_judge_decisions',
                     '_v3_preflight_snapshot_judge_tag_assignments', '_v3_preflight_snapshot_judging_tags',
                     'post_comments', 'reports');

-- ── 2. the revokes ─────────────────────────────────────────────────────────
DO $revoke$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['_v3_preflight_snapshot_competition_entries', '_v3_preflight_snapshot_judge_decisions',
                            '_v3_preflight_snapshot_judge_tag_assignments', '_v3_preflight_snapshot_judging_tags'] LOOP
    IF to_regclass('public.' || _t) IS NULL THEN
      RAISE NOTICE 'FP351-0001: public.% does not exist on this lane — skipped', _t;
    ELSE
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', _t);
    END IF;
  END LOOP;
END
$revoke$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.post_comments FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.post_comments FROM authenticated;
REVOKE ALL ON public.reports FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.reports FROM authenticated;

DO $postconditions$
DECLARE
  _t   text;
  _bad text := '';
  _p   text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['_v3_preflight_snapshot_competition_entries', '_v3_preflight_snapshot_judge_decisions',
                            '_v3_preflight_snapshot_judge_tag_assignments', '_v3_preflight_snapshot_judging_tags'] LOOP
    IF to_regclass('public.' || _t) IS NOT NULL THEN
      FOREACH _p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege('anon', 'public.' || quote_ident(_t), _p) OR has_table_privilege('authenticated', 'public.' || quote_ident(_t), _p) THEN
          _bad := _bad || ' ' || _t || ':' || _p;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  FOREACH _p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.post_comments', _p) THEN _bad := _bad || ' post_comments:anon:' || _p; END IF;
  END LOOP;
  FOREACH _p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.reports', _p) THEN _bad := _bad || ' reports:anon:' || _p; END IF;
  END LOOP;
  FOREACH _p IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('authenticated', 'public.post_comments', _p) THEN _bad := _bad || ' post_comments:authenticated:' || _p; END IF;
    IF has_table_privilege('authenticated', 'public.reports', _p) THEN _bad := _bad || ' reports:authenticated:' || _p; END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'FP351-0001-POST-001: privileges remain:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  -- What must stay (the app's own paths).
  IF NOT has_table_privilege('anon', 'public.post_comments', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.post_comments', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('authenticated', 'public.reports', 'SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'FP351-0001-POST-002: a privilege the app uses was lost' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'FP351-0001: snapshots closed to the API roles; post_comments/reports hold only what the app uses; % ACL(s) saved',
    (SELECT count(*) FROM public.f_p35_1_acl_before);
END
$postconditions$;

COMMIT;
