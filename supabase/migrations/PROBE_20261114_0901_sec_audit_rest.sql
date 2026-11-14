-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261114_0901 — proves 20261114_0900 (functions, AI counter, table
-- rights) and 20261114_0901 (competition-photos own folder).
-- READ-ONLY in effect: one transaction, ROLLBACK (its own test rows vanish).
-- Ends "SA0901 PASS …" or raises "SA0901 FAIL …" (red run). Before the fix it
-- is expected to FAIL; after the fix it must PASS on both lanes.
-- Prints counts / yes-no only, never ids.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL client_min_messages = notice;

CREATE FUNCTION pg_temp.as_role(_role text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE _v text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _uid IS NULL THEN json_build_object('role', _role)
           ELSE json_build_object('sub', _uid, 'role', _role) END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), true);
    PERFORM set_config('request.jwt.claim.role', _role, true);
    EXECUTE format('SET LOCAL ROLE %I', _role);
    IF _sql ~* '^\s*INSERT' AND _sql !~* 'RETURNING' THEN
      EXECUTE _sql;            -- a plain write: no RETURNING (needs no SELECT policy)
      _v := 'written';
    ELSE
      EXECUTE _sql INTO _v;
    END IF;
    RAISE EXCEPTION 'PROBE_OK:%', coalesce(_v, '<no row>');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_OK:%' THEN RETURN 'ok ' || substr(SQLERRM, 10); END IF;
    RETURN 'refused ' || SQLSTATE || ' ' || left(SQLERRM, 140);
  END;
END
$f$;

