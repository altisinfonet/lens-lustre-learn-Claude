-- ═══════════════════════════════════════════════════════════════════════════
-- 20261028_0001 — S2-A Client telemetry (data layer).
--   One ledger for what members' devices measure: timings (feed RPC, post
--   open, uploads, hot RPCs), uncaught errors (window.onerror /
--   unhandledrejection), realtime subscribe status, and one row per app start
--   (the crash-rate denominator). Written ONLY through ONE authenticated,
--   rate-limited SECURITY DEFINER RPC; read ONLY by one admin aggregate RPC.
-- EXPAND step: new objects only; nothing existing is altered. The current
-- client keeps working (it simply does not send any of this yet).
-- Lanes: staging and production (refuses any other lane).
-- D1 (Database & Runtime), 2026-10-28. Master plan S2 "Observability".
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE (verbatim): "Owner can read, without an editor: feed p95 yesterday,
-- upload failure %, crash rate per build, egress/1k views"
-- This file supplies the first three (egress is measured from outside by
-- .github/workflows/d2-synthetic.yml, S2-B).
--
-- SHAPE REUSED FROM S12-F1 (20261018_0001): batched client writes, a WHERE
-- clause + caps as the control, a per-member rate bound, an hourly pg_cron
-- purge with a fixed retention, RLS on, grants revoked then granted exactly.
--
-- PRIVACY — WHAT A ROW DOES NOT HOLD
--   · No member id. The ledger cannot be joined back to a member at all. The
--     rate bound needs a member key, so it lives in a separate counter table
--     (client_telemetry_quota: member, hour, count) that is purged after two
--     hours and holds nothing else.
--   · No free text. An error is stored as its constructor name (letters only)
--     and an 8–16 hex-digit hash of its normalised message, computed on the
--     device. The route is the first path segment only ("/post/:x"), so no
--     post id, username or query string is stored. Every text column is held
--     to a strict pattern by a CHECK and by the RPC's WHERE clause.
--   · No client SELECT: authenticated and anon have no privilege on either
--     table. Only admin_health_daily (admin-checked) and service_role read.
--
-- DESIGN
--   1. public.client_telemetry — one row per event:
--        kind        'timing' | 'error' | 'realtime' | 'session'
--        metric      [a-z0-9_.:-]{1,64}   e.g. rpc.get_broadcast_feed,
--                    upload.photo, post.open, onerror, unhandledrejection,
--                    realtime.subscribed / .timed_out / .channel_error,
--                    app.start
--        ok          success flag (timings; false = failed / threw)
--        duration_ms 0 … 600,000 (timings only)
--        platform    'web' | 'android' | 'ios'
--        app_build   [A-Za-z0-9._+-]{1,40}
--        route       '/' or '/segment' or '/segment/:x'
--        error_name  [A-Za-z]{1,40}   (errors only)
--        error_hash  [0-9a-f]{8,16}   (errors only)
--        created_at  set by the server (now()); the client cannot date a row.
--   2. public.record_client_telemetry(_events jsonb) — the ONLY write path.
--        SECURITY DEFINER, VOLATILE, search_path ''. (SELECT auth.uid()) must
--        be a live account, else 0 rows. At most 50 events per call; at most
--        600 events per member per clock hour (the counter row is locked, so
--        concurrent batches cannot overshoot). Rows that do not match the
--        column patterns are DROPPED by the WHERE clause, not errored, so one
--        bad row never takes its batch with it; a malformed payload as a whole
--        returns 0. Returns the number of rows stored. EXECUTE: authenticated
--        only (revoked from PUBLIC and anon).
--   3. public.admin_health_daily(_days integer DEFAULT 7) — admin only
--        (has_role(auth.uid(),'admin'), else insufficient_privilege). STABLE,
--        read-only. Per UTC day, last _days (1…30) days:
--          timings  : metric, n, p50, p95, p99 (ms), failure % (ok = false)
--          builds   : platform, app_build, app starts, errors, crash rate
--                     (errors per 100 app starts)
--          realtime : subscribe attempts, failures, failure %
--          uploads  : photo + video attempts, failures, failure %
--        EXECUTE: authenticated only (the role check is the control).
--   4. public.purge_client_telemetry(_batch) — hourly (cron
--        'purge-client-telemetry', minute 17): ledger rows older than 30
--        days, quota rows older than 2 hours. Not callable by clients.
--   5. Volume bound: 600 rows/member/hour × 30 days. At today's ~100 members
--        and real usage (tens of events per session) this is thousands of
--        rows a day; the purge removes up to 100,000 per run (2.4 M/day).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _bad text := '';
BEGIN
  IF to_regclass('public.client_telemetry') IS NOT NULL
     OR to_regclass('public.client_telemetry_quota') IS NOT NULL
     OR to_regproc('public.record_client_telemetry') IS NOT NULL
     OR to_regproc('public.admin_health_daily') IS NOT NULL
     OR to_regproc('public.purge_client_telemetry') IS NOT NULL THEN
    RAISE EXCEPTION 'S2-0001-PRE-001: an S2 telemetry object already exists — 20261028_0001 is applied (or half-applied by hand)'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.has_role(uuid, public.app_role)') IS NULL THEN _bad := _bad || E'\n  public.has_role(uuid, app_role) missing'; END IF;
  IF to_regprocedure('public.account_is_live()') IS NULL THEN _bad := _bad || E'\n  public.account_is_live() missing'; END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN _bad := _bad || E'\n  auth.uid() missing'; END IF;
  IF to_regclass('auth.users') IS NULL THEN _bad := _bad || E'\n  auth.users missing'; END IF;
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN _bad := _bad || E'\n  pg_cron (cron.schedule) missing'; END IF;
  IF to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-client-telemetry') THEN
    _bad := _bad || E'\n  cron job purge-client-telemetry already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    _bad := _bad || E'\n  role anon / authenticated / service_role missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S2-0001-PRE-002: prerequisites missing:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the ledger and the rate counter ─────────────────────────────────────
