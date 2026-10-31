-- ============================================================================
-- MAKE "IMAGES ARE NOT COMING" MEASURABLE.
--
-- OWNER REPORT, 2026-08-05, on https://www.50mmretina.com/login and /signup:
--
--   "Images are not coming. Many times told, still you not solved — all time
--    images are not coming."
--
-- His console showed two `Failed to load resource: the server responded with a
-- status of 404 ()` lines. Chrome truncates those: **no URL**. And measured
-- from a clean browser the same minute, both pages were entirely healthy —
-- 30 resources, zero 4xx, login_background.webp 1200px and the site logo
-- 852px. So the failure is real for him and invisible to everyone else, which
-- is precisely why repeated reports never led to a fix.
--
-- THE ACTUAL BROKEN IMAGE was found separately: the About Us page in
-- site_settings.managed_pages pointed twice at https://www.50mmretina.com/logo.png,
-- a file that does not exist, so Cloudflare served the SPA shell (200 text/html)
-- and the browser could not decode it. Fixed in the data the same day.
--
-- There were TWO reasons nothing was ever learned:
--
--   1. public/sw-image-cache.js answered a failed image fetch with a
--      TRANSPARENT 1x1 GIF. The browser treats that as a SUCCESSFUL load, so
--      onerror never fired, no retry ran, and nothing was logged anywhere.
--      The fallback was destroying the evidence. Fixed: it now returns a 504.
--   2. log_client_error accepted only four kinds and silently DROPPED
--      anything else, so even a correct report from the client would have gone
--      nowhere. That is this migration.
--
-- WHY 'image_load' GETS ITS OWN RATE LIMIT
--
-- The existing limit is 20 rows per member per hour, which is right for post
-- and upload failures — those are single deliberate actions. Images are not:
-- one bad moment on a feed screen can fail fifteen thumbnails at once, and
-- under the shared limit a single scroll would consume the member's entire
-- hourly budget and then SILENCE the post/reply/upload reports that matter
-- most. That is the logger making an incident harder to see.
--
-- So image_load is counted separately: 10 per member per hour.
--
-- TWO BUCKETS, NOT FIVE. The original four keep sharing ONE budget of 20,
-- exactly as before. Switching to a per-kind count would have quietly raised
-- the ceiling from 20 rows an hour to 80 for every existing caller.
--
-- NOTHING ELSE IN THE FUNCTION CHANGES. Same signature, same SECURITY DEFINER,
-- same silent-return-on-failure contract, same grants.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_client_error(
  _kind      text,
  _message   text,
  _detail    jsonb DEFAULT NULL,
  _platform  text  DEFAULT NULL,
  _app_build text  DEFAULT NULL,
  _url       text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid    uuid := auth.uid();
  _recent integer;
  _cap    integer;
BEGIN
  IF _kind NOT IN ('post_create', 'reply', 'upload', 'blank_page', 'image_load') THEN
    RETURN;
  END IF;

  IF _message IS NULL OR btrim(_message) = '' THEN
    RETURN;
  END IF;

  _cap := CASE WHEN _kind = 'image_load' THEN 10 ELSE 20 END;

  IF _uid IS NOT NULL THEN
    SELECT count(*) INTO _recent
      FROM public.client_errors
     WHERE user_id = _uid
       AND (kind = 'image_load') = (_kind = 'image_load')
       AND created_at > now() - interval '1 hour';
    IF _recent >= _cap THEN RETURN; END IF;
  ELSE
    SELECT count(*) INTO _recent
      FROM public.client_errors
     WHERE user_id IS NULL
       AND created_at > now() - interval '1 hour';
    IF _recent >= 200 THEN RETURN; END IF;
  END IF;

  INSERT INTO public.client_errors (user_id, kind, message, detail, platform, app_build, url)
  VALUES (
    _uid,
    _kind,
    left(_message, 500),
    _detail,
    left(_platform, 16),
    left(_app_build, 32),
    left(_url, 300)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$fn$;

COMMENT ON FUNCTION public.log_client_error(text, text, jsonb, text, text, text) IS
  'The only door into client_errors. Kinds: post_create, reply, upload, blank_page, image_load. Rate limited per member per hour — 10 for image_load (they fail in bursts and must not crowd out the others), 20 shared by the rest, 200/hr for anonymous. Never raises.';
