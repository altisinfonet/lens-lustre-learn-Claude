-- ── P33 · 0042 fixture · scratch PostgreSQL 17 only. ─────────────────────
-- Self-contained: this unit is one PR and does not depend on 0036's fixture.
--
-- The two views under test, with their PRE-0042 definitions copied verbatim
-- from staging's pg_get_viewdef on 2026-09-25, over the minimal base tables
-- they need. judge_decisions_owner_safe is included unchanged, because the
-- whole argument of 0042 is "make these two match the one that is already
-- right", and that claim is worth measuring rather than asserting.
--
-- auth.uid() is stubbed from request.jwt.claim.sub the way Supabase resolves
-- it, so the row filters run for real.
--
-- THE DATA IS BUILT SO EVERY CLAUSE OF THE NEW CORRELATION CAN FAIL:
--   competition C  round 1 PUBLISHED, round 3 NOT published
--   competition D  round 1 PUBLISHED (a DIFFERENT competition's round 1)
--   member A owns entry EA in C; member B owns entry EB in C
--   A's comments:  one in C round 1 (published)      -> must be visible
--                  one in C round 3 (not published)  -> must be hidden
--                  one with round_id NULL            -> must be hidden
--                  one pointing at D's round 1       -> must be hidden
--   A's tags:      one in round 1, one in round 3
--   B's comment and tag in C round 1                 -> never visible to A
--
-- Before 0042 the owner sees ALL FOUR of A's comments and BOTH of A's tags,
-- because C has a published round. That is finding C-A19, and it is the
-- control: without it, "one comment after" would not be evidence of anything.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- ── base tables, with the column types and nullability measured on staging ──
CREATE TABLE public.competition_entries (
  id uuid primary key, competition_id uuid, user_id uuid, title text, status text);
CREATE TABLE public.competition_round_publish (
  competition_id uuid, round_number integer, published_at timestamptz);
CREATE TABLE public.judging_rounds (
  id uuid primary key,
  competition_id uuid NOT NULL,
  round_number integer NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.judge_comments (
  id uuid primary key, entry_id uuid, judge_id uuid, comment text,
  round_id uuid,                      -- NULLABLE on staging. Deliberately so here.
  created_at timestamptz default now(), photo_index integer,
  CONSTRAINT judge_comments_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.competition_entries(id),
  CONSTRAINT judge_comments_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.judging_rounds(id));
CREATE TABLE public.judge_tag_assignments (
  id uuid primary key, entry_id uuid, tag_id uuid, judge_id uuid,
  created_at timestamptz default now(), photo_index integer,
  round_number integer NOT NULL);     -- NOT NULL on staging.
CREATE TABLE public.judge_decisions (
  id uuid primary key, entry_id uuid, judge_id uuid, round_number integer, decision text,
  created_at timestamptz default now(), photo_index integer);

-- ── the three owner-safe views, PRE-0042, verbatim from staging ───────────

CREATE VIEW public.judge_comments_owner_safe AS
 SELECT id,
    entry_id,
    photo_index,
    comment,
    created_at
   FROM judge_comments jc
  WHERE (EXISTS ( SELECT 1
           FROM competition_entries ce
             JOIN competition_round_publish crp ON crp.competition_id = ce.competition_id
          WHERE ce.id = jc.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL));

CREATE VIEW public.judge_tag_assignments_owner_safe AS
 SELECT id,
    entry_id,
    tag_id,
    photo_index,
    round_number,
    created_at
   FROM judge_tag_assignments jta
  WHERE (EXISTS ( SELECT 1
           FROM competition_entries ce
             JOIN competition_round_publish crp ON crp.competition_id = ce.competition_id
          WHERE ce.id = jta.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL));

-- Out of scope for 0042 and included as the reference implementation: this one
-- already correlates the round.
CREATE VIEW public.judge_decisions_owner_safe AS
 SELECT entry_id,
    photo_index,
    decision,
    round_number
   FROM judge_decisions jd
  WHERE (EXISTS ( SELECT 1
           FROM competition_round_publish crp
             JOIN competition_entries ce ON ce.competition_id = crp.competition_id
          WHERE ce.id = jd.entry_id AND ce.user_id = auth.uid() AND crp.round_number = jd.round_number AND crp.published_at IS NOT NULL));

-- The measured staging ACL, post-0033, reproduced exactly:
--   postgres=arwdDxtm  anon=r  authenticated=r  service_role=arwdDxtm
-- and NO PUBLIC entry. Reproduced rather than approximated because the F-66
-- assertion is that CREATE OR REPLACE leaves this string byte-identical, and a
-- simplified ACL would make that a weaker claim than the one being made.
GRANT SELECT ON TABLE public.judge_comments_owner_safe,
                      public.judge_tag_assignments_owner_safe,
                      public.judge_decisions_owner_safe
  TO anon, authenticated;
GRANT ALL ON TABLE public.judge_comments_owner_safe,
                   public.judge_tag_assignments_owner_safe,
                   public.judge_decisions_owner_safe
  TO service_role;

-- ── DATA ─────────────────────────────────────────────────────────────────
INSERT INTO public.competition_entries (id, competition_id, user_id, title, status) VALUES
 ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A entry','submitted'),
 ('22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B entry','submitted');

-- competition C: round 1 published, round 3 not.
-- competition D: round 1 published. Nobody in the fixture owns an entry there;
-- it exists so a round_id can point at ANOTHER competition's published round 1.
INSERT INTO public.competition_round_publish VALUES
 ('cccccccc-cccc-cccc-cccc-cccccccccccc', 1, now()),
 ('cccccccc-cccc-cccc-cccc-cccccccccccc', 3, NULL),
 ('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, now());

INSERT INTO public.judging_rounds (id, competition_id, round_number, name, status) VALUES
 ('c0000001-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc',1,'C Round 1','completed'),
 ('c0000003-0000-0000-0000-000000000003','cccccccc-cccc-cccc-cccc-cccccccccccc',3,'C Round 3','in_progress'),
 ('d0000001-0000-0000-0000-000000000001','dddddddd-dddd-dddd-dddd-dddddddddddd',1,'D Round 1','completed');

INSERT INTO public.judge_comments (id, entry_id, judge_id, comment, round_id, photo_index) VALUES
 ('11000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','99990000-0000-0000-0000-000000000000',
  'A C-R1 PUBLISHED',        'c0000001-0000-0000-0000-000000000001', 0),
 ('11000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','99990000-0000-0000-0000-000000000000',
  'A C-R3 UNPUBLISHED',      'c0000003-0000-0000-0000-000000000003', 0),
 ('11000000-0000-0000-0000-00000000000f','11111111-1111-1111-1111-111111111111','99990000-0000-0000-0000-000000000000',
  'A NULL ROUND',            NULL,                                   0),
 ('11000000-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','99990000-0000-0000-0000-000000000000',
  'A FOREIGN ROUND D-R1',    'd0000001-0000-0000-0000-000000000001', 0),
 ('22000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','99990000-0000-0000-0000-000000000000',
  'B C-R1 PUBLISHED',        'c0000001-0000-0000-0000-000000000001', 0);

INSERT INTO public.judge_tag_assignments (id, entry_id, tag_id, judge_id, photo_index, round_number) VALUES
 ('7a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaa0000-0000-0000-0000-00000000000a','99990000-0000-0000-0000-000000000000',0,1),
 ('7a000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','bbbb0000-0000-0000-0000-00000000000b','99990000-0000-0000-0000-000000000000',0,3),
 ('7b000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','aaaa0000-0000-0000-0000-00000000000a','99990000-0000-0000-0000-000000000000',0,1);

INSERT INTO public.judge_decisions (id, entry_id, judge_id, round_number, decision, photo_index) VALUES
 ('d1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','99990000-0000-0000-0000-000000000000',1,'A R1 PUBLISHED',0),
 ('d1000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','99990000-0000-0000-0000-000000000000',3,'A R3 UNPUBLISHED',0);

\echo 'FIXTURE BUILT (0042)'
