-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · P5-b · publish-scheduled-posts only when due (20261004_0007) — LIVE half.
-- READ-ONLY. Ends in ROLLBACK. Raises (and so fails the dispatch) on a hit.
--
-- S1 · cron job 'publish-scheduled-posts', where it exists, runs at most once a
--      minute, calls public.publish_scheduled_posts_tick() and carries no
--      net.http_post, no inline vault read and no quoted literal of 17+
--      characters; its HTTP target is in vault ('p9_cron_http:…').
-- S2 · the due-check and the tick exist; no API role can execute them.
-- S3 · the due-check agrees with the table right now (a disagreement means it
--      no longer mirrors the edge function's selections).
-- Commands are never printed: they may carry secrets.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  j     record;
  hits  text := '';
  st    record;
  truth boolean;
BEGIN
  IF to_regprocedure('public.publish_scheduled_posts_tick()') IS NULL OR to_regprocedure('public.scheduled_posts_due()') IS NULL
     OR to_regclass('public.publish_scheduled_posts_tick_state') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P5b: S2 the tick of 20261004_0007 is not installed';
  END IF;
  FOR j IN SELECT schedule, command FROM cron.job WHERE jobname = 'publish-scheduled-posts' LOOP
    IF j.schedule ~* '^\s*\d+\s+seconds?\s*$' THEN hits := hits || E'\n  S1 schedule is sub-minute (' || j.schedule || ')'; END IF;
    IF j.command ~* 'http_post' THEN hits := hits || E'\n  S1 the command still calls net.http_post'; END IF;
    IF j.command ~* 'decrypted_secrets' THEN hits := hits || E'\n  S1 the command reads the vault inline'; END IF;
    IF j.command ~ '''[^'']{17,}''' THEN hits := hits || E'\n  S1 the command holds a long quoted literal'; END IF;
    IF j.command !~* 'public\.publish_scheduled_posts_tick\(\)' THEN hits := hits || E'\n  S1 the command does not call the tick'; END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'p9_cron_http:publish-scheduled-posts') THEN
      hits := hits || E'\n  S1 no vault target p9_cron_http:publish-scheduled-posts'; END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.publish_scheduled_posts_tick()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.publish_scheduled_posts_tick()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.scheduled_posts_due()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.scheduled_posts_due()', 'EXECUTE') THEN
    hits := hits || E'\n  S2 an API role can execute the tick or the due-check';
  END IF;
  truth := EXISTS (SELECT 1 FROM public.scheduled_posts WHERE status = 'pending' AND scheduled_for <= clock_timestamp())
        OR EXISTS (SELECT 1 FROM public.scheduled_posts WHERE status = 'publishing' AND updated_at < clock_timestamp() - interval '5 minutes');
  IF public.scheduled_posts_due() IS DISTINCT FROM truth THEN
    hits := hits || E'\n  S3 scheduled_posts_due() says ' || public.scheduled_posts_due()::text || ', the table says ' || truth::text;
  END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL P5b:%', hits;
  END IF;
  SELECT wakes, idle_ticks, last_wake_at INTO st FROM public.publish_scheduled_posts_tick_state;
  RAISE NOTICE 'PROBE PASS P5b: job %, due now %, wakes %, idle ticks %, last wake %',
    CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-scheduled-posts') THEN 'once a minute → publish_scheduled_posts_tick()' ELSE 'absent on this lane' END,
    truth, st.wakes, st.idle_ticks, coalesce(st.last_wake_at::text, 'never');
END
$probe$;
ROLLBACK;