DO $p$
DECLARE
  _admin uuid; _member uuid; _other uuid; _comp uuid; _judges int; _n int;
  _r text; _fail text := '';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  RAISE NOTICE 'lane %', current_setting('p32.lane');

  SELECT ur.user_id INTO _admin FROM public.user_roles ur WHERE ur.role::text = 'admin' LIMIT 1;
  SELECT p.id INTO _member FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text IN ('admin', 'judge', 'content_editor'))
   ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO _other FROM public.profiles p WHERE p.id <> _member ORDER BY p.created_at LIMIT 1;
  SELECT c.id INTO _comp FROM public.competitions c ORDER BY c.created_at DESC LIMIT 1;
  SELECT count(*) INTO _judges FROM public.user_roles ur WHERE ur.role::text = 'judge';
  RAISE NOTICE 'fixture admin=% member=% other=% comp=% judges=%', _admin IS NOT NULL, _member IS NOT NULL, _other IS NOT NULL, _comp IS NOT NULL, _judges;
  IF _admin IS NULL OR _member IS NULL OR _other IS NULL THEN
    RAISE EXCEPTION 'SA0901 FAIL — fixture missing (admin/member/other)';
  END IF;

  -- ── S2: server-only functions ─────────────────────────────────────────────
  _r := pg_temp.as_role('anon', NULL, $q$SELECT public.get_ad_analytics('2026-10-15T00:00:00Z')::text$q$);
  RAISE NOTICE 'A1 anon get_ad_analytics ............ %', left(_r, 90);
  IF _r NOT LIKE 'refused 42501%' THEN _fail := _fail || ' A1'; END IF;
  _r := pg_temp.as_role('authenticated', _member, $q$SELECT public.get_ad_analytics('2026-10-15T00:00:00Z')::text$q$);
  RAISE NOTICE 'A2 member get_ad_analytics .......... %', left(_r, 90);
  IF _r NOT LIKE 'refused 42501%' THEN _fail := _fail || ' A2'; END IF;
  _r := pg_temp.as_role('anon', NULL, format('SELECT count(*)::text FROM public.get_needs_review_recipients_for_round(%L::uuid, 1)', _comp));
  RAISE NOTICE 'A3 anon needs_review_recipients ..... %', left(_r, 90);
  IF _r NOT LIKE 'refused 42501%' THEN _fail := _fail || ' A3'; END IF;
  _r := pg_temp.as_role('authenticated', _member, format('SELECT count(*)::text FROM public.get_needs_review_recipients_for_round(%L::uuid, 1)', _comp));
  RAISE NOTICE 'A4 member needs_review_recipients ... %', left(_r, 90);
  IF _r NOT LIKE 'refused 42501%' THEN _fail := _fail || ' A4'; END IF;
  RAISE NOTICE 'N1 service_role may run both ........ % / %',
    has_function_privilege('service_role', 'public.get_ad_analytics(timestamptz)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.get_needs_review_recipients_for_round(uuid, integer)', 'EXECUTE');
  IF NOT has_function_privilege('service_role', 'public.get_ad_analytics(timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_needs_review_recipients_for_round(uuid, integer)', 'EXECUTE') THEN
    _fail := _fail || ' N1';
  END IF;

  -- ── S1: judge list only when signed in; admin list stays public ───────────
  _r := pg_temp.as_role('anon', NULL, $q$SELECT count(*)::text FROM public.get_public_role_user_ids('judge')$q$);
  RAISE NOTICE 'A5 anon judge ids (want ok 0) ....... %', _r;
  IF _r <> 'ok 0' THEN _fail := _fail || ' A5'; END IF;
  _r := pg_temp.as_role('authenticated', _member, $q$SELECT count(*)::text FROM public.get_public_role_user_ids('judge')$q$);
  RAISE NOTICE 'N2 member judge ids (want ok %) ..... %', _judges, _r;
  IF _r <> 'ok ' || _judges THEN _fail := _fail || ' N2'; END IF;
  _r := pg_temp.as_role('anon', NULL, $q$SELECT count(*)::text FROM public.get_public_role_user_ids('admin')$q$);
  RAISE NOTICE 'N3 anon admin ids (badge, want ok >0) %', _r;
  IF _r NOT LIKE 'ok %' OR _r = 'ok 0' THEN _fail := _fail || ' N3'; END IF;
  _r := pg_temp.as_role('anon', NULL, format('SELECT public.has_role(%L::uuid, %L)::text', _admin, 'admin'));
  RAISE NOTICE 'N4 anon has_role still works (policies) %', _r;
  IF _r <> 'ok true' THEN _fail := _fail || ' N4'; END IF;

  -- ── S4: AI question counter ───────────────────────────────────────────────
  INSERT INTO public.ai_chat_usage (user_id, device_id, session_date, question_count)
  VALUES (_member, 'probe-0901', current_date, 7);
  _r := pg_temp.as_role('authenticated', _member,
    $q$WITH u AS (UPDATE public.ai_chat_usage SET question_count = 0 WHERE user_id = auth.uid() AND device_id = 'probe-0901' RETURNING 1) SELECT count(*)::text FROM u$q$);
  RAISE NOTICE 'A6 member resets own AI counter ..... %', _r;
  IF _r NOT LIKE 'refused%' AND _r <> 'ok 0' THEN _fail := _fail || ' A6'; END IF;
  _r := pg_temp.as_role('authenticated', _member,
    $q$WITH d AS (DELETE FROM public.ai_chat_usage WHERE user_id = auth.uid() AND device_id = 'probe-0901' RETURNING 1) SELECT count(*)::text FROM d$q$);
  RAISE NOTICE 'A7 member deletes own AI counter .... %', _r;
  IF _r NOT LIKE 'refused%' AND _r <> 'ok 0' THEN _fail := _fail || ' A7'; END IF;
  _r := pg_temp.as_role('authenticated', _member,
    $q$INSERT INTO public.ai_chat_usage (user_id, device_id, session_date, question_count) VALUES (auth.uid(), 'probe-0901b', current_date, 0) RETURNING 'inserted'$q$);
  RAISE NOTICE 'A8 member inserts an AI counter ..... %', _r;
  IF _r NOT LIKE 'refused%' THEN _fail := _fail || ' A8'; END IF;
  _r := pg_temp.as_role('authenticated', _member,
    $q$SELECT question_count::text FROM public.ai_chat_usage WHERE user_id = auth.uid() AND device_id = 'probe-0901'$q$);
  RAISE NOTICE 'N5 member reads own counter (want 7)  %', _r;
  IF _r <> 'ok 7' THEN _fail := _fail || ' N5'; END IF;
  SELECT count(*) INTO _n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'ai_chat_usage' AND grantee = 'service_role'
     AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE');
  RAISE NOTICE 'N6 service_role SELECT/INSERT/UPDATE on ai_chat_usage: %/3', _n;
  IF _n <> 3 THEN _fail := _fail || ' N6'; END IF;

  -- ── S5: no TRUNCATE / TRIGGER / REFERENCES for app roles ──────────────────
  SELECT count(*) INTO _n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
     AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  RAISE NOTICE 'A9 app-role TRUNCATE/TRIGGER/REFERENCES grants: %', _n;
  IF _n <> 0 THEN _fail := _fail || ' A9'; END IF;
  SELECT count(*) INTO _n
    FROM pg_default_acl d, aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
     AND pg_get_userbyid(d.defaclrole) = 'postgres'
     AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
     AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  RAISE NOTICE 'A10 postgres default ACL hands them to new tables: %', _n;
  IF _n <> 0 THEN _fail := _fail || ' A10'; END IF;
  RAISE NOTICE 'N7 anon still SELECTs hashtags ....... %', has_table_privilege('anon', 'public.hashtags', 'SELECT');
  IF NOT has_table_privilege('anon', 'public.hashtags', 'SELECT') THEN _fail := _fail || ' N7'; END IF;

  -- ── competition-photos: own folder, or staff ──────────────────────────────
  _r := pg_temp.as_role('authenticated', _member,
    format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('competition-photos', %L)$q$, _other::text || '/competitions/probe-0901.webp'));
  RAISE NOTICE 'A11 member uploads into another folder %', left(_r, 90);
  IF _r NOT LIKE 'refused%' THEN _fail := _fail || ' A11'; END IF;
  _r := pg_temp.as_role('authenticated', _member,
    format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('competition-photos', %L)$q$, _member::text || '/competitions/probe-0901.webp'));
  RAISE NOTICE 'N8 member uploads into own folder .... %', left(_r, 90);
  IF _r <> 'ok written' THEN _fail := _fail || ' N8'; END IF;
  _r := pg_temp.as_role('authenticated', _admin,
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('competition-photos', 'covers/probe-0901.webp')$q$);
  RAISE NOTICE 'N9 admin uploads a cover ............. %', left(_r, 90);
  IF _r <> 'ok written' THEN _fail := _fail || ' N9'; END IF;
  _r := pg_temp.as_role('anon', NULL,
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('competition-photos', 'x/probe-0901.webp')$q$);
  RAISE NOTICE 'A12 signed-out upload ................ %', left(_r, 90);
  IF _r NOT LIKE 'refused%' THEN _fail := _fail || ' A12'; END IF;

  BEGIN
    EXECUTE 'SELECT public.is_s3_storage_enabled()::text' INTO _r;
  EXCEPTION WHEN OTHERS THEN _r := 'n/a';
  END;
  RAISE NOTICE 'INFO external (R2) storage on: %', _r;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'SA0901 FAIL (lane %):%', current_setting('p32.lane'), _fail;
  END IF;
  RAISE NOTICE 'SA0901 PASS (lane %) — server-only functions closed, judge list signed-in only, AI counter server-only, no TRUNCATE rights, competition-photos own folder', current_setting('p32.lane');
END
$p$;

ROLLBACK;
