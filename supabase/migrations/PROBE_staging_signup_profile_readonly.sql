-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · staging_signup_profile (read-only) — every sign-up made on staging
--         since 20261013_0002 was applied has its public.profiles row, and
--         push_config names staging's own send-push
-- Lane: STAGING ONLY. G0 refuses unless p32.lane = 'staging' (apply-migration.yml
-- sets it from target=staging). The expected values below describe staging; on
-- production they would be wrong by design.
-- READ-ONLY (BEGIN READ ONLY … ROLLBACK). It only reads: pg_trigger, the rows
-- of auth.users and public.profiles, and public.push_config.function_url.
-- Nothing is changed, and the read-only transaction would refuse a change.
-- Raises, and so fails the dispatch, on any hit.
-- PRIVACY. Output is counts, booleans, timestamps (to the second) and a project
-- ref / host name only. No email, user id, name or metadata is selected, and
-- push_config.internal_secret is never read (function_url is the only column
-- of that table this file names).
--
-- WHY. 20261013_0002 put on_auth_user_created back on staging's auth.users, so
-- a sign-up should again get its profiles row from public.handle_new_user().
-- PROBE_20261013_0002 proves the trigger and its function are production's. It
-- cannot prove that a real sign-up produced a row. This file reads the result
-- of one: sign up once on staging.50mmretina.com, then dispatch it.
--   Join key: handle_new_user() does INSERT INTO public.profiles (id, …)
--   VALUES (NEW.id, …) (20260805120000_fallback_avatar_at_registration.sql;
--   production's body is in docs/evidence/d1/staging-auth-triggers-20261013/),
--   and profiles.id is the primary key referencing auth.users(id). So "has a
--   profile" is profiles.id = auth.users.id.
--
-- CUT-OFF 2026-10-13 12:05:39+00 is the moment run 38394785921 (the staging
-- apply of 20261013_0002) was dispatched. Its psql session committed the
-- triggers about 22 s later (COMMIT logged 12:06:01Z). Every sign-up made with
-- the trigger in place is therefore at/after the cut-off, and a PASS covers all
-- of them. The other direction: a sign-up inside those 22 s had no trigger yet
-- and would be reported by S3 — the S3 failure line gives the created_at range
-- of the rows it found so that case can be told apart.
--
--   S0 · the three relations read below exist, and the connecting role sees
--        all their rows (row security is not active for it). Otherwise the
--        counts would be of a filtered view and a wrong "no sign-up" or
--        "no profile" could be printed. Fails at once, before any count.
--   S1 · NOTICE: number of non-internal triggers on auth.users; whether
--        on_auth_user_created exists and is enabled for ordinary sessions
--        (tgenabled O or A). FAIL if it is missing or not enabled.
--   S2 · NOTICE only: count(auth.users), count(public.profiles), and the
--        auth.users rows with no profiles row, all-time. Rows from before the
--        trigger existed are expected here — context, not a verdict.
--   S3 · the behaviour check. n_new = auth.users rows created at/after the
--        cut-off; n_new_missing = those with no profiles row.
--        FAIL if n_new_missing > 0.
--   S4 · NOTICE + check: push_config row count and the project ref parsed
--        from function_url. FAIL if function_url names the production ref
--        jtdtehuqtinjxropkkcn, or is not exactly
--        https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push
--        (no row at all counts as "not exactly").
--
-- THREE OUTCOMES — read the last line of the run:
--   PROBE FAIL …          exception, the dispatch goes red: any S0–S4 hit.
--   PROBE INCONCLUSIVE …  notice, the dispatch stays green: S1 and S4 hold but
--                         n_new = 0 — nobody has signed up since the cut-off,
--                         so the behaviour is NOT proven. A green run ending in
--                         this line is not a pass.
--   PROBE PASS …          notice: n_new ≥ 1, each has a profiles row, the
--                         trigger is enabled and push_config names staging.
--
-- Rehearsed fail-first on PGlite:
--   docs/evidence/d1/staging-signup-profile-probe-20261013/
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  _cutoff      constant timestamptz := timestamptz '2026-10-13 12:05:39+00';
  _staging_url constant text := 'https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push';
  _prod_ref    constant text := 'jtdtehuqtinjxropkkcn';
  _ts_fmt      constant text := 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
  _lane        constant text := coalesce(nullif(current_setting('p32.lane', true), ''), '(unset)');
  r              record;
  _bad           text := '';
  _n_trg         int;
  _tg_enabled    text;
  _tg_exists     boolean;
  _n_users       bigint;
  _n_profiles    bigint;
  _n_missing     bigint;
  _n_new         bigint;
  _n_new_missing bigint;
  _n_undated     bigint;
  _newest        timestamptz;
  _miss_first    timestamptz;
  _miss_last     timestamptz;
BEGIN
  -- G0 · lane guard: these expectations describe staging only.
  IF _lane <> 'staging' THEN
    RAISE EXCEPTION 'PROBE REFUSED staging_signup_profile — staging-only probe and p32.lane reads %. Dispatch apply-migration.yml with target=staging.',
      _lane;
  END IF;

  -- S0 · the relations exist and are read unfiltered.
  FOR r IN
    SELECT w.name, to_regclass(w.name) AS rel
      FROM (VALUES ('auth.users'), ('public.profiles'), ('public.push_config')) AS w(name)
  LOOP
    IF r.rel IS NULL THEN
      _bad := _bad || E'\n  S0 ' || r.name || ' does not exist';
    ELSIF row_security_active(r.rel::oid) THEN
      _bad := _bad || E'\n  S0 row security is active on ' || r.name
                   || ' for the connecting role — its rows would be filtered, so no count below would be the table''s';
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL staging_signup_profile (nothing was counted, nothing is concluded):%', _bad;
  END IF;

  -- S1 · the sign-up trigger is there and fires.
  SELECT count(*)::int INTO _n_trg
    FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal;
  SELECT t.tgenabled::text INTO _tg_enabled
    FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
     AND t.tgname = 'on_auth_user_created';
  _tg_exists := FOUND;
  RAISE NOTICE 'S1 auth.users: % non-internal trigger(s); on_auth_user_created exists = %, enabled = % (tgenabled %)',
    _n_trg, _tg_exists::text, (_tg_exists AND _tg_enabled IN ('O', 'A'))::text, coalesce(_tg_enabled, 'n/a');
  IF NOT _tg_exists THEN
    _bad := _bad || E'\n  S1 on_auth_user_created is missing from auth.users — a sign-up creates no profiles row';
  ELSIF _tg_enabled NOT IN ('O', 'A') THEN
    _bad := _bad || E'\n  S1 on_auth_user_created is not enabled for ordinary sessions (tgenabled ' || _tg_enabled || ')';
  END IF;

  -- S2 · all-time totals (context only).
  SELECT count(*), count(*) FILTER (WHERE p.id IS NULL)
    INTO _n_users, _n_missing
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id;
  SELECT count(*) INTO _n_profiles FROM public.profiles;
  RAISE NOTICE 'S2 auth.users rows = %, public.profiles rows = %, auth.users rows with no profiles row = % (all-time; context only — rows from before the trigger existed are expected here)',
    _n_users, _n_profiles, _n_missing;

  -- S3 · sign-ups since the cut-off, and how many of them have no profile.
  SELECT count(*), count(*) FILTER (WHERE p.id IS NULL), max(u.created_at),
         min(u.created_at) FILTER (WHERE p.id IS NULL), max(u.created_at) FILTER (WHERE p.id IS NULL)
    INTO _n_new, _n_new_missing, _newest, _miss_first, _miss_last
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.created_at >= _cutoff;
  SELECT count(*) INTO _n_undated FROM auth.users u WHERE u.created_at IS NULL;
  RAISE NOTICE 'S3 cut-off % (staging apply of 20261013_0002, run 38394785921): n_new = % sign-up(s) at/after it, n_new_missing = % of them with no profiles row; auth.users rows with no created_at (cannot be placed, not counted) = %',
    to_char(_cutoff AT TIME ZONE 'UTC', _ts_fmt), _n_new, _n_new_missing, _n_undated;
  IF _n_new_missing > 0 THEN
    _bad := _bad || E'\n  S3 ' || _n_new_missing || ' of ' || _n_new
                 || ' sign-up(s) since the cut-off have no profiles row (created between '
                 || to_char(_miss_first AT TIME ZONE 'UTC', _ts_fmt) || ' and '
                 || to_char(_miss_last AT TIME ZONE 'UTC', _ts_fmt) || ')';
  END IF;

  -- S4 · staging push stays on staging. function_url is the only column read;
  --      of it, only the project ref (or the bare host) is printed.
  SELECT count(*) AS n_rows,
         count(*) FILTER (WHERE c.function_url = _staging_url) AS n_staging,
         count(*) FILTER (WHERE position(_prod_ref IN lower(c.function_url)) > 0) AS n_prod,
         string_agg(DISTINCT coalesce(substring(c.host FROM '^([a-z0-9]+)\.supabase\.co$'),
                                      '(no project ref; host ' || coalesce(nullif(c.host, ''), 'unparseable') || ')'),
                    ', ') AS refs
    INTO r
    FROM (SELECT pc.function_url,
                 lower(regexp_replace(regexp_replace(
                   substring(pc.function_url FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]*)'),
                   '^.*@', ''), ':[0-9]*$', '')) AS host
            FROM public.push_config pc) c;
  RAISE NOTICE 'S4 public.push_config: % row(s); project ref parsed from function_url: %; exactly staging''s send-push = %; names the production ref = %',
    r.n_rows, coalesce(r.refs, '(no row)'), (r.n_rows > 0 AND r.n_staging = r.n_rows)::text, (r.n_prod > 0)::text;
  IF r.n_prod > 0 THEN
    _bad := _bad || E'\n  S4 push_config.function_url names the production project ' || _prod_ref
                 || ' — a staging notification would be pushed through production';
  END IF;
  IF r.n_rows = 0 OR r.n_staging <> r.n_rows THEN
    _bad := _bad || E'\n  S4 push_config.function_url is not exactly ' || _staging_url
                 || ' (rows ' || r.n_rows || '; parsed ' || coalesce(r.refs, 'nothing') || ')';
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL staging_signup_profile:%', _bad;
  END IF;
  IF _n_new = 0 THEN
    RAISE NOTICE 'PROBE INCONCLUSIVE: no sign-up since the cut-off — nothing proven yet (this is NOT a pass: sign up once on staging.50mmretina.com, then dispatch this file again)';
  ELSE
    RAISE NOTICE 'PROBE PASS: % sign-up(s) since the cut-off, each has a profiles row; newest sign-up at %',
      _n_new, to_char(_newest AT TIME ZONE 'UTC', _ts_fmt);
  END IF;
END
$probe$;
ROLLBACK;
