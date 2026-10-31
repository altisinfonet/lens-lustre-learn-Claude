-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261013_0003 — staging's push trigger names staging's own send-push,
--         and no checked staging config names the production project
-- Lane: STAGING ONLY. G0 refuses unless p32.lane = 'staging' (apply-migration.yml
-- sets it from target=staging). The expected values below describe staging; on
-- production they would be wrong by design.
-- READ-ONLY (BEGIN READ ONLY … ROLLBACK). Raises, and so fails the dispatch, on
-- any hit. Output is counts, booleans and host names only — no secret value,
-- no column value from vault, push_config.internal_secret or cron commands is
-- ever printed.
--
--   G1 · public.push_config: exactly 1 row; function_url is exactly
--        https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push;
--        the production ref appears in no column of the row; internal_secret
--        is still NOT NULL (presence only).
--   G2 · the trigger path is the one 20261013_0003 relied on: push_config's
--        only reader is public.push_on_notification(), which queues through
--        pg_net inside an EXCEPTION WHEN OTHERS handler, attached once as
--        trg_push_on_notification AFTER INSERT FOR EACH ROW on
--        public.user_notifications.
--   G3 · no checked config store names the production ref jtdtehuqtinjxropkkcn:
--        site_settings values; vault secrets (boolean per secret, counted);
--        cron.job commands; function bodies in every schema (a body carrying
--        the repository's `isolation-allow` marker is exempt — none exists on
--        staging today); column defaults; view and policy expressions;
--        function and role settings; pending pg_net requests.
--   G4 · no row of any text/varchar/json/jsonb/text[] column of any public
--        table names the production ref (the 2026-10-13 sweep found only
--        push_config.function_url, which 20261013_0003 changes).
--   G5 · (NOTICE only) site_settings keys that still carry production HOSTS
--        on 50mmretina.com outside staging./cdn-staging. — known, reported in
--        the PR, deliberately not changed by 20261013_0003.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  _staging_url constant text := 'https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push';
  _ref         constant text := 'jtdtehuqtinjxropkkcn';
  r     record;
  _n    int;
  _hit  int;
  _bad  text := '';
  _cols int := 0;
  _keys text;
