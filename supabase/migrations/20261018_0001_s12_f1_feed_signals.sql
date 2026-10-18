-- ═══════════════════════════════════════════════════════════════════════════
-- 20261018_0001 — S12-F1 Signals + Hide + Mute (data layer).
--   · Signals: the member's OWN attention on the feed — time on post, fast
--     skips, video watch %, "Copy link" share clicks, profile visits —
--     recorded exactly once, readable by that member only.
--   · Hide ("Not interested" / "Hide post"): a negative signal per (viewer,
--     post), exactly once, own rows only, indexed so the later feed RPC can
--     exclude hidden posts.
--   · Mute account: the viewer stops seeing an author's posts without
--     unfollowing; exactly once, own rows only, unique (viewer, author).
-- EXPAND step: new objects only; nothing existing is altered. The current
-- client keeps working (it simply does not send any of these yet).
-- Lanes: staging and production (refuses any other lane).
-- D1 (Database & Runtime), 2026-10-18. Master plan v3 S12 (Owner, 2026-10-18;
-- Owner decisions of 2026-10-18: detailed rows kept 90 days; watch % kept as a
-- taste signal, no video boost; Extra A hide and Extra D mute in this unit).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE (verbatim): "Likes, comments, shares, saves, follows, profile visits,
-- time on post, video watch %, skips (own-member data only, via the outbox) —
-- Signals recorded exactly once; no other member can read them."
--
-- WHAT ALREADY HAS A HOME — NOT DUPLICATED (F2 reads these tables directly):
--   likes        post_reactions   UNIQUE (post_id, user_id)        via the outbox
--   comments     post_comments    UNIQUE (user_id, idempotency_key) via the outbox
--   shares       post_shares      UNIQUE (post_id, user_id)        "Share to your wall"
--   follows      follows          UNIQUE (follower_id, following_id)
--   seen         feed_events      PK (id), client-made id           via the outbox (Stage L2)
--   saves        — the product has no save feature; it gets its own table when built.
--   mute         — none exists (git grep mute/muted in src + migrations: only
--                  video sound and CSS; live catalogue 2026-10-17: no mute or
--                  hide relation or function). user_blocks is a different
--                  thing (both directions, and it hides the member entirely).
-- (Read from the live catalogue snapshot of 2026-10-17, _control/forensic.)
--
-- WHAT HAD NO HOME — ADDED HERE:
--   time on post (dwell), video watch %, fast skip, share click ("Copy link"),
--   profile visit as the VIEWER's signal; hide; mute.
--   · Why not more event types in feed_events: its rows drive behaviour today.
--     get_broadcast_feed retires a post on 'view' or on two 'skip's, and
--     trg_feed_events_viewer_count bumps posts.viewer_count — the public view
--     count — on the first view/skip. A fast flick recorded there would hide
--     posts and inflate a visible number before F4 has decided anything.
--     Signals must change nothing until F2/F4 read them.
--   · Why not profile_views: the profile OWNER can read it (who visited me —
--     "Users can view own profile views"), it has no idempotency key and is
--     written directly, not through the outbox. It stays what it is: the
--     owner's view count. The viewer's signal is private, so it lives here.
--
-- DESIGN (1 M members)
--   1. public.feed_signal_events — the INGEST LEDGER. One row per signal,
--      written ONLY through the OFF-2 outbox (kind "feed_signals"): PRIMARY KEY
--      (id) where id is a UUID made ONCE on the device when the signal is
--      recorded; the sender upserts ON CONFLICT (id) DO NOTHING.
--   2. BEFORE INSERT (feed_signal_events_before, SECURITY DEFINER) —
--      normalises and filters the caller's OWN rows only: a row whose user_id
--      is not auth.uid() is passed through untouched for RLS to refuse, so
--      "skipped" vs "refused" never reveals another member's activity. It SKIPS a row (RETURN NULL: not an error, so
--      one bad row never takes the rest of its batch with it) when:
--        · the post does not exist, or the member may not see it
--          (public.can_view_post — the same rule as posts' own SELECT policy);
--        · the post or profile is the member's own (own-member data only);
--        · the profile does not exist;
--        · the member already sent 300 signals in the last 10 minutes.
--      subject_id is overwritten with the post's real author; created_at with
--      now() (the client cannot date a row past the retention).
--   3. AFTER INSERT (feed_signal_events_fold, SECURITY DEFINER) — folds the
--      row into the per-viewer aggregates F2 reads:
--        public.feed_post_signals   (user_id, post_id): dwell_ms (sum, capped
--          at 24 h), watch_pct (max), skips, share_clicks, first_at, last_at;
--        public.feed_author_signals (user_id, author_id): profile_visits,
--          first_at, last_visit_at.
--      EXACTLY ONCE: an AFTER ROW INSERT trigger fires only for a row that was
--      really inserted. A resend (same id) hits ON CONFLICT DO NOTHING and
--      fires nothing; a row skipped by the BEFORE trigger fires nothing. So
--      one recorded signal is one count, however often it is resent.
--   4. Bounds: CHECK per kind — dwell 1 … 600,000 ms per row, watch 0 … 100,
--      skip / share_click / profile_visit value 0; post_id required for the
--      post kinds and NULL for profile_visit. Aggregates saturate (dwell ≤ 24 h
--      per viewer per post, counters ≤ 32,767 / 1,000,000) instead of failing.
--   5. HIDE — public.feed_hidden_posts (user_id, post_id) PRIMARY KEY, reason
--      'not_interested' | 'hide'. Outbox kind "hide_post", natural key: the
--      sender upserts ON CONFLICT (user_id, post_id) DO NOTHING, so a resend
--      is the same row. BEFORE INSERT (feed_hidden_posts_before) skips a post
--      that does not exist, is the member's own, or that they may not see.
--      The later feed RPC excludes with
--        NOT EXISTS (SELECT 1 FROM feed_hidden_posts h
--                     WHERE h.user_id = auth.uid() AND h.post_id = p.id)
--      which is exactly the primary key (no extra index needed).
--   6. MUTE — public.feed_muted_authors (user_id, author_id) PRIMARY KEY,
--      CHECK user_id <> author_id. Outbox kinds "mute" / "unmute", natural key
--      (upsert ON CONFLICT DO NOTHING / delete by the pair: both repeatable;
--      the outbox collapses mute/unmute of one author to the last intent).
--      The feed RPC excludes with (user_id = auth.uid() AND author_id =
--      p.user_id) — the primary key again.
--   7. RETENTION (Owner, 2026-10-18: detailed signal rows 90 days; F2's
--      summaries are kept longer and are F2's to define). public.purge_feed_signals,
--      hourly at :43, ≤ 100,000 rows per table per run:
--        feed_signal_events   90 days after created_at;
--        feed_post_signals    90 days after first_at;
--        feed_author_signals  90 days after the last visit.
--      Hides and mutes are the member's standing choices, not detailed
--      signals: kept until undone (mute) or until the post / account is
--      deleted (FK cascade).
--      Capacity: 2.4 M rows per table per day purged. Past that inflow the
--      ledger should move to daily partitions (DROP PARTITION) — a follow-up
--      unit; PROBE G4 prints the daily inflow so the trigger point is visible.
--   8. PRIVACY. RLS on all five tables. One permissive policy per action, all
--      ((SELECT auth.uid()) = user_id), TO authenticated:
--        feed_signal_events   SELECT, INSERT
--        feed_post_signals    SELECT          (written only by the fold)
--        feed_author_signals  SELECT          (written only by the fold)
--        feed_hidden_posts    SELECT, INSERT, DELETE (un-hide, later UI)
--        feed_muted_authors   SELECT, INSERT, DELETE (unmute)
--      plus a RESTRICTIVE insert policy refusing a deleted account
--      (account_is_live(), the house pattern) on every table members insert
--      into. No UPDATE anywhere. No admin policy, no anon grant, nothing for
--      PUBLIC. Account deletion: every member column is a FK to auth.users ON
--      DELETE CASCADE; post deletion cascades to feed_post_signals and
--      feed_hidden_posts.
--   9. SECURITY DEFINER, judged by its WHERE clauses: the two BEFORE triggers
--      read posts / profiles by the row's own post_id / subject_id and write
--      nothing; the fold writes exactly one aggregate row keyed by
--      NEW.user_id, which the INSERT policy has already pinned to auth.uid()
--      (WITH CHECK is evaluated on the row the BEFORE trigger returns; no
--      trigger touches user_id). None returns data to the caller. EXECUTE on
--      every function: not PUBLIC, anon or authenticated (a trigger function
--      is not checked for EXECUTE when it fires; PROBE G2 proves a member's
--      insert still works).
--  10. INDEXES — each is for a named reader (P28 lines below).
--
-- LOCKING. CREATE TABLE / FUNCTION / TRIGGER / POLICY on new objects only; the
-- only existing objects referenced are FK targets (posts, auth.users: SHARE ROW
-- EXCLUSIVE for the FK creation, brief — no rows to validate) and the cron
-- schedule. lock_timeout 5 s.
-- RE-RUN: refused by PRE-001 once applied. After the rollback it applies again.
-- ROLLBACK: supabase/rollback/20261018_0001_s12_f1_feed_signals_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261018_0001_s12_f1_feed_signals.sql
--           (fails before this file, passes after; writes test rows inside its
--           own transaction and ROLLs BACK)
-- EVIDENCE: docs/evidence/d1/S12-F1-feed-signals/ (PGlite proof, fail-first,
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
BEGIN
  -- PRE-001 · not applied already (checked first, so a re-run says so plainly).
  IF to_regclass('public.feed_signal_events') IS NOT NULL
     OR to_regclass('public.feed_post_signals') IS NOT NULL
     OR to_regclass('public.feed_author_signals') IS NOT NULL
     OR to_regclass('public.feed_hidden_posts') IS NOT NULL
     OR to_regclass('public.feed_muted_authors') IS NOT NULL
     OR to_regproc('public.feed_signal_events_before') IS NOT NULL
     OR to_regproc('public.feed_signal_events_fold') IS NOT NULL
     OR to_regproc('public.feed_hidden_posts_before') IS NOT NULL
     OR to_regproc('public.purge_feed_signals') IS NOT NULL THEN
    RAISE EXCEPTION 'S12F1-0001-PRE-001: an S12-F1 object already exists — 20261018_0001 is applied (or half-applied by hand)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-002 · what this file relies on.
  IF to_regclass('public.posts') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.posts'::regclass AND attname = 'privacy' AND NOT attisdropped) THEN
    _bad := _bad || E'\n  public.posts(privacy) missing';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN _bad := _bad || E'\n  public.profiles missing'; END IF;
  IF to_regclass('auth.users') IS NULL THEN _bad := _bad || E'\n  auth.users missing'; END IF;
  IF to_regprocedure('public.can_view_post(uuid, uuid, text)') IS NULL THEN _bad := _bad || E'\n  public.can_view_post(uuid, uuid, text) missing'; END IF;
  IF to_regprocedure('public.account_is_live()') IS NULL THEN _bad := _bad || E'\n  public.account_is_live() missing'; END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN _bad := _bad || E'\n  auth.uid() missing'; END IF;
  IF to_regnamespace('cron') IS NULL OR to_regproc('cron.schedule') IS NULL THEN _bad := _bad || E'\n  pg_cron (cron.schedule) missing'; END IF;
  IF to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-feed-signals') THEN
    _bad := _bad || E'\n  cron job purge-feed-signals already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    _bad := _bad || E'\n  role anon / authenticated / service_role missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F1-0001-PRE-002: prerequisites missing:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the ingest ledger ─────────────────────────────────────────────────────
-- No DEFAULT on id, on purpose: an id-less insert would get a fresh key on
-- every resend and break exactly-once, so it fails loudly instead.
CREATE TABLE public.feed_signal_events (
  id          uuid        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  post_id     uuid,
  subject_id  uuid        NOT NULL,
  value       integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_signal_events_kind_value_check CHECK (
       (kind = 'dwell'         AND post_id IS NOT NULL AND value BETWEEN 1 AND 600000)
    OR (kind = 'watch'         AND post_id IS NOT NULL AND value BETWEEN 0 AND 100)
    OR (kind IN ('skip', 'share_click') AND post_id IS NOT NULL AND value = 0)
    OR (kind = 'profile_visit' AND post_id IS NULL     AND value = 0)
  )
);
COMMENT ON TABLE public.feed_signal_events IS
  'S12-F1 ingest ledger: one row per signal, client-made id (exactly once via the OFF-2 outbox, ON CONFLICT (id) DO NOTHING). Folded into feed_post_signals / feed_author_signals by an AFTER INSERT trigger. Own rows only (RLS). Kept 90 days (purge_feed_signals).';

-- P28: feed_signal_events · ~2 M rows/day at launch scale, 90-day window · the
-- BEFORE trigger's per-member rate count (user_id = $1 AND created_at > now()-10 min)
-- and the auth.users FK cascade on account deletion; no other index serves either.
CREATE INDEX feed_signal_events_user_created_idx ON public.feed_signal_events (user_id, created_at DESC);
-- P28: feed_signal_events · append-only, created_at follows physical order · BRIN
-- (a few pages) lets the hourly purge find rows older than 90 days without a scan.
CREATE INDEX feed_signal_events_created_brin ON public.feed_signal_events USING brin (created_at);

-- ── 2. the aggregates F2 reads ───────────────────────────────────────────────
-- fillfactor 80: every fold is an UPDATE of an existing row on non-indexed
-- columns (dwell_ms, watch_pct, skips, share_clicks, last_at) — room on the page
-- keeps those updates HOT, so the indexes are not touched per signal.
CREATE TABLE public.feed_post_signals (
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  post_id       uuid        NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  author_id     uuid        NOT NULL,
  dwell_ms      integer     NOT NULL DEFAULT 0 CHECK (dwell_ms BETWEEN 0 AND 86400000),
  watch_pct     smallint             CHECK (watch_pct BETWEEN 0 AND 100),
  skips         smallint    NOT NULL DEFAULT 0 CHECK (skips >= 0),
  share_clicks  smallint    NOT NULL DEFAULT 0 CHECK (share_clicks >= 0),
  first_at      timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
) WITH (fillfactor = 80);
COMMENT ON TABLE public.feed_post_signals IS
  'S12-F1 per viewer per post: dwell (ms, sum), watch % (max; a taste signal, no video boost), skips, share clicks. Written only by feed_signal_events_fold. Own rows only (RLS). Kept 90 days after first_at.';

-- P28: feed_post_signals · ≈ distinct posts each member engages with (bounded by
-- the 90-day window) · F2 viewer→author closeness reads (user_id, author_id);
-- the PK leads with (user_id, post_id), which cannot serve an author range.
CREATE INDEX feed_post_signals_user_author_idx ON public.feed_post_signals (user_id, author_id);
-- P28: feed_post_signals · F2 post quality (engagement ÷ views per post) reads
-- by post_id, and the posts FK cascade on post deletion needs it (P35 rule 2).
CREATE INDEX feed_post_signals_post_idx ON public.feed_post_signals (post_id);
-- P28: feed_post_signals · first_at is set once at insert, so it follows physical
-- order · BRIN for the hourly 90-day purge.
CREATE INDEX feed_post_signals_first_brin ON public.feed_post_signals USING brin (first_at);

CREATE TABLE public.feed_author_signals (
  user_id         uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  author_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_visits  integer     NOT NULL DEFAULT 0 CHECK (profile_visits >= 0),
  first_at        timestamptz NOT NULL DEFAULT now(),
  last_visit_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, author_id),
  CONSTRAINT feed_author_signals_not_self CHECK (user_id <> author_id)
);
COMMENT ON TABLE public.feed_author_signals IS
  'S12-F1 per viewer per profile: profile visits (the viewer''s own signal; profile_views stays the owner''s count). Written only by feed_signal_events_fold. Own rows only (RLS). Kept 90 days after the last visit.';

-- P28: feed_author_signals · ≈ profiles each member visits · the auth.users FK
-- cascade when the VISITED account is deleted (P35 rule 2); the PK leads with user_id.
CREATE INDEX feed_author_signals_author_idx ON public.feed_author_signals (author_id);
-- P28: feed_author_signals · visits are rare (one per profile per 30 min) so
-- updating this index costs little · the hourly 90-day purge by last_visit_at.
CREATE INDEX feed_author_signals_last_visit_idx ON public.feed_author_signals (last_visit_at);

-- ── 3. hide and mute ─────────────────────────────────────────────────────────
-- The primary keys ARE the feed RPC's exclusion indexes: (user_id = auth.uid()
-- AND post_id = p.id) and (user_id = auth.uid() AND author_id = p.user_id).
CREATE TABLE public.feed_hidden_posts (
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  post_id     uuid        NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  reason      text        NOT NULL DEFAULT 'not_interested' CHECK (reason IN ('not_interested', 'hide')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
COMMENT ON TABLE public.feed_hidden_posts IS
  'S12-F1 Extra A: "Not interested" / "Hide post" — a negative signal per viewer per post, exactly once via the OFF-2 outbox (natural key). The feed RPC excludes these by the PK. Own rows only (RLS). Kept until the post or account is deleted.';
-- P28: feed_hidden_posts · a few rows per member · the posts FK cascade on post
-- deletion (P35 rule 2); the PK leads with user_id and cannot serve it.
CREATE INDEX feed_hidden_posts_post_idx ON public.feed_hidden_posts (post_id);

CREATE TABLE public.feed_muted_authors (
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, author_id),
  CONSTRAINT feed_muted_authors_not_self CHECK (user_id <> author_id)
);
COMMENT ON TABLE public.feed_muted_authors IS
  'S12-F1 Extra D: mute an account — the viewer stops seeing the author''s posts without unfollowing. Unique (viewer, author); exactly once via the OFF-2 outbox (natural key). Own rows only (RLS). Kept until unmuted or the account is deleted.';
-- P28: feed_muted_authors · a few rows per member · the auth.users FK cascade
-- when the MUTED account is deleted (P35 rule 2); the PK leads with user_id.
CREATE INDEX feed_muted_authors_author_idx ON public.feed_muted_authors (author_id);

-- ── 4. BEFORE INSERT: normalise and filter ───────────────────────────────────
CREATE FUNCTION public.feed_signal_events_before()
 RETURNS trigger
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  _author  uuid;
  _privacy text;
  _recent  integer;
BEGIN
  -- A row in ANOTHER member's name is passed through untouched, so the RLS
  -- WITH CHECK refuses it uniformly. Filtering it here first (visibility, rate)
  -- would let the caller tell "skipped" from "refused" and so learn about that
  -- member's activity (review B1, PR #457). service_role (auth.uid() NULL) is
  -- trusted and bypasses RLS: its rows are not normalised here.
  IF NEW.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF NEW.kind = 'profile_visit' THEN
    -- own profile, or no such profile: not recorded
    IF NEW.subject_id IS NULL OR NEW.subject_id = NEW.user_id
       OR NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = NEW.subject_id) THEN
      RETURN NULL;
    END IF;
  ELSE
    SELECT p.user_id, p.privacy INTO _author, _privacy FROM public.posts p WHERE p.id = NEW.post_id;
    -- deleted post, own post, or a post this member may not see: not recorded
    IF _author IS NULL OR _author = NEW.user_id
       OR NOT public.can_view_post(NEW.user_id, _author, _privacy) THEN
      RETURN NULL;
    END IF;
    NEW.subject_id := _author;
  END IF;

  -- rate bound: 300 signals per member per 10 minutes (LIMIT keeps the count cheap)
  SELECT count(*) INTO _recent
    FROM (SELECT 1 FROM public.feed_signal_events e
           WHERE e.user_id = NEW.user_id AND e.created_at > now() - interval '10 minutes'
           LIMIT 300) r;
  IF _recent >= 300 THEN
    RETURN NULL;
  END IF;

  NEW.created_at := now();
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION public.feed_hidden_posts_before()
 RETURNS trigger
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  _author  uuid;
  _privacy text;
BEGIN
  -- A row in ANOTHER member's name is passed through untouched, so the RLS
  -- WITH CHECK refuses it uniformly. Filtering it here first (visibility, rate)
  -- would let the caller tell "skipped" from "refused" and so learn about that
  -- member's activity (review B1, PR #457). service_role (auth.uid() NULL) is
  -- trusted and bypasses RLS: its rows are not normalised here.
  IF NEW.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN NEW;
  END IF;
  SELECT p.user_id, p.privacy INTO _author, _privacy FROM public.posts p WHERE p.id = NEW.post_id;
  -- deleted post, own post, or a post this member may not see: not recorded
  -- (and the FK error that would say "this post exists" never happens)
  IF _author IS NULL OR _author = NEW.user_id
     OR NOT public.can_view_post(NEW.user_id, _author, _privacy) THEN
    RETURN NULL;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$fn$;

-- ── 5. AFTER INSERT: fold into the aggregates (fires only for a row really inserted) ──
CREATE FUNCTION public.feed_signal_events_fold()
 RETURNS trigger
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.kind = 'profile_visit' THEN
    INSERT INTO public.feed_author_signals AS s (user_id, author_id, profile_visits, first_at, last_visit_at)
    VALUES (NEW.user_id, NEW.subject_id, 1, NEW.created_at, NEW.created_at)
    ON CONFLICT (user_id, author_id) DO UPDATE
      SET profile_visits = LEAST(s.profile_visits + 1, 1000000),
          last_visit_at  = GREATEST(s.last_visit_at, EXCLUDED.last_visit_at);
  ELSE
    INSERT INTO public.feed_post_signals AS s
      (user_id, post_id, author_id, dwell_ms, watch_pct, skips, share_clicks, first_at, last_at)
    VALUES (
      NEW.user_id, NEW.post_id, NEW.subject_id,
      CASE WHEN NEW.kind = 'dwell' THEN NEW.value ELSE 0 END,
      CASE WHEN NEW.kind = 'watch' THEN NEW.value::smallint END,
      CASE WHEN NEW.kind = 'skip' THEN 1 ELSE 0 END,
      CASE WHEN NEW.kind = 'share_click' THEN 1 ELSE 0 END,
      NEW.created_at, NEW.created_at)
    ON CONFLICT (user_id, post_id) DO UPDATE
      SET dwell_ms     = LEAST(s.dwell_ms::bigint + EXCLUDED.dwell_ms, 86400000)::integer,
          watch_pct    = GREATEST(s.watch_pct, EXCLUDED.watch_pct),
          skips        = LEAST(s.skips + EXCLUDED.skips, 32767)::smallint,
          share_clicks = LEAST(s.share_clicks + EXCLUDED.share_clicks, 32767)::smallint,
          last_at      = GREATEST(s.last_at, EXCLUDED.last_at);
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER feed_signal_events_before BEFORE INSERT ON public.feed_signal_events
  FOR EACH ROW EXECUTE FUNCTION public.feed_signal_events_before();
CREATE TRIGGER feed_signal_events_fold AFTER INSERT ON public.feed_signal_events
  FOR EACH ROW EXECUTE FUNCTION public.feed_signal_events_fold();
CREATE TRIGGER feed_hidden_posts_before BEFORE INSERT ON public.feed_hidden_posts
  FOR EACH ROW EXECUTE FUNCTION public.feed_hidden_posts_before();

-- ── 6. retention (detailed signal rows: 90 days) ────────────────────────────
CREATE FUNCTION public.purge_feed_signals(_batch integer DEFAULT 100000)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO ''
AS $fn$
DECLARE
  _b integer := GREATEST(1, LEAST(coalesce(_batch, 100000), 1000000));
  _e integer;
  _p integer;
  _a integer;
BEGIN
  DELETE FROM public.feed_signal_events
   WHERE ctid = ANY (ARRAY(SELECT ctid FROM public.feed_signal_events
                            WHERE created_at < now() - interval '90 days' LIMIT _b));
  GET DIAGNOSTICS _e = ROW_COUNT;
  DELETE FROM public.feed_post_signals
   WHERE ctid = ANY (ARRAY(SELECT ctid FROM public.feed_post_signals
                            WHERE first_at < now() - interval '90 days' LIMIT _b));
  GET DIAGNOSTICS _p = ROW_COUNT;
  DELETE FROM public.feed_author_signals
   WHERE ctid = ANY (ARRAY(SELECT ctid FROM public.feed_author_signals
                            WHERE last_visit_at < now() - interval '90 days' LIMIT _b));
  GET DIAGNOSTICS _a = ROW_COUNT;
  RETURN jsonb_build_object('feed_signal_events', _e, 'feed_post_signals', _p, 'feed_author_signals', _a);
END;
$fn$;

-- ── 7. privacy: RLS, one permissive policy per action, grants ───────────────
ALTER TABLE public.feed_signal_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_post_signals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_author_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_hidden_posts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_muted_authors  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members insert own signals" ON public.feed_signal_events
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Members read own signals" ON public.feed_signal_events
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Deleted accounts cannot insert" ON public.feed_signal_events
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.account_is_live()));
CREATE POLICY "Members read own post signals" ON public.feed_post_signals
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Members read own author signals" ON public.feed_author_signals
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Members hide posts for themselves" ON public.feed_hidden_posts
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Members read own hidden posts" ON public.feed_hidden_posts
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Members unhide own hidden posts" ON public.feed_hidden_posts
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Deleted accounts cannot insert" ON public.feed_hidden_posts
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.account_is_live()));

