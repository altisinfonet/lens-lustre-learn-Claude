-- ── P33 fixture · scratch PostgreSQL 17 only. ────────────────────────────
-- The ELEVEN P33 relations, with the definitions copied VERBATIM from
-- staging's pg_get_viewdef on 2026-09-25, over the minimal base tables they
-- need. auth.uid() is stubbed from request.jwt.claim.sub, the way Supabase
-- resolves it, so the row filters run for real rather than being simulated.
--
-- Two members. A published round and an unpublished round. One award-family
-- R4 tag and one non-award tag.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='app_role') THEN CREATE TYPE app_role AS ENUM ('admin','judge','member'); END IF;
END $$;
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role app_role) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;          -- no admins in the fixture
CREATE OR REPLACE FUNCTION public.classify_judging_tag(_label text, _visible int[])
  RETURNS TABLE(family text, advances_to int, blocks_from int, verification_round int)
  LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN _label ILIKE 'top %' THEN 'progression_pass' ELSE 'progression_fail' END,
          NULL::int, NULL::int, NULL::int $$;

-- ── base tables ──────────────────────────────────────────────────────────
CREATE TABLE public.competition_entries (
  id uuid primary key, competition_id uuid, user_id uuid, title text, description text,
  status text, placement text, current_round text, progression_decision text,
  updated_at timestamptz default now());
CREATE TABLE public.competition_round_publish (
  competition_id uuid, round_number integer, published_at timestamptz);
CREATE TABLE public.judge_comments (
  id uuid primary key, entry_id uuid, judge_id uuid, comment text, round_id uuid,
  created_at timestamptz default now(), photo_index integer);
CREATE TABLE public.judge_decisions (
  id uuid primary key, entry_id uuid, judge_id uuid, round_number integer, decision text,
  created_at timestamptz default now(), photo_index integer, stage_key text);
CREATE TABLE public.judge_tag_assignments (
  id uuid primary key, entry_id uuid, tag_id uuid, judge_id uuid,
  created_at timestamptz default now(), photo_index integer, round_number integer);
CREATE TABLE public.judging_tags (
  id uuid primary key, label text, is_active boolean default true,
  is_visible boolean default true, visible_in_round integer[]);
CREATE TABLE public.v3_stage_catalog (
  id uuid primary key default gen_random_uuid(), stage_key text, round_number integer,
  family text, tag_label_canonical text, blocks_from_round integer, is_active boolean default true);
CREATE TABLE public.v3_tag_label_alias (alias_label text, round_number integer);
CREATE TABLE public.v3_mirror_log (
  id uuid primary key, entry_id uuid, judge_id uuid, round_number integer, photo_index integer,
  tag_label text, matched_stage text, error_message text, action text,
  occurred_at timestamptz default now(), reviewed_at timestamptz);
CREATE TABLE public.competition_votes (id uuid primary key, entry_id uuid, photo_index integer);
CREATE TABLE public.admin_vote_adjustments (entry_id uuid, photo_index integer, adjustment_value integer);
CREATE TABLE public.profiles_public_data (
  id uuid primary key, full_name text, avatar_url text, bio text, portfolio_url text,
  photography_interests text[], facebook_url text, instagram_url text, twitter_url text,
  youtube_url text, website_url text, preferred_language text, is_suspended boolean,
  created_at timestamptz, updated_at timestamptz, custom_url text, pronouns text,
  current_city text, workplace text, education text, is_banned boolean,
  last_active_at timestamptz, notification_sound_enabled boolean);

-- ── THE ELEVEN, verbatim from staging pg_get_viewdef 2026-09-25 ──────────

CREATE VIEW public.judge_comments_owner_safe AS
 SELECT id, entry_id, photo_index, comment, created_at
   FROM judge_comments jc
  WHERE (EXISTS ( SELECT 1
           FROM competition_entries ce
             JOIN competition_round_publish crp ON crp.competition_id = ce.competition_id
          WHERE ce.id = jc.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL));