CREATE TABLE public.client_telemetry (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text        NOT NULL CHECK (kind IN ('timing', 'error', 'realtime', 'session')),
  metric       text        NOT NULL CHECK (metric ~ '^[a-z0-9_.:-]{1,64}$'),
  ok           boolean,
  duration_ms  integer     CHECK (duration_ms BETWEEN 0 AND 600000),
  platform     text        NOT NULL CHECK (platform IN ('web', 'android', 'ios')),
  app_build    text        NOT NULL CHECK (app_build ~ '^[A-Za-z0-9._+-]{1,40}$'),
  route        text        CHECK (route ~ '^/([a-z0-9_-]{1,40}(/:x)?)?$'),
  error_name   text        CHECK (error_name ~ '^[A-Za-z]{1,40}$'),
  error_hash   text        CHECK (error_hash ~ '^[0-9a-f]{8,16}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_telemetry_shape CHECK (
       (kind = 'timing'   AND duration_ms IS NOT NULL AND ok IS NOT NULL AND error_hash IS NULL)
    OR (kind = 'error'    AND duration_ms IS NULL AND error_hash IS NOT NULL)
    OR (kind = 'realtime' AND duration_ms IS NULL AND error_hash IS NULL)
    OR (kind = 'session'  AND duration_ms IS NULL AND error_hash IS NULL)
  )
);
COMMENT ON TABLE public.client_telemetry IS
  'S2-A client telemetry ledger: timings, uncaught errors (name + message hash, no text), realtime subscribe status, app starts. No member id, no free text. Written only by record_client_telemetry (600/member/hour); read only by admin_health_daily and service_role. Kept 30 days (purge_client_telemetry).';
CREATE INDEX client_telemetry_created_brin ON public.client_telemetry USING brin (created_at);
CREATE INDEX client_telemetry_kind_created_idx ON public.client_telemetry (kind, created_at);

CREATE TABLE public.client_telemetry_quota (
  user_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  hour      timestamptz NOT NULL,
  n         integer     NOT NULL DEFAULT 0 CHECK (n BETWEEN 0 AND 600),
  PRIMARY KEY (user_id, hour)
);
COMMENT ON TABLE public.client_telemetry_quota IS
  'S2-A rate bound for record_client_telemetry: events accepted per member per clock hour (cap 600). Holds nothing else; purged after 2 hours.';

