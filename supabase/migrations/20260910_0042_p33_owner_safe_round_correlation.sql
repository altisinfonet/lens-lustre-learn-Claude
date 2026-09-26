-- ═══════════════════════════════════════════════════════════════════════════
-- P33 · C-A19 — THE TWO OWNER-SAFE VIEWS LEARN WHICH ROUND WAS PUBLISHED.
--
-- `judge_comments_owner_safe` and `judge_tag_assignments_owner_safe` are meant
-- to let a member read the judges' comments and tags on their OWN entry, and
-- only once the admin has formally published that round. Measured on staging
-- 2026-09-25, both do this instead:
--
--     EXISTS (SELECT 1 FROM competition_entries ce
--               JOIN competition_round_publish crp
--                 ON crp.competition_id = ce.competition_id
--              WHERE ce.id = <row>.entry_id
--                AND ce.user_id = auth.uid()
--                AND crp.published_at IS NOT NULL)
--
-- The entry is correlated. The owner is correlated. The ROUND IS NOT. The
-- EXISTS is satisfied by ANY published round of that competition, so the
-- moment round 1 is published the owner can read the judges' comments and tags
-- on their entry from EVERY round — including rounds still being judged.
--
-- That is finding C-A19. D1 raised it and STOPPED rather than build 0036 as
-- first issued; the Auditor confirmed it independently on PostgreSQL 17.11 and
-- ruled the error its own (R-49/R-50, 2026-09-25). 0036 closes five OTHER
-- relations and deliberately changes no definition. This file is the fix.
--
-- `judge_decisions_owner_safe` already carries the correlation
-- (`AND crp.round_number = jd.round_number`) and is NOT touched here. Three
-- views, one shape, one of them right: the fix is to make the other two match
-- the one that was always correct.
--
-- ── THE APPLICATION ALREADY BELIEVES THIS IS HOW THEY BEHAVE ──────────────
-- (Standing Rule 21: an instructing comment is a control, and a comment that
-- disagrees with its code is a finding.)
--
--   src/hooks/dashboard/useDashboardData.ts:182
--     "read from publish-gated owner-safe views (no judge_id leak, and zero
--      rows pre-publication REGARDLESS OF ROUND)"
--   src/components/EntryTagStamps.tsx:35
--     "Returns zero rows until competition_round_publish.published_at is set,
--      so participant stamps stay hidden until the admin formally declares
--      the round."
--   src/hooks/competition/useCompetitionDetail.ts:176
--     "publish-gated owner-safe view ... zero rows pre-publication"
--
-- Every one of those states the guarantee the views do not currently give.
-- This file does not change the intended contract; it makes the database keep
-- the one the application has been written against.
--
-- ── HOW THE ROUND IS RESOLVED, DERIVED ON STAGING, SELECT ONLY ────────────
--
-- `judge_tag_assignments.round_number` is `integer NOT NULL` — the correlation
-- is direct.
--
-- `judge_comments` has NO round_number. It has `round_id uuid`, and
-- `judge_comments_round_id_fkey` references `judging_rounds(id)`.
-- `judging_rounds` is (id, competition_id NOT NULL, round_number integer NOT
-- NULL, name, description, status, created_at). So the mapping is
-- `jc.round_id -> judging_rounds.round_number`, and it is the only one: there
-- is no other round-bearing column or foreign key on judge_comments.
--
-- Two deliberate consequences, both fail-closed, both flagged rather than
-- assumed:
--
--   (a) `judge_comments.round_id` is NULLABLE. A comment with no round cannot
--       be shown to belong to a published round, so it is not returned. On
--       staging judge_comments has 0 rows, so this is unmeasurable there and
--       production is unmeasured. It is the safe direction: the alternative,
--       `(jc.round_id IS NULL OR <correlation>)`, reopens C-A19 for exactly
--       those rows.
--   (b) the join also requires `jr.competition_id = ce.competition_id`. Without
--       it the correlation is on a bare integer, so a round_id pointing at
--       ANOTHER competition's round would be unlocked by the owner's
--       competition publishing the same round number — a smaller version of
--       the same mistake. This is a strengthening beyond the literal wording
--       of the ruling and is called out for acceptance.
--
-- ── WHY `CREATE OR REPLACE VIEW` AND NOT DROP + CREATE ────────────────────
--
-- MEASURED on PostgreSQL 17.11 against this unit's fixture, rather than cited
-- (p33-0042-run-tests.sh step 7 runs it every time):
--
--   before DROP+CREATE  relacl = {postgres=arwdDxtm,anon=r,authenticated=r,
--                                 service_role=arwdDxtm}
--                       anon=t  authenticated=t  service_role=t
--   after  DROP+CREATE  relacl = NULL
--                       anon=f  authenticated=f  service_role=f  PUBLIC=f
--
-- DROP and CREATE resets the relation's ACL to NULL — the built-in default —
-- and gives it a new oid. For a VIEW the built-in default is owner-only, so
-- what is lost is `anon`, `authenticated` AND `service_role`: the six KEPT
-- views' live call sites (SubmissionDetail, EntryTagStamps,
-- useCompetitionDetail, useDashboardData) and every service-role reader would
-- start failing with 42501, silently, at the next read.
--
-- CORRECTION TO A CITATION THIS FILE ORIGINALLY MADE, AND WHICH OTHER P33
-- FILES MAKE TOO: F-66 is recorded as "DROP+CREATE reopens the default PUBLIC
-- grant". That is TRUE OF FUNCTIONS, where PUBLIC holds EXECUTE by default. It
-- is NOT true of tables and views, which have no built-in PUBLIC grant — the
-- measurement above shows PUBLIC=f afterwards. The hazard on a view is grant
-- LOSS, not a PUBLIC reopening. The conclusion is unchanged (do not DROP and
-- CREATE), but the reason is different, and the difference matters: guarding
-- only for a PUBLIC entry would not have caught this.
--
-- CREATE OR REPLACE VIEW preserves the ACL, the owner and the oid. The
-- postcondition asserts the oid is unchanged and the ACL string is
-- byte-identical to the pre-image captured before the replacement, which
-- catches BOTH failure modes.
--
-- The column list and its order are unchanged and must be: CREATE OR REPLACE
-- VIEW cannot alter them, and the postcondition asserts them anyway.
--
-- ── SCOPE ────────────────────────────────────────────────────────────────
-- Two view definitions. No GRANT, no REVOKE, no policy, no default privileges,
-- no other relation. `judge_decisions_owner_safe` is not touched.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE ASSERTION — TWO-LANE. This narrows a leak, so it is meant for both
-- lanes. It still fails closed outside the dispatch workflow, which since
-- PR #293 (R-13) is the only thing that sets p32.lane.
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

