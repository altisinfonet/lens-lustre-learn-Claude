-- ═══════════════════════════════════════════════════════════════════════════
-- MEDIA IDENTITY, SEPARATED FROM AUTHORIZATION.
--
-- Phase B, first migration. **Purely additive**: two new tables and their RLS.
-- Nothing reads them yet, `posts.image_urls` and `posts.thumbnail_urls` stay
-- authoritative, and no existing query changes. Deliberately so — the backfill,
-- the derivative worker and the feed contract are each their own cycle, exactly
-- as 20260814070357 and 20260814074922 were split.
--
-- The design was reviewed and approved in `claude/PHASE_0_DESIGN_REVIEW.md`
-- with three owner conditions, all of which are honoured below.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THREE IDENTITIES, DELIBERATELY NOT ONE STRING
--
-- The first draft of this design keyed objects by `sha256` globally. That was
-- WRONG, and the reason is worth keeping:
--
--   Post media is served from a PUBLIC CDN. If the key is the content hash,
--   anyone holding candidate bytes can compute the address and issue one GET to
--   learn whether that image exists on the platform. Hiding the dedup response
--   does not close it, because the attacker never has to upload. Putting the
--   owner in the path makes it worse — `user_id` is public, so an attacker who
--   suspects a specific person posted a specific photograph confirms it with a
--   single request.
--
-- So:
--   content identity   sha256          server-side ONLY. Never in a URL, never
--                                      in an RPC return type, never in a client
--                                      payload. Enforced by a test.
--   object identity    media_objects.id  a random uuid — the only public address
--   reference identity post_media rows   the ONLY basis for "may this viewer see it"
--
-- Storage layout: media/<object_id>/original.webp, /1440.webp, /1080.webp, /600.webp
--
-- ───────────────────────────────────────────────────────────────────────────
-- DEDUP IS PER OWNER, NOT GLOBAL, AND THAT IS THE POINT
--
-- `UNIQUE (owner_id, sha256)` gives retry idempotency — a retry is by definition
-- the same owner re-sending the same bytes — while two different members
-- uploading identical bytes get two rows and two unguessable addresses, so
-- there is nothing to observe and nothing to probe.
--
-- It also makes deletion and takedown correct: with a shared physical object,
-- honouring a DMCA notice or an account deletion would silently affect another
-- member's content.
--
-- What is given up is cross-user storage dedup. On a platform where every asset
-- is an original photograph that population is near-empty, and where it is not
-- empty — a stolen re-upload — merging them is the wrong behaviour anyway.
--
-- ───────────────────────────────────────────────────────────────────────────
-- `state` IS THE INTEGRITY GATE
--
--   pending      row created, bytes not confirmed
--   verified     server recomputed sha256 FROM THE STORED BYTES and it matched
--   ready        all required derivatives written — the ONLY state a published
--                post may reference
--   quarantined  recomputed hash disagreed, or the file failed to decode
--
-- The client computes the hash it claims. A malicious client could claim one
-- that is not its bytes, so a row is not usable until the server recomputes.
-- `post_media` enforces this with a trigger rather than a convention.
--
-- `visibility` defaults to `private`. Defaulting the other way is precisely how
-- the current gap arose: post media is publicly readable on the CDN regardless
-- of `posts.privacy`, which is harmless today only because 100% of production
-- posts are public — verified, `nonpublic_posts = 0`.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.media_objects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sha256       bytea  NOT NULL,
  width        int    NOT NULL CHECK (width  > 0 AND width  <= 100000),
  height       int    NOT NULL CHECK (height > 0 AND height <= 100000),
  bytes        bigint NOT NULL CHECK (bytes > 0),
  mime         text   NOT NULL CHECK (mime IN ('image/webp','image/jpeg','image/png','image/avif')),
  visibility   text   NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('public','restricted','private')),
  derivatives  jsonb  NOT NULL DEFAULT '{}'::jsonb,
  state        text   NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending','verified','ready','quarantined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  verified_at  timestamptz,
  CONSTRAINT media_objects_sha256_len CHECK (octet_length(sha256) = 32),
  CONSTRAINT media_objects_verified_has_ts CHECK (state = 'pending' OR verified_at IS NOT NULL)
);

COMMENT ON COLUMN public.media_objects.sha256 IS
  'Content identity. SERVER-SIDE ONLY — must never appear in a URL, an RPC '
  'return type or a client payload. A public CDN plus a content-derived address '
  'lets anyone holding candidate bytes probe whether a given member uploaded a '
  'given photograph. Enforced by src/__tests__/mediaIdentityContainment.test.ts.';

COMMENT ON COLUMN public.media_objects.state IS
  'pending -> verified -> ready, or quarantined. Only `ready` may be referenced '
  'by post_media; enforced by trg_post_media_requires_ready, not by convention.';

-- Retry idempotency, scoped to the owner. See the header for why not global.
CREATE UNIQUE INDEX IF NOT EXISTS media_objects_owner_content
  ON public.media_objects (owner_id, sha256);

