-- ═══════════════════════════════════════════════════════════════════════════
-- VID-2 · 20261005_0005 — videos in posts and ads: tables, state machine,
-- publish gate, RLS, 1–5 categories, limits, 30-day purge. D1, T1.
-- Lanes: staging and production. Needs 20261005_0004 (feature_allowed).
-- Plan: docs/evidence/d2/phase5/VID-1/DECISION.md §3.1, §3.5, §4, §5 (signed,
-- #376), with the Owner's R-100 (categories, 30-day keep) and R-102.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- EXPAND ONLY: media_objects, post_media and the photo path are untouched.
--
-- STATES (DECISION §4; "processing" in the Owner's words = 'checking'):
--   uploading ─mark_uploaded─▶ checking ─clean / not required─▶ ready ─report upheld─▶ taken_down
--      │                        │  └─match─▶ music_blocked ─new version─▶ uploading (v n+1)
--      │                        └─(error: stays checking, retried)
--      └─48 h─▶ failed          any of them ─owner/admin─▶ deleted ─30 days─▶ purged
-- The legal moves are enforced by a BEFORE UPDATE trigger for EVERY role,
-- service role included; nothing else can move a video.
--
-- THE PUBLISH GATE (DECISION §4, no admin bypass, no switch in the gate itself):
--   * CHECK ready_needs_check: state <> 'ready' OR music_check_id IS NOT NULL;
--   * the state trigger: entering 'ready' needs music_check_id → a
--     video_music_checks row of THIS video and its CURRENT version, verdict in
--     (clean, clean_no_audio, clean_library, not_required), and audio_sha256
--     equal to the version's stored audio hash (with audio) / no audio rendition
--     (without); a provider verdict also needs measured_audio_s within ±2 s of
--     the declared duration. 'not_required' is what 20261005_0006 records when
--     copyright_music_check is off for the owner (R-102) — it still carries the
--     audio hash, so a re-uploaded audio cannot ride on it either.
--   * video_music_checks is append-only (UPDATE always refused; DELETE only by
--     the 30-day purge).
--   * link triggers: a post_videos / ad_videos row needs a READY video of the
--     right purpose, owned by the post's author (ads: uploaded by an admin).
--
-- CATEGORIES (R-100, "POST-CAT-002 server backstop extended to videos"): a post
-- may carry a video only with 1–5 categories (VID-CAT-001, at link time, on
-- both lane shapes — staging's posts trigger has no INSERT minimum yet), and
-- keeps at least one while it carries one (VID-CAT-002). A video ad carries its
-- own 1–5 active category slugs (ad_creatives has none).
--
-- LIMITS (R-97, enforced in video_begin_upload; the client checks for UX only):
--   member post video: 3 min · 500 MB · 10 per rolling 24 h · 3 in progress ·
--                      feature_allowed('video_posts', uid)
--   video ad:          admins only · 5 min · 500 MB · no daily cap · 10 in progress ·
--                      feature_allowed('video_ads', uid)
--   bytes per declared second (SEC F-D3-15 condition 4): 240p ≤ 60 KB/s,
--   480p ≤ 160 KB/s, 720p ≤ 350 KB/s, audio ≤ 16 KB/s; poster + playlists ≤ 2 MB.
--   Owner from auth.uid() only; NULL refused; EXECUTE to authenticated only.
--
-- DELETED VIDEOS (R-100): kept 30 days, then purged by the hourly
-- 'video-housekeeping' job — the rows go and the R2 prefix is queued in
-- public.video_r2_purge_queue for the file deletion (D2/VID-6 worker). The same
-- job marks uploads abandoned for 48 h as failed (DECISION §3.5); failed videos
-- are purged 30 days later too.
--
-- OBJECTS (reservation): tables videos, video_versions, video_music_checks,
-- music_library_tracks, post_videos, ad_videos, video_r2_purge_queue; functions
-- video_validate_version (internal), video_begin_upload, video_delete, video_housekeeping and the trigger
-- functions below; cron job 'video-housekeeping'.
-- NOT RE-RUNNABLE: PRE-002 refuses once the tables exist.
-- ROLLBACK: supabase/rollback/20261005_0005_vid2_videos_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_vid2_videos.sql
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
BEGIN
  -- PRE-001 · what this file builds on.
  IF to_regprocedure('public.feature_allowed(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'VID2-0005-PRE-001: feature_allowed() is missing — apply 20261005_0004 first' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regclass('public.posts') IS NULL OR to_regclass('public.ad_creatives') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.categories') IS NULL OR to_regnamespace('cron') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'VID2-0005-PRE-001: posts, ad_creatives, profiles, categories, pg_cron or has_role is missing' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · the reserved names are free.
  IF to_regclass('public.videos') IS NOT NULL OR to_regclass('public.video_versions') IS NOT NULL
     OR to_regclass('public.video_music_checks') IS NOT NULL OR to_regclass('public.music_library_tracks') IS NOT NULL
     OR to_regclass('public.post_videos') IS NOT NULL OR to_regclass('public.ad_videos') IS NOT NULL
     OR to_regclass('public.video_r2_purge_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'VID2-0005-PRE-002: a video table already exists — 20261005_0005 is applied (or a name is taken)' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. tables ──────────────────────────────────────────────────────────────
CREATE TABLE public.music_library_tracks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                     text NOT NULL,
  artist                    text,
  duration_s                numeric(7,2) CHECK (duration_s > 0),
  r2_key                    text,
  license                   text NOT NULL,
  license_url               text NOT NULL,
  attribution               text,
  source                    text NOT NULL,
  provider_fingerprint_ids  text[] NOT NULL DEFAULT '{}',
  active                    boolean NOT NULL DEFAULT true,
  added_by                  uuid,
  added_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.videos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  purpose          text NOT NULL CHECK (purpose IN ('post', 'ad')),
  idempotency_key  uuid NOT NULL,
  current_version  integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  state            text NOT NULL DEFAULT 'uploading'
                   CHECK (state IN ('uploading', 'checking', 'music_blocked', 'ready', 'failed', 'taken_down', 'deleted')),
  music_check_id   uuid,
  failed_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  ready_at         timestamptz,
  deleted_at       timestamptz,
  CONSTRAINT videos_owner_idempotency_key UNIQUE (owner_id, idempotency_key),
  CONSTRAINT ready_needs_check CHECK (state <> 'ready' OR music_check_id IS NOT NULL),
  CONSTRAINT deleted_has_time CHECK (state <> 'deleted' OR deleted_at IS NOT NULL)
);
-- P28: the daily-limit and in-progress counts read one owner's newest rows; reviewed by D1 2026-10-05.
CREATE INDEX idx_videos_owner_created ON public.videos (owner_id, created_at DESC);
-- P28: partial — only rows the housekeeping job acts on (uploading, deleted, failed); reviewed by D1 2026-10-05.
CREATE INDEX idx_videos_housekeeping ON public.videos (state, updated_at) WHERE state IN ('uploading', 'deleted', 'failed');

CREATE TABLE public.video_versions (
  video_id             uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  version_no           integer NOT NULL CHECK (version_no >= 1),
  manifest_sha256      text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  total_bytes          bigint NOT NULL CHECK (total_bytes BETWEEN 1 AND 524288000),
  declared_duration_s  numeric(7,2) NOT NULL CHECK (declared_duration_s > 0 AND declared_duration_s <= 300),
  has_audio            boolean NOT NULL,
  rendition_bytes      jsonb NOT NULL,
  renditions           text[] NOT NULL,
  audio_sha256         text CHECK (audio_sha256 IS NULL OR audio_sha256 ~ '^[0-9a-f]{64}$'),
  measured_audio_s     numeric(7,2),
  remedy               text NOT NULL DEFAULT 'original' CHECK (remedy IN ('original', 'mute', 'library_track', 'trim')),
  library_track_id     uuid REFERENCES public.music_library_tracks(id),
  trims                jsonb,
  width                integer CHECK (width IS NULL OR width BETWEEN 1 AND 7680),
  height               integer CHECK (height IS NULL OR height BETWEEN 1 AND 7680),
  uploaded_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, version_no)
);
-- P28: FK library_track_id → music_library_tracks; partial, only versions that use a library track; reviewed by D1 2026-10-05.
CREATE INDEX idx_video_versions_library_track ON public.video_versions (library_track_id) WHERE library_track_id IS NOT NULL;

CREATE TABLE public.video_music_checks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id          uuid NOT NULL,
  version_no        integer NOT NULL,
  provider          text NOT NULL,
  attempt           integer NOT NULL CHECK (attempt >= 1),
  verdict           text NOT NULL CHECK (verdict IN ('pending', 'clean', 'clean_no_audio', 'clean_library', 'match', 'error', 'not_required')),
  audio_sha256      text CHECK (audio_sha256 IS NULL OR audio_sha256 ~ '^[0-9a-f]{64}$'),
  matches           jsonb,
  measured_audio_s  numeric(7,2),
  mode_at_check     text,
  checked_at        timestamptz NOT NULL DEFAULT now(),
  next_retry_at     timestamptz,
  FOREIGN KEY (video_id, version_no) REFERENCES public.video_versions (video_id, version_no) ON DELETE CASCADE
);
-- P28: FK (video_id, version_no) → video_versions; also the newest-attempt lookup; reviewed by D1 2026-10-05.
CREATE INDEX idx_video_music_checks_video ON public.video_music_checks (video_id, version_no, checked_at DESC);
ALTER TABLE public.videos ADD CONSTRAINT videos_music_check_fk FOREIGN KEY (music_check_id) REFERENCES public.video_music_checks(id);
-- P28: FK music_check_id → video_music_checks; partial, set only on ready videos; reviewed by D1 2026-10-05.
CREATE INDEX idx_videos_music_check ON public.videos (music_check_id) WHERE music_check_id IS NOT NULL;

CREATE TABLE public.post_videos (
  post_id   uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  video_id  uuid NOT NULL UNIQUE REFERENCES public.videos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ad_videos (
  ad_creative_id  uuid PRIMARY KEY REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  video_id        uuid NOT NULL UNIQUE REFERENCES public.videos(id) ON DELETE CASCADE,
  categories      text[] NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_videos_categories_1_5 CHECK (cardinality(categories) BETWEEN 1 AND 5)
);
CREATE TABLE public.video_r2_purge_queue (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  video_id     uuid NOT NULL,
  owner_id     uuid NOT NULL,
  prefix       text NOT NULL,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  done_at      timestamptz
);
-- P28: partial — the file-deletion worker reads only the undone rows; reviewed by D1 2026-10-05.
CREATE INDEX idx_video_r2_purge_queue_todo ON public.video_r2_purge_queue (enqueued_at) WHERE done_at IS NULL;

-- ── 2. the state machine + publish gate (every role, service role included) ─
CREATE FUNCTION public.tg_videos_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
DECLARE
  _c   record;
  _v   record;
  _ok  boolean;
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'VID-STATE-001: owner, purpose, idempotency key and created_at never change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.current_version IS DISTINCT FROM OLD.current_version
     AND NOT (OLD.state IN ('music_blocked', 'taken_down') AND NEW.state = 'uploading' AND NEW.current_version = OLD.current_version + 1) THEN
    RAISE EXCEPTION 'VID-STATE-002: a new version starts only from music_blocked or taken_down, as current_version + 1'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    _ok := (OLD.state, NEW.state) IN (
      ('uploading', 'checking'), ('uploading', 'failed'), ('uploading', 'deleted'),
      ('checking', 'ready'), ('checking', 'music_blocked'), ('checking', 'deleted'),
      ('music_blocked', 'uploading'), ('music_blocked', 'deleted'),
      ('ready', 'taken_down'), ('ready', 'deleted'),
      ('taken_down', 'uploading'), ('taken_down', 'deleted'),
      ('failed', 'deleted'));
    IF NOT _ok THEN
      RAISE EXCEPTION 'VID-STATE-003: % → % is not a legal move', OLD.state, NEW.state USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.state = 'ready' AND (OLD.state <> 'ready' OR NEW.music_check_id IS DISTINCT FROM OLD.music_check_id) THEN
    SELECT * INTO _c FROM public.video_music_checks WHERE id = NEW.music_check_id;
    SELECT * INTO _v FROM public.video_versions WHERE video_id = NEW.id AND version_no = NEW.current_version;
    IF _c.id IS NULL OR _c.video_id <> NEW.id OR _c.version_no <> NEW.current_version THEN
      RAISE EXCEPTION 'VID-GATE-001: ready needs a check of this video''s current version' USING ERRCODE = 'check_violation';
    END IF;
    IF _c.verdict NOT IN ('clean', 'clean_no_audio', 'clean_library', 'not_required') THEN
      RAISE EXCEPTION 'VID-GATE-002: ready needs a clean (or not-required) check, not %', _c.verdict USING ERRCODE = 'check_violation';
    END IF;
    IF _v.has_audio THEN
      IF _v.audio_sha256 IS NULL OR _c.audio_sha256 IS DISTINCT FROM _v.audio_sha256 OR _c.verdict = 'clean_no_audio' THEN
        RAISE EXCEPTION 'VID-GATE-003: the check is not of this version''s audio bytes' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF _c.verdict NOT IN ('clean_no_audio', 'not_required') OR _c.audio_sha256 IS NOT NULL OR _v.audio_sha256 IS NOT NULL THEN
        RAISE EXCEPTION 'VID-GATE-003: a version without audio needs a no-audio verdict' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF _c.verdict IN ('clean', 'clean_library')
       AND (_c.measured_audio_s IS NULL OR abs(_c.measured_audio_s - _v.declared_duration_s) > 2) THEN
      RAISE EXCEPTION 'VID-GATE-004: the measured audio length is not within 2 s of the declared duration' USING ERRCODE = 'check_violation';
    END IF;
    NEW.ready_at := now();
  END IF;
  IF NEW.state = 'deleted' AND OLD.state <> 'deleted' THEN
    NEW.deleted_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tg_videos_state_guard BEFORE UPDATE ON public.videos FOR EACH ROW EXECUTE FUNCTION public.tg_videos_state_guard();

-- A new video row always starts at the beginning, whoever inserts it.
CREATE FUNCTION public.tg_videos_insert_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  IF NEW.state <> 'uploading' OR NEW.current_version <> 1 OR NEW.music_check_id IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'VID-STATE-004: a video is created as uploading v1 with no check' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tg_videos_insert_guard BEFORE INSERT ON public.videos FOR EACH ROW EXECUTE FUNCTION public.tg_videos_insert_guard();

-- A version's bytes never change once declared; the measured facts (audio
-- hash, measured audio length, size, upload time) are written once, while the
-- video is uploading or checking. So a check, once bound, stays bound.
CREATE FUNCTION public.tg_video_versions_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
DECLARE
  _state text;
BEGIN
  IF (NEW.video_id, NEW.version_no, NEW.manifest_sha256, NEW.total_bytes, NEW.declared_duration_s, NEW.has_audio,
      NEW.rendition_bytes, NEW.renditions, NEW.remedy, NEW.library_track_id, NEW.trims, NEW.created_at)
     IS DISTINCT FROM
     (OLD.video_id, OLD.version_no, OLD.manifest_sha256, OLD.total_bytes, OLD.declared_duration_s, OLD.has_audio,
      OLD.rendition_bytes, OLD.renditions, OLD.remedy, OLD.library_track_id, OLD.trims, OLD.created_at) THEN
    RAISE EXCEPTION 'VID-VER-001: a version''s declared bytes never change — upload a new version' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.audio_sha256 IS NOT NULL AND NEW.audio_sha256 IS DISTINCT FROM OLD.audio_sha256)
     OR (OLD.measured_audio_s IS NOT NULL AND NEW.measured_audio_s IS DISTINCT FROM OLD.measured_audio_s)
     OR (OLD.width IS NOT NULL AND NEW.width IS DISTINCT FROM OLD.width)
     OR (OLD.height IS NOT NULL AND NEW.height IS DISTINCT FROM OLD.height)
     OR (OLD.uploaded_at IS NOT NULL AND NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at) THEN
    RAISE EXCEPTION 'VID-VER-002: a measured fact is written once' USING ERRCODE = 'check_violation';
  END IF;
  SELECT state INTO _state FROM public.videos WHERE id = NEW.video_id;
  IF _state NOT IN ('uploading', 'checking') THEN
    RAISE EXCEPTION 'VID-VER-003: a version is filled in only while its video is uploading or checking (video is %)', _state
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.has_audio IS FALSE AND NEW.audio_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'VID-VER-004: a version without audio has no audio hash' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tg_video_versions_guard BEFORE UPDATE ON public.video_versions FOR EACH ROW EXECUTE FUNCTION public.tg_video_versions_guard();

