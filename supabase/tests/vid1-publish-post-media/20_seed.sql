-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261013_0004 · seed (as the owner). Synthetic ids only.
--   member A  …000a      member B  …000b
--   videos  vA1 vA2 vA3 (A)   vB1 (B) — all ready, purpose post
--   pA_legacy  A's post left UNLINKED by the older two-step publish (no photos)
--   pA_media   A's post whose only sign of photographs is a post_media row
--   pA_urls    A's post with image_urls AND a post_media row
--   pB_media   B's post with a post_media row (the cross-member target)
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.videos (id, owner_id, state, purpose) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'ready', 'post'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a', 'ready', 'post'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-00000000000a', 'ready', 'post'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'ready', 'post');

INSERT INTO public.posts (id, user_id, content, privacy, categories, idempotency_key, image_urls) VALUES
  ('00000000-0000-4000-8000-0000000001a0', '00000000-0000-4000-8000-00000000000a', '',             'public', ARRAY['street'], 'legacy-two-step-0001', NULL),
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000000a', 'a photo post', 'public', ARRAY['street'], 'photo-media-only-001', NULL),
  ('00000000-0000-4000-8000-0000000001a2', '00000000-0000-4000-8000-00000000000a', 'photos + urls','public', ARRAY['street'], 'photo-with-urls-0001', ARRAY['https://example.invalid/a.jpg']),
  ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-00000000000b', 'b photo post', 'friends', ARRAY['street'], 'photo-media-b-000001', NULL);

INSERT INTO public.media_objects (id, owner_id) VALUES
  ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-0000000002a2', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-00000000000b');

INSERT INTO public.post_media (post_id, ord, media_id) VALUES
  ('00000000-0000-4000-8000-0000000001a1', 0, '00000000-0000-4000-8000-0000000002a1'),
  ('00000000-0000-4000-8000-0000000001a2', 0, '00000000-0000-4000-8000-0000000002a2'),
  ('00000000-0000-4000-8000-0000000001b1', 0, '00000000-0000-4000-8000-0000000002b1');