-- ── PRECONDITION ──────────────────────────────────────────────────────────
-- The two views exist as definer views owned by postgres; the columns the new
-- definitions correlate on exist with the types they are correlated as; and
-- the round mapping this file depends on is present as a foreign key. The ACL
-- is NOT asserted — production is unmeasured (the Owner's 2026-09-25 reading)
-- and this file must be correct on both lanes. It is captured instead.
DO $preconditions$
DECLARE
  rec  record;
  oid_ oid;
  n    int := 0;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
      ('judge_comments_owner_safe'),
      ('judge_tag_assignments_owner_safe')) AS t(relname)
  LOOP
    n := n + 1;
    SELECT c.oid INTO oid_ FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rec.relname AND c.relkind = 'v';
    IF oid_ IS NULL THEN
      RAISE EXCEPTION 'P33-0042-PRE-001: public.% is not a view', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
    IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = oid_) <> 'postgres' THEN
      RAISE EXCEPTION 'P33-0042-PRE-002: public.% is not owned by postgres', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
    -- C-A24: production's owner_safe views carry reloptions
    -- {security_invoker=off} -- the default, written out explicitly. Staging
    -- has NULL. Both mean the same thing: a definer view. The first version
    -- of this check refused anything non-NULL and so refused production (run
    -- #98) over a spelling, not a semantic. It now accepts NULL, '{}' and the
    -- two explicit spellings of the default, and still refuses anything else
    -- -- security_invoker=on above all, because on an invoker view the base
    -- tables' RLS applies and this file's reasoning about the grant being the
    -- only control would be wrong.
    IF coalesce((SELECT reloptions FROM pg_class WHERE oid = oid_), '{}'::text[]) NOT IN ('{}'::text[], '{security_invoker=off}'::text[], '{security_invoker=false}'::text[]) THEN
      RAISE EXCEPTION
        'P33-0042-PRE-003: public.% carries reloptions (%). This file assumes a '
        'SECURITY DEFINER view: security_invoker unset or explicitly off', rec.relname,
        (SELECT reloptions::text FROM pg_class WHERE oid = oid_)
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;
  IF n <> 2 THEN
    RAISE EXCEPTION 'P33-0042-PRE-004: expected 2 views, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;

  -- judge_tag_assignments.round_number, the direct correlation.
  PERFORM 1 FROM pg_attribute
   WHERE attrelid = 'public.judge_tag_assignments'::regclass
     AND attname = 'round_number' AND atttypid = 'integer'::regtype
     AND attnum > 0 AND NOT attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P33-0042-PRE-005: judge_tag_assignments.round_number is missing or not integer'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- judging_rounds.round_number and .competition_id, the indirect correlation.
  PERFORM 1 FROM pg_attribute
   WHERE attrelid = 'public.judging_rounds'::regclass
     AND attname = 'round_number' AND atttypid = 'integer'::regtype
     AND attnum > 0 AND NOT attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P33-0042-PRE-006: judging_rounds.round_number is missing or not integer'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM 1 FROM pg_attribute
   WHERE attrelid = 'public.judging_rounds'::regclass
     AND attname = 'competition_id' AND atttypid = 'uuid'::regtype
     AND attnum > 0 AND NOT attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P33-0042-PRE-007: judging_rounds.competition_id is missing or not uuid'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The mapping this file depends on must be a declared foreign key, not an
  -- assumption about a column name that happens to end in _id.
  PERFORM 1 FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.conrelid  = 'public.judge_comments'::regclass
     AND c.confrelid = 'public.judging_rounds'::regclass
     AND (SELECT attname FROM pg_attribute
           WHERE attrelid = c.conrelid AND attnum = c.conkey[1]) = 'round_id';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'P33-0042-PRE-008: judge_comments.round_id does not reference judging_rounds. '
      'The round mapping this file is built on is not present in this database'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── PRE-IMAGE — the ACL and column list, to be asserted unchanged after. ──
CREATE TEMP TABLE p33_0042_preimage ON COMMIT DROP AS
SELECT c.relname,
       c.relacl::text AS acl,
       pg_get_userbyid(c.relowner) AS owner,
       array_to_string(ARRAY(SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                               FROM pg_attribute a
                              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                              ORDER BY a.attnum), '|') AS cols,
       c.oid AS oid_
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
 WHERE ns.nspname = 'public'
   AND c.relname IN ('judge_comments_owner_safe', 'judge_tag_assignments_owner_safe');

-- ── THE FIX ───────────────────────────────────────────────────────────────
-- CREATE OR REPLACE, never DROP + CREATE (F-66). Column list and order are
-- byte-for-byte the staging definitions'; only the EXISTS changes.

CREATE OR REPLACE VIEW public.judge_comments_owner_safe AS
 SELECT id,
    entry_id,
    photo_index,
    comment,
    created_at
   FROM judge_comments jc
  WHERE (EXISTS ( SELECT 1
           FROM competition_entries ce
             JOIN judging_rounds jr ON jr.id = jc.round_id
             JOIN competition_round_publish crp ON crp.competition_id = ce.competition_id
          WHERE ce.id = jc.entry_id
            AND ce.user_id = auth.uid()
            AND jr.competition_id = ce.competition_id
            AND crp.round_number = jr.round_number
            AND crp.published_at IS NOT NULL));

CREATE OR REPLACE VIEW public.judge_tag_assignments_owner_safe AS
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
          WHERE ce.id = jta.entry_id
            AND ce.user_id = auth.uid()
            AND crp.round_number = jta.round_number
            AND crp.published_at IS NOT NULL));

