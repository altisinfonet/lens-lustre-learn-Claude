-- ═══════════════════════════════════════════════════════════════════════════
-- 20261030_0703 · S7 · PRIVACY POLICY: videos + music recognition
--
-- S7 gate clause: "privacy policy … updated for video + music recognition".
-- The site's and app's Privacy Policy page (/page/privacy-policy, also linked
-- from the store listings) is NOT code: ManagedPageView.tsx reads it from
-- site_settings.managed_pages (Admin → Pages edits it). The text in
-- src/components/admin/pages/PageTemplates.ts is only a starter template.
--
-- Read 2026-10-31 ~04:10 UTC with the public (anon) key both apps use:
--   production: privacy-policy updated 2026-10-17T05:51:34.199Z, md5 9e2488beef9242f12ce730c6c8ec5e92
--   staging:    privacy-policy updated 2026-04-05T04:13:54.221Z, md5 a45df80ca998dc39521c385b4670fb52
-- Neither says anything about videos, conversion or music recognition.
--
-- WHAT THIS DOES (one row, one array element; every other page untouched):
--   * refuses unless the page's content is EXACTLY one of the two versions read
--     above (so an Owner edit made since is never overwritten — re-read and
--     re-plan instead), or already carries this block (then: no change);
--   * inserts one marked block (<!-- s7-video-privacy --> … <!-- /s7-video-privacy -->)
--     with three paragraphs — Videos, Music recognition, Video reports and
--     removal — before "Contact / Grievance Officer" (production), or at the
--     end (staging's older page has no such heading);
--   * production only, two exact phrases: "Last updated: 17th October 2026" →
--     "31st October 2026", and the processor list "content delivery and
--     security (Cloudflare)" → "… security and photo and video storage
--     (Cloudflare), video conversion on our own server (Oracle Cloud)";
--   * sets that page's updated_at.
-- Every fact in the text is checked against the code (S7-privacy-store-text.md).
-- No address, name or other contact detail is written by this file.
--
-- Rollback: supabase/rollback/20261030_0703_s7_privacy_policy_video_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261030_0703_s7_privacy_policy_video.sql
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

SET LOCAL lock_timeout = '5s';

DO $apply$
DECLARE
  _pages   jsonb;
  _idx     integer;
  _old     text;
  _new     text;
  _anchor  constant text := '<p dir="ltr"><strong>Contact / Grievance Officer</strong>';
  _block   constant text :=
    '<!-- s7-video-privacy -->'
    || '<p dir="ltr"><strong>Videos</strong><br>' || chr(10)
    || 'When videos are available to you, you can add a video to a post. We store the video, its length, file size and picture size, and a fingerprint (a hash) of its sound so we can tell if the sound changes. Your phone prepares the video before it is uploaded; if you choose to let our server prepare it instead, the original file is sent to our own conversion server and deleted within 8 days. A video can be seen by the same people who can see its post.</p>' || chr(10)
    || '<p dir="ltr"><strong>Music recognition (copyright check)</strong><br>' || chr(10)
    || 'To protect music rights holders, we may check the sound of a video against a music-recognition service before the video is shown. This check is switched off today. Before we switch it on we will name the service here. It would receive only the video''s sound, and we keep only its result (song title, artist and where in the video the match is), never the service''s full reply.</p>' || chr(10)
    || '<p dir="ltr"><strong>Video reports and removal</strong><br>' || chr(10)
    || 'If we remove a video after a report or a copyright notice, it is hidden at once, you are told, and you can upload a corrected version. When you delete a video or its post, it is hidden at once; its files are kept for 30 days and then permanently deleted.</p>'
    || '<!-- /s7-video-privacy -->';
BEGIN
  SELECT value INTO _pages FROM public.site_settings WHERE key = 'managed_pages' FOR UPDATE;
  IF _pages IS NULL OR jsonb_typeof(_pages) <> 'array' THEN
    RAISE EXCEPTION 'APPLY REFUSED (20261030_0703) — site_settings.managed_pages is missing or not an array';
  END IF;
  SELECT (o - 1)::int, e ->> 'content' INTO _idx, _old
    FROM jsonb_array_elements(_pages) WITH ORDINALITY AS t(e, o) WHERE e ->> 'slug' = 'privacy-policy';
  IF _idx IS NULL OR _old IS NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED (20261030_0703) — no privacy-policy page with content';
  END IF;
  IF strpos(_old, '<!-- s7-video-privacy -->') > 0 THEN
    RAISE NOTICE 'S7-0703: the privacy policy already carries the video block on lane % — no change', current_setting('p32.lane');
    RETURN;
  END IF;
  IF md5(_old) NOT IN ('9e2488beef9242f12ce730c6c8ec5e92', 'a45df80ca998dc39521c385b4670fb52') THEN
    RAISE EXCEPTION 'APPLY REFUSED (20261030_0703) — the privacy policy was edited since 2026-10-31 04:10 UTC (md5 %); re-read it and re-plan, nothing changed', md5(_old);
  END IF;

  IF strpos(_old, _anchor) > 0 THEN
    _new := replace(_old, _anchor, _block || _anchor);
  ELSE
    _new := _old || _block;
  END IF;
  _new := replace(_new, 'Last updated: 17th October 2026', 'Last updated: 31st October 2026');
  _new := replace(_new, 'content delivery and security (Cloudflare)',
                  'content delivery, security and photo and video storage (Cloudflare), video conversion on our own server (Oracle Cloud)');

  UPDATE public.site_settings
     SET value = jsonb_set(jsonb_set(_pages, ARRAY[_idx::text, 'content'], to_jsonb(_new)),
                           ARRAY[_idx::text, 'updated_at'],
                           to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
         updated_at = now()
   WHERE key = 'managed_pages';
  RAISE NOTICE 'S7-0703: privacy policy updated on lane % (md5 % → %)', current_setting('p32.lane'), md5(_old), md5(_new);
END
$apply$;

DO $post$
DECLARE
  _c text;
BEGIN
  SELECT e ->> 'content' INTO _c FROM public.site_settings s, jsonb_array_elements(s.value) e
   WHERE s.key = 'managed_pages' AND e ->> 'slug' = 'privacy-policy';
  IF strpos(_c, '<!-- s7-video-privacy -->') = 0 OR strpos(_c, '<!-- /s7-video-privacy -->') = 0
     OR strpos(_c, 'Music recognition (copyright check)') = 0 THEN
    RAISE EXCEPTION 'S7-0703-POST: the video block is not on the privacy policy';
  END IF;
END
$post$;

COMMIT;
