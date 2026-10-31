-- ═══════════════════════════════════════════════════════════════════════════
-- THE MEDIA WRITE PATH, AND THE STATE MACHINE AS A SCHEMA PROPERTY.
--
-- Phase B, cycle 2. `20260814084711` created the tables and granted nothing:
-- anon and authenticated hold zero privileges on `media_objects` and
-- `post_media`, so today nothing can write a row at all. This is the cycle that
-- opens the door — and it opens exactly one, through four functions, rather
-- than by handing back the table grants.
--
-- ONE VARIABLE THIS CYCLE: how a row is created and how its state moves.
-- NOT in this cycle: the derivative worker, R2 storage, the feed read path,
-- EXIF stripping, the backfill. Each is its own.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY RPCs AND NOT TABLE GRANTS
--
-- The obvious move is `GRANT INSERT ON media_objects TO authenticated` and let
-- the RLS `WITH CHECK (owner_id = auth.uid())` policy do the work. That is
-- weaker than it looks, because RLS constrains WHICH ROWS, never WHICH COLUMN
-- VALUES. With a direct INSERT grant a member sets `state` to `'ready'` in the
-- same statement that creates the row, and every integrity property below
-- evaporates — the trigger in 20260814084711 only checks the media referenced
-- by `post_media`, and it would find a row that says `ready`.
--
-- So `media_objects` stays ungranted. The RLS policies remain as defence in
-- depth for any future direct grant; they are not the live path.
--
-- ───────────────────────────────────────────────────────────────────────────
-- TWO DEFECTS IN 20260814084711, FIXED HERE
--
-- 1. `CHECK (state = 'pending' OR verified_at IS NOT NULL)`.
--    Quarantine is what happens when the server recomputes the hash and it
--    DISAGREES. At that moment the row was never verified, so `verified_at`
--    must legitimately be NULL — and this constraint forbids it. The worker
--    would have had to write a timestamp asserting a verification that failed.
--    A constraint that can only be satisfied by lying is worse than no
--    constraint, because the lie ends up in the audit trail.
--
-- 2. Nothing recorded WHY a row was quarantined. `quarantine_reason` is added
--    so a quarantine is reviewable rather than merely terminal.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE STATE MACHINE IS ENFORCED BY A TRIGGER, NOT BY THE WORKER BEING CORRECT
--
--   pending      ──▶ verified ──▶ ready
--        │               │           │
--        └───────────────┴───────────┴──▶ quarantined   (terminal)
--
-- `tg_media_state_transition` refuses everything else, INCLUDING for
-- `service_role` and `postgres`. That is the point: the worker is the component
-- most likely to have a bug, and "skip verification, mark it ready" is the bug
-- that matters. A trigger cannot be forgotten by the next person to write a
-- worker.
--
-- It also freezes `owner_id` and `sha256` after insert. Without that, a row
-- could reach `ready` honestly and then have its content identity rewritten,
-- which would make every verification that came before it meaningless.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Repair the two defects above. ───────────────────────────────────────

ALTER TABLE public.media_objects
  DROP CONSTRAINT IF EXISTS media_objects_verified_has_ts;

ALTER TABLE public.media_objects
  ADD CONSTRAINT media_objects_verified_has_ts
  CHECK (state IN ('pending', 'quarantined') OR verified_at IS NOT NULL);

ALTER TABLE public.media_objects
  ADD COLUMN IF NOT EXISTS quarantine_reason text;

COMMENT ON COLUMN public.media_objects.quarantine_reason IS
  'Why this object was quarantined. NULL unless state = quarantined. Set by '
  'media_quarantine(); a quarantine with no reason is not reviewable.';

-- `ready` with no derivatives is not a state the system has any use for — it
-- means "serve this" with nothing to serve. Making it unrepresentable is
-- cheaper than discovering it from a broken card in the feed.
--
-- Only `original` is required. The ladder is 600/1080/1440, and an image
-- narrower than a rung has no honest derivative at that rung — requiring all
-- four would force the worker to fabricate one, which is defect (1) again in a
-- different costume.
ALTER TABLE public.media_objects
  ADD CONSTRAINT media_objects_ready_has_derivatives
  CHECK (state <> 'ready' OR derivatives ? 'original');

ALTER TABLE public.media_objects
  ADD CONSTRAINT media_objects_quarantine_has_reason
  CHECK (state <> 'quarantined' OR quarantine_reason IS NOT NULL);

-- ── 2. The state machine. ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_media_state_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- Content identity is immutable. A row that reached `ready` was verified
  -- against THESE bytes for THIS owner; allowing either to change afterwards
  -- retroactively invalidates that verification.
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'media_objects.owner_id is immutable (% -> %)', OLD.owner_id, NEW.owner_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'media_objects.sha256 is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    -- Legal edges only. Anything absent from this list is refused, which is
    -- the whole reason the machine lives here and not in the worker.
    IF NOT (
         (OLD.state = 'pending'  AND NEW.state IN ('verified', 'quarantined'))
      OR (OLD.state = 'verified' AND NEW.state IN ('ready', 'quarantined'))
      OR (OLD.state = 'ready'    AND NEW.state = 'quarantined')
    ) THEN
      RAISE EXCEPTION 'illegal media state transition % -> % (legal: pending->verified->ready, any->quarantined)',
        OLD.state, NEW.state
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_media_state_transition ON public.media_objects;
CREATE TRIGGER trg_media_state_transition
  BEFORE UPDATE ON public.media_objects
  FOR EACH ROW EXECUTE FUNCTION public.tg_media_state_transition();

