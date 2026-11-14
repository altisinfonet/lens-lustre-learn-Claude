-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261114_0900 — remaining security-audit items, re-measured live.
-- READ-ONLY in effect: one transaction, ROLLBACK. Prints counts and settings
-- only (never ids, e-mails or row contents). Diagnostic only — never fails on
-- findings. Items (audit of 2026-11-13, handover 13b §3):
--   S1 get_public_role_user_ids / has_role callable without sign-in
--   S2 get_ad_analytics / get_needs_review_recipients_for_round callable by anon
--   S3 storage buckets without size / MIME limit; competition-photos any-folder upload
--   S4 ai_chat_usage counter writable by its owner
--   S5 TRUNCATE (and other broad table rights) granted to anon / authenticated
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
    EXECUTE _sql INTO _v;
    RAISE EXCEPTION 'PROBE_OK:%', coalesce(_v, '<no row>');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_OK:%' THEN RETURN 'ALLOWED ' || substr(SQLERRM, 10); END IF;
    RETURN 'refused ' || SQLSTATE || ' ' || left(SQLERRM, 160);
  END;
END
$f$;

DO $p$
DECLARE
  r record; _admin uuid; _member uuid; _comp uuid; _n int;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  RAISE NOTICE 'lane %', current_setting('p32.lane');

  SELECT ur.user_id INTO _admin FROM public.user_roles ur WHERE ur.role::text = 'admin' LIMIT 1;
  SELECT p.id INTO _member FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text IN ('admin', 'judge'))
   LIMIT 1;
  SELECT c.id INTO _comp FROM public.competitions c ORDER BY c.created_at DESC LIMIT 1;

  -- ── S1 / S2: who may run the four functions ──────────────────────────────
  FOR r IN SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
                  pg_get_function_result(p.oid) AS res, p.proconfig,
                  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
                  coalesce(p.proacl::text, '<default: PUBLIC>') AS acl, p.prosrc
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('get_public_role_user_ids', 'has_role', 'get_ad_analytics', 'get_needs_review_recipients_for_round')
            ORDER BY 2, 3 LOOP
    RAISE NOTICE 'FN %(%) -> % definer=% anon_exec=% auth_exec=% acl=% config=%',
      r.proname, r.args, r.res, r.prosecdef, r.anon_x, r.auth_x, r.acl, r.proconfig;
    RAISE NOTICE 'FN-BODY % : %', r.proname, left(regexp_replace(r.prosrc, '\s+', ' ', 'g'), 900);
  END LOOP;

  RAISE NOTICE 'S1a anon get_public_role_user_ids(admin) %', pg_temp.as_role('anon', NULL,
    $q$SELECT 'rows=' || count(*) || ' textlen=' || coalesce(sum(length(t::text)), 0) FROM public.get_public_role_user_ids('admin') t$q$);
  RAISE NOTICE 'S1b anon get_public_role_user_ids(judge) %', pg_temp.as_role('anon', NULL,
    $q$SELECT 'rows=' || count(*) || ' textlen=' || coalesce(sum(length(t::text)), 0) FROM public.get_public_role_user_ids('judge') t$q$);
  RAISE NOTICE 'S1c anon has_role(<an admin>, admin) %', pg_temp.as_role('anon', NULL,
    format('SELECT public.has_role(%L::uuid, %L)::text', _admin, 'admin'));
  RAISE NOTICE 'S1d member get_public_role_user_ids(admin) %', pg_temp.as_role('authenticated', _member,
    $q$SELECT 'rows=' || count(*) FROM public.get_public_role_user_ids('admin') t$q$);
  RAISE NOTICE 'S2a anon get_ad_analytics(30 days) %', pg_temp.as_role('anon', NULL,
    $q$SELECT 'jsonlen=' || length(x::text) || ' keys=' || coalesce((SELECT string_agg(k, ',') FROM jsonb_object_keys(x::jsonb) k), '-')
         FROM (SELECT public.get_ad_analytics('2026-10-15T00:00:00Z') AS x) s$q$);
  RAISE NOTICE 'S2b member get_ad_analytics(30 days) %', pg_temp.as_role('authenticated', _member,
    $q$SELECT 'jsonlen=' || length(public.get_ad_analytics('2026-10-15T00:00:00Z')::text)$q$);
  RAISE NOTICE 'S2c anon get_needs_review_recipients_for_round(latest comp, 1) %', pg_temp.as_role('anon', NULL,
    format('SELECT %L || count(*) FROM public.get_needs_review_recipients_for_round(%L::uuid, 1) t', 'rows=', _comp));
  RAISE NOTICE 'S2d member get_needs_review_recipients_for_round(latest comp, 1) %', pg_temp.as_role('authenticated', _member,
    format('SELECT %L || count(*) FROM public.get_needs_review_recipients_for_round(%L::uuid, 1) t', 'rows=', _comp));

  -- has_role inside policies that anon (or PUBLIC) evaluates: revoking anon EXECUTE would break these
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname IN ('public', 'storage')
     AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'has_role\('
     AND (roles::text ~ 'anon' OR roles::text ~ 'public');
  RAISE NOTICE 'S1e policies calling has_role that apply to anon/public: %', _n;
  FOR r IN SELECT schemaname, tablename, policyname, cmd, roles::text AS roles FROM pg_policies
            WHERE schemaname IN ('public', 'storage')
              AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'has_role\('
              AND (roles::text ~ 'anon' OR roles::text ~ 'public')
            ORDER BY 1, 2, 3 LOOP
    RAISE NOTICE '  HASROLE-POL %.%.% [%] %', r.schemaname, r.tablename, r.policyname, r.cmd, r.roles;
  END LOOP;
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname IN ('public', 'storage') AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'has_role\(';
  RAISE NOTICE 'S1f policies calling has_role, all roles: %', _n;
  FOR r IN SELECT p.proname, p.prosecdef FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND NOT p.prosecdef
              AND p.prosrc ~ 'has_role\(' ORDER BY 1 LOOP
    RAISE NOTICE '  INVOKER-FN-CALLS-HAS_ROLE %', r.proname;
  END LOOP;

  -- ── S3: storage buckets and upload policies ───────────────────────────────
  FOR r IN SELECT id, public, file_size_limit, allowed_mime_types::text AS mimes,
                  (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = b.id) AS objs
             FROM storage.buckets b ORDER BY id LOOP
    RAISE NOTICE 'S3 BUCKET % public=% size_limit=% mime=% objects=%', r.id, r.public, r.file_size_limit, coalesce(r.mimes, 'ANY'), r.objs;
  END LOOP;
  FOR r IN SELECT policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT', 'UPDATE', 'ALL')
            ORDER BY policyname LOOP
    RAISE NOTICE 'S3 POL "%" [%] % using=% check=%', r.policyname, r.cmd, r.roles,
      left(regexp_replace(coalesce(r.qual, '-'), '\s+', ' ', 'g'), 260),
      left(regexp_replace(coalesce(r.with_check, '-'), '\s+', ' ', 'g'), 260);
  END LOOP;
  -- how existing competition-photos objects are named (first path part = owner id?)
  SELECT count(*) INTO _n FROM storage.objects o WHERE o.bucket_id = 'competition-photos';
  RAISE NOTICE 'S3 competition-photos objects=% first-folder-is-owner=% first-folder-is-uuid=%', _n,
    (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'competition-photos' AND (storage.foldername(o.name))[1] = o.owner::text),
    (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'competition-photos'
       AND (storage.foldername(o.name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  FOR r IN SELECT o.bucket_id, max((o.metadata->>'size')::bigint) AS biggest,
                  percentile_disc(0.99) WITHIN GROUP (ORDER BY (o.metadata->>'size')::bigint) AS p99,
                  string_agg(DISTINCT o.metadata->>'mimetype', ',') AS mimes
             FROM storage.objects o GROUP BY o.bucket_id ORDER BY 1 LOOP
    RAISE NOTICE 'S3 SIZES % biggest=% p99=% mimes=%', r.bucket_id, r.biggest, r.p99, left(coalesce(r.mimes, '-'), 300);
  END LOOP;

  -- ── S4: ai_chat_usage ─────────────────────────────────────────────────────
  RAISE NOTICE 'S4 rls_enabled=% rows=%',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_chat_usage'::regclass),
    (SELECT count(*) FROM public.ai_chat_usage);
  FOR r IN SELECT policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'ai_chat_usage' ORDER BY cmd, policyname LOOP
    RAISE NOTICE 'S4 POL "%" [%] % using=% check=%', r.policyname, r.cmd, r.roles,
      left(regexp_replace(coalesce(r.qual, '-'), '\s+', ' ', 'g'), 200),
      left(regexp_replace(coalesce(r.with_check, '-'), '\s+', ' ', 'g'), 200);
  END LOOP;
  FOR r IN SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
             FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'ai_chat_usage' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
            GROUP BY grantee LOOP
    RAISE NOTICE 'S4 GRANT % : %', r.grantee, r.privs;
  END LOOP;

  -- ── S5: broad table rights for anon / authenticated ───────────────────────
  FOR r IN SELECT grantee, privilege_type, count(*) AS n, string_agg(table_name, ',' ORDER BY table_name) AS tabs
             FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
              AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
            GROUP BY grantee, privilege_type ORDER BY 1, 2 LOOP
    RAISE NOTICE 'S5 % % on % table(s): %', r.grantee, r.privilege_type, r.n, left(r.tabs, 600);
  END LOOP;
  -- default privileges that would hand the same rights to future tables
  FOR r IN SELECT pg_get_userbyid(d.defaclrole) AS owner, d.defaclobjtype, d.defaclacl::text AS acl
             FROM pg_default_acl d WHERE d.defaclnamespace = 'public'::regnamespace LOOP
    RAISE NOTICE 'S5 DEFAULT-ACL owner=% type=% acl=%', r.owner, r.defaclobjtype, left(r.acl, 400);
  END LOOP;

  RAISE NOTICE 'SA0900 DONE (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
