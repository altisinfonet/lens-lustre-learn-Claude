-- F-93 · unit 1 of 5 — the reserved namespace, as DATA rather than as code.
--
-- WHAT GOES WRONG WITHOUT THIS, said first.
-- The vanity route is a catch-all `/:customUrl` and every specific route is
-- matched BEFORE it. So a member whose URL equals a route's first segment is
-- UNREACHABLE — and nothing looks broken. No 404, no error, no log line. Under
-- the change window (unit 3) they would be stuck there for a year.
--
-- `page`, `post`, `entry`, `settings` and `admin` are ordinary English words,
-- and Page and Post are real surnames. A member whose full_name is the single
-- word "Page" generates `page` and disappears.
--
-- WHY A TABLE AND NOT AN ARRAY IN A FUNCTION.
-- There were already TWO hardcoded lists in this database that disagreed with
-- each other and with App.tsx: change_custom_url() carried 45 words including
-- `api`/`www`/`root` that no route uses, while missing `home`,
-- `notifications`, `scheduled-posts` and every static file. A list that must
-- be hand-edited whenever someone adds a page is a list that is wrong within a
-- month. This one is seeded from a derivation and CI re-derives it: see
-- scripts/check-reserved-urls.mjs, which reads App.tsx and public/ and fails
-- the build when a route exists with no reserved row.
--
-- The first attempt at this list was hand-built by grepping single-segment
-- routes (path="/x"). That pattern silently skipped every NESTED route —
-- path="/page/:slug" never matched — and the list came out eleven short. The
-- eleven were exactly the dangerous ones. That is why nothing here is copied.
--
-- Row counts at the time of writing: 39 route first-segments derived from
-- App.tsx, 13 statically served paths derived from public/ plus the build's
-- `assets` output directory, and 16 further words carried over from
-- change_custom_url()'s own list so that removing that hardcoded array loses
-- no coverage. 68 rows.
--
-- ⚠ The markers below are load-bearing. scripts/check-reserved-urls.mjs finds
-- the seeded values by scanning between them; delete them and the check cannot
-- tell what this migration seeds, so it would pass while proving nothing.

CREATE TABLE IF NOT EXISTS public.reserved_custom_urls (
  value      text PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('route','static','legacy')),
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reserved_custom_urls IS
  'F-93. Names that must never be issued as a profile custom_url because a route or a statically served path already occupies that top-level address. Compared case-insensitively. Seeded by derivation from App.tsx and public/; CI re-derives via scripts/check-reserved-urls.mjs and fails when a route has no row here.';

ALTER TABLE public.reserved_custom_urls ENABLE ROW LEVEL SECURITY;

-- Readable by everyone: the signup form must be able to tell a member that a
-- name is unavailable BEFORE they try to claim it. There is nothing sensitive
-- here — every value is already a public URL on the site. Writes stay with the
-- migration role; no policy grants INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS reserved_custom_urls_readable ON public.reserved_custom_urls;
CREATE POLICY reserved_custom_urls_readable
  ON public.reserved_custom_urls FOR SELECT USING (true);

INSERT INTO public.reserved_custom_urls (value, kind, note) VALUES
-- BEGIN DERIVED RESERVED VALUES
  ('__crop-test', 'route', 'App.tsx route first segment'),
  ('ad', 'route', 'App.tsx route first segment'),
  ('admin', 'route', 'App.tsx route first segment'),
  ('certificate', 'route', 'App.tsx route first segment'),
  ('certificates', 'route', 'App.tsx route first segment'),
  ('competitions', 'route', 'App.tsx route first segment'),
  ('cookie-policy', 'route', 'App.tsx route first segment'),
  ('courses', 'route', 'App.tsx route first segment'),
  ('dashboard', 'route', 'App.tsx route first segment'),
  ('dev', 'route', 'App.tsx route first segment'),
  ('discover', 'route', 'App.tsx route first segment'),
  ('edit-profile', 'route', 'App.tsx route first segment'),
  ('entry', 'route', 'App.tsx route first segment'),
  ('featured-artist', 'route', 'App.tsx route first segment'),
  ('feed', 'route', 'App.tsx route first segment'),
  ('forgot-password', 'route', 'App.tsx route first segment'),
  ('friends', 'route', 'App.tsx route first segment'),
  ('hashtag', 'route', 'App.tsx route first segment'),
  ('help-support', 'route', 'App.tsx route first segment'),
  ('home', 'route', 'App.tsx route first segment'),
  ('idverification', 'route', 'App.tsx route first segment'),
  ('journal', 'route', 'App.tsx route first segment'),
  ('judge', 'route', 'App.tsx route first segment'),
  ('login', 'route', 'App.tsx route first segment'),
  ('notifications', 'route', 'App.tsx route first segment'),
  ('page', 'route', 'App.tsx route first segment'),
  ('photos', 'route', 'App.tsx route first segment'),
  ('post', 'route', 'App.tsx route first segment'),
  ('profile', 'route', 'App.tsx route first segment'),
  ('qa', 'route', 'App.tsx route first segment'),
  ('referrals', 'route', 'App.tsx route first segment'),
  ('reset-password', 'route', 'App.tsx route first segment'),
  ('scheduled-posts', 'route', 'App.tsx route first segment'),
  ('settings', 'route', 'App.tsx route first segment'),
  ('signup', 'route', 'App.tsx route first segment'),
  ('unsubscribe', 'route', 'App.tsx route first segment'),
  ('verify', 'route', 'App.tsx route first segment'),
  ('wallet', 'route', 'App.tsx route first segment'),
  ('winners', 'route', 'App.tsx route first segment'),
  ('_headers', 'static', 'served by the CDN before React loads'),
  ('apple-touch-icon.png', 'static', 'served by the CDN before React loads'),
  ('assets', 'static', 'served by the CDN before React loads'),
  ('avatars', 'static', 'served by the CDN before React loads'),
  ('favicon.png', 'static', 'served by the CDN before React loads'),
  ('images', 'static', 'served by the CDN before React loads'),
  ('llms.txt', 'static', 'served by the CDN before React loads'),
  ('manifest.json', 'static', 'served by the CDN before React loads'),
  ('og-image.png', 'static', 'served by the CDN before React loads'),
  ('placeholder.svg', 'static', 'served by the CDN before React loads'),
  ('robots.txt', 'static', 'served by the CDN before React loads'),
  ('sitemap.xml', 'static', 'served by the CDN before React loads'),
  ('sw-image-cache.js', 'static', 'served by the CDN before React loads'),
  ('api', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('www', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('root', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('system', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('support', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('help', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('contact', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('about', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('user', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('users', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('mail', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('ftp', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('cdn', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('static', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('media', 'legacy', 'carried over from change_custom_url()'s hardcoded list'),
  ('not-found', 'legacy', 'carried over from change_custom_url()'s hardcoded list')
-- END DERIVED RESERVED VALUES
ON CONFLICT (value) DO NOTHING;
