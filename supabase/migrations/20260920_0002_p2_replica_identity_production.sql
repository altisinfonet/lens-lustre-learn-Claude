-- ═══════════════════════════════════════════════════════════════════════════
-- P2 · 20260920_0002 — REPLICA IDENTITY DEFAULT on competition_round_publish
-- Phase 2 units 2-D1-03 / 2-D1-05 (A-2). Ruled by R-61, narrowed by R-62.
-- PRODUCTION LANE ONLY.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- LANE. p32.lane = 'production', exactly. This file lands on staging with the
-- rest of the tree and is NOT dispatched there: staging's supabase_realtime
-- publication has 0 tables and no table on staging is REPLICA IDENTITY FULL
-- (the Auditor's staging reading, 2026-09-27; D1 re-read 2026-09-26 19:05 UTC:
-- competition_round_publish is relreplident 'd' on staging). A staging
-- dispatch refuses at the first block.
--
-- WHAT. Production's supabase_realtime publishes 29 tables; three are FULL:
-- competition_round_publish, profiles, scheduled_posts (the Owner's production
-- reading, 2026-09-26 18:50 UTC; the full list is in
-- docs/evidence/d1/phase2/replica-identity.md). FULL writes the whole old row
-- into WAL on every UPDATE and DELETE, and Realtime decodes it — realtime
-- decode was 48.2 % of all production database time at that reading.
--
--   public.competition_round_publish  FULL -> DEFAULT (PK competition_id, round_number)
--   public.profiles                   KEEP FULL (R-61/R-62, justified in replica-identity.md)
--   public.scheduled_posts            KEEP FULL (R-62, F-P2-1, justified in replica-identity.md)
--
-- WHY THIS ONE TABLE IS SAFE. Realtime evaluates a DELETE's subscription
-- filter against the old-row image, which under DEFAULT is the primary key.
-- competition_round_publish's subscribers filter on competition_id — inside the
-- primary key — or not at all, so every event they receive today they still
-- receive (measured: replica-identity.md, and harness steps 2/3b). The
-- handlers only invalidate queries; none reads payload.old. UPDATE and INSERT
-- events are unaffected: the filter is evaluated on the new row.
--
-- scheduled_posts was in R-61's first cut and is NOT here: its subscriber
-- filters on user_id, outside the primary key, so under DEFAULT a DELETE (a
-- member cancelling a post) would stop reaching the member's other devices
-- (F-P2-1, measured two ways; R-62 keeps it FULL).
--
-- DEFAULT on a published table is safe exactly when the table HAS a primary
-- key: with none, DEFAULT means "no identity" and every UPDATE and DELETE on it
-- then fails outright. PRE-003 asserts the key, by column list, first.
--
-- OBJECTS (reservation 2-D1-01): public.competition_round_publish (replica
-- identity only); publication supabase_realtime (read only — membership is
-- asserted, not changed). profiles and scheduled_posts are read, not altered.
--
-- LOCKS. ALTER TABLE ... REPLICA IDENTITY takes ACCESS EXCLUSIVE on the table
-- for the length of this transaction. lock_timeout 5 s, SET LOCAL, so a lock
-- that has to queue aborts the file instead of stalling every reader behind it.
--
-- NOT RE-RUNNABLE. A second apply finds the table already 'd' and PRE-002
-- refuses — a sentence, not a silent success.
--
-- ROLLBACK: supabase/rollback/20260920_0002_p2_replica_identity_production_ROLLBACK.sql
--   (production only, the same lane guard as this file.)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'production' THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as production (read: %). '
      '20260920_0002 is production-tailored (R-61/R-62): staging publishes no realtime '
      'tables and has no REPLICA IDENTITY FULL, so there is nothing here for it to do '
      'and a staging dispatch is refused by design.',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  pk       text;
  full_set text;
BEGIN
  -- PRE-001 · the target exists.
  IF to_regclass('public.competition_round_publish') IS NULL THEN
    RAISE EXCEPTION 'P2-0002-PRE-001: public.competition_round_publish does not exist'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-002 · it is FULL today. A second apply stops here.
  IF (SELECT relreplident FROM pg_class WHERE oid = 'public.competition_round_publish'::regclass) <> 'f' THEN
    RAISE EXCEPTION 'P2-0002-PRE-002: public.competition_round_publish is REPLICA IDENTITY %, not FULL. '
      'Already applied, or production has changed since the 2026-09-26 reading; re-read before anything else',
      (SELECT relreplident FROM pg_class WHERE oid = 'public.competition_round_publish'::regclass)
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-003 · it has exactly the primary key R-61 names. DEFAULT without a
  -- primary key is "no identity": UPDATE and DELETE on a published table would
  -- then fail. This is the check that makes DEFAULT safe.
  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO pk
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = 'public.competition_round_publish'::regclass AND c.contype = 'p';
  IF pk IS DISTINCT FROM 'competition_id,round_number' THEN
    RAISE EXCEPTION 'P2-0002-PRE-003: public.competition_round_publish primary key is (%), '
      'not (competition_id, round_number)', coalesce(pk, 'NONE')
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-004 · it is published by supabase_realtime (that is why this file exists).
  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'competition_round_publish';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P2-0002-PRE-004: public.competition_round_publish is not in publication supabase_realtime'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-005 · the published FULL set is exactly the three the reading found.
  -- Anything else means production moved since 2026-09-26 18:50 UTC, and this
  -- file was built for that reading, not for whatever it is now.
  SELECT string_agg(pt.schemaname || '.' || pt.tablename, ',' ORDER BY pt.tablename) INTO full_set
    FROM pg_publication_tables pt
    JOIN pg_class c ON c.relname = pt.tablename AND c.relnamespace = pt.schemaname::regnamespace
   WHERE pt.pubname = 'supabase_realtime' AND c.relreplident = 'f';
  IF full_set IS DISTINCT FROM 'public.competition_round_publish,public.profiles,public.scheduled_posts' THEN
    RAISE EXCEPTION 'P2-0002-PRE-005: the published FULL tables are (%), not exactly '
      'competition_round_publish, profiles, scheduled_posts as read on 2026-09-26', coalesce(full_set, 'none')
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;


ALTER TABLE public.competition_round_publish REPLICA IDENTITY DEFAULT;


DO $postconditions$
DECLARE
  full_set text;
BEGIN
  -- POST-001 · the target is 'd'.
  IF (SELECT relreplident FROM pg_class WHERE oid = 'public.competition_round_publish'::regclass) <> 'd' THEN
    RAISE EXCEPTION 'P2-0002-POST-001: public.competition_round_publish is not REPLICA IDENTITY DEFAULT after the ALTER'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-002 · the published FULL tables are exactly profiles and scheduled_posts.
  SELECT string_agg(pt.schemaname || '.' || pt.tablename, ',' ORDER BY pt.tablename) INTO full_set
    FROM pg_publication_tables pt
    JOIN pg_class c ON c.relname = pt.tablename AND c.relnamespace = pt.schemaname::regnamespace
   WHERE pt.pubname = 'supabase_realtime' AND c.relreplident = 'f';
  IF full_set IS DISTINCT FROM 'public.profiles,public.scheduled_posts' THEN
    RAISE EXCEPTION 'P2-0002-POST-002: published FULL tables are (%), not exactly public.profiles, public.scheduled_posts',
      coalesce(full_set, 'none')
      USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'P2-0002: competition_round_publish is REPLICA IDENTITY DEFAULT; '
               'profiles and scheduled_posts are the only published FULL tables';
END
$postconditions$;

COMMIT;
