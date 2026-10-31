-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261013_0004 · BEFORE: video_publish_post() is the 20261011_0003
-- body (it reads post_media as the member). The runner sets fx.shape.
--
-- This is the defect, reproduced: on the PRODUCTION shape (authenticated holds
-- no privilege on post_media) every replay that finds an unlinked post fails
-- with 42501 — including B2, whose image_urls already answer "photo post",
-- because privileges are checked for every relation in the statement before it
-- runs. On the STAGING shape (the keep) the same calls work, which is why
-- staging never showed it. Every call is rolled back (fx.outcome).
-- ═══════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

SELECT fx.check('B1 replay of an unlinked post (the older two-step publish)',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a1', '', 'public', ARRAY['street'], 'legacy-two-step-0001')$$),
  CASE current_setting('fx.shape') WHEN 'production' THEN '42501: permission denied for table post_media' ELSE 'ok' END);

SELECT fx.check('B2 replay of a photo post whose image_urls already say so',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'photo-with-urls-0001')$$),
  CASE current_setting('fx.shape') WHEN 'production' THEN '42501: permission denied for table post_media'
       ELSE '23505: VID-PUB-003: this publish key belongs to a photo post' END);

SELECT fx.check('B3 replay of a photo post known only by post_media',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'photo-media-only-001')$$),
  CASE current_setting('fx.shape') WHEN 'production' THEN '42501: permission denied for table post_media'
       ELSE '23505: VID-PUB-003: this publish key belongs to a photo post' END);

SELECT fx.check('B4 a first publish never reaches the statement',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'fresh-before-000001')$$),
  'ok');

SELECT fx.check('B5 a member reading post_media directly',
  fx.outcome($$SELECT count(*) FROM public.post_media$$),
  CASE current_setting('fx.shape') WHEN 'production' THEN '42501: permission denied for table post_media' ELSE 'ok' END);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
