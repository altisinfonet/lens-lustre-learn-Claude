-- ═══════════════════════════════════════════════════════════════════════════
-- B4 MULTI-MEDIA POST ATOMICITY MATRIX — HARNESS (2026-08-14)
--
-- Faithful replica of BOTH regimes the matrix must cover:
--   REGIME 1 (LIVE TODAY): posts.image_urls array + the posts BEFORE-INSERT
--     triggers. This is what every member post uses right now.
--   REGIME 2 (BUILT, EMPTY UNTIL B5): media_objects + post_media, their
--     state-machine triggers, unique indexes and RPCs.
--
-- Every function/trigger/constraint below is VERBATIM from production
-- catalogs pulled this session (pg_get_functiondef / pg_get_constraintdef /
-- pg_get_triggerdef / pg_indexes).
--
-- FIDELITY LEDGER:
--  1. auth.uid() reads the request.jwt.claim.sub GUC (V11 pattern).
--  2. posts here carries only the columns the probed triggers touch, plus the
--     media columns. Untouched production columns (rand_key, viewer_bucket…)
--     are irrelevant to atomicity and omitted.
--  3. rate_limit_posts is NOT attached: it counts recent posts per user and
--     would abort the race probes for the wrong reason. Its absence makes the
--     harness MORE permissive — every DENY verdict below therefore also holds
--     in production. No ALLOW verdict depends on it.
--  4. can_view_post() is stubbed true — the RLS *read* policies are not what
--     this matrix tests (cross-surface visibility is its own invariant, 8/9
--     verified separately). Only write-path atomicity is probed here.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

DROP TABLE IF EXISTS public.post_media, public.media_objects CASCADE;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- ── REGIME 2 tables (verbatim shapes) ──
CREATE TABLE public.media_objects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sha256 bytea NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  bytes bigint NOT NULL,
  mime text NOT NULL,
  visibility text NOT NULL DEFAULT 'private',
  derivatives jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  quarantine_reason text,
  CONSTRAINT media_objects_bytes_check CHECK (bytes > 0),
  CONSTRAINT media_objects_height_check CHECK (height > 0 AND height <= 100000),
  CONSTRAINT media_objects_width_check CHECK (width > 0 AND width <= 100000),
  CONSTRAINT media_objects_mime_check CHECK (mime = ANY (ARRAY['image/webp','image/jpeg','image/png','image/avif'])),
  CONSTRAINT media_objects_quarantine_has_reason CHECK (state <> 'quarantined' OR quarantine_reason IS NOT NULL),
  CONSTRAINT media_objects_ready_has_derivatives CHECK (state <> 'ready' OR derivatives ? 'original'),
  CONSTRAINT media_objects_sha256_len CHECK (octet_length(sha256) = 32),
  CONSTRAINT media_objects_state_check CHECK (state = ANY (ARRAY['pending','verified','ready','quarantined'])),
  CONSTRAINT media_objects_verified_has_ts CHECK (state = ANY (ARRAY['pending','quarantined']) OR verified_at IS NOT NULL),
  CONSTRAINT media_objects_visibility_check CHECK (visibility = ANY (ARRAY['public','restricted','private']))
);
CREATE UNIQUE INDEX media_objects_owner_content ON public.media_objects USING btree (owner_id, sha256);
CREATE INDEX media_objects_state_created ON public.media_objects USING btree (state, created_at) WHERE state <> 'ready';

CREATE TABLE public.post_media (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  ord integer NOT NULL CHECK (ord >= 0),
  media_id uuid NOT NULL REFERENCES public.media_objects(id) ON DELETE RESTRICT,
  PRIMARY KEY (post_id, ord)
);
CREATE INDEX post_media_media_id ON public.post_media USING btree (media_id);

-- ── Functions (verbatim) ──
CREATE OR REPLACE FUNCTION public.tg_media_state_transition() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'media_objects.owner_id is immutable (% -> %)', OLD.owner_id, NEW.owner_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'media_objects.sha256 is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT (
         (OLD.state = 'pending'  AND NEW.state IN ('verified', 'quarantined'))
      OR (OLD.state = 'verified' AND NEW.state IN ('ready', 'quarantined'))
      OR (OLD.state = 'ready'    AND NEW.state = 'quarantined')
    ) THEN
      RAISE EXCEPTION 'illegal media state transition % -> % (legal: pending->verified->ready, any->quarantined)',
        OLD.state, NEW.state USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_post_media_requires_ready() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _state text;
BEGIN
  SELECT state INTO _state FROM public.media_objects WHERE id = NEW.media_id;
  IF _state IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'post_media: media % is in state %, only ready may be referenced',
      NEW.media_id, coalesce(_state, '<missing>') USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_media_state_transition BEFORE UPDATE ON public.media_objects FOR EACH ROW EXECUTE FUNCTION tg_media_state_transition();
CREATE TRIGGER trg_post_media_requires_ready BEFORE INSERT OR UPDATE ON public.post_media FOR EACH ROW EXECUTE FUNCTION tg_post_media_requires_ready();

