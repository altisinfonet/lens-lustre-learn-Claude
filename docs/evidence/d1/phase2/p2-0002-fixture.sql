-- ── P2 · 20260920_0002 fixture · scratch PostgreSQL 17 (wal_level=logical, wal2json). ──
-- Production's shape at the Owner's reading of 2026-09-26 18:50 UTC, reduced to
-- what 0002 reads and changes:
--   * publication supabase_realtime, with the three FULL tables R-61 names and
--     one 'd' table standing in for the other 26 (so "exactly one published
--     FULL table" is counted across a publication that has non-FULL members).
--   * primary keys as measured on staging 2026-09-26 (schema is shared):
--     scheduled_posts (id), competition_round_publish (competition_id, round_number),
--     profiles (id).
--   * the columns the realtime subscribers filter on: scheduled_posts.user_id
--     (useScheduledPostsRealtime), competition_round_publish.competition_id
--     (useCompetitionDetail), profiles.id (useAuth's guard).
-- Column lists are cut to what the subscribers and the decode test need; 0002
-- touches no column.
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_banned boolean NOT NULL DEFAULT false, is_suspended boolean NOT NULL DEFAULT false, bio text);
CREATE TABLE public.scheduled_posts (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending', content text);
CREATE TABLE public.competition_round_publish (competition_id uuid NOT NULL, round_number int NOT NULL, published_at timestamptz,
  PRIMARY KEY (competition_id, round_number));
CREATE TABLE public.posts (id uuid PRIMARY KEY, body text);

ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.scheduled_posts REPLICA IDENTITY FULL;
ALTER TABLE public.competition_round_publish REPLICA IDENTITY FULL;

CREATE PUBLICATION supabase_realtime FOR TABLE public.profiles, public.scheduled_posts,
  public.competition_round_publish, public.posts;

INSERT INTO public.profiles (id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO public.scheduled_posts (id, user_id, content) VALUES
  ('5c000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'one'),
  ('5c000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'two'),
  ('5c000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'three');
INSERT INTO public.competition_round_publish VALUES
  ('c0000000-0000-0000-0000-000000000001', 1, now()),
  ('c0000000-0000-0000-0000-000000000001', 2, now()),
  ('c0000000-0000-0000-0000-000000000001', 3, now());

-- relreplident of every published table: the pre-image the rollback must restore.
CREATE FUNCTION public.fx_ri() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(pt.tablename || '=' || c.relreplident::text, ' ' ORDER BY pt.tablename)
    FROM pg_publication_tables pt
    JOIN pg_class c ON c.relname = pt.tablename AND c.relnamespace = pt.schemaname::regnamespace
   WHERE pt.pubname = 'supabase_realtime'
$$;
\echo 'FIXTURE BUILT (P2 0002)'
