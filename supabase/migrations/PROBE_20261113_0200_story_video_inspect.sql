-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0200 — INSPECT ONLY (Owner 13 Nov: "story video: no video
-- playing, no sound"). READ ONLY, ROLLBACK. Measures, before any fix:
--   1. the video stories live right now: video state, sound track, length,
--      size, sound remedy — facts about the FILE, never who posted it
--   2. the videos table's columns (where a cover picture could come from)
--   3. what members' phones and browsers logged about video / stories in the
--      last 48 h (counts per code / event / platform / build — no member data)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  r record;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  RAISE NOTICE 'STORIES LIVE: total=% from_posts=% video=%',
    (SELECT count(*) FROM public.stories s WHERE s.expires_at > now()),
    (SELECT count(*) FROM public.stories s WHERE s.expires_at > now() AND s.post_id IS NOT NULL),
    (SELECT count(*) FROM public.stories s WHERE s.expires_at > now()
        AND EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.post_id = s.post_id));

  FOR r IN
    SELECT left(md5(s.id::text), 6) AS tag, round(extract(epoch FROM now() - s.created_at) / 3600, 1) AS age_h,
           v.state, v.current_version, vv.has_audio, vv.declared_duration_s, vv.measured_audio_s, vv.remedy,
           vv.width, vv.height, vv.renditions, (p.thumbnail_url IS NOT NULL) AS post_thumb, (p.image_url IS NOT NULL) AS post_img,
           (s.image_url IS NOT NULL) AS story_img
      FROM public.stories s
      JOIN public.post_videos pv ON pv.post_id = s.post_id
      JOIN public.videos v ON v.id = pv.video_id
      LEFT JOIN public.video_versions vv ON vv.video_id = v.id AND vv.version_no = v.current_version
      LEFT JOIN public.posts p ON p.id = s.post_id
     WHERE s.expires_at > now()
     ORDER BY s.created_at DESC
     LIMIT 20
  LOOP
    RAISE NOTICE 'VIDEO STORY %: age %h state=% ver=% has_audio=% dur=% audio_s=% remedy=% %x% renditions=% cover: post_thumb=% post_img=% story_img=%',
      r.tag, r.age_h, r.state, r.current_version, r.has_audio, r.declared_duration_s, r.measured_audio_s, r.remedy,
      r.width, r.height, r.renditions, r.post_thumb, r.post_img, r.story_img;
  END LOOP;

  RAISE NOTICE 'COLS videos: %', (
    SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid = 'public.videos'::regclass AND a.attnum > 0 AND NOT a.attisdropped);

  FOR r IN
    SELECT coalesce(j->>'code', '-') AS code, coalesce(j->>'event', j->>'kind', '-') AS event,
           coalesce(j->>'platform', '-') AS platform, coalesce(j->>'app_build', '-') AS build, count(*) AS n,
           left(max(coalesce(j->>'reason', j->>'message', '')), 160) AS sample_reason
      FROM (SELECT to_jsonb(ce) AS j FROM public.client_errors ce WHERE ce.created_at > now() - interval '48 hours') x
     WHERE (j->>'code') ILIKE ANY (ARRAY['VID%', 'STORY%', 'MEDIA%'])
        OR coalesce(j->>'event', j->>'kind', '') ILIKE ANY (ARRAY['%VIDEO%', '%PLAY%', '%STORY%', '%AUTOPLAY%', '%HLS%'])
     GROUP BY 1, 2, 3, 4
     ORDER BY n DESC
     LIMIT 40
  LOOP
    RAISE NOTICE 'LOG 48h: % % [%/%] x% — %', r.code, r.event, r.platform, r.build, r.n, r.sample_reason;
  END LOOP;

  RAISE NOTICE 'SV0200 INSPECT DONE (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