-- video_music_checks: append-only. A DELETE goes through only as part of a
-- cascade (the purge, or an account's hard delete: pg_trigger_depth() > 1) or
-- inside the purge (vid.purge = on); a direct DELETE, UPDATE or TRUNCATE never.
CREATE FUNCTION public.tg_video_music_checks_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND (current_setting('vid.purge', true) = 'on' OR pg_trigger_depth() > 1) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'video_music_checks is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$fn$;
CREATE TRIGGER tg_video_music_checks_append_only BEFORE UPDATE OR DELETE ON public.video_music_checks
  FOR EACH ROW EXECUTE FUNCTION public.tg_video_music_checks_append_only();
CREATE TRIGGER tg_video_music_checks_no_truncate BEFORE TRUNCATE ON public.video_music_checks
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_video_music_checks_append_only();

-- ── 3. links: ready video, right purpose, right owner, 1–5 categories ──────
CREATE FUNCTION public.tg_post_videos_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _v record;
  _p record;
BEGIN
  SELECT owner_id, purpose, state INTO _v FROM public.videos WHERE id = NEW.video_id FOR UPDATE;
  SELECT user_id, categories INTO _p FROM public.posts WHERE id = NEW.post_id;
  IF _v.state IS DISTINCT FROM 'ready' OR _v.purpose IS DISTINCT FROM 'post' THEN
    RAISE EXCEPTION 'VID-LINK-001: post_videos needs a ready post video (video is %)', coalesce(_v.state, '<missing>')
      USING ERRCODE = 'check_violation';
  END IF;
  IF _p.user_id IS NULL OR _p.user_id <> _v.owner_id THEN
    RAISE EXCEPTION 'VID-LINK-002: the video must belong to the post''s author' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(coalesce(_p.categories, '{}')) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'VID-CAT-001: a video post needs between 1 and 5 categories' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tg_post_videos_link_guard BEFORE INSERT OR UPDATE ON public.post_videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_post_videos_link_guard();

CREATE FUNCTION public.tg_ad_videos_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _v   record;
  _bad text;
BEGIN
  SELECT owner_id, purpose, state INTO _v FROM public.videos WHERE id = NEW.video_id FOR UPDATE;
  IF _v.state IS DISTINCT FROM 'ready' OR _v.purpose IS DISTINCT FROM 'ad' THEN
    RAISE EXCEPTION 'VID-LINK-001: ad_videos needs a ready ad video (video is %)', coalesce(_v.state, '<missing>')
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.has_role(_v.owner_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'VID-LINK-003: an ad video must have been uploaded by an admin' USING ERRCODE = 'check_violation';
  END IF;
  NEW.categories := ARRAY(                       -- lower-cased, trimmed, de-duplicated, first-seen order (as posts)
    SELECT t.slug FROM (SELECT DISTINCT ON (lower(btrim(u.c))) lower(btrim(u.c)) AS slug, u.ord
                          FROM unnest(coalesce(NEW.categories, '{}')) WITH ORDINALITY AS u(c, ord)
                         WHERE btrim(u.c) <> '' ORDER BY lower(btrim(u.c)), u.ord) t
    ORDER BY t.ord);
  SELECT string_agg(c, ', ') INTO _bad FROM unnest(NEW.categories) c
   WHERE NOT EXISTS (SELECT 1 FROM public.categories cat WHERE cat.slug = c AND cat.is_active);
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'VID-CAT-003: unknown or inactive category slug(s): %', _bad USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(NEW.categories) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'VID-CAT-001: a video ad needs between 1 and 5 categories' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tg_ad_videos_link_guard BEFORE INSERT OR UPDATE ON public.ad_videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_videos_link_guard();

-- A post carrying a video keeps 1–5 categories. Named to fire AFTER
-- trg_validate_post_categories (alphabetical), i.e. on the normalised list.
CREATE FUNCTION public.tg_posts_video_keeps_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF cardinality(coalesce(NEW.categories, '{}')) < 1 AND EXISTS (SELECT 1 FROM public.post_videos WHERE post_id = NEW.id) THEN
    RAISE EXCEPTION 'VID-CAT-002: a video post must keep at least one category' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER trg_videos_keep_post_categories BEFORE UPDATE OF categories ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_posts_video_keeps_categories();

-- ── 4. RLS and column grants ───────────────────────────────────────────────
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_music_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_library_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_r2_purge_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.videos, public.video_versions, public.video_music_checks, public.music_library_tracks,
  public.post_videos, public.ad_videos, public.video_r2_purge_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.video_r2_purge_queue_id_seq FROM PUBLIC, anon, authenticated;

-- Visible = own, admin, or READY and linked to a post / ad the viewer may already see.
CREATE FUNCTION public.video_visible(_video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.post_videos pv JOIN public.posts p ON p.id = pv.post_id WHERE pv.video_id = _video_id)
      OR EXISTS (SELECT 1 FROM public.ad_videos av JOIN public.ad_creatives ac ON ac.id = av.ad_creative_id WHERE av.video_id = _video_id);
$fn$;
GRANT EXECUTE ON FUNCTION public.video_visible(uuid) TO anon, authenticated;

CREATE POLICY videos_read ON public.videos FOR SELECT TO anon, authenticated
  USING (owner_id = (SELECT auth.uid())
         OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
         OR (state = 'ready' AND public.video_visible(id)));
-- Viewers: id · state · size/duration (versions) — never the idempotency key.
GRANT SELECT (id, owner_id, purpose, current_version, state, failed_reason, created_at, ready_at) ON public.videos TO anon, authenticated;

CREATE POLICY video_versions_read ON public.video_versions FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.videos v WHERE v.id = video_id
                   AND (v.owner_id = (SELECT auth.uid())
                        OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
                        OR (v.state = 'ready' AND v.current_version = version_no AND public.video_visible(v.id)))));