CREATE POLICY "Members mute for themselves" ON public.feed_muted_authors
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Members read own mutes" ON public.feed_muted_authors
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Members unmute own mutes" ON public.feed_muted_authors
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Deleted accounts cannot insert" ON public.feed_muted_authors
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.account_is_live()));

-- New tables and functions get each lane's default privileges (they differ
-- between staging and production): take everything away, then grant exactly.
REVOKE ALL ON TABLE public.feed_signal_events, public.feed_post_signals, public.feed_author_signals,
  public.feed_hidden_posts, public.feed_muted_authors
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.feed_signal_events TO authenticated;
GRANT SELECT ON TABLE public.feed_post_signals, public.feed_author_signals TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.feed_hidden_posts, public.feed_muted_authors TO authenticated;
GRANT ALL ON TABLE public.feed_signal_events, public.feed_post_signals, public.feed_author_signals,
  public.feed_hidden_posts, public.feed_muted_authors TO service_role;

REVOKE ALL ON FUNCTION public.feed_signal_events_before(), public.feed_signal_events_fold(),
  public.feed_hidden_posts_before(), public.purge_feed_signals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_feed_signals(integer) TO service_role;

-- ── 8. the hourly purge ─────────────────────────────────────────────────────
SELECT cron.schedule('purge-feed-signals', '43 * * * *', $cmd$SELECT public.purge_feed_signals();$cmd$);

