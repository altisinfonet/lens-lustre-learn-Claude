-- ═══════════════════════════════════════════════════════════════════════════
-- OFF-2 · 20261004_0008 — exactly once: server-side idempotency keys for the
-- outbox actions that have no natural key. D1 half of OFF-2 (T1).
-- Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE RULE (MASTER R-90 OFF-2; OFF-5 §3 R4 + R8, D3 decision file): every
-- outbox item carries a client-generated idempotency key (UUID v4); "D1
-- enforces it with a unique constraint per action table, so a duplicate send
-- returns the original result". A retry, a double tap, or two sends racing
-- after a timeout must leave ONE row.
--
-- THE OUTBOX ACTION TABLES (OFF-5 §2, QUEUED) AND WHAT ALREADY MAKES THEM
-- EXACTLY-ONCE — read on staging, 2026-10-04 (scripts/db-off2-outbox-contract.json
-- is the list, PROBE_off2_idempotency.sql checks it live):
--   natural key (a repeat is the same fact, so the pair IS the key):
--     post_reactions (post_id, user_id) · follows (follower_id, following_id) ·
--     friendships least/greatest pair · post_reports (post_id, reporter_id) ·
--     comment_reactions (comment_id, user_id)
--   idempotency key already: posts (user_id, idempotency_key), partial —
--     create_post_with_media() returns the first post on a sequential retry.
--   update-only (setting is_read twice is the same row): user_notifications.
--   NOTHING — a repeat creates a SECOND row:
--     public.post_comments   (a comment sent 3 times = 3 comments, 3 notices,
--                             comments_count + 3)
--     public.reports         (a report sent twice = 2 reports)
--   This file closes those two.
--
-- WHAT THIS FILE DOES (for each of post_comments, reports):
--   * ADD COLUMN idempotency_key text (NULL for every existing row and for any
--     client that does not send one — unchanged behaviour);
--   * CHECK: NULL, or a UUID (8-4-4-4-12 hex) — no empty or guessable keys;
--   * UNIQUE (<owner>, idempotency_key) as a full constraint (NULLs distinct),
--     not a partial index, so PostgREST can name it in on_conflict:
--       insert(...).select()                      → 23505 on a repeat, naming
--         post_comments_user_idempotency_key / reports_reporter_idempotency_key
--       upsert(..., { onConflict: 'user_id,idempotency_key', ignoreDuplicates: true })
--                                                 → no error, no second row
--     and the original row is then read back by (owner, key). A rejected
--     repeat fires no AFTER trigger: no second notification, no double count.
--
-- OBJECTS (reservation): columns post_comments.idempotency_key,
-- reports.idempotency_key; constraints post_comments_user_idempotency_key,
-- reports_reporter_idempotency_key, post_comments_idempotency_key_format,
-- reports_idempotency_key_format.
-- LOCKING: ADD COLUMN (no default) is catalog-only; the UNIQUE build takes a
-- SHARE lock for the length of one index build (staging: 8 and 0 rows).
-- RE-RUNNABLE after its rollback (the rollback keeps the column).
-- ROLLBACK: supabase/rollback/20261004_0008_off2_idempotency_keys_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_off2_idempotency.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  n bigint;
BEGIN
  -- PRE-001 · the tables and their owner columns.
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
        AND ((table_name = 'post_comments' AND column_name = 'user_id')
          OR (table_name = 'reports' AND column_name = 'reporter_id'))) <> 2 THEN
    RAISE EXCEPTION 'OFF2-0008-PRE-001: public.post_comments(user_id) or public.reports(reporter_id) is missing'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · not applied already.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('post_comments_user_idempotency_key', 'reports_reporter_idempotency_key',
                                                           'post_comments_idempotency_key_format', 'reports_idempotency_key_format')) THEN
    RAISE EXCEPTION 'OFF2-0008-PRE-002: an OFF-2 constraint already exists — 20261004_0008 is applied'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · after a rollback the column is kept; any keys in it must already
  -- be unique and well-formed, or the constraints cannot be added. Report, do not guess.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_comments' AND column_name = 'idempotency_key') THEN
    EXECUTE $q$SELECT count(*) FROM (SELECT 1 FROM public.post_comments WHERE idempotency_key IS NOT NULL
               GROUP BY user_id, idempotency_key HAVING count(*) > 1) d$q$ INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'OFF2-0008-PRE-003: % (user_id, idempotency_key) pair(s) repeat in post_comments — resolve before applying', n
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'idempotency_key') THEN
    EXECUTE $q$SELECT count(*) FROM (SELECT 1 FROM public.reports WHERE idempotency_key IS NOT NULL
               GROUP BY reporter_id, idempotency_key HAVING count(*) > 1) d$q$ INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'OFF2-0008-PRE-003: % (reporter_id, idempotency_key) pair(s) repeat in reports — resolve before applying', n
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
END
$preconditions$;

-- ── post_comments ──────────────────────────────────────────────────────────
ALTER TABLE public.post_comments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_idempotency_key_format
  CHECK (idempotency_key IS NULL OR idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
-- P28: the OFF-2 exactly-once key; one entry per comment sent with a key, probed only on insert; reviewed by D1 2026-10-04.
ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_user_idempotency_key UNIQUE (user_id, idempotency_key);
COMMENT ON COLUMN public.post_comments.idempotency_key IS
  'OFF-2: client-generated UUID per outbox send; UNIQUE with user_id, so a repeated send cannot create a second comment (20261004_0008).';

-- ── reports ────────────────────────────────────────────────────────────────
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.reports ADD CONSTRAINT reports_idempotency_key_format
  CHECK (idempotency_key IS NULL OR idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
-- P28: the OFF-2 exactly-once key; one entry per report sent with a key, probed only on insert; reviewed by D1 2026-10-04.
ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_idempotency_key UNIQUE (reporter_id, idempotency_key);
COMMENT ON COLUMN public.reports.idempotency_key IS
  'OFF-2: client-generated UUID per outbox send; UNIQUE with reporter_id, so a repeated send cannot create a second report (20261004_0008).';

DO $postconditions$
BEGIN
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
       WHERE c.contype = 'u' AND i.indisvalid AND i.indisunique AND i.indpred IS NULL
         AND ((c.conname = 'post_comments_user_idempotency_key' AND c.conrelid = 'public.post_comments'::regclass
               AND pg_get_constraintdef(c.oid) = 'UNIQUE (user_id, idempotency_key)')
           OR (c.conname = 'reports_reporter_idempotency_key' AND c.conrelid = 'public.reports'::regclass
               AND pg_get_constraintdef(c.oid) = 'UNIQUE (reporter_id, idempotency_key)'))) <> 2 THEN
    RAISE EXCEPTION 'OFF2-0008-POST-001: the two UNIQUE (owner, idempotency_key) constraints are not both present and valid'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND convalidated
        AND conname IN ('post_comments_idempotency_key_format', 'reports_idempotency_key_format')) <> 2 THEN
    RAISE EXCEPTION 'OFF2-0008-POST-002: the key-format CHECKs are not both present and validated' USING ERRCODE = 'raise_exception';
  END IF;
  -- The clients that write these tables can write the new column.
  IF NOT has_column_privilege('authenticated', 'public.post_comments', 'idempotency_key', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.reports', 'idempotency_key', 'INSERT') THEN
    RAISE EXCEPTION 'OFF2-0008-POST-003: authenticated cannot INSERT idempotency_key' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'OFF2-0008: post_comments and reports refuse a repeated (owner, idempotency_key)';
END
$postconditions$;

COMMIT;