-- ── 3. The member-facing door. Exactly one. ────────────────────────────────
--
-- Returns the OBJECT id and nothing else. Never the sha256, never another
-- member's row — see the header of 20260814084711 for why the hash must not
-- travel outward.
--
-- Idempotent by construction: `UNIQUE (owner_id, sha256)` means a retry is the
-- same owner re-sending the same bytes, so it resolves to the same object. A
-- flaky mobile connection retrying six times produces one object, not six.

CREATE OR REPLACE FUNCTION public.media_begin_upload(
  _sha256 bytea,
  _width  int,
  _height int,
  _bytes  bigint,
  _mime   text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid     uuid := auth.uid();
  _id      uuid;
  _state   text;
  _pending int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'media_begin_upload requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  -- Validated here rather than left to the table CHECKs so the client gets a
  -- stable, readable error instead of a constraint name that describes our
  -- schema to it.
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

  -- An authenticated member can otherwise create unbounded rows without ever
  -- uploading a byte. The cap counts only rows that never completed, so a
  -- prolific photographer with thousands of `ready` objects is unaffected.
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
    -- A quarantined object is not handed back. Returning it would put the
    -- client in a loop it cannot exit: it uploads, we refuse, it retries.
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
    -- Two devices, or two taps, racing on the same bytes. Both get the same
    -- object; neither gets an error.
    SELECT id INTO _id FROM public.media_objects
    WHERE owner_id = _uid AND sha256 = _sha256;
  END;

  RETURN _id;
END $$;

-- ── 4. The server-side transitions. service_role ONLY. ─────────────────────
--
-- These are the three moves the worker makes. They are not reachable by a
-- member under any circumstances: `media_mark_ready` is, by definition, the
-- ability to publish unverified bytes.

CREATE OR REPLACE FUNCTION public.media_mark_verified(_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.media_objects
     SET state = 'verified', verified_at = now()
   WHERE id = _id AND state = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % is not in state pending', _id USING ERRCODE = '23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.media_mark_ready(_id uuid, _derivatives jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _bad text;
BEGIN
  IF _derivatives IS NULL OR jsonb_typeof(_derivatives) <> 'object'
     OR NOT (_derivatives ? 'original') THEN
    RAISE EXCEPTION 'derivatives must be an object containing at least "original"'
      USING ERRCODE = '22023';
  END IF;

  -- An unexpected key means the worker and the delivery layer disagree about
  -- the ladder, and the reader would silently serve nothing for it.
  SELECT string_agg(k, ',') INTO _bad
  FROM jsonb_object_keys(_derivatives) k
  WHERE k NOT IN ('original', '1440', '1080', '600');

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'unknown derivative rung(s): % (allowed: original,1440,1080,600)', _bad
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.media_objects
     SET state = 'ready', derivatives = _derivatives
   WHERE id = _id AND state = 'verified';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % is not in state verified', _id USING ERRCODE = '23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.media_quarantine(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'a quarantine must record a reason' USING ERRCODE = '22023';
  END IF;

  UPDATE public.media_objects
     SET state = 'quarantined', quarantine_reason = _reason
   WHERE id = _id AND state <> 'quarantined';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % does not exist or is already quarantined', _id
      USING ERRCODE = '23514';
  END IF;
END $$;

-- ── 5. Grants. ─────────────────────────────────────────────────────────────
--
-- ⚠ `ALTER DEFAULT PRIVILEGES` has already granted EXECUTE on all five
-- functions above to anon AND authenticated. Every one is therefore revoked by
-- NAME first — `FROM PUBLIC` alone does not remove a grant held by a named
-- role, which is the mistake email_infra.sql:195 made and lived with for two
-- years — and then granted back deliberately.
--
-- The asymmetry is the security property: members may start an upload; only
-- the server may say a byte stream was verified.

REVOKE ALL ON FUNCTION public.tg_media_state_transition()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_begin_upload(bytea,int,int,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_mark_verified(uuid)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_mark_ready(uuid,jsonb)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_quarantine(uuid,text)                FROM PUBLIC, anon, authenticated;

-- A logged-out visitor has no reason to begin an upload, so `anon` is not here.
GRANT EXECUTE ON FUNCTION public.media_begin_upload(bytea,int,int,bigint,text) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.media_mark_verified(uuid)    TO service_role;
GRANT EXECUTE ON FUNCTION public.media_mark_ready(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.media_quarantine(uuid,text)  TO service_role;

COMMIT;