-- Never the manifest hash or the audio hash.
GRANT SELECT (video_id, version_no, declared_duration_s, has_audio, renditions, remedy, library_track_id, width, height, created_at)
  ON public.video_versions TO anon, authenticated;

-- The owner reads the verdict and matches of their own videos; admins all.
CREATE POLICY video_music_checks_read ON public.video_music_checks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.videos v WHERE v.id = video_id AND v.owner_id = (SELECT auth.uid()))
         OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
GRANT SELECT (id, video_id, version_no, attempt, verdict, matches, checked_at, next_retry_at) ON public.video_music_checks TO authenticated;

CREATE POLICY music_library_tracks_read ON public.music_library_tracks FOR SELECT TO authenticated USING (active);
GRANT SELECT (id, title, artist, duration_s, license, license_url, attribution, source, active) ON public.music_library_tracks TO authenticated;

-- A member links their own ready video to their own post while video_posts is on for them
-- (the link trigger checks the rest).
CREATE POLICY post_videos_read ON public.post_videos FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id));
CREATE POLICY post_videos_insert_own ON public.post_videos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.user_id = (SELECT auth.uid()))
              AND (SELECT public.feature_allowed_me('video_posts')));
CREATE POLICY post_videos_delete_own ON public.post_videos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.user_id = (SELECT auth.uid())));
CREATE POLICY "Deleted accounts cannot insert" ON public.post_videos AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.account_is_live()));
GRANT SELECT, INSERT, DELETE ON public.post_videos TO authenticated;
GRANT SELECT ON public.post_videos TO anon;

