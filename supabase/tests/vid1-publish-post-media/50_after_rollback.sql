-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261013_0004 · AFTER THE ROLLBACK: each shape is back in its own
-- pre-state — production: the 42501 returns; staging: the keep returns.
-- ═══════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

SELECT fx.check('R1 replay of a photo post known only by post_media',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'photo-media-only-001')$$),
  CASE current_setting('fx.shape') WHEN 'production' THEN '42501: permission denied for table post_media'
       ELSE '23505: VID-PUB-003: this publish key belongs to a photo post' END);
SELECT fx.check('R2 a member reading post_media directly',
  fx.outcome($$SELECT count(*) FROM public.post_media$$),
  CASE current_setting('fx.shape') WHEN 'production' THEN '42501: permission denied for table post_media' ELSE 'ok' END);
SELECT fx.check('R3 the helper is gone',
  fx.outcome($$SELECT public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001a1')$$),
  '42883: function public.video_publish_own_post_has_media(unknown) does not exist');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
