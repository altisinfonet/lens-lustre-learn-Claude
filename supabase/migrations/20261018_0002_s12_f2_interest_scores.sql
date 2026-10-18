-- ═══════════════════════════════════════════════════════════════════════════
-- 20261018_0002 — S12-F2 Interest scores (data layer, server-side only).
--   · viewer → author closeness   public.feed_viewer_author_affinity
--   · viewer → category interest  public.feed_viewer_category_interest
--   · post quality (engagement ÷ views, smoothed)  public.feed_post_quality
--   maintained INCREMENTALLY by pg_cron every 3 minutes, readable by NO
--   client role (the later feed RPC, F3/F4, reads them as SECURITY DEFINER).
-- EXPAND step: new objects plus five plain indexes on existing tables; no
-- existing column, function, policy or trigger is altered. Nothing a client
-- does today changes.
-- Lanes: staging and production (refuses any other lane).
-- D1 (Database & Runtime), 2026-10-18. Master plan v3 S12 (Owner: the feed
-- "like Meta/Instagram"). Builds on S12-F1 (20261018_0001).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE (verbatim): "Viewer→author closeness, viewer→category interest, post
-- quality (engagement ÷ views), maintained server-side — Scores update within
-- minutes; a cross-member test proves privacy."
--
-- INPUTS — READ, NOT DUPLICATED (live catalogue 2026-10-17 + 20261018_0001):
--   like            post_reactions (user_id, post_id, created_at)   UNIQUE (post_id, user_id)
--   comment         post_comments  (user_id, post_id, created_at)
--   share to wall   post_shares    (user_id, post_id, created_at)   UNIQUE (post_id, user_id)
--   follow          follows        (follower_id, following_id, created_at)
--   seen / views    feed_events 'view' | 'skip' (created_at) → only marks a post's
--                   quality for recompute; posts.viewer_count (distinct viewers,
--                   trg_feed_events_viewer_count) is the views denominator
--   dwell, watch %, fast skip, share click, profile visit
--                   feed_signal_events (S12-F1 ledger; created_at set by the server)
--   Not interested  feed_hidden_posts (S12-F1) — strong NEGATIVE
--   mute            feed_muted_authors (S12-F1) — an EXCLUSION the feed RPC applies;
--                   not a score (a muted author is never shown, whatever the score)
--   categories      posts.categories text[] (CategoryChips 1–5 slugs; CHECK ≤ 5)
--
-- DESIGN (1 M members)
--   1. WEIGHTS IN ONE PLACE — public.feed_score_config (key, value, note). The
--      refresh reads every key once per run; F6 Admin can tune them later
--      without a code change. Seeded values (all documented in the rows):
--        half_life_days 14 — every contribution decays exp(-ln2·age/14 d), so an
--          action 14 days old counts half, 28 days a quarter;
--        closeness/category weights per action: like 3 · comment 4 · share 6 ·
--          follow 8 · profile visit 2 · share click 1 · dwell 1 per 30 s (max 1
--          per post per run) · watch 1 × watch% · skip −0.5 (weak) · hide −15
--          (strong); a post's weight is split evenly over its categories, so a
--          5-category post does not count 5×;
--        caps: score in [−100, 100]; positive gain per (viewer, author) and per
--          (viewer, category) ≤ 12 per run; each viewer ≤ 300 actions per run;
--          per (viewer, post, action) one unit per run (L8: 43k scripted share
--          clicks/day on one post become ≤ 1 unit per run for that viewer's
--          OWN closeness, and exactly ONE share-clicker in that post's quality);
--        quality: like 1 · commenter 2 · sharer 3 · share-clicker 0.5 ·
--          hider −5, each counted as DISTINCT members (one per member per post);
--          Bayesian prior rate 0.05 over 50 views:
--            quality = (engagement + 0.05·50) / (views + 50)
--          so a post with 1 view and 1 like scores ≈ 0.07, not 1.0 — it also
--          serves the "new member start" (popular posts) of a later unit.
--   2. STORED AS (score, updated_at): the value at updated_at. Read-side value
--      at time t is score·exp(-ln2·(t−updated_at)/half-life) —
--      public.feed_score_decayed(score, updated_at) — so a row needs no rewrite
--      to age. Each update first decays the stored score to now, then adds the
--      run's (decayed) gains.
--   3. INCREMENTAL — public.feed_scores_refresh(), pg_cron 'refresh-feed-scores'
--      every 3 minutes. Per source a WATERMARK (created_at, key1, key2) in
--      public.feed_score_watermarks; each run reads rows
--        created_at in [wm, LEAST(wm + 6 h, now() − 120 s)) and (created_at, key) > wm
--      ORDER BY (created_at, key) LIMIT 10,000 — an index range scan — and
--      advances the watermark IN THE SAME TRANSACTION as the score writes:
--        · full batch → to the last row read (exact keyset: ties never lost);
--        · short batch → to the window end (gaps do not stall it).
--      The 120 s settle lag covers commit order: a row is stamped with its
--      transaction's start time, and member writes are single statements under
--      statement_timeout 8 s (authenticated). Rows are read once; a second run
--      with no new rows changes nothing (PROBE G4). Single runner:
--      pg_try_advisory_xact_lock — an overlapping run returns {"busy":true}.
--      Deletions (unlike, unfollow, un-hide) are not subtracted: their earlier
--      contribution decays away (14-day half-life); the follow STATE itself is
--      read live from follows by the feed RPC.
--      First run starts 14 days back (backfill), 6 h of history per run.
--   4. QUALITY — every post touched by any event (like, comment, share, signal,
--      hide, feed view) is queued once in public.feed_post_quality_queue (PK);
--      each run recomputes ≤ 2,000 queued posts EXACTLY from the counters and
--      the per-member tables (likes_count, shares_count, distinct commenters,
--      share-clickers, hiders; each count reads ≤ 100,000 index entries) — so
--      quality is recomputed, never accumulated, and is idempotent by
--      construction. views = GREATEST(viewer_count, each engager count).
--   5. RUN COST (estimate, not measured): steady state at 1 M members, assuming
--      ~2 M signals + ~0.5 M likes + ~0.2 M other actions per day ≈ 6,000 rows
--      per 3-minute run → 7 index range scans, one temp table, ≤ 6,000 upserts
--      per score table, ≤ 2,000 quality recomputes: tens to low hundreds of ms.
--      Hard bound per run: ≤ 70,000 source rows, ≤ 2,000 quality posts,
--      ≤ 5,000 purged rows per score table. Catch-up after an outage: 6 h of
--      history per source per run (sort of that window's rows, then LIMIT).
--   6. INDEXES ON EXISTING TABLES (the watermark range scans need them; none of
--      post_reactions / post_comments / post_shares / follows /
--      feed_hidden_posts has a created_at index): plain CREATE INDEX inside the
--      transaction — SHARE lock (blocks writes, not reads) while each builds;
--      these tables are ≤ 224 kB on staging (2026-10-18). feed_signal_events
--      (BRIN created_at, F1) and feed_events (idx_feed_events_created) already
--      have one.
--   7. RETENTION: a closeness / category row not updated for 180 days (score
--      decayed to < 0.02 % of its value) is purged by the same job, ≤ 5,000 rows
--      per table per run, by its updated_at index. Quality rows go with their
--      post (FK cascade); score rows go with either account (FK cascade).
--   8. PRIVACY. RLS ON with NO policy on all six tables: anon and
--      authenticated read nothing (and every table privilege is revoked from
--      PUBLIC, anon and authenticated). service_role: SELECT only. Both
--      functions: SECURITY INVOKER, search_path '', EXECUTE revoked from PUBLIC,
--      anon and authenticated (the refresh runs as the cron owner; the decay
--      helper is for the feed RPC, which runs as its owner). No function a
--      member may call returns any of these rows; PROBE G5 asserts that for
--      EVERY function in the database whose body names a score table.
--
-- LOCKING. New objects; CREATE INDEX on five small existing tables (SHARE lock,
-- brief); FK creation on posts / auth.users (SHARE ROW EXCLUSIVE, brief, no rows
-- to validate); the cron schedule. lock_timeout 5 s.
-- RE-RUN: refused by PRE-001 once applied. After the rollback it applies again.
-- ROLLBACK: supabase/rollback/20261018_0002_s12_f2_interest_scores_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261018_0002_s12_f2_interest_scores.sql
-- EVIDENCE: docs/evidence/d1/S12-F2-interest-scores/ (PGlite proof, fail-first,
--           loosened copies, rollback).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _bad text := '';
  r    record;
BEGIN
  -- PRE-001 · not applied already. Function names are checked by NAME in
  -- pg_proc (catches any overload), never with to_regproc.
  IF to_regclass('public.feed_score_config') IS NOT NULL
     OR to_regclass('public.feed_score_watermarks') IS NOT NULL
     OR to_regclass('public.feed_viewer_author_affinity') IS NOT NULL
     OR to_regclass('public.feed_viewer_category_interest') IS NOT NULL
     OR to_regclass('public.feed_post_quality') IS NOT NULL
     OR to_regclass('public.feed_post_quality_queue') IS NOT NULL
     OR to_regclass('public.post_reactions_created_at_idx') IS NOT NULL
     OR to_regclass('public.post_comments_created_at_idx') IS NOT NULL
     OR to_regclass('public.post_shares_created_at_idx') IS NOT NULL
     OR to_regclass('public.follows_created_at_idx') IS NOT NULL
     OR to_regclass('public.feed_hidden_posts_created_at_idx') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                  AND proname IN ('feed_scores_refresh', 'feed_score_decayed')) THEN
    RAISE EXCEPTION 'S12F2-0002-PRE-001: an S12-F2 object already exists — 20261018_0002 is applied (or half-applied by hand)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-002 · what this file relies on (S12-F1 included).
  FOR r IN SELECT * FROM (VALUES
      ('posts', 'id'), ('posts', 'user_id'), ('posts', 'categories'), ('posts', 'viewer_count'),
      ('posts', 'likes_count'), ('posts', 'shares_count'),
      ('post_reactions', 'id'), ('post_reactions', 'user_id'), ('post_reactions', 'post_id'), ('post_reactions', 'created_at'),
      ('post_comments', 'id'), ('post_comments', 'user_id'), ('post_comments', 'post_id'), ('post_comments', 'created_at'),
      ('post_shares', 'id'), ('post_shares', 'user_id'), ('post_shares', 'post_id'), ('post_shares', 'created_at'),
      ('follows', 'id'), ('follows', 'follower_id'), ('follows', 'following_id'), ('follows', 'created_at'),
      ('feed_events', 'id'), ('feed_events', 'post_id'), ('feed_events', 'event_type'), ('feed_events', 'created_at'),
      ('feed_signal_events', 'id'), ('feed_signal_events', 'kind'), ('feed_signal_events', 'subject_id'), ('feed_signal_events', 'created_at'),
      ('feed_post_signals', 'share_clicks'), ('feed_hidden_posts', 'created_at'), ('feed_muted_authors', 'author_id')
    ) v(t, c) LOOP
    IF to_regclass('public.' || r.t) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = ('public.' || r.t)::regclass AND attname = r.c AND NOT attisdropped) THEN
      _bad := _bad || E'\n  public.' || r.t || '(' || r.c || ') missing';
    END IF;
  END LOOP;
  IF to_regclass('auth.users') IS NULL THEN _bad := _bad || E'\n  auth.users missing'; END IF;
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    _bad := _bad || E'\n  pg_cron (cron.schedule(text,text,text)) missing';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-feed-scores') THEN
    _bad := _bad || E'\n  cron job refresh-feed-scores already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    _bad := _bad || E'\n  role anon / authenticated / service_role missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F2-0002-PRE-002: prerequisites missing:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. weights in one place ──────────────────────────────────────────────────
