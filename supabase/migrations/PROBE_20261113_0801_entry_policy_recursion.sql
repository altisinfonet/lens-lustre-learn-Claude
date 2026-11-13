-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0801 why does a member's edit of their own entry fail with
-- "infinite recursion detected in policy for relation competition_entries"?
-- (seen on staging by PROBE 0800, run 43440954038). READ-ONLY in effect: one
-- transaction, ROLLBACK. Prints every policy on competition_entries and
-- competitions, every policy elsewhere that reads competition_entries, and
-- repeats the owner's title edit as that member, with and without RETURNING.
-- Diagnostic only — it never fails on findings.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL client_min_messages = notice;

CREATE FUNCTION pg_temp.as_member(_uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE _v text; _ctx text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    SET LOCAL ROLE authenticated;
    EXECUTE _sql INTO _v;
    RAISE EXCEPTION 'PROBE_OK:%', coalesce(_v, '<no row>');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_OK:%' THEN RETURN 'ok ' || substr(SQLERRM, 10); END IF;
    GET STACKED DIAGNOSTICS _ctx = PG_EXCEPTION_CONTEXT;
    RETURN 'refused ' || SQLSTATE || ' ' || left(SQLERRM, 150) || ' | ' || left(coalesce(_ctx, ''), 300);
  END;
END
$f$;

DO $p$
DECLARE
  r record; _e uuid; _owner uuid; _comp uuid; _st text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  RAISE NOTICE 'lane %', current_setting('p32.lane');

  FOR r IN SELECT tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
             FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('competition_entries', 'competitions')
            ORDER BY tablename, cmd, policyname LOOP
    RAISE NOTICE 'POL %.% [% %] % using=% check=%', r.tablename, r.policyname, left(r.permissive, 1), r.cmd, r.roles,
      left(regexp_replace(coalesce(r.qual, '-'), '\s+', ' ', 'g'), 400), left(regexp_replace(coalesce(r.with_check, '-'), '\s+', ' ', 'g'), 300);
  END LOOP;
  FOR r IN SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
            WHERE schemaname = 'public' AND tablename NOT IN ('competition_entries')
              AND (coalesce(qual, '') ~ 'competition_entries' OR coalesce(with_check, '') ~ 'competition_entries')
            ORDER BY 1, 2 LOOP
    RAISE NOTICE 'READS-ENTRIES %.% [%] using=%', r.tablename, r.policyname, r.cmd, left(regexp_replace(coalesce(r.qual, r.with_check, '-'), '\s+', ' ', 'g'), 300);
  END LOOP;
  -- functions used in those two tables' policies that read competition_entries
  FOR r IN SELECT DISTINCT p.proname, p.prosecdef FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.prosrc ~ 'competition_entries'
              AND EXISTS (SELECT 1 FROM pg_policies q WHERE q.schemaname = 'public' AND q.tablename IN ('competition_entries', 'competitions')
                           AND (coalesce(q.qual, '') || coalesce(q.with_check, '')) ~ ('\m' || p.proname || '\('))
            ORDER BY 1 LOOP
    RAISE NOTICE 'POLICY-FN % reads competition_entries, security_definer=%', r.proname, r.prosecdef;
  END LOOP;

  SELECT e.id, e.user_id, e.competition_id, e.status INTO _e, _owner, _comp, _st
    FROM public.competition_entries e JOIN auth.users u ON u.id = e.user_id
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = e.user_id AND ur.role::text = 'admin')
   ORDER BY (e.status = 'submitted') DESC, e.created_at DESC LIMIT 1;
  UPDATE public.competitions
     SET phase = 'submission_open', starts_at = now() - interval '1 day', ends_at = now() + interval '1 day',
         status = CASE WHEN status IN ('archived', 'cancelled') THEN 'open' ELSE status END
   WHERE id = _comp;
  RAISE NOTICE 'test entry status %', _st;
  RAISE NOTICE 'T1 owner SELECT own entry ......... %', pg_temp.as_member(_owner, format('SELECT id::text FROM public.competition_entries WHERE id = %L', _e));
  RAISE NOTICE 'T2 owner UPDATE title, RETURNING .. %', pg_temp.as_member(_owner, format('UPDATE public.competition_entries SET title = title WHERE id = %L RETURNING id::text', _e));
  RAISE NOTICE 'T3 owner UPDATE title, no RETURNING %', pg_temp.as_member(_owner, format('WITH u AS (UPDATE public.competition_entries SET title = title WHERE id = %L) SELECT %L', _e, 'done'));
  RAISE NOTICE 'T4 member SELECT competitions ..... %', pg_temp.as_member(_owner, format('SELECT id::text FROM public.competitions WHERE id = %L', _comp));
  RAISE NOTICE 'JR0801 DONE (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