-- ── 2. the one write path ──────────────────────────────────────────────────
CREATE FUNCTION public.record_client_telemetry(_events jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  _uid   uuid := (SELECT auth.uid());
  _hour  timestamptz := date_trunc('hour', now());
  _used  integer;
  _room  integer;
  _n     integer := 0;
BEGIN
  IF _uid IS NULL OR NOT coalesce((SELECT public.account_is_live()), false) THEN
    RETURN 0;
  END IF;
  IF _events IS NULL OR jsonb_typeof(_events) <> 'array' OR jsonb_array_length(_events) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.client_telemetry_quota (user_id, hour, n) VALUES (_uid, _hour, 0)
  ON CONFLICT (user_id, hour) DO NOTHING;
  SELECT q.n INTO _used FROM public.client_telemetry_quota q
   WHERE q.user_id = _uid AND q.hour = _hour FOR UPDATE;
  _room := LEAST(50, 600 - coalesce(_used, 600));
  IF _room <= 0 THEN
    RETURN 0;
  END IF;

  BEGIN
    INSERT INTO public.client_telemetry
      (kind, metric, ok, duration_ms, platform, app_build, route, error_name, error_hash)
    SELECT e.kind, e.metric, e.ok, round(e.duration_ms)::integer, e.platform, e.app_build,
           e.route, e.error_name, e.error_hash
      FROM (SELECT x.* FROM jsonb_array_elements(_events) WITH ORDINALITY AS a(v, i),
                 LATERAL jsonb_to_record(CASE WHEN jsonb_typeof(a.v) = 'object' THEN a.v ELSE '{}'::jsonb END)
                   AS x(kind text, metric text, ok boolean, duration_ms numeric, platform text,
                        app_build text, route text, error_name text, error_hash text)
             WHERE a.i <= 50) e
     WHERE e.kind IN ('timing', 'error', 'realtime', 'session')
       AND e.metric ~ '^[a-z0-9_.:-]{1,64}$'
       AND e.platform IN ('web', 'android', 'ios')
       AND e.app_build ~ '^[A-Za-z0-9._+-]{1,40}$'
       AND (e.route IS NULL OR e.route ~ '^/([a-z0-9_-]{1,40}(/:x)?)?$')
       AND (e.error_name IS NULL OR e.error_name ~ '^[A-Za-z]{1,40}$')
       AND (e.error_hash IS NULL OR e.error_hash ~ '^[0-9a-f]{8,16}$')
       AND (   (e.kind = 'timing' AND e.duration_ms BETWEEN 0 AND 600000 AND e.ok IS NOT NULL AND e.error_hash IS NULL)
            OR (e.kind = 'error' AND e.duration_ms IS NULL AND e.error_hash IS NOT NULL)
            OR (e.kind IN ('realtime', 'session') AND e.duration_ms IS NULL AND e.error_hash IS NULL))
     LIMIT _room;
    GET DIAGNOSTICS _n = ROW_COUNT;
  EXCEPTION WHEN data_exception OR check_violation OR not_null_violation THEN
    -- A payload whose values cannot even be typed (e.g. "ok": "maybe") is
    -- dropped whole; telemetry never raises at a member's device.
    RETURN 0;
  END;

  UPDATE public.client_telemetry_quota q SET n = q.n + _n
   WHERE q.user_id = _uid AND q.hour = _hour;
  RETURN _n;
END;
$fn$;

-- ── 3. the one read path (admin) ───────────────────────────────────────────
CREATE FUNCTION public.admin_health_daily(_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  _uid  uuid := (SELECT auth.uid());
  _d    integer := GREATEST(1, LEAST(coalesce(_days, 7), 30));
  _from timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - make_interval(days => _d - 1);
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'S2HEALTH-001: only an admin can read app health' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'days', _d,
    'timings', coalesce((
      SELECT jsonb_agg(t ORDER BY t.day DESC, t.metric) FROM (
        SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, c.metric, count(*) AS n,
               round(percentile_cont(0.50) WITHIN GROUP (ORDER BY c.duration_ms))::integer AS p50,
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY c.duration_ms))::integer AS p95,
               round(percentile_cont(0.99) WITHIN GROUP (ORDER BY c.duration_ms))::integer AS p99,
               round(100.0 * count(*) FILTER (WHERE NOT c.ok) / count(*), 2) AS fail_pct
          FROM public.client_telemetry c
         WHERE c.kind = 'timing' AND c.created_at >= _from
         GROUP BY 1, 2) t), '[]'::jsonb),
    'builds', coalesce((
      SELECT jsonb_agg(b ORDER BY b.day DESC, b.starts DESC) FROM (
        SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, c.platform, c.app_build,
               count(*) FILTER (WHERE c.kind = 'session') AS starts,
               count(*) FILTER (WHERE c.kind = 'error') AS errors,
               CASE WHEN count(*) FILTER (WHERE c.kind = 'session') = 0 THEN NULL
                    ELSE round(100.0 * count(*) FILTER (WHERE c.kind = 'error')
                               / count(*) FILTER (WHERE c.kind = 'session'), 2) END AS errors_per_100_starts
          FROM public.client_telemetry c
         WHERE c.kind IN ('session', 'error') AND c.created_at >= _from
         GROUP BY 1, 2, 3) b), '[]'::jsonb),
    'realtime', coalesce((
      SELECT jsonb_agg(r ORDER BY r.day DESC) FROM (
        SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS attempts,
               count(*) FILTER (WHERE c.metric <> 'realtime.subscribed') AS failures,
               round(100.0 * count(*) FILTER (WHERE c.metric <> 'realtime.subscribed') / count(*), 2) AS fail_pct
          FROM public.client_telemetry c
         WHERE c.kind = 'realtime' AND c.created_at >= _from
         GROUP BY 1) r), '[]'::jsonb),
    'uploads', coalesce((
      SELECT jsonb_agg(u ORDER BY u.day DESC) FROM (
        SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS attempts,
               count(*) FILTER (WHERE NOT c.ok) AS failures,
               round(100.0 * count(*) FILTER (WHERE NOT c.ok) / count(*), 2) AS fail_pct
          FROM public.client_telemetry c
         WHERE c.kind = 'timing' AND c.metric IN ('upload.photo', 'upload.video') AND c.created_at >= _from
         GROUP BY 1) u), '[]'::jsonb)
  );