CREATE TABLE public.feed_score_config (
  key         text             PRIMARY KEY,
  value       double precision NOT NULL,
  note        text             NOT NULL,
  updated_at  timestamptz      NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.feed_score_config IS
  'S12-F2 the ONE place for interest-score weights, decay, caps and batch sizes; read once per run by feed_scores_refresh. No client access (RLS, no policy). F6 Admin tunes later.';

INSERT INTO public.feed_score_config (key, value, note) VALUES
  ('half_life_days',      14,     'decay: a contribution counts half after this many days'),
  ('w_like',              3,      'closeness/category: a like'),
  ('w_comment',           4,      'closeness/category: a comment (one unit per viewer per post per run)'),
  ('w_share',             6,      'closeness/category: share to wall'),
  ('w_follow',            8,      'closeness: the act of following (the follow state is read live by the feed RPC)'),
  ('w_profile_visit',     2,      'closeness: a profile visit (one unit per viewer per profile per run)'),
  ('w_share_click',       1,      'closeness/category: "Copy link" (one unit per viewer per post per run — L8)'),
  ('w_dwell',             1,      'closeness/category: per 30 s time on post, at most 1 unit per viewer per post per run'),
  ('w_watch',             1,      'closeness/category: × max watch % / 100'),
  ('w_skip',              -0.5,   'closeness/category: fast skip — weak negative'),
  ('w_hide',              -15,    'closeness/category: Not interested / Hide — strong negative'),
  ('pair_gain_cap',       12,     'max POSITIVE gain per (viewer, author) and per (viewer, category) per run'),
  ('viewer_events_cap',   300,    'max actions per viewer per run (the rest of a scripted burst is read and dropped)'),
  ('score_max',           100,    'closeness / category score ceiling'),
  ('score_min',           -100,   'closeness / category score floor'),
  ('q_like',              1,      'quality: per liker (likes_count; one per member per post)'),
  ('q_comment',           2,      'quality: per distinct commenter (author excluded)'),
  ('q_share',             3,      'quality: per sharer (shares_count; one per member per post)'),
  ('q_share_click',       0.5,    'quality: per distinct share-clicker (one per member, however many clicks — L8)'),
  ('q_hide',              5,      'quality: subtracted per distinct hider'),
  ('q_prior_rate',        0.05,   'quality: Bayesian prior engagement rate'),
  ('q_prior_views',       50,     'quality: prior strength in views (low-view posts stay near the prior)'),
  ('q_count_cap',         100000, 'quality: each per-post count reads at most this many index entries'),
  ('settle_seconds',      120,    'refresh reads rows older than this (commit-order safety)'),
  ('window_hours',        6,      'refresh reads at most this much history per source per run'),
  ('batch_rows',          10000,  'refresh reads at most this many rows per source per run'),
  ('quality_batch',       2000,   'refresh recomputes at most this many posts per run'),
  ('purge_batch',         5000,   'refresh purges at most this many stale rows per score table per run'),
  ('retention_days',      180,    'closeness / category rows not updated for this long are purged');

-- ── 2. watermarks, one per source ────────────────────────────────────────────
CREATE TABLE public.feed_score_watermarks (
  source       text        PRIMARY KEY CHECK (source IN ('likes', 'comments', 'shares', 'follows', 'signals', 'hides', 'views')),
  wm_at        timestamptz NOT NULL,
  wm_k1        uuid        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  wm_k2        uuid        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  last_run_at  timestamptz,
  last_rows    integer
);
COMMENT ON TABLE public.feed_score_watermarks IS
  'S12-F2 per source: every row with (created_at, key1, key2) <= (wm_at, wm_k1, wm_k2) has been folded into the scores. Advanced in the same transaction as the score writes. No client access.';
-- First run starts 14 days back (backfill).
INSERT INTO public.feed_score_watermarks (source, wm_at)
SELECT s, now() - interval '14 days'
  FROM unnest(ARRAY['likes', 'comments', 'shares', 'follows', 'signals', 'hides', 'views']) s;

-- ── 3. the three score sets ──────────────────────────────────────────────────
CREATE TABLE public.feed_viewer_author_affinity (
  user_id     uuid             NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  author_id   uuid             NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  score       double precision NOT NULL,
  updated_at  timestamptz      NOT NULL,
  PRIMARY KEY (user_id, author_id),
  CONSTRAINT feed_viewer_author_affinity_not_self CHECK (user_id <> author_id)
);
COMMENT ON TABLE public.feed_viewer_author_affinity IS
  'S12-F2 viewer → author closeness: score at updated_at, decays with half_life_days (feed_score_decayed). Written only by feed_scores_refresh. No client access (RLS, no policy); the feed RPC reads it as definer.';
-- P28: feed_viewer_author_affinity · ≈ authors each member engaged with · the
-- auth.users FK cascade when the AUTHOR's account is deleted (P35 rule 2).
CREATE INDEX feed_viewer_author_affinity_author_idx ON public.feed_viewer_author_affinity (author_id);
-- P28: same table · the 180-day purge by updated_at (bounded, ≤ 5,000 per run).
CREATE INDEX feed_viewer_author_affinity_updated_idx ON public.feed_viewer_author_affinity (updated_at);

CREATE TABLE public.feed_viewer_category_interest (
  user_id     uuid             NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  category    text             NOT NULL CHECK (length(category) BETWEEN 1 AND 64),
  score       double precision NOT NULL,
  updated_at  timestamptz      NOT NULL,
  PRIMARY KEY (user_id, category)
);
COMMENT ON TABLE public.feed_viewer_category_interest IS
  'S12-F2 viewer → category interest (posts.categories slugs): score at updated_at, decays with half_life_days. Written only by feed_scores_refresh. No client access.';
-- P28: feed_viewer_category_interest · ≤ ~30 categories per member · the 180-day purge.
CREATE INDEX feed_viewer_category_interest_updated_idx ON public.feed_viewer_category_interest (updated_at);

CREATE TABLE public.feed_post_quality (
  post_id     uuid             PRIMARY KEY REFERENCES public.posts (id) ON DELETE CASCADE,
  score       double precision NOT NULL,
  engagement  double precision NOT NULL,
  views       integer          NOT NULL,
  updated_at  timestamptz      NOT NULL
);
COMMENT ON TABLE public.feed_post_quality IS
  'S12-F2 post quality = (engagement + q_prior_rate·q_prior_views) / (views + q_prior_views); engagers counted as distinct members. Recomputed exactly per queued post by feed_scores_refresh. No client access.';

CREATE TABLE public.feed_post_quality_queue (
  post_id    uuid        PRIMARY KEY REFERENCES public.posts (id) ON DELETE CASCADE,
  queued_at  timestamptz NOT NULL
);
COMMENT ON TABLE public.feed_post_quality_queue IS
  'S12-F2 posts whose quality must be recomputed (touched since the last run). Drained ≤ quality_batch per run, oldest first. No client access.';
-- P28: feed_post_quality_queue · rows awaiting one run · the oldest-first drain.
CREATE INDEX feed_post_quality_queue_queued_idx ON public.feed_post_quality_queue (queued_at);

-- ── 4. created_at indexes for the watermark range scans ─────────────────────
-- P28: post_reactions · refresh reads (created_at, id) > watermark, a 3-minute window.
CREATE INDEX post_reactions_created_at_idx ON public.post_reactions (created_at);
-- P28: post_comments · the same; (user_id, created_at) cannot serve a global range.
CREATE INDEX post_comments_created_at_idx ON public.post_comments (created_at);
-- P28: post_shares · the same.
CREATE INDEX post_shares_created_at_idx ON public.post_shares (created_at);
-- P28: follows · the same.
CREATE INDEX follows_created_at_idx ON public.follows (created_at);
-- P28: feed_hidden_posts · the same (S12-F1 table; PK leads with user_id).
CREATE INDEX feed_hidden_posts_created_at_idx ON public.feed_hidden_posts (created_at);

-- ── 5. read-side decay (for the feed RPC) ────────────────────────────────────
CREATE FUNCTION public.feed_score_decayed(_score double precision, _at timestamptz)
 RETURNS double precision
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $fn$
  SELECT _score * exp(-ln(2::double precision) * GREATEST(0::double precision, extract(epoch FROM now() - _at)::double precision)
                      / (86400 * (SELECT c.value FROM public.feed_score_config c WHERE c.key = 'half_life_days')));
$fn$;

-- ── 6. the incremental refresh ───────────────────────────────────────────────
CREATE FUNCTION public.feed_scores_refresh(_batch integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO ''
AS $fn$
DECLARE
  _zero  constant uuid := '00000000-0000-0000-0000-000000000000';
  _now   timestamptz := now();
  _c     jsonb;
  _k     double precision;   -- decay constant per second: ln2 / (half-life in s)
  _hi    timestamptz;
  _b     integer;
  _qb    integer;
  _pb    integer;
  _cap   double precision;
  _min   double precision;
  _max   double precision;
  _qcap  integer;
  _wm    record;
  _end   timestamptz;
  _n     integer;
  _last  record;
  _rows  jsonb := '{}'::jsonb;
  _na    integer := 0;
  _nc    integer := 0;
  _nq    integer := 0;
  _pa    integer := 0;
  _pc    integer := 0;
  s      record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(2026101802) THEN
    RETURN jsonb_build_object('busy', true);
  END IF;

  SELECT jsonb_object_agg(c.key, c.value) INTO _c FROM public.feed_score_config c;
  IF _c IS NULL OR NOT _c ?& ARRAY['half_life_days', 'w_like', 'w_comment', 'w_share', 'w_follow', 'w_profile_visit',
       'w_share_click', 'w_dwell', 'w_watch', 'w_skip', 'w_hide', 'pair_gain_cap', 'viewer_events_cap', 'score_max',
       'score_min', 'q_like', 'q_comment', 'q_share', 'q_share_click', 'q_hide', 'q_prior_rate', 'q_prior_views',
       'q_count_cap', 'settle_seconds', 'window_hours', 'batch_rows', 'quality_batch', 'purge_batch', 'retention_days'] THEN
    RAISE EXCEPTION 'feed_scores_refresh: feed_score_config is missing a key';
  END IF;
  _k    := ln(2::double precision) / ((_c->>'half_life_days')::double precision * 86400);
  _hi   := _now - make_interval(secs => (_c->>'settle_seconds')::double precision);
  _b    := GREATEST(1, coalesce(_batch, (_c->>'batch_rows')::integer));
  _qb   := GREATEST(1, LEAST(coalesce(_batch, (_c->>'quality_batch')::integer), (_c->>'quality_batch')::integer));
  _pb   := GREATEST(1, LEAST(coalesce(_batch, (_c->>'purge_batch')::integer), (_c->>'purge_batch')::integer));
  _cap  := (_c->>'pair_gain_cap')::double precision;
  _min  := (_c->>'score_min')::double precision;
  _max  := (_c->>'score_max')::double precision;
  _qcap := (_c->>'q_count_cap')::integer;

  CREATE TEMP TABLE IF NOT EXISTS feed_score_ev (
    src text, at timestamptz, k1 uuid, k2 uuid, viewer uuid, post_id uuid, author_id uuid,
    kind text, val integer, cats text[]
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.feed_score_ev;

  -- 1 · read each source from its watermark (constant SQL; no input reaches format()).
  FOR s IN SELECT * FROM (VALUES
      ('likes',    'public.post_reactions r',     'r.created_at', 'TRUE',
       'r.created_at, r.id, $6, r.user_id, r.post_id, NULL::uuid, ''like'', 1'),
      ('comments', 'public.post_comments r',      'r.created_at', 'TRUE',
       'r.created_at, r.id, $6, r.user_id, r.post_id, NULL::uuid, ''comment'', 1'),
      ('shares',   'public.post_shares r',        'r.created_at', 'TRUE',
       'r.created_at, r.id, $6, r.user_id, r.post_id, NULL::uuid, ''share'', 1'),
      ('follows',  'public.follows r',            'r.created_at', 'TRUE',
       'r.created_at, r.id, $6, r.follower_id, NULL::uuid, r.following_id, ''follow'', 1'),
      ('signals',  'public.feed_signal_events r', 'r.created_at', 'TRUE',
       'r.created_at, r.id, $6, r.user_id, r.post_id, r.subject_id, r.kind, r.value'),
      ('hides',    'public.feed_hidden_posts r',  'r.created_at', 'TRUE',
       'r.created_at, r.user_id, r.post_id, r.user_id, r.post_id, NULL::uuid, ''hide'', 1'),
      ('views',    'public.feed_events r',        'r.created_at', 'r.event_type IN (''view'', ''skip'')',
       'r.created_at, r.id, $6, r.user_id, r.post_id, NULL::uuid, ''view'', 0')
    ) v(src, rel, col, flt, sel)
  LOOP
    SELECT * INTO _wm FROM public.feed_score_watermarks w WHERE w.source = s.src FOR UPDATE;
    _end := LEAST(_wm.wm_at + make_interval(hours => (_c->>'window_hours')::integer), _hi);
    IF _end <= _wm.wm_at THEN
      _rows := _rows || jsonb_build_object(s.src, 0);
      CONTINUE;
    END IF;
    EXECUTE format(
      'INSERT INTO pg_temp.feed_score_ev (src, at, k1, k2, viewer, post_id, author_id, kind, val)
       SELECT %L, x.* FROM (
         SELECT %s FROM %s
          WHERE %s >= $1 AND %s < $2 AND %s
            AND (%s, %s) > ($1, $3, $4)
          ORDER BY 1, 2, 3 LIMIT $5) x',
      s.src, s.sel, s.rel, s.col, s.col, s.flt, s.col,
      CASE s.src WHEN 'hides' THEN 'r.user_id, r.post_id' ELSE 'r.id, $6' END)
    USING _wm.wm_at, _end, _wm.wm_k1, _wm.wm_k2, _b, _zero;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n >= _b THEN
      SELECT e.at, e.k1, e.k2 INTO _last FROM pg_temp.feed_score_ev e WHERE e.src = s.src
       ORDER BY e.at DESC, e.k1 DESC, e.k2 DESC LIMIT 1;
      UPDATE public.feed_score_watermarks
         SET wm_at = _last.at, wm_k1 = _last.k1, wm_k2 = _last.k2, last_run_at = _now, last_rows = _n
       WHERE source = s.src;
    ELSE
      UPDATE public.feed_score_watermarks
         SET wm_at = _end, wm_k1 = _zero, wm_k2 = _zero, last_run_at = _now, last_rows = _n
       WHERE source = s.src;
    END IF;
    _rows := _rows || jsonb_build_object(s.src, _n);
  END LOOP;

  -- 2 · the real author and categories of each post (never a client value).
  UPDATE pg_temp.feed_score_ev e SET author_id = p.user_id, cats = p.categories
    FROM public.posts p WHERE e.post_id = p.id;

  -- 3 · fold into closeness and category interest.
  WITH e AS (
    SELECT ev.*, row_number() OVER (PARTITION BY ev.viewer ORDER BY ev.at, ev.k1, ev.k2) AS rn
      FROM pg_temp.feed_score_ev ev
     WHERE ev.kind <> 'view' AND ev.author_id IS NOT NULL AND ev.viewer <> ev.author_id
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ev.viewer)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ev.author_id)
  ), u AS (
    -- one unit per (viewer, post or profile, action) per run
    SELECT e.viewer, e.author_id, e.post_id, e.cats, e.kind,
           CASE e.kind WHEN 'dwell' THEN LEAST(sum(e.val)::double precision / 30000, 1)
                       WHEN 'watch' THEN LEAST(max(e.val)::double precision / 100, 1)
                       ELSE 1 END AS f,
           max(e.at) AS at
      FROM e WHERE e.rn <= (_c->>'viewer_events_cap')::integer
     GROUP BY e.viewer, e.author_id, e.post_id, e.cats, e.kind
  ), g AS (
    SELECT u.viewer, u.author_id, u.cats,
           u.f * (_c->>(CASE u.kind
                          WHEN 'like' THEN 'w_like' WHEN 'comment' THEN 'w_comment' WHEN 'share' THEN 'w_share'
                          WHEN 'follow' THEN 'w_follow' WHEN 'profile_visit' THEN 'w_profile_visit'
                          WHEN 'share_click' THEN 'w_share_click' WHEN 'dwell' THEN 'w_dwell'
                          WHEN 'watch' THEN 'w_watch' WHEN 'skip' THEN 'w_skip' WHEN 'hide' THEN 'w_hide' END))::double precision
               * exp(-_k * GREATEST(0::double precision, extract(epoch FROM _now - u.at)::double precision)) AS g
      FROM u
  ), aff AS (
    INSERT INTO public.feed_viewer_author_affinity AS a (user_id, author_id, score, updated_at)
    SELECT g.viewer, g.author_id, LEAST(_max, GREATEST(_min, LEAST(sum(g.g), _cap))), _now
      FROM g WHERE g.g IS NOT NULL GROUP BY g.viewer, g.author_id
    ON CONFLICT (user_id, author_id) DO UPDATE
      SET score = LEAST(_max, GREATEST(_min,
                    a.score * exp(-_k * GREATEST(0::double precision, extract(epoch FROM _now - a.updated_at)::double precision))
                    + EXCLUDED.score)),
          updated_at = _now
    RETURNING 1
  ), cat AS (
    INSERT INTO public.feed_viewer_category_interest AS c (user_id, category, score, updated_at)
    SELECT g.viewer, x.cat, LEAST(_max, GREATEST(_min, LEAST(sum(g.g / cardinality(g.cats)), _cap))), _now
      FROM g CROSS JOIN LATERAL (SELECT DISTINCT unnest(g.cats) AS cat) x
     WHERE g.g IS NOT NULL AND cardinality(g.cats) > 0 AND length(x.cat) BETWEEN 1 AND 64
     GROUP BY g.viewer, x.cat
    ON CONFLICT (user_id, category) DO UPDATE
      SET score = LEAST(_max, GREATEST(_min,
                    c.score * exp(-_k * GREATEST(0::double precision, extract(epoch FROM _now - c.updated_at)::double precision))
                    + EXCLUDED.score)),
          updated_at = _now
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM aff), (SELECT count(*) FROM cat) INTO _na, _nc;

  -- 4 · queue every touched post for a quality recompute, then drain the oldest.
  INSERT INTO public.feed_post_quality_queue (post_id, queued_at)
  SELECT DISTINCT e.post_id, _now FROM pg_temp.feed_score_ev e JOIN public.posts p ON p.id = e.post_id
  ON CONFLICT (post_id) DO NOTHING;

  WITH q AS (
    DELETE FROM public.feed_post_quality_queue d
     WHERE d.post_id IN (SELECT qq.post_id FROM public.feed_post_quality_queue qq ORDER BY qq.queued_at, qq.post_id LIMIT _qb)
    RETURNING d.post_id
  ), n AS (
    SELECT p.id,
           LEAST(GREATEST(p.likes_count, 0), _qcap) AS likers,
           LEAST(GREATEST(p.shares_count, 0), _qcap) AS sharers,
           GREATEST(p.viewer_count, 0) AS viewers,
           (SELECT count(*) FROM (SELECT DISTINCT c.user_id FROM public.post_comments c
                                   WHERE c.post_id = p.id AND c.user_id <> p.user_id LIMIT _qcap) z) AS commenters,
           (SELECT count(*) FROM (SELECT 1 FROM public.feed_post_signals fs
                                   WHERE fs.post_id = p.id AND fs.share_clicks > 0 LIMIT _qcap) z) AS clickers,
           (SELECT count(*) FROM (SELECT 1 FROM public.feed_hidden_posts h
                                   WHERE h.post_id = p.id LIMIT _qcap) z) AS hiders
      FROM q JOIN public.posts p ON p.id = q.post_id
  ), m AS (
    SELECT n.id,
           GREATEST(0::double precision,
               (_c->>'q_like')::double precision * n.likers + (_c->>'q_comment')::double precision * n.commenters
             + (_c->>'q_share')::double precision * n.sharers + (_c->>'q_share_click')::double precision * n.clickers
             - (_c->>'q_hide')::double precision * n.hiders) AS engagement,
           GREATEST(n.viewers, n.likers, n.commenters, n.sharers, n.clickers, n.hiders)::integer AS views
      FROM n
  ), w AS (
    INSERT INTO public.feed_post_quality AS pq (post_id, score, engagement, views, updated_at)
    SELECT m.id,
           (m.engagement + (_c->>'q_prior_rate')::double precision * (_c->>'q_prior_views')::double precision)
             / GREATEST(m.views + (_c->>'q_prior_views')::double precision, 1),
           m.engagement, m.views, _now
      FROM m
    ON CONFLICT (post_id) DO UPDATE
      SET score = EXCLUDED.score, engagement = EXCLUDED.engagement, views = EXCLUDED.views, updated_at = EXCLUDED.updated_at
    RETURNING 1
  )
  SELECT count(*) INTO _nq FROM w;

  -- 5 · retention (bounded).
  DELETE FROM public.feed_viewer_author_affinity
   WHERE ctid = ANY (ARRAY(SELECT a.ctid FROM public.feed_viewer_author_affinity a
                            WHERE a.updated_at < _now - make_interval(days => (_c->>'retention_days')::integer) LIMIT _pb));
  GET DIAGNOSTICS _pa = ROW_COUNT;
  DELETE FROM public.feed_viewer_category_interest
   WHERE ctid = ANY (ARRAY(SELECT c.ctid FROM public.feed_viewer_category_interest c
                            WHERE c.updated_at < _now - make_interval(days => (_c->>'retention_days')::integer) LIMIT _pb));
  GET DIAGNOSTICS _pc = ROW_COUNT;

  RETURN jsonb_build_object('rows', _rows, 'affinity', _na, 'category', _nc, 'quality', _nq,
                            'purged_affinity', _pa, 'purged_category', _pc);
END;
$fn$;

-- ── 7. privacy: RLS on, NO policy; privileges ───────────────────────────────
ALTER TABLE public.feed_score_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_score_watermarks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_viewer_author_affinity   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_viewer_category_interest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_post_quality             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_post_quality_queue       ENABLE ROW LEVEL SECURITY;

-- New tables and functions get each lane's default privileges (they differ
-- between staging and production): take everything away, then grant exactly.
REVOKE ALL ON TABLE public.feed_score_config, public.feed_score_watermarks, public.feed_viewer_author_affinity,
  public.feed_viewer_category_interest, public.feed_post_quality, public.feed_post_quality_queue
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.feed_score_config, public.feed_score_watermarks, public.feed_viewer_author_affinity,
  public.feed_viewer_category_interest, public.feed_post_quality, public.feed_post_quality_queue
  TO service_role;

