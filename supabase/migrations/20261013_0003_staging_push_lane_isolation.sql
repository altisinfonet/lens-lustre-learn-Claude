-- ═══════════════════════════════════════════════════════════════════════════
-- 20261013_0003 — staging: point the push trigger at staging's own send-push
-- Lane: STAGING ONLY (fpszggreishhuvdpkmdr). Refuses any other lane.
-- D1 (Database & Runtime), 2026-10-13. Code only until applied through
-- apply-migration.yml with target=staging.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY. Staging's public.push_config has one row, and its function_url names
-- PRODUCTION's send-push edge function:
--     https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push
-- (updated_at 2026-07-31 10:52:12.705409+00 — the row came across with data
-- copied from production before the staging lane existed). Every row inserted
-- into staging's public.user_notifications fires trg_push_on_notification,
-- which posts to that URL. So staging notifications are delivered to
-- production's push sender: a cross-lane path that must not exist.
--   Measured on staging, read-only, 2026-10-13: 51 user_notifications rows
--   (2026-09-11 14:42Z .. 2026-09-14 14:24Z, 2 recipients, none self-actored),
--   each of which took that path; none since. net._http_response keeps only a
--   few hours, so what production answered cannot be read from staging.
--
-- WHAT THIS FILE DOES — and nothing else:
--   UPDATE public.push_config SET function_url = staging's own send-push
--     https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push
--   and updated_at = now(). internal_secret is NOT read, printed or changed.
--   No function, trigger, grant, policy or other row is touched.
--   Staging's send-push is deployed (list_edge_functions on staging,
--   2026-10-13: slug send-push, ACTIVE, version 4, verify_jwt true).
--
-- WHY A REFUSAL FROM THE NEW TARGET IS HARMLESS (PRE-003 re-checks each fact):
--   * push_config has exactly one reader in the database:
--     public.push_on_notification(), the AFTER INSERT FOR EACH ROW trigger
--     function of public.user_notifications (trg_push_on_notification).
--   * It hands the request to pg_net (PERFORM net.http_post). pg_net only
--     queues it; the HTTP call is made by pg_net's worker after the inserting
--     transaction commits, and the answer lands in net._http_response. A 401
--     or any other refusal therefore never reaches the INSERT.
--   * Anything that does raise inside the function is caught by its own
--     EXCEPTION WHEN OTHERS handler, which logs and RETURNs NEW.
--   What will happen after this file: staging's send-push is deployed with
--   verify_jwt = true and the trigger sends no Authorization header, so the
--   Supabase gateway answers 401 before the function runs. Staging push stays
--   inert (it was never meant to deliver through production). Making staging
--   push deliver on its own lane is a separate unit (send-push deploy setting,
--   a staging-only shared value on both sides, staging FCM credentials).
--   Setting function_url to NULL was considered: the trigger short-circuits on
--   NULL, but the column is NOT NULL on staging (and in 20260731100000), so it
--   would need DDL that makes staging's schema differ from production's. A
--   staging-own URL keeps the schema identical and isolates the lane.
--
-- LANE-LEAK SCAN (staging, read-only, 2026-10-13) — production ref
-- jtdtehuqtinjxropkkcn and production hosts on 50mmretina.com:
--   push_config.function_url ........ production ref — CHANGED here.
--   every text/varchar/json/jsonb/text[] column of every public table ....
--     no other row names the production ref.
--   function bodies (all schemas) ... none name the production ref.
--   vault secrets ................... none name the production ref (booleans
--                                     only; the p9_cron_http:* targets name
--                                     staging's ref).
--   cron.job commands ............... none (no literal URL in any command).
--   column defaults, views, policies, comments, function/role settings,
--   trigger arguments, foreign servers, pending pg_net requests, storage
--   object metadata, auth user metadata, migration history .... none.
--   site_settings ................... no production ref. Production HOSTS do
--     appear, and are deliberately NOT changed (they are not a call path from
--     staging's database, and repointing them could break pages):
--       cdn.50mmretina.com image URLs — ad_slots[].image_url (9),
--         ad_slots_backup_20260723[].image_url (9),
--         ad_zones_v2 .lightbox.own.image_url / .rewarded.own.image_url,
--         managed_pages[].og_image (6) and [].json_ld (6),
--         seo_global.default_og_image, seo_pages[].og_image (7);
--       smtp_settings.from_email — an address on the 50mmretina.com domain
--         (no email worker is wired on staging).
--     Reported in the PR for an Owner decision; not part of this file.
--
-- LOCK. The UPDATE takes ROW EXCLUSIVE on push_config and a row lock on its
-- single row. The trigger only SELECTs push_config, and a plain SELECT never
-- waits for a row lock, so notification inserts are not blocked. lock_timeout
-- 5s bounds any wait; on timeout nothing is applied — re-dispatch.
--
-- RE-RUN: idempotent. A row that already names staging's send-push is left
-- as it is (NOTICE, 0 rows). A row naming anything other than production's or
-- staging's send-push is refused (PRE-002), never overwritten.
-- ROLLBACK: supabase/rollback/20261013_0003_staging_push_lane_isolation_ROLLBACK.sql
--           (restores the production URL, i.e. RE-OPENS the cross-lane path)
-- PROBE:    supabase/migrations/PROBE_20261013_0003_staging_push_lane_isolation.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'APPLY REFUSED — this file is for STAGING only and p32.lane reads %. '
      'Dispatch apply-migration.yml with target=staging (it sets p32.lane = ''staging'').',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _prod_url    constant text := 'https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push';
  _staging_url constant text := 'https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push';
  _n    int;
  _url  text;
  r     record;
BEGIN
  -- PRE-001 · push_config is the table this file was written against:
  --           owned by the migration role, RLS not forced (so the owner's
  --           UPDATE is not filtered), no user trigger, one row, both text
  --           columns NOT NULL.
  IF to_regclass('public.push_config') IS NULL THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-001: public.push_config does not exist' USING ERRCODE = 'raise_exception';
  END IF;
  SELECT c.relowner::regrole::text AS owner, c.relforcerowsecurity AS forced
    INTO r FROM pg_class c WHERE c.oid = 'public.push_config'::regclass;
  IF r.owner IS DISTINCT FROM current_user OR r.forced THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-001: push_config owner % (migration role %), FORCE RLS % — refusing',
      r.owner, current_user, r.forced USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO _n FROM pg_trigger t WHERE t.tgrelid = 'public.push_config'::regclass AND NOT t.tgisinternal;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-001: push_config carries % user trigger(s); this file was written against none', _n
    USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO _n
    FROM pg_attribute a
   WHERE a.attrelid = 'public.push_config'::regclass AND NOT a.attisdropped AND a.attnotnull
     AND a.atttypid = 'text'::regtype AND a.attname IN ('function_url', 'internal_secret');
  IF _n <> 2 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-001: push_config.function_url / internal_secret are not both text NOT NULL (% of 2)', _n
    USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO _n FROM public.push_config;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-001: push_config holds % row(s); exactly 1 expected', _n USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-002 · function_url is production's send-push (to be repointed) or
  --           already staging's (re-run). Anything else is refused.
  SELECT function_url INTO _url FROM public.push_config WHERE id;
  IF _url IS DISTINCT FROM _prod_url AND _url IS DISTINCT FROM _staging_url THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-002: push_config.function_url names host % — neither production''s nor staging''s send-push; re-read staging, refusing',
      coalesce(substring(_url from '^https?://([^/]+)'), '(unparseable)') USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-003 · the trigger path tolerates a refusal from the new target (see header).
  SELECT count(*) INTO _n FROM pg_proc p WHERE p.prosrc ~ 'push_config';
  IF _n <> 1 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-003: % function bodies name push_config; exactly 1 (push_on_notification) expected — re-check every reader',
      _n USING ERRCODE = 'raise_exception';
  END IF;
  SELECT p.oid, p.prosecdef, p.prorettype = 'trigger'::regtype AS is_trigger_fn,
         p.prosrc ~ 'push_config' AS reads_cfg,
         p.prosrc ~ 'PERFORM\s+net\.http_post\s*\(' AS queues_via_pg_net,
         p.prosrc ~ 'EXCEPTION\s+WHEN\s+OTHERS\s+THEN' AS catches_all,
         p.prosrc ~ 'url\s*:=\s*_cfg\.function_url' AS posts_to_cfg_url
    INTO r
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.push_on_notification()');
  IF r.oid IS NULL OR NOT r.reads_cfg OR NOT r.is_trigger_fn OR NOT r.queues_via_pg_net
     OR NOT r.catches_all OR NOT r.posts_to_cfg_url THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-003: public.push_on_notification() is missing, or no longer queues through pg_net inside a catch-all handler (exists %, trigger fn %, reads cfg %, pg_net %, catch-all %, posts cfg url %)',
      r.oid IS NOT NULL, r.is_trigger_fn, r.reads_cfg, r.queues_via_pg_net, r.catches_all, r.posts_to_cfg_url
    USING ERRCODE = 'raise_exception';
  END IF;
  -- tgtype 5 = FOR EACH ROW (1) + INSERT (4), no BEFORE bit (2): AFTER INSERT FOR EACH ROW.
  SELECT count(*) INTO _n
    FROM pg_trigger t
   WHERE t.tgfoid = 'public.push_on_notification()'::regprocedure AND NOT t.tgisinternal;
  IF _n <> 1 OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgfoid = 'public.push_on_notification()'::regprocedure AND NOT t.tgisinternal
          AND t.tgrelid = 'public.user_notifications'::regclass
          AND t.tgname = 'trg_push_on_notification' AND t.tgtype = 5) THEN
    RAISE EXCEPTION 'PUSHLANE-0003-PRE-003: push_on_notification() is not attached exactly once as trg_push_on_notification AFTER INSERT FOR EACH ROW on public.user_notifications (% attachment(s))',
      _n USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'PUSHLANE-0003 PRE: push_config 1 row, function_url = % send-push; sole reader push_on_notification() queues via pg_net inside a catch-all',
    CASE WHEN _url = _prod_url THEN 'PRODUCTION''s' ELSE 'staging''s (re-run)' END;
END
$preconditions$;

DO $apply$
DECLARE
  _prod_url    constant text := 'https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push';
  _staging_url constant text := 'https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push';
  _fp_before text;
  _fp_after  text;
  _rows      int;
BEGIN
  -- POST-002 needs the other column's state before and after. It is reduced
  -- to a fingerprint inside this block and only ever compared, never output.
  SELECT md5(c.internal_secret) INTO _fp_before FROM public.push_config c WHERE c.id;

  UPDATE public.push_config
     SET function_url = _staging_url,
         updated_at   = now()
   WHERE id
     AND function_url = _prod_url;
  GET DIAGNOSTICS _rows = ROW_COUNT;

  SELECT md5(c.internal_secret) INTO _fp_after FROM public.push_config c WHERE c.id;
  IF _fp_after IS NULL OR _fp_after IS DISTINCT FROM _fp_before THEN
    RAISE EXCEPTION 'PUSHLANE-0003-POST-002: the other push_config column changed or became NULL — this file must leave it exactly as it was'
    USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'PUSHLANE-0003: % row(s) repointed to staging''s send-push (0 = already staging)', _rows;
END
$apply$;

DO $postconditions$
DECLARE
  _staging_url constant text := 'https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push';
  _n int;
BEGIN
  -- POST-001 · exactly one row, naming staging's own send-push, no production ref in any column of it.
  SELECT count(*) INTO _n FROM public.push_config;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-POST-001: push_config holds % row(s); exactly 1 expected', _n USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO _n FROM public.push_config c
   WHERE c.id AND c.function_url = _staging_url AND c.internal_secret IS NOT NULL
     AND NOT (c::text ~ 'jtdtehuqtinjxropkkcn');
  IF _n <> 1 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-POST-001: push_config does not name staging''s send-push, or still names the production ref'
    USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'PUSHLANE-0003 POST: push_config.function_url = staging send-push; production ref absent from push_config; other column unchanged';
END
$postconditions$;

COMMIT;