CREATE VIEW public.judge_decisions_owner_safe AS
 SELECT entry_id, photo_index, decision, round_number
   FROM judge_decisions jd
  WHERE (EXISTS ( SELECT 1
           FROM competition_round_publish crp
             JOIN competition_entries ce ON ce.competition_id = crp.competition_id
          WHERE ce.id = jd.entry_id AND ce.user_id = auth.uid() AND crp.round_number = jd.round_number AND crp.published_at IS NOT NULL));

CREATE VIEW public.judge_tag_assignments_owner_safe AS
 SELECT id, entry_id, tag_id, photo_index, round_number, created_at
   FROM judge_tag_assignments jta
  WHERE (EXISTS ( SELECT 1
           FROM competition_entries ce
             JOIN competition_round_publish crp ON crp.competition_id = ce.competition_id
          WHERE ce.id = jta.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL));

CREATE VIEW public.judge_tag_assignments_public_r4 AS
 SELECT id, entry_id, tag_id, photo_index, round_number, created_at
   FROM judge_tag_assignments jta
  WHERE (EXISTS ( SELECT 1
           FROM judging_tags jt
             JOIN v3_stage_catalog sc ON sc.tag_label_canonical = jt.label
          WHERE jt.id = jta.tag_id AND sc.family = 'award'::text AND sc.round_number = 4 AND sc.is_active)) AND (EXISTS ( SELECT 1
           FROM competition_entries ce
             JOIN competition_round_publish crp ON crp.competition_id = ce.competition_id
          WHERE ce.id = jta.entry_id AND crp.round_number = 4 AND crp.published_at IS NOT NULL));

CREATE VIEW public.judging_progression_audit AS
 WITH per_photo AS (
         SELECT jta.entry_id, jta.photo_index,
            mode() WITHIN GROUP (ORDER BY c_1.family) AS majority_family,
            count(DISTINCT jta.judge_id) AS judge_count
           FROM judge_tag_assignments jta
             JOIN judging_tags t ON t.id = jta.tag_id
             CROSS JOIN LATERAL classify_judging_tag(t.label, t.visible_in_round) c_1(family, advances_to, blocks_from, verification_round)
          GROUP BY jta.entry_id, jta.photo_index
        ), agg AS (
         SELECT per_photo.entry_id,
            bool_or(per_photo.majority_family = 'progression_pass'::text) AS any_pass,
            bool_or(per_photo.majority_family = 'progression_fail'::text) AS any_fail,
            bool_or(per_photo.majority_family = 'rejection'::text) AS any_reject,
            sum(per_photo.judge_count) AS total_decisions
           FROM per_photo GROUP BY per_photo.entry_id
        ), computed AS (
         SELECT agg.entry_id,
                CASE WHEN agg.any_pass THEN 'qualified'::text
                     WHEN agg.any_fail THEN 'not_selected'::text
                     WHEN agg.any_reject THEN 'reject'::text
                     ELSE NULL::text END AS expected_decision,
            agg.total_decisions FROM agg
        )
 SELECT ce.id AS entry_id, ce.competition_id, ce.title, ce.status,
    ce.progression_decision AS stored_decision, c.expected_decision, c.total_decisions,
        CASE WHEN ce.progression_decision IS NULL AND c.expected_decision IS NULL THEN false
             WHEN ce.progression_decision IS DISTINCT FROM c.expected_decision THEN true
             ELSE false END AS has_drift,
    ce.updated_at
   FROM competition_entries ce
     LEFT JOIN computed c ON c.entry_id = ce.id;

