-- ═══════════════════════════════════════════════════════════════════════════
-- 20261030_0702 · S7 · VID-6 VIDEO ALARMS (cost line + music-check wait)
--
-- OWNER DECISION (2026-10-30 ~15:20 UTC, comment on status PR #617): alarm at
-- 8 GB of R2 storage per lane-month, raised as a row in public.ops_alarms so the
-- existing alarm-relay.yml delivers it (an ALARM issue; GitHub e-mails the
-- Owner). No e-mail address is written anywhere in git.
--
-- WHAT WAS MISSING (inspected on staging e68965dc):
--   * nothing measured how much video the lane stores — R2's free allowance is
--     10 GB-month; past it every GB is billed, and no one would know;
--   * public.music_check_overdue(6 h) (20261005_0006) was built as "the 6-hour
--     alert list (VID-6 channel)" but nothing ever read it (no caller in src/,
--     functions/, converter/ or any migration).
--
-- WHAT THIS ADDS (inside the database, pg_cron, same channel as 20261103_0300):
--   * ops_alarm_settings.video_storage_alarm_bytes — the line, default
--     8,000,000,000 bytes ("8 GB" read as 10^9, the LOWER reading, so the alarm
--     is never late if Cloudflare bills in 2^30). Changed only by migration.
--   * public.ops_video_storage_bytes() — the bytes of every video file this
--     lane's database still points at: every row of video_versions (served
--     renditions; deleted / failed versions stay until the 30-day purge) plus
--     every row of video_sources (converter originals; rows go 2 days after the
--     job ends). Both sizes are the declared, server-checked totals (VID-LIM-002).
--     NOT counted (stated in the alarm detail): photos (PHOTOS bucket; legacy
--     image_urls photos have no recorded size), private photo derivatives, and
--     folders already queued in video_r2_purge_queue but not yet deleted
--     (the converter's purge tick empties those within the hour, S7-f).
--   * public.ops_video_alarms() — every 15 minutes (pg_cron 'ops-video-alarms'):
--       'video-storage'        open while stored bytes >= the line, closed below;
--       'video-music-overdue'  open while music_check_overdue(6 h) has rows
--                              (a member has waited > 6 h on our side), closed
--                              when it has none.
--     It only calls public.ops_alarm_set (20261103_0300); delivery, the Admin →
--     Health banner and issue closing are unchanged. alarm-relay.yml reads the
--     PRODUCTION database only, so a staging alarm shows in staging's banner.
--
-- SHAPE RULES MET: the cron command calls ONE public function, no net.http_* /
-- vault / credential (P9); 15-minute cadence (P5); no new table (P35); no
-- runtime DDL (P7). SECURITY DEFINER, search_path '', EXECUTE revoked from
-- PUBLIC, anon, authenticated and service_role (only postgres / pg_cron run it).
-- No feature switch is touched. Both lanes get the same objects.
--
-- Name note: S7 files use 20261030_07xx (runner rule) although this needs
-- 20261103_0300 (ops alarms) applied first — the precondition below refuses
-- otherwise. Rollback: supabase/rollback/20261030_0702_s7_vid6_video_alarms_ROLLBACK.sql
-- PROBE: supabase/migrations/PROBE_20261030_0702_s7_vid6_video_alarms.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %)',
      coalesce(current_setting('p32.lane', true), '(unset)') USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

DO $pre$
DECLARE
  _bad text := '';
BEGIN
  IF to_regclass('public.ops_alarm_settings') IS NULL OR to_regclass('public.ops_alarms') IS NULL
     OR to_regprocedure('public.ops_alarm_set(text,boolean,text,jsonb)') IS NULL THEN
    _bad := _bad || E'\n  ops alarms missing (apply 20261103_0300_ops_alarms first)';
  END IF;
  IF to_regclass('public.video_versions') IS NULL THEN _bad := _bad || E'\n  video_versions missing (20261005_0005)'; END IF;
  IF to_regclass('public.video_sources') IS NULL THEN _bad := _bad || E'\n  video_sources missing (20261012_0002)'; END IF;
  IF to_regprocedure('public.music_check_overdue(interval)') IS NULL THEN _bad := _bad || E'\n  music_check_overdue missing (20261005_0006)'; END IF;
  IF to_regclass('public.video_r2_purge_queue') IS NULL THEN _bad := _bad || E'\n  video_r2_purge_queue missing (20261005_0005)'; END IF;
  IF _bad <> '' THEN RAISE EXCEPTION 'APPLY REFUSED (20261030_0702) — precondition:%', _bad; END IF;
