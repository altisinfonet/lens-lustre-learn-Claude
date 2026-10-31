-- ── Unit D fixture · scratch PostgreSQL 17 only. ──────────────────────────
-- Roles as on Supabase. postgres is the cluster superuser and therefore
-- bypasses RLS, which is the property Supabase's postgres has via BYPASSRLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- ── Base tables, RLS enabled, policies that DENY anon writes. ─────────────
CREATE TABLE public.profiles_base (
  id int PRIMARY KEY, owner_id text NOT NULL, full_name text, bio text);
CREATE TABLE public.judge_comments_base (
  id int PRIMARY KEY, owner_id text NOT NULL, entry_id int, comment text);
CREATE TABLE public.judge_decisions_base (
  id int PRIMARY KEY, owner_id text NOT NULL, entry_id int, decision text);
CREATE TABLE public.judge_tags_base (
  id int PRIMARY KEY, owner_id text NOT NULL, entry_id int, tag_id int, round_number int);

INSERT INTO public.profiles_base       VALUES (1,'someone-else','Ada','original bio'),(2,'someone-else','Grace','original bio');
INSERT INTO public.judge_comments_base VALUES (1,'someone-else',10,'original comment');
INSERT INTO public.judge_decisions_base VALUES (1,'someone-else',10,'original decision');
INSERT INTO public.judge_tags_base     VALUES (1,'someone-else',10,7,4);

ALTER TABLE public.profiles_base        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_comments_base  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_decisions_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_tags_base      ENABLE ROW LEVEL SECURITY;

-- One permissive policy per table per action per role. Nothing anon can match:
-- every row is owned by 'someone-else', and anon's current_user is 'anon'.
CREATE POLICY own_rows_select ON public.profiles_base        FOR SELECT USING (true);
CREATE POLICY own_rows_update ON public.profiles_base        FOR UPDATE USING (owner_id = current_user);
CREATE POLICY own_rows_select ON public.judge_comments_base  FOR SELECT USING (true);
CREATE POLICY own_rows_update ON public.judge_comments_base  FOR UPDATE USING (owner_id = current_user);
CREATE POLICY own_rows_select ON public.judge_decisions_base FOR SELECT USING (true);
CREATE POLICY own_rows_update ON public.judge_decisions_base FOR UPDATE USING (owner_id = current_user);
CREATE POLICY own_rows_select ON public.judge_tags_base      FOR SELECT USING (true);
CREATE POLICY own_rows_update ON public.judge_tags_base      FOR UPDATE USING (owner_id = current_user);

-- anon holds table privileges on the base tables. RLS, not the grant, is what
-- is supposed to stop it — which is exactly what the definer view bypasses.
GRANT SELECT, UPDATE ON public.profiles_base, public.judge_comments_base,
                        public.judge_decisions_base, public.judge_tags_base
  TO anon, authenticated;

-- ── The five AUTO-UPDATABLE definer views (mask 28 on staging). ───────────
-- security_invoker deliberately not set: default false = runs as owner.
CREATE VIEW public.profiles_public                  AS SELECT id, owner_id, full_name, bio FROM public.profiles_base;
CREATE VIEW public.judge_comments_owner_safe        AS SELECT id, owner_id, entry_id, comment FROM public.judge_comments_base;
CREATE VIEW public.judge_decisions_owner_safe       AS SELECT id, owner_id, entry_id, decision FROM public.judge_decisions_base;
CREATE VIEW public.judge_tag_assignments_owner_safe AS SELECT id, owner_id, entry_id, tag_id, round_number FROM public.judge_tags_base;
CREATE VIEW public.judge_tag_assignments_public_r4  AS SELECT id, owner_id, entry_id, tag_id FROM public.judge_tags_base;

-- ── The five minimal views (mask 0 on staging). ───────────────────────────
CREATE VIEW public.entry_final_votes         AS SELECT 1::int AS entry_id, 1::int AS photo_index, 0::int AS final_votes;
CREATE VIEW public.entry_final_votes_legacy  AS SELECT 1::int AS entry_id, 0::int AS final_votes;
CREATE VIEW public.entry_public_status       AS SELECT 1::int AS entry_id, 'x'::text AS public_status;
CREATE VIEW public.judging_progression_audit AS SELECT 1::int AS entry_id, 'x'::text AS note;
CREATE VIEW public.v_judging_drift           AS SELECT 1::int AS entry_id, 'x'::text AS drift;

-- ── The one materialised view. ────────────────────────────────────────────
CREATE MATERIALIZED VIEW public.entry_vote_counts AS SELECT 1::int AS entry_id, 0::bigint AS votes;

-- ── [A-7] Grants issued AS postgres, so every grantor is postgres, and the
--    resulting ACL is the measured staging pre-state as a set.
DO $g$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'entry_final_votes','entry_final_votes_legacy','entry_public_status',
    'entry_vote_counts','judge_comments_owner_safe','judge_decisions_owner_safe',
    'judge_tag_assignments_owner_safe','judge_tag_assignments_public_r4',
    'judging_progression_audit','profiles_public','v_judging_drift']
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN '
      'ON public.%I TO anon, authenticated, service_role', r);
  END LOOP;
END $g$;