CREATE OR REPLACE FUNCTION public.media_begin_upload(_sha256 bytea, _width integer, _height integer, _bytes bigint, _mime text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid     uuid := auth.uid();
  _id      uuid;
  _state   text;
  _pending int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'media_begin_upload requires an authenticated caller' USING ERRCODE = '42501';
  END IF;
  IF octet_length(_sha256) <> 32 THEN
    RAISE EXCEPTION 'sha256 must be exactly 32 bytes' USING ERRCODE = '22023';
  END IF;
  IF _width IS NULL OR _height IS NULL OR _width <= 0 OR _height <= 0
     OR _width > 100000 OR _height > 100000 THEN
    RAISE EXCEPTION 'width and height must be between 1 and 100000' USING ERRCODE = '22023';
  END IF;
  IF _bytes IS NULL OR _bytes <= 0 THEN
    RAISE EXCEPTION 'bytes must be positive' USING ERRCODE = '22023';
  END IF;
  IF _mime NOT IN ('image/webp','image/jpeg','image/png','image/avif') THEN
    RAISE EXCEPTION 'unsupported mime %', _mime USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO _pending
  FROM public.media_objects
  WHERE owner_id = _uid AND state IN ('pending', 'verified');

  IF _pending >= 50 THEN
    RAISE EXCEPTION 'too many uploads in flight (%); finish or abandon them before starting more', _pending
      USING ERRCODE = '54000';
  END IF;

  SELECT id, state INTO _id, _state
  FROM public.media_objects
  WHERE owner_id = _uid AND sha256 = _sha256;

  IF FOUND THEN
    IF _state = 'quarantined' THEN
      RAISE EXCEPTION 'this image was rejected by content verification and cannot be re-uploaded'
        USING ERRCODE = '42501';
    END IF;
    RETURN _id;
  END IF;

  BEGIN
    INSERT INTO public.media_objects (owner_id, sha256, width, height, bytes, mime)
    VALUES (_uid, _sha256, _width, _height, _bytes, _mime)
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO _id FROM public.media_objects
    WHERE owner_id = _uid AND sha256 = _sha256;
  END;

  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.media_mark_verified(_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.media_objects SET state = 'verified', verified_at = now()
   WHERE id = _id AND state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % is not in state pending', _id USING ERRCODE = '23514';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.media_mark_ready(_id uuid, _derivatives jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _bad text;
BEGIN
  IF _derivatives IS NULL OR jsonb_typeof(_derivatives) <> 'object'
     OR NOT (_derivatives ? 'original') THEN
    RAISE EXCEPTION 'derivatives must be an object containing at least "original"' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(k, ',') INTO _bad
  FROM jsonb_object_keys(_derivatives) k
  WHERE k NOT IN ('original', '1440', '1080', '600');
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'unknown derivative rung(s): % (allowed: original,1440,1080,600)', _bad USING ERRCODE = '22023';
  END IF;
  UPDATE public.media_objects SET state = 'ready', derivatives = _derivatives
   WHERE id = _id AND state = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % is not in state verified', _id USING ERRCODE = '23514';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.media_quarantine(_id uuid, _reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'a quarantine must record a reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.media_objects SET state = 'quarantined', quarantine_reason = _reason
   WHERE id = _id AND state <> 'quarantined';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % does not exist or is already quarantined', _id USING ERRCODE = '23514';
  END IF;
END $function$;

-- ── REGIME 1 posts triggers (verbatim) ──
CREATE OR REPLACE FUNCTION public.detect_duplicate_post() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  hash_val text;
  dupe_exists boolean;
BEGIN
  hash_val := md5(
    COALESCE(NEW.content, '') || '|' ||
    COALESCE(array_to_string(NEW.image_urls, ','), '') || '|' ||
    COALESCE(NEW.image_url, '')
  );
  NEW.content_hash := hash_val;
  SELECT EXISTS (
    SELECT 1 FROM public.posts
    WHERE user_id = NEW.user_id
      AND content_hash = hash_val
      AND created_at > now() - interval '10 minutes'
  ) INTO dupe_exists;
  IF dupe_exists THEN
    RAISE EXCEPTION 'Duplicate post detected. Please wait before posting similar content.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_post_caption_only_update() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() = OLD.user_id THEN
    IF NEW.user_id        IS DISTINCT FROM OLD.user_id        OR
       NEW.image_url      IS DISTINCT FROM OLD.image_url      OR
       NEW.image_urls     IS DISTINCT FROM OLD.image_urls     OR
       NEW.thumbnail_url  IS DISTINCT FROM OLD.thumbnail_url  OR
       NEW.thumbnail_urls IS DISTINCT FROM OLD.thumbnail_urls OR
       NEW.privacy        IS DISTINCT FROM OLD.privacy        OR
       NEW.created_at     IS DISTINCT FROM OLD.created_at     OR
       NEW.content_hash   IS DISTINCT FROM OLD.content_hash   THEN
      RAISE EXCEPTION 'Only the caption can be edited' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_detect_duplicate_post ON public.posts;
DROP TRIGGER IF EXISTS trg_enforce_post_caption_only_update ON public.posts;
CREATE TRIGGER trg_detect_duplicate_post BEFORE INSERT ON public.posts FOR EACH ROW EXECUTE FUNCTION detect_duplicate_post();
CREATE TRIGGER trg_enforce_post_caption_only_update BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION enforce_post_caption_only_update();
-- fidelity ledger #3: rate_limit_posts deliberately NOT attached.

-- can_view_post stub (fidelity ledger #4) — reads are not what this matrix tests.
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='can_view_post') THEN
    EXECUTE $f$CREATE FUNCTION public.can_view_post(_viewer uuid, _author uuid, _privacy text)
      RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true'$f$;
  END IF;  -- an existing faithful can_view_post from the feed cycle is kept
END $do$;

-- ── Seeds ──
DELETE FROM public.post_media; DELETE FROM public.media_objects;
DELETE FROM public.posts WHERE user_id = '00000000-0000-0000-0000-0000000000a4';

INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000a4') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id) VALUES ('00000000-0000-0000-0000-0000000000a4') ON CONFLICT DO NOTHING;

SELECT 'B4 MEDIA SEED OK' AS ok,
  (SELECT count(*) FROM media_objects) AS media,
  (SELECT count(*) FROM post_media) AS refs;
