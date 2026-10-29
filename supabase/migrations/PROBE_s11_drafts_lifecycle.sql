-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S11 drafts lifecycle (staging and production). READ ONLY, ROLLBACK.
--
-- Finding under test (S11 re-verification): "drafts are marked at 7 days but
-- never purged — no purge function in git". The app promises members a real,
-- no-undo deletion after 7 days (usePostDrafts.ts DRAFT_EXPIRY_DAYS). The S1
-- security PROBE lists a live `reap_post_drafts` that no migration in git
-- creates. This reports, per lane — names, schedules and counts only:
--   1. which draft functions exist (mark_expiring_post_drafts, reap_post_drafts,
--      publish_post_draft, expiring_post_drafts) and their arguments;
--   2. every pg_cron job whose command names one of them: job name, schedule,
--      active flag, and its last run's status and age (never the command text);
--   3. drafts by age since last edit: ≤ 7 days, 7–8 days, > 8 days, > 30 days.
-- A draft older than 8 days on a lane with a live reaper means the reaper is
-- not doing its job; a reaper with no cron job means nothing ever calls it.
-- It never fails on what it finds. FAILS only if the lane is not asserted.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE
  r record; line text := ''; has_cron boolean;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- 1. functions
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('mark_expiring_post_drafts', 'reap_post_drafts', 'publish_post_draft', 'expiring_post_drafts')
     ORDER BY p.proname
  LOOP
    line := line || format(E'\n  function %s(%s) definer=%s', r.proname, r.args, r.prosecdef);
  END LOOP;
  IF line = '' THEN line := E'\n  function (none of the four draft functions exist)'; END IF;

  -- 2. cron jobs that call them
  has_cron := to_regclass('cron.job') IS NOT NULL;
  IF NOT has_cron THEN
    line := line || E'\n  cron     (pg_cron not installed on this lane)';
  ELSE
    FOR r IN EXECUTE $q$
      SELECT j.jobid, j.jobname, j.schedule, j.active,
             (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_status,
             (SELECT now() - d.start_time FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_age
        FROM cron.job j
       WHERE j.command ~* '(mark_expiring_post_drafts|reap_post_drafts|post_drafts)'
       ORDER BY j.jobid
    $q$
    LOOP
      line := line || format(E'\n  cron     job %s "%s" schedule "%s" active=%s last run: %s, %s ago',
        r.jobid, coalesce(r.jobname, '(unnamed)'), r.schedule, r.active,
        coalesce(r.last_status, 'never'), coalesce(date_trunc('minute', r.last_age)::text, '—'));
    END LOOP;
    IF line !~ 'cron     job' THEN line := line || E'\n  cron     (no cron job names a draft function or post_drafts)'; END IF;
  END IF;

  -- 3. drafts by age
  IF to_regclass('public.post_drafts') IS NULL THEN
    line := line || E'\n  drafts   (public.post_drafts does not exist on this lane)';
  ELSE
    EXECUTE $q$
      SELECT format(E'\n  drafts   total %s · ≤7 d %s · 7–8 d %s · >8 d %s · >30 d %s',
        count(*),
        count(*) FILTER (WHERE updated_at >= now() - interval '7 days'),
        count(*) FILTER (WHERE updated_at <  now() - interval '7 days' AND updated_at >= now() - interval '8 days'),
        count(*) FILTER (WHERE updated_at <  now() - interval '8 days'),
        count(*) FILTER (WHERE updated_at <  now() - interval '30 days'))
        FROM public.post_drafts
    $q$ INTO r;
    line := line || r.format;
  END IF;

  RAISE NOTICE 'DRAFTS LIFECYCLE (lane %):%', current_setting('p32.lane'), line;
END
$p$;

ROLLBACK;
