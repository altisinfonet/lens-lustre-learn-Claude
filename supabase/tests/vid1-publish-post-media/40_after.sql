-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261013_0004 · AFTER the migration. Same expectations on BOTH
-- shapes — that is the point: staging now behaves as production does.
-- A1, A2 and A6 publish for real (the next steps depend on them); every other
-- call is rolled back (fx.outcome).
-- ═══════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

-- ── member A: publishing works without any post_media privilege ─────────────
SELECT fx.check('A1 replay of an unlinked post links the video and returns that post',
  public.video_publish_post('00000000-0000-4000-8000-0000000000a1', '', 'public', ARRAY['street'], 'legacy-two-step-0001')::text,
  '00000000-0000-4000-8000-0000000001a0');
SELECT fx.check('A1b the link is there',
  (SELECT video_id::text FROM public.post_videos WHERE post_id = '00000000-0000-4000-8000-0000000001a0'),
  '00000000-0000-4000-8000-0000000000a1');
SELECT fx.check('A2 the same replay again returns the same post (idempotent)',
  public.video_publish_post('00000000-0000-4000-8000-0000000000a1', '', 'public', ARRAY['street'], 'legacy-two-step-0001')::text,
  '00000000-0000-4000-8000-0000000001a0');
SELECT fx.check('A3 the same key with another video is refused',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'legacy-two-step-0001')$$),
  '23505: VID-PUB-003: this publish key already belongs to another video');
SELECT fx.check('A4 a photo post known only by post_media is refused — through the helper',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'photo-media-only-001')$$),
  '23505: VID-PUB-003: this publish key belongs to a photo post');
SELECT fx.check('A5 a photo post with image_urls is refused',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'photo-with-urls-0001')$$),
  '23505: VID-PUB-003: this publish key belongs to a photo post');
SELECT set_config('fx.a6',
  public.video_publish_post('00000000-0000-4000-8000-0000000000a2', 'caption', 'public', ARRAY['street'], 'fresh-after-0000001')::text, false);
SELECT fx.check('A6 a first publish writes the post (author A) and its link (vA2)',
  (SELECT p.user_id::text || ' ' || pv.video_id::text
     FROM public.posts p JOIN public.post_videos pv ON pv.post_id = p.id
    WHERE p.id = current_setting('fx.a6')::uuid),
  '00000000-0000-4000-8000-00000000000a 00000000-0000-4000-8000-0000000000a2');

-- ── post_media itself stays closed ──────────────────────────────────────────
SELECT fx.check('A7 a member reading post_media directly is refused',
  fx.outcome($$SELECT count(*) FROM public.post_media$$),
  '42501: permission denied for table post_media');
SELECT fx.check('A7b a member writing post_media directly is refused',
  fx.outcome($$INSERT INTO public.post_media (post_id, ord, media_id) VALUES ('00000000-0000-4000-8000-0000000001a0', 0, '00000000-0000-4000-8000-0000000002a1')$$),
  '42501: permission denied for table post_media');

-- ── the helper: SECURITY DEFINER, judged by its WHERE clause ─────────────────
SELECT fx.check('A8 own post with post_media → true',
  public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001a1')::text, 'true');
SELECT fx.check('A8b own post without post_media → false',
  public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001a0')::text, 'false');
SELECT fx.check('A8c CROSS-MEMBER: B''s post with post_media, asked by A → false',
  public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001b1')::text, 'false');
SELECT fx.check('A8d NULL → false',
  public.video_publish_own_post_has_media(NULL)::text, 'false');
SELECT fx.check('A8e a post id that does not exist → false',
  public.video_publish_own_post_has_media('00000000-0000-4000-8000-00000000ffff')::text, 'false');

-- ── member B ────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000b', false);
SELECT fx.check('A9 B''s own post → true',
  public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001b1')::text, 'true');
SELECT fx.check('A9b CROSS-MEMBER: A''s post with post_media, asked by B → false',
  public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001a1')::text, 'false');
SELECT fx.check('A10 B using A''s publish key gets B''s own new post (keys are per member)',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000b1', '', 'public', ARRAY['street'], 'photo-media-only-001')$$),
  'ok');
SELECT fx.check('A11 B cannot publish A''s video (link guard; nothing is left behind)',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a3', '', 'public', ARRAY['street'], 'b-steals-a-video-01')$$),
  '23514: VID-LINK-002: the video must belong to the post''s author');

-- ── no session / the JWT claims form PostgREST sends ────────────────────────
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT fx.check('A12 no session: publishing is refused',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'no-session-000001')$$),
  '42501: VID-PUB-001: sign in first');
SELECT fx.check('A12b no session: the helper answers false',
  public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001a1')::text, 'false');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', false);
SELECT fx.check('A12c request.jwt.claims (PostgREST form) identifies A',
  public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001a1')::text, 'true');
SELECT set_config('request.jwt.claims', '', false);
RESET ROLE;

-- ── anon ────────────────────────────────────────────────────────────────────
SET ROLE anon;
SELECT fx.check('A13 anon cannot execute the helper',
  fx.outcome($$SELECT public.video_publish_own_post_has_media('00000000-0000-4000-8000-0000000001a1')$$),
  '42501: permission denied for function video_publish_own_post_has_media');
SELECT fx.check('A13b anon cannot execute video_publish_post',
  fx.outcome($$SELECT public.video_publish_post('00000000-0000-4000-8000-0000000000a2', '', 'public', ARRAY['street'], 'anon-000000001')$$),
  '42501: permission denied for function video_publish_post');
SELECT fx.check('A13c anon cannot read post_media',
  fx.outcome($$SELECT count(*) FROM public.post_media$$),
  '42501: permission denied for table post_media');
RESET ROLE;
