-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261013_0002 — staging's auth.users triggers equal production's
-- Lane: STAGING ONLY. G0 refuses unless p32.lane = 'staging' (apply-migration.yml
-- sets it from target=staging).
-- READ-ONLY (BEGIN READ ONLY … ROLLBACK). Raises, and so fails the dispatch, on
-- any hit. Run on staging after 20261013_0002; a pass means auth.users on
-- staging carries exactly production's two user triggers, enabled, calling
-- production's function bodies. Before 20261013_0002 (or after its rollback) it
-- fails at G1 — that is its negative control.
--
--   G1 · the set of non-internal triggers on auth.users is exactly
--        {on_auth_user_created, on_auth_user_login_sync} — production's set.
--   G2 · pg_get_triggerdef() of each equals production's text, byte for byte
--        (collector, 2026-10-13 06:51Z, live/db/triggers.json), read with
--        search_path = public as production's text was.
--   G3 · each is enabled = 'O' (fires on origin and local), as on production.
--   G4 · each calls the public function production's calls (tgfoid), not a
--        same-named function in another schema.
--   G5 · public.handle_new_user() / public.sync_oauth_on_login(): md5(prosrc),
--        SECURITY DEFINER, search_path=public, returns trigger, plpgsql and
--        owner equal production's (same attributes as the migration's PRE-002),
--        so the triggers run production's bodies.
--   G6 · public.push_config.function_url is NULL or names staging's own
--        project (https://fpszggreishhuvdpkmdr.supabase.co/…), so the
--        'new_follower' push each sign-up now produces stays on staging.
--        Only the host is printed.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL search_path TO public;
DO $probe$
DECLARE
  r    record;
  _bad text := '';
BEGIN
  -- G0 · lane guard: these expectations describe staging only.
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION 'PROBE REFUSED 20261013_0002 — staging-only probe and p32.lane reads %. Dispatch apply-migration.yml with target=staging.',
      coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;

  -- G1 · exactly production's two user triggers on auth.users, no more, no fewer.
  FOR r IN
    SELECT coalesce(w.name, t.tgname::text) AS name, (w.name IS NULL) AS unexpected, (t.oid IS NULL) AS missing,
           pg_get_triggerdef(t.oid) AS def
      FROM (SELECT oid, tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal) t
      FULL JOIN (VALUES ('on_auth_user_created'), ('on_auth_user_login_sync')) AS w(name)
        ON w.name = t.tgname::text
     WHERE w.name IS NULL OR t.oid IS NULL
  LOOP
    IF r.missing THEN
      _bad := _bad || E'\n  G1 missing: ' || r.name;
    ELSE
      _bad := _bad || E'\n  G1 unexpected user trigger on auth.users: ' || r.def;
    END IF;
  END LOOP;

  -- G2–G4 · definition text, enabled state and called function, per trigger.
  FOR r IN
    SELECT w.name, w.want_def, w.want_fn, t.oid AS tg_oid, pg_get_triggerdef(t.oid) AS got_def,
           t.tgenabled::text AS got_enabled, t.tgfoid,
           to_regprocedure(w.want_fn) AS want_fn_oid
      FROM (VALUES
        ('on_auth_user_created',
         'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()',
         'public.handle_new_user()'),
        ('on_auth_user_login_sync',
         'CREATE TRIGGER on_auth_user_login_sync AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION sync_oauth_on_login()',
         'public.sync_oauth_on_login()')
      ) AS w(name, want_def, want_fn)
      LEFT JOIN pg_trigger t ON t.tgrelid = 'auth.users'::regclass AND t.tgname::text = w.name
     WHERE t.oid IS NOT NULL
  LOOP
    IF r.got_def IS DISTINCT FROM r.want_def THEN
      _bad := _bad || E'\n  G2 ' || r.name || ' reads ' || r.got_def || E'\n     expected ' || r.want_def;
    END IF;
    IF r.got_enabled IS DISTINCT FROM 'O' THEN
      _bad := _bad || E'\n  G3 ' || r.name || ' tgenabled = ' || r.got_enabled || ', expected O';
    END IF;
    IF r.want_fn_oid IS NULL OR r.tgfoid IS DISTINCT FROM r.want_fn_oid::oid THEN
      _bad := _bad || E'\n  G4 ' || r.name || ' calls ' || r.tgfoid::regprocedure::text || ', expected ' || r.want_fn;
    END IF;
  END LOOP;

  -- G5 · the called bodies are production's.
  FOR r IN
    SELECT v.fn, v.want_md5, p.oid AS fn_oid, md5(p.prosrc) AS got_md5, p.prosecdef,
           p.proconfig::text AS cfg, p.proowner::regrole::text AS owner,
           p.prorettype::regtype::text AS rettype, l.lanname
      -- (hash listed first: the gitleaks generic-api-key rule takes a name that
      --  contains the word auth followed by a hex literal for a credential)
      FROM (VALUES
        ('ca4a770bff3c438515f6edf9b977efbb', 'handle_new_user'),
        ('6c157691677358931ff05084c7fefee4', 'sync_oauth_on_login')
      ) AS v(want_md5, fn)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace AND p.proname::text = v.fn AND p.pronargs = 0
      LEFT JOIN pg_language l ON l.oid = p.prolang
  LOOP
    IF r.fn_oid IS NULL
       OR r.got_md5 IS DISTINCT FROM r.want_md5
       OR r.prosecdef IS DISTINCT FROM true
       OR r.cfg IS DISTINCT FROM '{search_path=public}'
       OR r.rettype IS DISTINCT FROM 'trigger'
       OR r.lanname IS DISTINCT FROM 'plpgsql'
       OR r.owner IS DISTINCT FROM 'postgres' THEN
      _bad := _bad || E'\n  G5 public.' || r.fn || '() differs from production (md5 ' || coalesce(r.got_md5, 'missing')
                   || ', definer ' || coalesce(r.prosecdef::text, '?') || ', config ' || coalesce(r.cfg, 'NULL')
                   || ', returns ' || coalesce(r.rettype, '?') || ', ' || coalesce(r.lanname, '?')
                   || ', owner ' || coalesce(r.owner, '?') || ')';
    END IF;
  END LOOP;

  -- G6 · staging push stays on staging.
  IF to_regclass('public.push_config') IS NOT NULL THEN
    FOR r IN
      SELECT coalesce(substring(pc.function_url FROM '^[a-zA-Z]+://([^/?#]+)'), '(unparseable)') AS host
        FROM public.push_config pc
       WHERE pc.function_url IS NOT NULL
         AND left(pc.function_url, length('https://fpszggreishhuvdpkmdr.supabase.co/'))
             IS DISTINCT FROM 'https://fpszggreishhuvdpkmdr.supabase.co/'
    LOOP
      _bad := _bad || E'\n  G6 public.push_config.function_url points at host ' || r.host
                   || ', expected NULL or fpszggreishhuvdpkmdr.supabase.co';
    END LOOP;
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261013_0002:%', _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261013_0002: auth.users carries exactly production''s two user triggers, definitions identical (pg_get_triggerdef), enabled, calling production''s handle_new_user / sync_oauth_on_login bodies; staging push stays on staging';
END
$probe$;
ROLLBACK;
