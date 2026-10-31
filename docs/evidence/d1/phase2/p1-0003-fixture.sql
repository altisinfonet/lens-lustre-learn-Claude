-- ── P1 · 20260920_0003 fixture · scratch PostgreSQL 17 only. ───────────────
-- public.profiles as the VACUUM sees it on staging (2026-09-28): owned by
-- postgres, 50 live rows, and an index that includes last_active_at
-- (idx_profiles_reengagement_scan), which is why a last_active_at UPDATE is
-- never HOT and always leaves a dead heap tuple. autovacuum is switched OFF on
-- this fixture table only, so the number measured after the file runs is the
-- file's doing and not a background worker's — on staging autovacuum would
-- not have fired anyway (51 dead < the 60-row trigger).
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, last_active_at timestamptz, last_platform text,
  reengagement_sends_count int NOT NULL DEFAULT 0, last_reengagement_sent_at timestamptz
) WITH (autovacuum_enabled = false);
CREATE INDEX idx_profiles_reengagement_scan ON public.profiles
  (last_active_at, reengagement_sends_count, last_reengagement_sent_at) WHERE (reengagement_sends_count < 4);
INSERT INTO public.profiles (id, last_active_at)
  SELECT md5('p' || g)::uuid, now() - interval '1 day' FROM generate_series(1, 50) g;
-- The old timer's footprint: every row updated once -> 50 dead tuples.
UPDATE public.profiles SET last_active_at = now();
SELECT pg_stat_force_next_flush();
