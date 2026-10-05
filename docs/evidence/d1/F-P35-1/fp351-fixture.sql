-- F-P35-1 fixture — SCRATCH ONLY (database fp351). The six tables with the ACL
-- read on staging fpszgg 2026-10-05 (anon/authenticated/service_role = arwdDxtm,
-- RLS on). Policies are the staging set reduced to what decides these tests:
-- post_comments SELECT TO public USING (true) (staging: "visible posts"), INSERT/
-- UPDATE/DELETE own row by auth.uid(); reports INSERT/SELECT own row TO
-- authenticated; snapshots: admin-only SELECT TO authenticated. auth.uid() reads
-- the request.jwt.claim.sub setting, as Supabase's does.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.post_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL, user_id uuid NOT NULL, content text NOT NULL);
CREATE TABLE public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL, target_type text NOT NULL, target_id text NOT NULL, reason text NOT NULL);
CREATE TABLE public._v3_preflight_snapshot_competition_entries (id uuid PRIMARY KEY, photos text[]);
CREATE TABLE public._v3_preflight_snapshot_judge_decisions (id uuid PRIMARY KEY, decision text);
CREATE TABLE public._v3_preflight_snapshot_judge_tag_assignments (id uuid PRIMARY KEY);
CREATE TABLE public._v3_preflight_snapshot_judging_tags (id uuid PRIMARY KEY, image_url text);
DO $g$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['post_comments','reports','_v3_preflight_snapshot_competition_entries','_v3_preflight_snapshot_judge_decisions','_v3_preflight_snapshot_judge_tag_assignments','_v3_preflight_snapshot_judging_tags'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', t);
  END LOOP; END $g$;
CREATE POLICY "Users can view comments on visible posts" ON public.post_comments FOR SELECT USING (true);
CREATE POLICY "Authenticated users can comment on visible posts" ON public.post_comments FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own comments" ON public.post_comments FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own comments" ON public.post_comments FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "Users can create reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "Users can view own reports" ON public.reports FOR SELECT TO authenticated USING (reporter_id = auth.uid());
CREATE POLICY snapshot_admin_read_ce ON public._v3_preflight_snapshot_competition_entries FOR SELECT TO authenticated USING (false);
CREATE POLICY snapshot_admin_read_jd ON public._v3_preflight_snapshot_judge_decisions FOR SELECT TO authenticated USING (false);
INSERT INTO public.post_comments (post_id, user_id, content) SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'c' || g FROM generate_series(1, 5) g;
INSERT INTO public.reports (reporter_id, target_type, target_id, reason) VALUES ('00000000-0000-0000-0000-0000000000b1', 'post', 'x', 'spam');
INSERT INTO public._v3_preflight_snapshot_judge_decisions VALUES (gen_random_uuid(), 'advance');