CREATE VIEW public.v_judging_drift AS
 SELECT 'F1_TAG_WITHOUT_DECISION'::text AS finding_code, 'judge_tag_assignments'::text AS source_table,
    jta.id AS source_row_id, jta.entry_id, jta.judge_id, jta.round_number, jta.photo_index,
    jt.label AS detail_label, NULL::text AS expected_value, NULL::text AS actual_value,
    jta.created_at AS occurred_at
   FROM judge_tag_assignments jta
     LEFT JOIN judging_tags jt ON jt.id = jta.tag_id
  WHERE NOT (EXISTS ( SELECT 1 FROM judge_decisions jd
          WHERE jd.entry_id = jta.entry_id AND jd.judge_id = jta.judge_id AND jd.round_number = jta.round_number AND NOT jd.photo_index IS DISTINCT FROM jta.photo_index));

CREATE VIEW public.entry_vote_counts_src AS SELECT 1;  -- placeholder, replaced below
DROP VIEW public.entry_vote_counts_src;
CREATE MATERIALIZED VIEW public.entry_vote_counts AS
 SELECT cv.entry_id,
    count(cv.id)::integer AS real_votes,
    COALESCE(adj.total_adjustment, 0::bigint)::integer AS adjustment_votes,
    (count(cv.id) + COALESCE(adj.total_adjustment, 0::bigint))::integer AS final_votes
   FROM competition_votes cv
     LEFT JOIN ( SELECT admin_vote_adjustments.entry_id,
            sum(admin_vote_adjustments.adjustment_value) AS total_adjustment
           FROM admin_vote_adjustments GROUP BY admin_vote_adjustments.entry_id) adj ON adj.entry_id = cv.entry_id
  GROUP BY cv.entry_id, adj.total_adjustment;

CREATE VIEW public.entry_final_votes AS
 WITH photo_keys AS (
         SELECT competition_votes.entry_id, competition_votes.photo_index FROM competition_votes
        UNION
         SELECT admin_vote_adjustments.entry_id, admin_vote_adjustments.photo_index FROM admin_vote_adjustments
        ), real_counts AS (
         SELECT competition_votes.entry_id, competition_votes.photo_index, count(*)::integer AS real_votes
           FROM competition_votes GROUP BY competition_votes.entry_id, competition_votes.photo_index
        ), adj_sums AS (
         SELECT admin_vote_adjustments.entry_id, admin_vote_adjustments.photo_index,
            COALESCE(sum(admin_vote_adjustments.adjustment_value), 0::bigint)::integer AS adjustment_total
           FROM admin_vote_adjustments GROUP BY admin_vote_adjustments.entry_id, admin_vote_adjustments.photo_index
        )
 SELECT pk.entry_id, pk.photo_index,
    COALESCE(rc.real_votes, 0) AS real_votes,
    COALESCE(asu.adjustment_total, 0) AS adjustment_total,
    GREATEST(0, COALESCE(rc.real_votes, 0) + COALESCE(asu.adjustment_total, 0)) AS final_votes
   FROM photo_keys pk
     LEFT JOIN real_counts rc ON rc.entry_id = pk.entry_id AND rc.photo_index = pk.photo_index
     LEFT JOIN adj_sums asu ON asu.entry_id = pk.entry_id AND asu.photo_index = pk.photo_index;

CREATE VIEW public.entry_final_votes_legacy AS
 SELECT entry_id,
    sum(real_votes)::integer AS real_votes,
    sum(adjustment_total)::integer AS adjustment_total,
    sum(final_votes)::integer AS final_votes
   FROM entry_final_votes GROUP BY entry_id;

CREATE VIEW public.profiles_public AS
 SELECT id, full_name, avatar_url, bio, portfolio_url, photography_interests,
    facebook_url, instagram_url, twitter_url, youtube_url, website_url,
    preferred_language, is_suspended, created_at, updated_at, custom_url,
    pronouns, current_city, workplace, education
   FROM profiles_public_data;