END
$pre$;

SET LOCAL lock_timeout = '5s';

-- ── the line (one setting, changed by migration only) ───────────────────────
ALTER TABLE public.ops_alarm_settings
  ADD COLUMN IF NOT EXISTS video_storage_alarm_bytes bigint NOT NULL DEFAULT 8000000000
  CONSTRAINT ops_alarm_settings_video_storage_alarm_bytes_positive CHECK (video_storage_alarm_bytes > 0);
COMMENT ON COLUMN public.ops_alarm_settings.video_storage_alarm_bytes IS
  'VID-6: open alarm video-storage when the lane''s video files reach this many bytes. Owner decision 2026-10-30: 8 GB (8e9, the lower reading of GB).';

-- ── what the lane stores (bytes the database points at) ─────────────────────
CREATE OR REPLACE FUNCTION public.ops_video_storage_bytes()
RETURNS TABLE (version_bytes bigint, source_bytes bigint, total_bytes bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT v.b, s.b, v.b + s.b
    FROM (SELECT coalesce(sum(total_bytes), 0)::bigint AS b FROM public.video_versions) v,
         (SELECT coalesce(sum(source_bytes), 0)::bigint AS b FROM public.video_sources) s;
$fn$;

-- ── the check (reads, then opens / closes two alarm keys) ───────────────────
CREATE OR REPLACE FUNCTION public.ops_video_alarms()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _lane    text;
  _line    bigint;
  _st      record;
  _pending bigint;
  _late    bigint;
  _oldest  timestamptz;
  _storage boolean;
BEGIN
  SELECT lane, video_storage_alarm_bytes INTO _lane, _line FROM public.ops_alarm_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped', 'no ops_alarm_settings row'); END IF;

  SELECT * INTO _st FROM public.ops_video_storage_bytes();
  SELECT count(*) INTO _pending FROM public.video_r2_purge_queue WHERE done_at IS NULL;
  _storage := _st.total_bytes >= _line;
  PERFORM public.ops_alarm_set('video-storage', _storage,
    format('[%s] video storage is %s GB — at or over the %s GB alarm line (R2 free allowance: 10 GB-month)',
           _lane, to_char(_st.total_bytes / 1e9, 'FM9999990.00'), to_char(_line / 1e9, 'FM9999990.##')),
    jsonb_build_object('total_bytes', _st.total_bytes, 'version_bytes', _st.version_bytes, 'source_bytes', _st.source_bytes,
                       'line_bytes', _line, 'purge_rows_pending', _pending,
                       'not_counted', 'photos, private photo derivatives, folders queued for purge but not yet deleted'));

  SELECT count(*), min(since) INTO _late, _oldest FROM public.music_check_overdue(interval '6 hours');
  PERFORM public.ops_alarm_set('video-music-overdue', _late > 0,
    format('[%s] %s video(s) waiting over 6 h for the music check (oldest since %s UTC) — the wait is on our side',
           _lane, _late, to_char(_oldest AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')),
    jsonb_build_object('videos', _late, 'oldest_since', _oldest));

  RETURN jsonb_build_object('total_bytes', _st.total_bytes, 'line_bytes', _line, 'storage_alarm', _storage,
                            'music_overdue', _late);
END
$fn$;

REVOKE ALL ON FUNCTION public.ops_video_storage_bytes() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ops_video_alarms() FROM PUBLIC, anon, authenticated, service_role;

-- ── schedule (pg_cron upserts by job name) ─────────────────────────────────
SELECT cron.schedule('ops-video-alarms', '*/15 * * * *', 'SELECT public.ops_video_alarms()');

DO $post$
DECLARE
  f text;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'ops-video-alarms' AND schedule = '*/15 * * * *' AND active) <> 1 THEN
    RAISE EXCEPTION 'VID6-0702-POST: cron job ops-video-alarms not scheduled';
  END IF;
  FOREACH f IN ARRAY ARRAY['public.ops_video_storage_bytes()', 'public.ops_video_alarms()'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'VID6-0702-POST: an API role can execute %', f;
    END IF;
  END LOOP;
  IF (SELECT video_storage_alarm_bytes FROM public.ops_alarm_settings WHERE id = 1) IS DISTINCT FROM 8000000000 THEN
    RAISE EXCEPTION 'VID6-0702-POST: the alarm line is not 8,000,000,000 bytes';
  END IF;
  RAISE NOTICE 'VID6-0702: video alarms installed on lane % (first check: %)', current_setting('p32.lane'), public.ops_video_alarms();
END
$post$;

COMMIT;