COMMENT ON VIEW public.judge_comments_owner_safe IS
  'P33 0042 (C-A19): the owner sees a judge comment only once the comment''s OWN round is published. The round is resolved through judge_comments.round_id -> judging_rounds.round_number, within the same competition. A comment with a NULL round_id is not returned: it cannot be shown to belong to a published round. Before 0042 any published round of the competition exposed every round''s comments.';

COMMENT ON VIEW public.judge_tag_assignments_owner_safe IS
  'P33 0042 (C-A19): the owner sees a tag assignment only once that assignment''s OWN round is published (crp.round_number = jta.round_number). Before 0042 any published round of the competition exposed every round''s tags.';

-- ── POSTCONDITION ─────────────────────────────────────────────────────────
DO $postconditions$
DECLARE
  rec  record;
  cur  record;
  n    int := 0;
  def  text;
BEGIN
  FOR rec IN SELECT * FROM p33_0042_preimage LOOP
    n := n + 1;
    SELECT c.oid AS oid_, c.relacl::text AS acl, pg_get_userbyid(c.relowner) AS owner,
           c.reloptions::text AS reloptions,
           array_to_string(ARRAY(SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                                   FROM pg_attribute a
                                  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                                  ORDER BY a.attnum), '|') AS cols
      INTO cur
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rec.relname;

    -- A DROP + CREATE gives a new oid and resets relacl to NULL, which on a
    -- view means anon, authenticated AND service_role lose SELECT.
    IF cur.oid_ <> rec.oid_ THEN
      RAISE EXCEPTION
        'P33-0042-POST-001: public.% has a new oid. The relation was re-created, '
        'not replaced, and a re-created view carries no grants at all: anon, '
        'authenticated and service_role would all have lost SELECT',
        rec.relname USING ERRCODE = 'raise_exception';
    END IF;
    IF cur.acl IS DISTINCT FROM rec.acl THEN
      RAISE EXCEPTION 'P33-0042-POST-002: public.% ACL changed: % -> %',
        rec.relname, coalesce(rec.acl, '(null)'), coalesce(cur.acl, '(null)')
        USING ERRCODE = 'raise_exception';
    END IF;
    IF cur.owner <> rec.owner THEN
      RAISE EXCEPTION 'P33-0042-POST-003: public.% owner changed: % -> %',
        rec.relname, rec.owner, cur.owner USING ERRCODE = 'raise_exception';
    END IF;
    IF cur.cols <> rec.cols THEN
      RAISE EXCEPTION 'P33-0042-POST-004: public.% column list changed: % -> %',
        rec.relname, rec.cols, cur.cols USING ERRCODE = 'raise_exception';
    END IF;
    IF cur.reloptions IS NOT NULL THEN
      RAISE EXCEPTION
        'P33-0042-POST-005: public.% acquired reloptions (%). It must remain a '
        'definer view with security_invoker unset', rec.relname, cur.reloptions
        USING ERRCODE = 'raise_exception';
    END IF;

    -- The correlation must actually be in the stored definition. A file that
    -- ran without changing anything would otherwise pass every check above.
    def := pg_get_viewdef(cur.oid_, true);
    IF rec.relname = 'judge_tag_assignments_owner_safe'
       AND def !~ 'crp\.round_number = jta\.round_number' THEN
      RAISE EXCEPTION
        'P33-0042-POST-006: judge_tag_assignments_owner_safe has no round correlation'
        USING ERRCODE = 'raise_exception';
    END IF;
    IF rec.relname = 'judge_comments_owner_safe'
       AND (def !~ 'crp\.round_number = jr\.round_number'
            OR def !~ 'jr\.id = jc\.round_id'
            OR def !~ 'jr\.competition_id = ce\.competition_id') THEN
      RAISE EXCEPTION
        'P33-0042-POST-007: judge_comments_owner_safe is missing part of the round correlation'
        USING ERRCODE = 'raise_exception';
    END IF;
    IF def !~ 'auth\.uid\(\)' THEN
      RAISE EXCEPTION 'P33-0042-POST-008: public.% lost its owner check', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
    IF def !~ 'published_at IS NOT NULL' THEN
      RAISE EXCEPTION 'P33-0042-POST-009: public.% lost its publication check', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 2 THEN
    RAISE EXCEPTION 'P33-0042-POST-010: expected 2 views, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;

  -- judge_decisions_owner_safe is out of scope and must be untouched.
  PERFORM 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'judge_decisions_owner_safe'
     AND pg_get_viewdef(c.oid, true) ~ 'crp\.round_number = jd\.round_number';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'P33-0042-POST-011: judge_decisions_owner_safe no longer carries its own round '
      'correlation. This file must not have touched it'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
