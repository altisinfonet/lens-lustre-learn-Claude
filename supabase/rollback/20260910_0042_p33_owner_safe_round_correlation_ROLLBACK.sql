-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0042_p33_owner_safe_round_correlation.sql
-- Identical stem, as required. Two views.
--
-- ⚠ EXECUTING THIS FILE RESTORES FINDING C-A19.
--
-- It puts back the definitions in which `judge_comments_owner_safe` and
-- `judge_tag_assignments_owner_safe` correlate the entry and the owner but NOT
-- the round, so that publishing ANY round of a competition exposes the owner's
-- judge comments and tags from EVERY round, including rounds still being
-- judged. Both views are SECURITY DEFINER and owned by `postgres`, which is
-- BYPASSRLS, so the base tables' RLS is not consulted and nothing else stands
-- between the caller and those rows.
--
-- THE STAGING LANE GUARD BELOW IS THEREFORE MANDATORY. 0042 is two-lane
-- because it narrows; this file widens, so it is staging-only (R-9). The two
-- assertions are deliberately different and neither form should be copied into
-- the other.
--
-- ── WHAT IT RESTORES ──────────────────────────────────────────────────────
--
-- The definitions VERBATIM as measured on staging (fpszggreishhuvdpkmdr,
-- PostgreSQL 17.6) on 2026-09-25, before 0042: same column list, same order,
-- same EXISTS, same formatting as pg_get_viewdef rendered them.
--
-- CREATE OR REPLACE VIEW, never DROP + CREATE, for the same measured reason
-- 0042 uses it: re-creating a view resets its ACL to NULL, so anon,
-- authenticated AND service_role lose SELECT — see the correction in 0042's
-- header, and p33-0042-run-tests.sh step 7, which measures it. The
-- postcondition asserts the oid and the ACL string are both unchanged, and
-- additionally that no PUBLIC entry appeared.
--
-- ── IT REFUSES WHEN THERE IS NOTHING TO UNDO ──────────────────────────────
--
-- The precondition requires 0042's post-state — the round correlation must be
-- present in both stored definitions. Run against the pre-0042 state it
-- refuses, so "it did nothing" and "it did its job" are never the same
-- outcome.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. STAGING ONLY. ──────────────
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback restores finding C-A19: two SECURITY DEFINER views stop '
      'correlating the round, so one published round exposes an entry owner''s '
      'judge comments and tags from every round, including rounds still being '
      'judged. The file cannot detect its own lane, so it refuses unless the '
      'lane is asserted. Set it in THIS session before running: '
      'SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — 0042's post-state must be in place. ────────────────────
DO $preconditions$
DECLARE
  oid_ oid;
  def  text;
  n    int := 0;
  rec  record;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
      ('judge_comments_owner_safe',        'crp\.round_number = jr\.round_number'),
      ('judge_tag_assignments_owner_safe', 'crp\.round_number = jta\.round_number')) AS t(relname, needle)
  LOOP
    n := n + 1;
    SELECT c.oid INTO oid_ FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rec.relname AND c.relkind = 'v';
    IF oid_ IS NULL THEN
      RAISE EXCEPTION 'P33-0042-RB-PRE-001: public.% is not a view', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
    def := pg_get_viewdef(oid_, true);
    IF def !~ rec.needle THEN
      RAISE EXCEPTION
        'P33-0042-RB-PRE-002: public.% does not carry the round correlation, so '
        '0042 is not in effect and there is nothing for this file to roll back',
        rec.relname USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;
  IF n <> 2 THEN
    RAISE EXCEPTION 'P33-0042-RB-PRE-003: expected 2 views, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

CREATE TEMP TABLE p33_0042_rb_preimage ON COMMIT DROP AS
SELECT c.relname, c.relacl::text AS acl, c.oid AS oid_,
       array_to_string(ARRAY(SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                               FROM pg_attribute a
                              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                              ORDER BY a.attnum), '|') AS cols
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
 WHERE ns.nspname = 'public'
   AND c.relname IN ('judge_comments_owner_safe', 'judge_tag_assignments_owner_safe');

-- ── THE RESTORATION — the pre-0042 definitions, verbatim. ─────────────────

CREATE OR REPLACE VIEW public.judge_comments_owner_safe AS
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
          WHERE ce.id = jta.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL));

COMMENT ON VIEW public.judge_comments_owner_safe IS
  'Owner-safe judge comments. WARNING: finding C-A19 is present in this definition — the round is not correlated, so any published round of the competition exposes the owner''s comments from every round. 20260910_0042 fixes it.';

COMMENT ON VIEW public.judge_tag_assignments_owner_safe IS
  'Owner-safe judge tag assignments. WARNING: finding C-A19 is present in this definition — the round is not correlated, so any published round of the competition exposes the owner''s tags from every round. 20260910_0042 fixes it.';

-- ── POSTCONDITION ─────────────────────────────────────────────────────────
DO $postconditions$
DECLARE
  rec   record;
  cur   record;
  pub_n int;
  n     int := 0;
BEGIN
  FOR rec IN SELECT * FROM p33_0042_rb_preimage LOOP
    n := n + 1;
    SELECT c.oid AS oid_, c.relacl::text AS acl,
           array_to_string(ARRAY(SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                                   FROM pg_attribute a
                                  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                                  ORDER BY a.attnum), '|') AS cols,
           pg_get_viewdef(c.oid, true) AS def
      INTO cur
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = rec.relname;

    IF cur.oid_ <> rec.oid_ THEN
      RAISE EXCEPTION 'P33-0042-RB-POST-001: public.% was re-created, not replaced (F-66)',
        rec.relname USING ERRCODE = 'raise_exception';
    END IF;
    IF cur.acl IS DISTINCT FROM rec.acl THEN
      RAISE EXCEPTION 'P33-0042-RB-POST-002: public.% ACL changed: % -> %',
        rec.relname, coalesce(rec.acl, '(null)'), coalesce(cur.acl, '(null)')
        USING ERRCODE = 'raise_exception';
    END IF;
    IF cur.cols <> rec.cols THEN
      RAISE EXCEPTION 'P33-0042-RB-POST-003: public.% column list changed', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT count(*) INTO pub_n FROM pg_class c, LATERAL aclexplode(c.relacl) a
     WHERE c.oid = cur.oid_ AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION
        'P33-0042-RB-POST-004: public.% acquired a PUBLIC ACL entry. CREATE OR '
        'REPLACE must preserve the ACL exactly; a PUBLIC entry means something '
        'granted one, and 0033 (PR #292) has been undone', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
    IF cur.def ~ 'round_number = jta\.round_number' OR cur.def ~ 'round_number = jr\.round_number' THEN
      RAISE EXCEPTION 'P33-0042-RB-POST-005: public.% still carries the round correlation',
        rec.relname USING ERRCODE = 'raise_exception';
    END IF;
    IF cur.def !~ 'auth\.uid\(\)' OR cur.def !~ 'published_at IS NOT NULL' THEN
      RAISE EXCEPTION
        'P33-0042-RB-POST-006: public.% lost its owner or publication check. The '
        'rollback restores C-A19, not an open view', rec.relname
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 2 THEN
    RAISE EXCEPTION 'P33-0042-RB-POST-007: expected 2 views, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
