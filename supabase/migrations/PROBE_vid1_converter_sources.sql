-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 converter job queue (20261012_0002). READ-ONLY. Ends in ROLLBACK.
--   C1 · tables video_sources, video_source_events, video_converter_accounts
--        exist, RLS on; the status machine, one-video-per-source and
--        owner+key uniqueness constraints are there; the touch and
--        append-only triggers are attached.
--   C2 · API roles: members read their own sources on the allowed columns
--        only — never claim_token, source_etag, lease_until; no INSERT /
--        UPDATE / DELETE; anon nothing; events and converter accounts are not
--        reachable by any API role.
--   C3 · every new function is SECURITY DEFINER with search_path ''; the
--        member and converter functions are EXECUTE for authenticated only
--        (not anon); the internal ones for no API role.
--   C4 · video_begin_upload counts sources (shared caps, R5);
--        video_mark_uploaded has the converter branch and checks the OWNER's
--        switch (R3); the F-D1-4 attestation is still enforced.
--   C5 · converter identity (R9): at most one account, and that user holds no
--        user_roles row.
--   C6 · the source-housekeeping job runs every 5 min AND runs the
--        housekeeping function; the site setting 'video_conversion' is
--        "device" or "server"; the service role can read the health.
--   (C1/C3/C4/C6 extended after the independent review of #416, finding 8.)
-- Bucket separation (R4) is not a database fact: it is proven separately
-- (docs/evidence/d2/phase5/VID-1/BUCKET-SEPARATION-staging.md).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits  text := '';
  _f    text;
  _p    record;
  _n    bigint;
  _conv uuid;
  _mode text;
BEGIN
  -- C1
  IF to_regclass('public.video_sources') IS NULL OR to_regclass('public.video_source_events') IS NULL
     OR to_regclass('public.video_converter_accounts') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-CONV: a table is missing — is 20261012_0002 applied?';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.video_sources'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.video_source_events'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.video_converter_accounts'::regclass) THEN
    hits := hits || E'\n  C1 RLS is off on a converter table';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND conname = 'video_sources_owner_idempotency_key')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND contype = 'u'
                      AND pg_get_constraintdef(oid) = 'UNIQUE (video_id)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND conname = 'video_sources_converting_has_claim'
                      AND pg_get_constraintdef(oid) ILIKE '%claimed_at IS NOT NULL%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND conname = 'video_sources_queued_has_etag')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND conname = 'video_sources_done_has_video')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND contype = 'c'
                      AND pg_get_constraintdef(oid) ILIKE '%status%awaiting_upload%queued%converting%done%failed%cancelled%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND contype = 'c'
                      AND pg_get_constraintdef(oid) ILIKE '%attempts >= 0%attempts <= 3%') THEN
    hits := hits || E'\n  C1 a video_sources constraint is missing (owner+key, one video per source, claim, ETag, done→video, status list, attempts)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.video_sources'::regclass AND tgname = 'tg_video_sources_touch' AND tgenabled <> 'D')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.video_source_events'::regclass AND tgname = 'tg_video_source_events_append_only' AND tgenabled <> 'D')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.video_source_events'::regclass AND tgname = 'tg_video_source_events_no_truncate' AND tgenabled <> 'D') THEN
    hits := hits || E'\n  C1 a guard trigger is missing or disabled';
  END IF;

  -- C2
  IF has_table_privilege('authenticated', 'public.video_sources', 'INSERT') OR has_table_privilege('authenticated', 'public.video_sources', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.video_sources', 'DELETE') OR has_table_privilege('anon', 'public.video_sources', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_sources', 'claim_token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_sources', 'source_etag', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_sources', 'lease_until', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_sources', 'claimed_at', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.video_sources', 'status', 'SELECT') THEN
    hits := hits || E'\n  C2 video_sources access is not owner-read on the allowed columns only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.video_sources'::regclass AND polname = 'video_sources_owner_read'
                   AND polcmd = 'r' AND pg_get_expr(polqual, polrelid) ILIKE '%owner_id = ( SELECT auth.uid()%')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.video_sources'::regclass) <> 1 THEN
    hits := hits || E'\n  C2 video_sources must have exactly the one owner-read policy';
  END IF;
  IF has_table_privilege('authenticated', 'public.video_source_events', 'SELECT') OR has_table_privilege('anon', 'public.video_source_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.video_converter_accounts', 'SELECT') OR has_table_privilege('anon', 'public.video_converter_accounts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.video_source_events', 'INSERT') OR has_table_privilege('authenticated', 'public.video_converter_accounts', 'INSERT') THEN
    hits := hits || E'\n  C2 the audit trail or the converter accounts are reachable by an API role';
  END IF;

  -- C3
  FOREACH _f IN ARRAY ARRAY[
    'public.video_source_begin(text,bigint,uuid)', 'public.video_source_uploaded(uuid,text)', 'public.video_source_cancel(uuid)',
    'public.video_source_claim()', 'public.video_source_heartbeat(uuid,uuid)',
    'public.video_converter_begin_version(uuid,uuid,text,bigint,numeric,boolean,jsonb)',
    'public.video_converter_version(uuid,integer,uuid)', 'public.video_source_fail(uuid,uuid,text,text)', 'public.video_source_done(uuid,uuid)',
    'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)', 'public.video_mark_uploaded(uuid,integer,text,bigint,text)'] LOOP
    SELECT prosecdef, proconfig INTO _p FROM pg_proc WHERE oid = to_regprocedure(_f);
    IF NOT FOUND OR NOT _p.prosecdef OR _p.proconfig IS NULL OR NOT ('search_path=""' = ANY (_p.proconfig))
       OR NOT has_function_privilege('authenticated', _f, 'EXECUTE') OR has_function_privilege('anon', _f, 'EXECUTE') THEN
      hits := hits || E'\n  C3 ' || _f || ' is missing, not DEFINER/search_path, or its EXECUTE is not authenticated-only';
    END IF;
  END LOOP;
  FOREACH _f IN ARRAY ARRAY[
    'public.video_is_converter()', 'public.video_converter_acting(uuid)', 'public.video_source_log(uuid,uuid,text,text)',
    'public.video_owner_may(uuid,text)', 'public.video_open_count(uuid,text)', 'public.video_day_count(uuid)',
    'public.video_source_expire(uuid,uuid,integer,uuid)', 'public.video_source_drop_video(uuid)', 'public.video_source_held(uuid,uuid)',
    'public.video_source_housekeeping(integer)', 'public.video_converter_health()', 'public.tg_video_sources_touch()',
    'public.tg_video_source_events_append_only()'] LOOP
    SELECT prosecdef, proconfig INTO _p FROM pg_proc WHERE oid = to_regprocedure(_f);
    IF NOT FOUND OR (NOT _p.prosecdef AND _f NOT LIKE 'public.tg\_%') OR _p.proconfig IS NULL OR NOT ('search_path=""' = ANY (_p.proconfig))
       OR has_function_privilege('authenticated', _f, 'EXECUTE') OR has_function_privilege('anon', _f, 'EXECUTE') THEN
      hits := hits || E'\n  C3 internal ' || _f || ' is missing, not DEFINER/search_path, or callable by an API role';
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'public.video_source_reason_text(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_source_reason_text(text)', 'EXECUTE') THEN
    hits := hits || E'\n  C3 internal video_source_reason_text is callable by an API role';
  END IF;

  -- C4
  SELECT prosrc INTO _f FROM pg_proc WHERE oid = 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)'::regprocedure;
  IF position('public.video_day_count(_uid)' IN _f) = 0 OR position('public.video_open_count(_uid, _purpose)' IN _f) = 0
     OR position('IF public.video_is_converter() THEN' IN _f) = 0 THEN
    hits := hits || E'\n  C4 video_begin_upload does not count sources (shared caps) or does not refuse the converter';
  END IF;
  SELECT prosrc INTO _f FROM pg_proc WHERE oid = 'public.video_day_count(uuid)'::regprocedure;
  IF position('converted_from IS NULL' IN _f) = 0 OR position('cancelled' IN _f) > 0 THEN
    hits := hits || E'\n  C4 video_day_count must count every source once and leave converter-made videos out';
  END IF;
  IF has_column_privilege('authenticated', 'public.videos', 'converted_from', 'SELECT') OR has_column_privilege('anon', 'public.videos', 'converted_from', 'SELECT') THEN
    hits := hits || E'\n  C4 videos.converted_from is readable by an API role';
  END IF;
  SELECT prosrc INTO _f FROM pg_proc WHERE oid = 'public.video_mark_uploaded(uuid,integer,text,bigint,text)'::regprocedure;
  IF position('public.video_converter_acting(_video_id)' IN _f) = 0 OR position('feature_allowed(''video_posts'', _v.owner_id)' IN _f) = 0
     OR position('feature_allowed(''video_ads'', _v.owner_id)' IN _f) = 0 OR position('PERFORM public.video_attest_verify(' IN _f) = 0
     OR position('feature_allowed(''video_posts'', _uid)' IN _f) > 0 THEN
    hits := hits || E'\n  C4 video_mark_uploaded: converter branch / owner switch / attestation not as designed';
  END IF;

  -- C5
  SELECT count(*), min(user_id::text)::uuid INTO _n, _conv FROM public.video_converter_accounts;
  IF _n > 1 THEN
    hits := hits || E'\n  C5 more than one converter account';
  END IF;
  IF _n = 1 AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _conv) THEN
    hits := hits || E'\n  C5 the converter account holds a role (it must hold none)';
  END IF;

  -- C6
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-housekeeping' AND schedule = '*/5 * * * *' AND active
         AND command = 'SELECT public.video_source_housekeeping();') <> 1 THEN
    hits := hits || E'\n  C6 the source housekeeping job is not scheduled every 5 min with the housekeeping command';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.video_converter_health()', 'EXECUTE') THEN
    hits := hits || E'\n  C6 the service role cannot read video_converter_health (the alert)';
  END IF;
  SELECT value #>> '{}' INTO _mode FROM public.site_settings WHERE key = 'video_conversion';
  IF _mode IS NULL OR _mode NOT IN ('device', 'server') THEN
    hits := hits || E'\n  C6 site setting video_conversion is missing or not device/server';
  END IF;

  IF hits <> '' THEN RAISE EXCEPTION 'PROBE FAIL VID-CONV:%', hits; END IF;
  RAISE NOTICE 'PROBE PASS VID-CONV: queue tables + guards, owner-read only, DEFINER/search_path, authenticated-only EXECUTE, shared caps, owner switch on mark, converter accounts % (no role), housekeeping every 5 min, conversion mode %',
    _n, _mode;
END
$probe$;
ROLLBACK;
