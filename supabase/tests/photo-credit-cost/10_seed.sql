-- FIXTURE · rows, at :scale × the size production showed on 4 Nov 2026 (census
-- run 41752806340: 661 post photos, 5 of them new sets). Entries are a guess, no
-- log counts them: 300 × :scale, with 5 × :scale v3 photos. Post text is padded
-- so a table read walks pages of a realistic width.
INSERT INTO public.profiles (id, full_name, custom_url)
SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Fixture Member ' || g, 'member' || g
  FROM generate_series(1, 200) g;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-8000-000000000001', 'admin');

INSERT INTO public.posts (user_id, content, image_urls)
SELECT o.id, repeat('fixture post text ', 35),
       CASE WHEN g % 90 = 0
            THEN ARRAY[o.base || 'set' || g || '-w1080h810-l5.webp']
            WHEN g % 100 < 47
            THEN ARRAY[o.base || 'old' || g || 'a.webp', o.base || 'old' || g || 'b.webp']
            ELSE ARRAY[o.base || 'old' || g || 'a.webp'] END
  FROM generate_series(1, 450 * :scale) g
 CROSS JOIN LATERAL (
   SELECT ('00000000-0000-4000-8000-' || lpad((g % 200 + 1)::text, 12, '0'))::uuid AS id,
          'https://' || public.photo_set_backfill_cdn() || '/post-images/00000000-0000-4000-8000-'
            || lpad((g % 200 + 1)::text, 12, '0') || '/posts/' AS base) o;

INSERT INTO public.competition_entries (user_id, title, photos)
SELECT o.id, 'Fixture entry ' || g,
       CASE WHEN g % 60 = 0
            THEN ARRAY[o.base || 'set' || g || '-w1080h810-l5f.webp']
            ELSE ARRAY[o.base || 'old' || g || '.webp'] END
  FROM generate_series(1, 300 * :scale) g
 CROSS JOIN LATERAL (
   SELECT ('00000000-0000-4000-8000-' || lpad((g % 200 + 1)::text, 12, '0'))::uuid AS id,
          'https://' || public.photo_set_backfill_cdn() || '/competition-photos/00000000-0000-4000-8000-'
            || lpad((g % 200 + 1)::text, 12, '0') || '/competitions/' AS base) o;

ANALYZE public.posts;
ANALYZE public.competition_entries;