BEGIN
  -- G0 · lane guard: these expectations describe staging only.
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION 'PROBE REFUSED 20261013_0003 — staging-only probe and p32.lane reads %. Dispatch apply-migration.yml with target=staging.',
      coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;

  -- G1 · push_config
  IF to_regclass('public.push_config') IS NULL THEN
    _bad := _bad || E'\n  G1 public.push_config does not exist';
  ELSE
    SELECT count(*) INTO _n FROM public.push_config;
    IF _n <> 1 THEN
      _bad := _bad || E'\n  G1 push_config holds ' || _n || ' row(s); exactly 1 expected';
    END IF;
    SELECT count(*) FILTER (WHERE c.function_url = _staging_url)  AS url_ok,
           count(*) FILTER (WHERE c::text ~ _ref)                AS names_ref,
           count(*) FILTER (WHERE c.internal_secret IS NOT NULL) AS other_present,
           string_agg(DISTINCT coalesce(substring(c.function_url from '^https?://([^/]+)'), '(unparseable)'), ',') AS hosts
      INTO r FROM public.push_config c;
    IF r.url_ok <> 1 THEN
      _bad := _bad || E'\n  G1 push_config.function_url is not staging''s send-push (host ' || coalesce(r.hosts, 'none') || ')';
    END IF;
    IF r.names_ref <> 0 THEN
      _bad := _bad || E'\n  G1 push_config still names the production ref';
    END IF;
    IF r.other_present <> 1 THEN
      _bad := _bad || E'\n  G1 push_config.internal_secret is missing (presence check only)';
    END IF;
  END IF;

  -- G2 · trigger path
  SELECT count(*) INTO _n FROM pg_proc p WHERE p.prosrc ~ 'push_config';
  IF _n <> 1 THEN
    _bad := _bad || E'\n  G2 ' || _n || ' function bodies name push_config; exactly 1 expected';
  END IF;
  SELECT p.oid,
         p.prosrc ~ 'push_config' AS reads_cfg,
         p.prosrc ~ 'PERFORM\s+net\.http_post\s*\(' AS queues_via_pg_net,
         p.prosrc ~ 'EXCEPTION\s+WHEN\s+OTHERS\s+THEN' AS catches_all
    INTO r FROM pg_proc p WHERE p.oid = to_regprocedure('public.push_on_notification()');
  IF r.oid IS NULL OR NOT (r.reads_cfg AND r.queues_via_pg_net AND r.catches_all) THEN
    _bad := _bad || E'\n  G2 push_on_notification() missing, or not (reads push_config, queues via pg_net, catch-all handler)';
  ELSIF NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgfoid = r.oid AND NOT t.tgisinternal
             AND t.tgrelid = 'public.user_notifications'::regclass
             AND t.tgname = 'trg_push_on_notification' AND t.tgtype = 5)
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = r.oid AND NOT t.tgisinternal) <> 1 THEN
    _bad := _bad || E'\n  G2 push_on_notification() is not attached exactly once as trg_push_on_notification AFTER INSERT FOR EACH ROW on user_notifications';
  END IF;

  -- G3 · config stores
  SELECT count(*) INTO _n FROM public.site_settings s WHERE s.value::text ~ _ref;
  IF _n <> 0 THEN
    SELECT string_agg(s.key, ', ' ORDER BY s.key) INTO _keys FROM public.site_settings s WHERE s.value::text ~ _ref;
    _bad := _bad || E'\n  G3 site_settings keys naming the production ref: ' || _keys;
  END IF;
  SELECT count(*) INTO _n FROM vault.decrypted_secrets d WHERE d.decrypted_secret ~ _ref;
  IF _n <> 0 THEN
    SELECT string_agg(d.name, ', ' ORDER BY d.name) INTO _keys FROM vault.decrypted_secrets d WHERE d.decrypted_secret ~ _ref;
    _bad := _bad || E'\n  G3 vault secrets (names only) whose value names the production ref: ' || _keys;
  END IF;
  SELECT count(*) INTO _n FROM cron.job j WHERE j.command ~ _ref;
  IF _n <> 0 THEN
    SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO _keys FROM cron.job j WHERE j.command ~ _ref;
    _bad := _bad || E'\n  G3 cron jobs (names only) whose command names the production ref: ' || _keys;
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p WHERE p.prosrc ~ _ref AND p.prosrc !~ 'isolation-allow';
  IF _n <> 0 THEN
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _keys FROM pg_proc p WHERE p.prosrc ~ _ref AND p.prosrc !~ 'isolation-allow';
    _bad := _bad || E'\n  G3 function bodies naming the production ref: ' || _keys;
  END IF;
  SELECT (SELECT count(*) FROM pg_attrdef d WHERE pg_get_expr(d.adbin, d.adrelid) ~ _ref)
       + (SELECT count(*) FROM pg_views v WHERE v.definition ~ _ref)
       + (SELECT count(*) FROM pg_matviews v WHERE v.definition ~ _ref)
       + (SELECT count(*) FROM pg_policies p WHERE coalesce(p.qual, '') || coalesce(p.with_check, '') ~ _ref)
       + (SELECT count(*) FROM pg_proc p WHERE array_to_string(p.proconfig, ',') ~ _ref)
       + (SELECT count(*) FROM pg_db_role_setting s WHERE array_to_string(s.setconfig, ',') ~ _ref)
       + (SELECT count(*) FROM net.http_request_queue q WHERE q.url ~ _ref)
    INTO _n;
  IF _n <> 0 THEN
    _bad := _bad || E'\n  G3 ' || _n || ' default/view/policy/setting/pending-request object(s) name the production ref';
  END IF;

  -- G4 · every text-like column of every public table
  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'json'::regtype, 'jsonb'::regtype,
                          'text[]'::regtype, 'varchar[]'::regtype)
     ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text ~ $1', r.tbl, r.col) INTO _hit USING _ref;
    IF _hit <> 0 THEN
      _bad := _bad || E'\n  G4 public.' || r.tbl || '.' || r.col || ': ' || _hit || ' row(s) name the production ref';
    END IF;
    _cols := _cols + 1;
  END LOOP;

  -- G5 · production hosts still in site_settings (NOTICE only; reported, not changed)
  SELECT string_agg(s.key, ', ' ORDER BY s.key) INTO _keys
    FROM public.site_settings s
   WHERE regexp_replace(lower(s.value::text), 'https?://(cdn-staging|staging)\.50mmretina\.com', '', 'g')
         ~ '50mmretina\.com';
  RAISE NOTICE 'G5 site_settings keys still carrying a production host on 50mmretina.com (known, not changed by 20261013_0003): %',
    coalesce(_keys, 'none');

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261013_0003:%', _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261013_0003: push_config names staging''s send-push; trigger path unchanged; production ref absent from site_settings, vault, cron, function bodies, defaults/views/policies/settings, pending pg_net requests and % public text columns',
    _cols;
END
$probe$;
ROLLBACK;