END;
$fn$;

-- ── 4. the hourly purge ────────────────────────────────────────────────────
CREATE FUNCTION public.purge_client_telemetry(_batch integer DEFAULT 100000)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO ''
AS $fn$
DECLARE
  _b integer := GREATEST(1, LEAST(coalesce(_batch, 100000), 1000000));
  _t integer;
  _q integer;
BEGIN
  DELETE FROM public.client_telemetry
   WHERE id = ANY (ARRAY(SELECT id FROM public.client_telemetry
                          WHERE created_at < now() - interval '30 days' LIMIT _b));
  GET DIAGNOSTICS _t = ROW_COUNT;
  DELETE FROM public.client_telemetry_quota WHERE hour < now() - interval '2 hours';
  GET DIAGNOSTICS _q = ROW_COUNT;
  RETURN jsonb_build_object('client_telemetry', _t, 'client_telemetry_quota', _q);
END;
$fn$;

-- ── 5. privacy: RLS on, no client policies, grants exact ───────────────────
ALTER TABLE public.client_telemetry       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_telemetry_quota ENABLE ROW LEVEL SECURITY;
-- No policy: authenticated/anon would see nothing even if a grant appeared.

REVOKE ALL ON TABLE public.client_telemetry, public.client_telemetry_quota FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.client_telemetry, public.client_telemetry_quota TO service_role;

REVOKE ALL ON FUNCTION public.record_client_telemetry(jsonb), public.admin_health_daily(integer),
  public.purge_client_telemetry(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_telemetry(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_health_daily(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_client_telemetry(integer) TO service_role;

SELECT cron.schedule('purge-client-telemetry', '17 * * * *', $cmd$SELECT public.purge_client_telemetry();$cmd$);

DO $postconditions$
DECLARE
  _bad text := '';
  r    record;
BEGIN
  -- POST-001 · RLS on, and no policy at all on either table.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.client_telemetry'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.client_telemetry_quota'::regclass) THEN
    _bad := _bad || E'\n  RLS not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND tablename IN ('client_telemetry', 'client_telemetry_quota')) THEN
    _bad := _bad || E'\n  a policy exists on a telemetry table';
  END IF;
  -- POST-002 · no table privilege for anon or authenticated.
  FOR r IN SELECT t, p FROM unnest(ARRAY['client_telemetry', 'client_telemetry_quota']) t,
                            unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p LOOP
    IF has_table_privilege('anon', 'public.' || r.t, r.p) OR has_table_privilege('authenticated', 'public.' || r.t, r.p) THEN
      _bad := _bad || E'\n  anon/authenticated has ' || r.p || ' on ' || r.t;
    END IF;
  END LOOP;
  -- POST-003 · function attributes and EXECUTE.
  FOR r IN SELECT f, definer, vol, auth_ok FROM (VALUES
      ('public.record_client_telemetry(jsonb)', true, 'v', true),
      ('public.admin_health_daily(integer)', true, 's', true),
      ('public.purge_client_telemetry(integer)', false, 'v', false)) v(f, definer, vol, auth_ok) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = r.f::regprocedure AND p.prosecdef = r.definer
                     AND p.provolatile = r.vol AND p.proconfig = ARRAY['search_path=""']) THEN
      _bad := _bad || E'\n  ' || r.f || ': attributes differ';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.auth_ok
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = r.f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  ' || r.f || ': EXECUTE grants differ (PUBLIC/anon must be none)';
    END IF;
  END LOOP;
  -- POST-004 · the purge is scheduled.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-client-telemetry' AND schedule = '17 * * * *') THEN
    _bad := _bad || E'\n  cron job purge-client-telemetry missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S2-0001-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S2-0001: client_telemetry (30 d, no member id, no free text) + client_telemetry_quota (2 h); RLS on, no client privilege; record_client_telemetry (authenticated, 50/call, 600/member/hour); admin_health_daily (admin only); purge-client-telemetry hourly';
END
$postconditions$;

COMMIT;