REVOKE ALL ON FUNCTION public.feed_scores_refresh(integer), public.feed_score_decayed(double precision, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feed_scores_refresh(integer) TO service_role;

-- ── 8. every 3 minutes ───────────────────────────────────────────────────────
SELECT cron.schedule('refresh-feed-scores', '*/3 * * * *', $cmd$SELECT public.feed_scores_refresh();$cmd$);

DO $postconditions$
DECLARE
  _bad text := '';
  r    record;
BEGIN
  -- POST-001 · RLS on, and NO policy at all, on the six tables.
  FOR r IN SELECT unnest(ARRAY['feed_score_config', 'feed_score_watermarks', 'feed_viewer_author_affinity',
                               'feed_viewer_category_interest', 'feed_post_quality', 'feed_post_quality_queue']) AS t LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || r.t)::regclass) THEN
      _bad := _bad || E'\n  ' || r.t || ': RLS not enabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.t) THEN
      _bad := _bad || E'\n  ' || r.t || ': has a policy (want none)';
    END IF;
    -- POST-002 · no privilege for anon / authenticated.
    IF has_table_privilege('anon', 'public.' || r.t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_table_privilege('authenticated', 'public.' || r.t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      _bad := _bad || E'\n  ' || r.t || ': anon or authenticated has a privilege';
    END IF;
  END LOOP;

  -- POST-003 · functions: invoker, search_path '', not executable by PUBLIC / anon / authenticated.
  FOR r IN SELECT unnest(ARRAY['public.feed_scores_refresh(integer)', 'public.feed_score_decayed(double precision,timestamp with time zone)']) AS f LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = r.f::regprocedure AND NOT p.prosecdef
                     AND p.proconfig = ARRAY['search_path=""']) THEN
      _bad := _bad || E'\n  ' || r.f || ': attributes differ (SECURITY INVOKER / search_path)';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = r.f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  ' || r.f || ' is executable by PUBLIC, anon or authenticated';
    END IF;
  END LOOP;

  -- POST-004 · config complete, sane; seven watermarks; job scheduled.
  IF (SELECT count(*) FROM public.feed_score_config) <> 29
     OR (SELECT value FROM public.feed_score_config WHERE key = 'half_life_days') <= 0
     OR (SELECT value FROM public.feed_score_config WHERE key = 'q_prior_views') < 1
     OR (SELECT value FROM public.feed_score_config WHERE key = 'w_hide') >= 0
     OR (SELECT value FROM public.feed_score_config WHERE key = 'w_skip') >= 0 THEN
    _bad := _bad || E'\n  feed_score_config is not the seeded set';
  END IF;
  IF (SELECT count(*) FROM public.feed_score_watermarks) <> 7 THEN
    _bad := _bad || E'\n  feed_score_watermarks does not hold the seven sources';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-feed-scores' AND schedule = '*/3 * * * *') THEN
    _bad := _bad || E'\n  cron job refresh-feed-scores missing';
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F2-0002-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S12F2-0002: closeness + category interest + post quality (half-life 14 d, Bayesian prior 0.05 over 50 views); refresh-feed-scores every 3 min, watermark + bounded batch; RLS on, no policy, no client privilege';
END
$postconditions$;

COMMIT;