-- entry_public_status is reproduced in full; it is the only one of the five
-- with a row filter, and the filter is what the justification cites.
CREATE VIEW public.entry_public_status AS
 WITH latest_published AS (
         SELECT competition_round_publish.competition_id,
            max(competition_round_publish.round_number) FILTER (WHERE competition_round_publish.published_at IS NOT NULL) AS latest_published_round,
            bool_or(competition_round_publish.published_at IS NOT NULL) AS has_any_published_round
           FROM competition_round_publish GROUP BY competition_round_publish.competition_id
        ), canonical_decision AS (
         SELECT e.id AS entry_id, c.stage_key, c.round_number AS decision_round, c.family, c.blocks_from_round
           FROM competition_entries e JOIN v3_stage_catalog c ON c.stage_key = e.progression_decision
        ), base AS (
         SELECT e.id, e.competition_id, e.status, e.current_round, e.placement, e.progression_decision,
            lp.latest_published_round, COALESCE(lp.has_any_published_round, false) AS has_any_published_round,
            cd.stage_key AS canonical_stage_key, cd.decision_round, cd.family AS decision_family,
            NULLIF(regexp_replace(COALESCE(e.current_round, ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS current_round_num,
                CASE WHEN e.placement = ANY (ARRAY['winner'::text,'runner_up_1'::text,'runner_up_2'::text,'honorary_mention'::text,'honourable_mention'::text,'honorable_mention'::text,'special_jury'::text,'top_50'::text,'top_100'::text,'finalist'::text]) THEN e.placement
                     WHEN e.status = 'winner'::text THEN 'winner'::text
                     WHEN e.status = 'finalist'::text AND lp.latest_published_round >= 4 THEN 'finalist'::text
                     ELSE NULL::text END AS r4_public_award
           FROM competition_entries e
             LEFT JOIN latest_published lp ON lp.competition_id = e.competition_id
             LEFT JOIN canonical_decision cd ON cd.entry_id = e.id
        )
 SELECT id AS entry_id, competition_id,
        CASE WHEN latest_published_round >= 4 AND r4_public_award IS NOT NULL THEN r4_public_award
             WHEN canonical_stage_key IS NOT NULL AND latest_published_round IS NOT NULL AND decision_round <= latest_published_round THEN canonical_stage_key
             ELSE 'judging_in_progress'::text END AS public_status,
        CASE WHEN has_any_published_round THEN latest_published_round::text ELSE NULL::text END AS public_round,
        NULL::text AS public_progression_note,
        CASE WHEN placement IS NOT NULL AND latest_published_round >= 4 THEN placement ELSE NULL::text END AS public_placement,
        NULL::text[] AS public_r4_tags
   FROM base
  WHERE (status = ANY (ARRAY['submitted'::text,'approved'::text,'winner'::text,'runner_up'::text,'honorary'::text,'finalist'::text,'shortlisted'::text,'qualified'::text,'round1_qualified'::text,'round2_qualified'::text,'round3_qualified'::text])) OR ( SELECT has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) AS has_role);

-- ── the measured staging SELECT grants (post-0033) ───────────────────────
DO $g$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'judging_progression_audit','v_judging_drift','entry_public_status','entry_vote_counts',
    'entry_final_votes_legacy','judge_comments_owner_safe','judge_decisions_owner_safe',
    'judge_tag_assignments_owner_safe','judge_tag_assignments_public_r4','profiles_public','entry_final_votes']
  LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated, service_role', r);
  END LOOP;
END $g$;

-- ── A SECURITY DEFINER wrapper per closed relation, owned by postgres.
-- This is the stand-in for get_judging_drift_admin, get_entry_vote_counts and
-- the eight entry_public_status readers: after 0036 it must still read.
CREATE FUNCTION public.definer_read_probe(_rel text) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public' AS
$w$ DECLARE n bigint; BEGIN EXECUTE format('SELECT count(*) FROM public.%I', _rel) INTO n; RETURN n; END $w$;
GRANT EXECUTE ON FUNCTION public.definer_read_probe(text) TO anon, authenticated, service_role;

-- ── DATA ─────────────────────────────────────────────────────────────────
-- Competition C. Round 1 PUBLISHED, round 3 NOT published, round 4 PUBLISHED.
-- Member A owns entry EA. Member B owns entry EB.
INSERT INTO public.competition_entries (id, competition_id, user_id, title, status, current_round, progression_decision) VALUES
 ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A entry','submitted','4',NULL),
 ('22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B entry','submitted','4',NULL);
INSERT INTO public.competition_round_publish VALUES
 ('cccccccc-cccc-cccc-cccc-cccccccccccc', 1, now()),
 ('cccccccc-cccc-cccc-cccc-cccccccccccc', 3, NULL),
 ('cccccccc-cccc-cccc-cccc-cccccccccccc', 4, now());

-- Tags: one award-family R4 tag, one non-award tag.
INSERT INTO public.judging_tags (id, label, visible_in_round) VALUES
 ('aaaa0000-0000-0000-0000-00000000000a','Top 50', ARRAY[4]),
 ('bbbb0000-0000-0000-0000-00000000000b','Needs Work', ARRAY[3]);
INSERT INTO public.v3_stage_catalog (stage_key, round_number, family, tag_label_canonical, is_active) VALUES
 ('r4_top_50', 4, 'award',            'Top 50',     true),
 ('r3_fail',   3, 'progression_fail', 'Needs Work', true);

-- Decisions: round 1 (published) and round 3 (NOT published), for both members.
INSERT INTO public.judge_decisions (id, entry_id, judge_id, round_number, decision, photo_index) VALUES
 ('d1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','99990000-0000-0000-0000-000000000000',1,'A R1 PUBLISHED',0),
 ('d1000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','99990000-0000-0000-0000-000000000000',3,'A R3 UNPUBLISHED',0),
 ('d2000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','99990000-0000-0000-0000-000000000000',1,'B R1 PUBLISHED',0),
 ('d2000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','99990000-0000-0000-0000-000000000000',3,'B R3 UNPUBLISHED',0);

-- Tag assignments:
--   A: an award tag in the PUBLISHED round 4, and a non-award tag in round 3.
--   B: an award tag in round 4 of the same (published) competition.
INSERT INTO public.judge_tag_assignments (id, entry_id, tag_id, judge_id, photo_index, round_number) VALUES
 ('7a000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','aaaa0000-0000-0000-0000-00000000000a','99990000-0000-0000-0000-000000000000',0,4),
 ('7a000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','bbbb0000-0000-0000-0000-00000000000b','99990000-0000-0000-0000-000000000000',0,3),
 ('7b000000-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','aaaa0000-0000-0000-0000-00000000000a','99990000-0000-0000-0000-000000000000',0,4);

INSERT INTO public.competition_votes VALUES
 ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',0);
INSERT INTO public.admin_vote_adjustments VALUES
 ('11111111-1111-1111-1111-111111111111',0,5);
INSERT INTO public.profiles_public_data (id, full_name, is_suspended, is_banned) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Member A', false, false);
-- ── A SECOND COMPETITION, so "R4 is not published" is a real case and not an
-- absence. Competition D's round 4 exists and is NOT published. Member C's
-- entry EC carries the SAME award-family R4 tag that A and B carry in the
-- published competition. Without this row, the r4 publication filter could be
-- deleted and every assertion would still pass (C-34).
INSERT INTO public.competition_entries (id, competition_id, user_id, title, status, current_round, progression_decision) VALUES
 ('33333333-3333-3333-3333-333333333333','dddddddd-dddd-dddd-dddd-dddddddddddd','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','C entry','submitted','4',NULL);
INSERT INTO public.competition_round_publish VALUES
 ('dddddddd-dddd-dddd-dddd-dddddddddddd', 4, NULL);
INSERT INTO public.judge_tag_assignments (id, entry_id, tag_id, judge_id, photo_index, round_number) VALUES
 ('7c000000-0000-0000-0000-000000000004','33333333-3333-3333-3333-333333333333','aaaa0000-0000-0000-0000-00000000000a','99990000-0000-0000-0000-000000000000',0,4);

REFRESH MATERIALIZED VIEW public.entry_vote_counts;