-- The derivative worker and the orphan sweep both drive off this.
CREATE INDEX IF NOT EXISTS media_objects_state_created
  ON public.media_objects (state, created_at)
  WHERE state <> 'ready';

CREATE TABLE IF NOT EXISTS public.post_media (
  post_id   uuid NOT NULL REFERENCES public.posts(id)         ON DELETE CASCADE,
  ord       int  NOT NULL CHECK (ord >= 0),
  media_id  uuid NOT NULL REFERENCES public.media_objects(id) ON DELETE RESTRICT,
  PRIMARY KEY (post_id, ord)
);

-- ON DELETE RESTRICT on media_id is deliberate: a media object cannot be deleted
-- while a post still points at it. CASCADE would let a race delete bytes out
-- from under a live post. Deletion goes through the sweep, which checks
-- references first.
--
-- The composite primary key makes slide misalignment UNREPRESENTABLE. Today
-- `image_urls` and `thumbnail_urls` are aligned by array index, and
-- PostMedia.tsx:355-357 records the consequence: a length mismatch was one of
-- three routine paths into loading a 14.7 MB original as a blurred backdrop.
CREATE INDEX IF NOT EXISTS post_media_media_id ON public.post_media (media_id);

-- ── The integrity gate, as a trigger rather than a hope ────────────────────
CREATE OR REPLACE FUNCTION public.tg_post_media_requires_ready()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _state text;
BEGIN
  SELECT state INTO _state FROM public.media_objects WHERE id = NEW.media_id;
  IF _state IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'post_media: media % is in state %, only ready may be referenced',
      NEW.media_id, coalesce(_state, '<missing>')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_post_media_requires_ready ON public.post_media;
CREATE TRIGGER trg_post_media_requires_ready
  BEFORE INSERT OR UPDATE ON public.post_media
  FOR EACH ROW EXECUTE FUNCTION public.tg_post_media_requires_ready();

-- ── RLS. The project standard is 141/141; these two do not become the exception.
ALTER TABLE public.media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_media    ENABLE ROW LEVEL SECURITY;

-- Owners see their own rows. Everyone else reaches media only through a post
-- they may view.
--
-- ⚠ THIS POLICY MUST NEVER BE THE FEED'S READ PATH. The EXISTS below is a
-- per-row function call — the identical shape that made the feed non-sargable
-- and cost 4.8M buffers at 1M posts. The feed reads media through a SECURITY
-- DEFINER RPC that resolves URLs after its own visibility filter. This governs
-- direct table access only. Recorded here so it stays a decision.
CREATE POLICY media_objects_select ON public.media_objects
  FOR SELECT USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.post_media pm
      JOIN public.posts p ON p.id = pm.post_id
      WHERE pm.media_id = media_objects.id
        AND public.can_view_post(auth.uid(), p.user_id, p.privacy)
    )
  );

CREATE POLICY media_objects_insert_own ON public.media_objects
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Deliberately NO update/delete policy for members. State transitions are the
-- server's job (hash verification, derivative completion, quarantine), and
-- deletion goes through the reference-counted sweep.

CREATE POLICY post_media_select ON public.post_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_media.post_id
        AND public.can_view_post(auth.uid(), p.user_id, p.privacy)
    )
  );

CREATE POLICY post_media_write_own ON public.post_media
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_media.post_id AND p.user_id = auth.uid())
  );

CREATE POLICY post_media_delete_own ON public.post_media
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_media.post_id AND p.user_id = auth.uid())
  );

-- ── Grants.
--
-- ⚠ `ALTER DEFAULT PRIVILEGES` grants EXECUTE on every new public function to
-- anon and authenticated. The trigger function is SECURITY DEFINER, so it is
-- revoked by NAME — `FROM PUBLIC` alone does not remove a grant held by a named
-- role, which is why email_infra.sql:195 did not hold for two years.
REVOKE ALL ON FUNCTION public.tg_post_media_requires_ready()
  FROM PUBLIC, anon, authenticated;

-- ⚠ AND IT COVERS TABLES TOO. Read from production at pre-flight, 2026-08-14:
--
--   select array_to_string(defaclacl,' | ') from pg_default_acl d
--     join pg_namespace n on n.oid = d.defaclnamespace
--    where n.nspname='public' and d.defaclobjtype='r';
--   -> anon=arwdDxtm/postgres | authenticated=arwdDxtm/postgres | service_role=…
--
-- So the two tables above are created with SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN already granted to `anon`. RLS
-- covers the first four. It does NOT cover the rest: TRUNCATE, REFERENCES and
-- TRIGGER are checked against the grant only, and no policy can stop them.
--
-- This migration ships with no reader and no writer — `posts.image_urls` stays
-- authoritative — so the correct grant right now is none at all. The cycle that
-- adds the upload path grants exactly the columns and verbs it needs, visibly,
-- in its own diff. `service_role` keeps its default grant; that is the path the
-- derivative worker and the hash verifier use.
--
-- Do not "restore" these grants to make a query work. If a query needs access,
-- the grant belongs in that query's migration, next to the reason.
REVOKE ALL ON TABLE public.media_objects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.post_media    FROM PUBLIC, anon, authenticated;

COMMIT;
