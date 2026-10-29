-- F-AUD-8 fixture, part 2 (after the REAL 20261005_0003 has moved the HTTP jobs).
-- process-email-queue (production only) and publish-scheduled-posts, captured
-- exactly as 0006 / P5-b 0007 capture them: the literal job is EVALUATED through
-- a function with net.http_post's parameters into 'p9_cron_http:<job>', and
-- {schedule, command} goes to 'p9_cron_previous:<job>'. Values invented.
-- psql variables: shape, old_key, old_cs.
CREATE FUNCTION pg_temp.cap(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS jsonb LANGUAGE sql AS $c$ SELECT jsonb_build_object('url', url, 'body', body, 'params', params, 'headers', headers,
  'timeout_milliseconds', timeout_milliseconds) $c$;
CREATE TEMP TABLE prev (job text, sched text, cmd text, tick text);
INSERT INTO prev SELECT 'process-email-queue', '10 seconds', format(
  E' select net.http_post(\n url := %L,\n headers := jsonb_build_object(\n ''Content-Type'',''application/json'',\n ''Authorization'',%L,\n ''x-cron-secret'',%L),\n body := ''{}''::jsonb) ',
  'https://fixture-not-a-project.supabase.co/functions/v1/process-email-queue', 'Bearer ' || :'old_key', :'old_cs'),
  'SELECT public.email_queue_tick();'
 WHERE :'shape' = 'production';
INSERT INTO prev SELECT 'publish-scheduled-posts', '* * * * *', format(
  'select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',%L,''x-scheduled-posts-secret'',(select decrypted_secret from vault.decrypted_secrets where name = ''SCHEDULED_POSTS_CRON_SECRET'')), body := ''{}''::jsonb, timeout_milliseconds := 10000)',
  'https://fixture-not-a-project.supabase.co/functions/v1/publish-scheduled-posts', 'Bearer ' || :'old_key'),
  'SELECT public.publish_scheduled_posts_tick();';
DO $d$
DECLARE r record; t jsonb;
BEGIN
  FOR r IN SELECT * FROM prev LOOP
    EXECUTE regexp_replace(rtrim(r.cmd, E' \t\r\n;'), 'net\.http_post\s*\(', 'pg_temp.cap(', 'i') INTO t;
    PERFORM vault.create_secret(t::text, 'p9_cron_http:' || r.job, 'fixture capture');
    PERFORM vault.create_secret(jsonb_build_object('schedule', r.sched, 'command', r.cmd)::text, 'p9_cron_previous:' || r.job, 'fixture');
    PERFORM cron.schedule(r.job, CASE WHEN r.job = 'process-email-queue' THEN '* * * * *' ELSE '* * * * *' END, r.tick);
  END LOOP;
END $d$;
SELECT cron.alter_job(jobid, active := false) FROM cron.job;
-- production: the scheduler's history from before P9 still holds literal credentials (F-P6-1);
-- two rows written as the scheduler writes them.
INSERT INTO cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
SELECT j.jobid, nextval('cron.runid_seq'), 1, 'p5cron', 'postgres', (p.secret::jsonb)->>'command', 'succeeded', '1 row', now() - interval '20 h', now() - interval '20 h'
  FROM cron.job j JOIN vault.secrets p ON p.name = 'p9_cron_previous:' || j.jobname
 WHERE :'shape' = 'production' AND j.jobname IN ('apply-scheduled-boosts', 'process-email-queue');