CREATE POLICY ad_videos_read ON public.ad_videos FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.ad_creatives ac WHERE ac.id = ad_creative_id));
CREATE POLICY ad_videos_admin_write ON public.ad_videos FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
              AND (SELECT public.feature_allowed_me('video_ads')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_videos TO authenticated;
GRANT SELECT ON public.ad_videos TO anon;

-- ── 5. RPCs ────────────────────────────────────────────────────────────────
-- The size rules of one version (R-97 + SEC F-D3-15 condition 4). Internal:
-- video_begin_upload calls it, and so does 0006's new-version (remedy) RPC.
CREATE FUNCTION public.video_validate_version(_purpose text, _manifest_sha256 text, _total_bytes bigint,
                                              _declared_duration_s numeric, _has_audio boolean, _rendition_bytes jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $fn$
DECLARE
  _key      text;
  _sum      bigint := 0;
  _ceiling  constant jsonb := '{"240p": 61440, "480p": 163840, "720p": 358400, "audio": 16384}';
  _max_s    numeric := CASE _purpose WHEN 'post' THEN 180 WHEN 'ad' THEN 300 END;
BEGIN
  IF _max_s IS NULL THEN
    RAISE EXCEPTION 'VID-UP-002: purpose must be post or ad' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _declared_duration_s IS NULL OR _declared_duration_s <= 0 OR _declared_duration_s > _max_s THEN
    RAISE EXCEPTION 'VID-LIM-001: a % video is at most % s (declared %)', _purpose, _max_s, _declared_duration_s USING ERRCODE = 'check_violation';
  END IF;
  IF _total_bytes IS NULL OR _total_bytes < 1 OR _total_bytes > 524288000 THEN
    RAISE EXCEPTION 'VID-LIM-002: a video is at most 500 MB (declared % bytes)', _total_bytes USING ERRCODE = 'check_violation';
  END IF;
  IF _manifest_sha256 IS NULL OR _manifest_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'VID-UP-005: manifest_sha256 must be 64 lowercase hex' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _rendition_bytes IS NULL OR jsonb_typeof(_rendition_bytes) <> 'object' OR NOT (_rendition_bytes ? '240p') THEN
    RAISE EXCEPTION 'VID-UP-006: rendition_bytes must be an object with at least 240p' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _has_audio IS NULL OR _has_audio IS DISTINCT FROM (_rendition_bytes ? 'audio') THEN
    RAISE EXCEPTION 'VID-UP-006: an audio rendition is present exactly when has_audio is true' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR _key IN SELECT jsonb_object_keys(_rendition_bytes) LOOP
    IF _key NOT IN ('240p', '480p', '720p', 'audio', 'other') OR jsonb_typeof(_rendition_bytes->_key) <> 'number'
       OR (_rendition_bytes->>_key)::numeric < 1 OR (_rendition_bytes->>_key)::numeric <> trunc((_rendition_bytes->>_key)::numeric) THEN
      RAISE EXCEPTION 'VID-UP-006: rendition_bytes key % is not allowed or not a positive whole number', _key USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF _key = 'other' AND (_rendition_bytes->>_key)::bigint > 2097152 THEN
      RAISE EXCEPTION 'VID-LIM-005: poster + playlists are at most 2 MB' USING ERRCODE = 'check_violation';
    END IF;
    IF _key <> 'other' AND (_rendition_bytes->>_key)::numeric / _declared_duration_s > (_ceiling->>_key)::numeric THEN
      RAISE EXCEPTION 'VID-LIM-006: % is % bytes/s, above its ceiling of %', _key,
        round((_rendition_bytes->>_key)::numeric / _declared_duration_s), _ceiling->>_key USING ERRCODE = 'check_violation';
    END IF;
    _sum := _sum + (_rendition_bytes->>_key)::bigint;
  END LOOP;
  IF _sum <> _total_bytes THEN
    RAISE EXCEPTION 'VID-UP-006: rendition_bytes add up to %, not total_bytes %', _sum, _total_bytes USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN ARRAY(SELECT k FROM jsonb_object_keys(_rendition_bytes) k WHERE k <> 'other' ORDER BY k);
END;
$fn$;

CREATE FUNCTION public.video_begin_upload(_purpose text, _manifest_sha256 text, _total_bytes bigint,
                                          _declared_duration_s numeric, _has_audio boolean,
                                          _idempotency_key uuid, _rendition_bytes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid      uuid := (SELECT auth.uid());
  _v        record;
  _id       uuid;
  _n        bigint;
  _rends    text[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'VID-UP-001: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _purpose IS NULL OR _purpose NOT IN ('post', 'ad') THEN
    RAISE EXCEPTION 'VID-UP-002: purpose must be post or ad' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The switch is the enforcement point (VID-7): a crafted request changes nothing.
  IF _purpose = 'post' AND NOT public.feature_allowed('video_posts', _uid) THEN
    RAISE EXCEPTION 'VID-UP-003: video posts are not enabled for this member' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _purpose = 'ad' AND NOT (public.has_role(_uid, 'admin'::public.app_role) AND public.feature_allowed('video_ads', _uid)) THEN
    RAISE EXCEPTION 'VID-UP-003: video ads are admin-only and must be enabled' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'VID-UP-004: an idempotency key is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Same key → the same row (OFF-2), checked before the limits so a retry never counts twice.
  SELECT id, purpose, state, current_version INTO _v FROM public.videos WHERE owner_id = _uid AND idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF _v.purpose <> _purpose THEN
      RAISE EXCEPTION 'VID-UP-004: this idempotency key was used for a %', _v.purpose USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN jsonb_build_object('video_id', _v.id, 'version_no', _v.current_version, 'state', _v.state, 'replayed', true);
  END IF;
  -- Size rules (R-97, SEC F-D3-15 condition 4).
  _rends := public.video_validate_version(_purpose, _manifest_sha256, _total_bytes, _declared_duration_s, _has_audio, _rendition_bytes);
  -- Count rules (R-97). Serialised per member so two parallel calls cannot both slip under a cap.
  PERFORM pg_advisory_xact_lock(hashtextextended('video_begin_upload:' || _uid::text, 0));
  IF _purpose = 'post' THEN
    SELECT count(*) INTO _n FROM public.videos WHERE owner_id = _uid AND purpose = 'post' AND created_at > now() - interval '24 hours';
    IF _n >= 10 THEN
      RAISE EXCEPTION 'VID-LIM-003: 10 video uploads in 24 hours is the limit' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT count(*) INTO _n FROM public.videos WHERE owner_id = _uid AND purpose = _purpose AND state IN ('uploading', 'checking');
  IF _n >= (CASE _purpose WHEN 'post' THEN 3 ELSE 10 END) THEN
    RAISE EXCEPTION 'VID-LIM-004: too many videos in progress at once (%)', _n USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES (_uid, _purpose, _idempotency_key)
  ON CONFLICT ON CONSTRAINT videos_owner_idempotency_key DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NULL THEN                               -- lost a race with the same key: return the winner
    SELECT id, current_version, state INTO _v FROM public.videos WHERE owner_id = _uid AND idempotency_key = _idempotency_key;
    RETURN jsonb_build_object('video_id', _v.id, 'version_no', _v.current_version, 'state', _v.state, 'replayed', true);
  END IF;
  INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio,
                                     rendition_bytes, renditions)
  VALUES (_id, 1, _manifest_sha256, _total_bytes, _declared_duration_s, _has_audio, _rendition_bytes, _rends);
  RETURN jsonb_build_object('video_id', _id, 'version_no', 1, 'state', 'uploading', 'replayed', false);
END;
$fn$;

-- The owner (or an admin) deletes a video; it is kept 30 days, then purged.
CREATE FUNCTION public.video_delete(_video_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _v   record;
BEGIN
  SELECT owner_id, state INTO _v FROM public.videos WHERE id = _video_id FOR UPDATE;
  IF NOT FOUND OR _uid IS NULL OR (_v.owner_id <> _uid AND NOT public.has_role(_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'VID-DEL-001: no such video of yours' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _v.state = 'deleted' THEN
    RETURN 'deleted';
  END IF;
  UPDATE public.videos SET state = 'deleted' WHERE id = _video_id;
  RETURN 'deleted';
END;
$fn$;

-- Hourly: uploads stuck 48 h → failed; deleted or failed for 30 days → purged.
CREATE FUNCTION public.video_housekeeping(_keep interval DEFAULT interval '30 days', _batch integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _failed bigint;
  _ids    uuid[];
BEGIN
  IF _keep IS NULL OR _keep < interval '30 days' THEN
    RAISE EXCEPTION 'video_housekeeping: _keep % is below the 30 days the Owner set', _keep USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _batch IS NULL OR _batch < 1 THEN
    RAISE EXCEPTION 'video_housekeeping: _batch must be at least 1' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- 1. uploads abandoned for 48 h → failed (DECISION §3.5).
  UPDATE public.videos SET state = 'failed', failed_reason = 'abandoned'
   WHERE id IN (SELECT id FROM public.videos WHERE state = 'uploading' AND updated_at < now() - interval '48 hours'
                 ORDER BY updated_at LIMIT _batch);
  GET DIAGNOSTICS _failed = ROW_COUNT;
  -- 2. deleted (or failed) for _keep (30 days) → purged: R2 prefix queued, links, versions, checks and the row go.
  SELECT coalesce(array_agg(id), '{}') INTO _ids FROM (
    SELECT id FROM public.videos
     WHERE (state = 'deleted' AND deleted_at < now() - _keep)
        OR (state = 'failed' AND updated_at < now() - _keep)
     ORDER BY updated_at
     LIMIT _batch
     FOR UPDATE SKIP LOCKED) g;
  IF cardinality(_ids) > 0 THEN
    INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix)
    SELECT id, owner_id, 'video/' || owner_id || '/' || id || '/' FROM public.videos WHERE id = ANY (_ids);
    DELETE FROM public.post_videos WHERE video_id = ANY (_ids);
    DELETE FROM public.ad_videos WHERE video_id = ANY (_ids);
    UPDATE public.videos SET music_check_id = NULL WHERE id = ANY (_ids) AND music_check_id IS NOT NULL;
    PERFORM set_config('vid.purge', 'on', true);          -- lets the append-only checks cascade away, this txn only
    DELETE FROM public.videos WHERE id = ANY (_ids);
    PERFORM set_config('vid.purge', 'off', true);
  END IF;
  RETURN jsonb_build_object('failed', _failed, 'purged', cardinality(_ids));
END;
$fn$;

REVOKE ALL ON FUNCTION public.video_begin_upload(text, text, bigint, numeric, boolean, uuid, jsonb), public.video_delete(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_begin_upload(text, text, bigint, numeric, boolean, uuid, jsonb), public.video_delete(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.video_validate_version(text, text, bigint, numeric, boolean, jsonb),
  public.video_housekeeping(interval, integer), public.tg_videos_state_guard(), public.tg_videos_insert_guard(),
  public.tg_video_versions_guard(),
  public.tg_video_music_checks_append_only(), public.tg_post_videos_link_guard(), public.tg_ad_videos_link_guard(),
  public.tg_posts_video_keeps_categories() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('video-housekeeping', '41 * * * *', $cmd$SELECT public.video_housekeeping();$cmd$);

DO $postconditions$
BEGIN
  IF has_table_privilege('authenticated', 'public.videos', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.video_versions', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.video_music_checks', 'INSERT,UPDATE,DELETE')
     OR has_column_privilege('authenticated', 'public.videos', 'idempotency_key', 'SELECT')
     OR has_column_privilege('anon', 'public.video_versions', 'audio_sha256', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_versions', 'manifest_sha256', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_music_checks', 'audio_sha256', 'SELECT')
     OR has_table_privilege('authenticated', 'public.video_r2_purge_queue', 'SELECT')
     OR has_function_privilege('anon', 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_housekeeping(interval,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VID2-0005-POST-001: a write path, a hidden column or an internal function is reachable by an API role'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'video-housekeeping' AND schedule = '41 * * * *') <> 1 THEN
    RAISE EXCEPTION 'VID2-0005-POST-002: the housekeeping job is not in place' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'VID2-0005: videos, versions, checks, links, library, purge queue + state machine, publish gate, RLS, limits, 30-day purge';
END
$postconditions$;

COMMIT;