DO $postconditions$
DECLARE
  _bad text := '';
  r    record;
BEGIN
  -- POST-001 · tables, RLS, policies (exact set).
  FOR r IN SELECT unnest(ARRAY['feed_signal_events', 'feed_post_signals', 'feed_author_signals',
                               'feed_hidden_posts', 'feed_muted_authors']) AS t LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || r.t)::regclass) THEN
      _bad := _bad || E'\n  ' || r.t || ': RLS not enabled';
    END IF;
  END LOOP;
  IF (SELECT string_agg(tablename || '|' || policyname || '|' || cmd || '|' || permissive || '|' || array_to_string(roles, ','), ';' ORDER BY tablename, policyname)
        FROM pg_policies WHERE schemaname = 'public'
         AND tablename IN ('feed_signal_events', 'feed_post_signals', 'feed_author_signals', 'feed_hidden_posts', 'feed_muted_authors'))
     IS DISTINCT FROM
       'feed_author_signals|Members read own author signals|SELECT|PERMISSIVE|authenticated;'
    || 'feed_hidden_posts|Deleted accounts cannot insert|INSERT|RESTRICTIVE|authenticated;'
    || 'feed_hidden_posts|Members hide posts for themselves|INSERT|PERMISSIVE|authenticated;'
    || 'feed_hidden_posts|Members read own hidden posts|SELECT|PERMISSIVE|authenticated;'
    || 'feed_hidden_posts|Members unhide own hidden posts|DELETE|PERMISSIVE|authenticated;'
    || 'feed_muted_authors|Deleted accounts cannot insert|INSERT|RESTRICTIVE|authenticated;'
    || 'feed_muted_authors|Members mute for themselves|INSERT|PERMISSIVE|authenticated;'
    || 'feed_muted_authors|Members read own mutes|SELECT|PERMISSIVE|authenticated;'
    || 'feed_muted_authors|Members unmute own mutes|DELETE|PERMISSIVE|authenticated;'
    || 'feed_post_signals|Members read own post signals|SELECT|PERMISSIVE|authenticated;'
    || 'feed_signal_events|Deleted accounts cannot insert|INSERT|RESTRICTIVE|authenticated;'
    || 'feed_signal_events|Members insert own signals|INSERT|PERMISSIVE|authenticated;'
    || 'feed_signal_events|Members read own signals|SELECT|PERMISSIVE|authenticated' THEN
    _bad := _bad || E'\n  the policy set is not the intended one';
  END IF;

  -- POST-002 · table privileges: anon none; authenticated exactly as granted.
  FOR r IN
    SELECT t, p, want FROM (VALUES
      ('feed_signal_events', 'SELECT', true), ('feed_signal_events', 'INSERT', true),
      ('feed_signal_events', 'UPDATE', false), ('feed_signal_events', 'DELETE', false), ('feed_signal_events', 'TRUNCATE', false),
      ('feed_post_signals', 'SELECT', true), ('feed_post_signals', 'INSERT', false),
      ('feed_post_signals', 'UPDATE', false), ('feed_post_signals', 'DELETE', false),
      ('feed_author_signals', 'SELECT', true), ('feed_author_signals', 'INSERT', false),
      ('feed_author_signals', 'UPDATE', false), ('feed_author_signals', 'DELETE', false),
      ('feed_hidden_posts', 'SELECT', true), ('feed_hidden_posts', 'INSERT', true),
      ('feed_hidden_posts', 'UPDATE', false), ('feed_hidden_posts', 'DELETE', true), ('feed_hidden_posts', 'TRUNCATE', false),
      ('feed_muted_authors', 'SELECT', true), ('feed_muted_authors', 'INSERT', true),
      ('feed_muted_authors', 'UPDATE', false), ('feed_muted_authors', 'DELETE', true), ('feed_muted_authors', 'TRUNCATE', false)
    ) v(t, p, want)
  LOOP
    IF has_table_privilege('authenticated', 'public.' || r.t, r.p) IS DISTINCT FROM r.want THEN
      _bad := _bad || E'\n  authenticated ' || r.p || ' on ' || r.t || ' is ' || (NOT r.want)::text;
    END IF;
    IF has_table_privilege('anon', 'public.' || r.t, r.p) THEN
      _bad := _bad || E'\n  anon has ' || r.p || ' on ' || r.t;
    END IF;
  END LOOP;

  -- POST-003 · functions: attributes, and not executable by PUBLIC / anon / authenticated.
  FOR r IN
    SELECT f, definer FROM (VALUES
      ('public.feed_signal_events_before()', true), ('public.feed_signal_events_fold()', true),
      ('public.feed_hidden_posts_before()', true), ('public.purge_feed_signals(integer)', false)) v(f, definer)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = r.f::regprocedure AND p.prosecdef = r.definer
                     AND p.provolatile = 'v' AND p.proconfig = ARRAY['search_path=""']) THEN
      _bad := _bad || E'\n  ' || r.f || ': attributes differ (SECURITY DEFINER / VOLATILE / search_path)';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = r.f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  ' || r.f || ' is executable by PUBLIC, anon or authenticated';
    END IF;
  END LOOP;

  -- POST-004 · the three triggers, enabled.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.feed_signal_events'::regclass AND NOT tgisinternal
        AND tgenabled = 'O' AND tgname IN ('feed_signal_events_before', 'feed_signal_events_fold')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.feed_hidden_posts'::regclass AND NOT tgisinternal
        AND tgenabled = 'O' AND tgname = 'feed_hidden_posts_before') THEN
    _bad := _bad || E'\n  the S12-F1 triggers are not all present and enabled';
  END IF;

  -- POST-005 · the purge is scheduled.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-feed-signals' AND schedule = '43 * * * *') THEN
    _bad := _bad || E'\n  cron job purge-feed-signals missing';
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F1-0001-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S12F1-0001: feed_signal_events + feed_post_signals + feed_author_signals (90 d) + feed_hidden_posts + feed_muted_authors; RLS own-rows-only; exactly-once; purge-feed-signals hourly';
END
$postconditions$;

COMMIT;
