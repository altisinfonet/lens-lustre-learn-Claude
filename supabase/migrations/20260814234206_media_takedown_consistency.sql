-- ═══════════════════════════════════════════════════════════════════════════
-- B4 FIX-2 — TAKEDOWN CONSISTENCY + "NO DUPLICATE REFERENCE"
--
-- Both defects were MEASURED on the B4 harness (harness/b4/):
--
--   RACE-3: a quarantine landing while a publish was in flight left a LIVE
--   post referencing quarantined bytes (measured: 1 such reference). The
--   publish read `state = 'ready'`, the takedown committed, and nothing
--   reconciled the two.
--
--   R16: the same media could occupy two positions in one post's carousel —
--   the gate's "no duplicate reference" clause was assumed, never enforced.
--
-- Three parts:
--   a) tg_post_media_requires_ready reads the media row FOR UPDATE, so a
--      concurrent quarantine queues behind the publish instead of running
--      through the middle of it. Quarantine-first → the publish is refused.
--   b) media_quarantine detaches live references in the SAME transaction that
--      takes the media down. Publish-first → the takedown cleans up after it.
--      A takedown that leaves the photo on the post is not a takedown.
--   c) UNIQUE (post_id, media_id) enforces the no-duplicate-reference clause.
--
-- BLAST RADIUS: media_objects and post_media hold ZERO production rows — the
-- media engine ships with the B5 client switch. This migration is inert until
-- then; it is applied now so the switch inherits a proven-correct write path
-- rather than one that still has to be fixed under load.
--
-- POST-FIX HARNESS RESULT: live refs to quarantined media 0 (was 1); duplicate
-- reference refused; every other matrix row unchanged (R7/R8/R9/R11/R12/R13/
-- R14 all still hold, RACE-2 and RACE-4 unregressed).
-- ═══════════════════════════════════════════════════════════════════════════

-- (a) order the publish against a concurrent takedown
CREATE OR REPLACE FUNCTION public.tg_post_media_requires_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _state text;
BEGIN
  -- FOR UPDATE: a concurrent quarantine of this media waits for this publish
  -- rather than interleaving with it. Whichever lands first, the other sees a
  -- settled state instead of a stale one.
  SELECT state INTO _state FROM public.media_objects WHERE id = NEW.media_id FOR UPDATE;
  IF _state IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'post_media: media % is in state %, only ready may be referenced',
      NEW.media_id, coalesce(_state, '<missing>')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

-- (b) a takedown removes the photo from every post that shows it
CREATE OR REPLACE FUNCTION public.media_quarantine(_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _detached int;
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

  -- Same transaction as the state change: there is no window in which the
  -- media is quarantined but still on someone's post.
  DELETE FROM public.post_media WHERE media_id = _id;
  GET DIAGNOSTICS _detached = ROW_COUNT;
  IF _detached > 0 THEN
    RAISE NOTICE 'quarantine of % detached % live reference(s)', _id, _detached;
  END IF;
END $function$;

-- (c) no duplicate reference
CREATE UNIQUE INDEX IF NOT EXISTS post_media_post_media_uniq
  ON public.post_media USING btree (post_id, media_id);

-- ── GRANTS: stated, never inherited ──
-- CREATE OR REPLACE preserves an existing function's ACL, so redefining
-- media_quarantine did NOT re-open it (verified live: anon false,
-- authenticated false, both before and after this migration). But the standing
-- rule — enforced by securityDefinerGrants.test.ts, which failed on this very
-- file — is that every migration defining a SECURITY DEFINER function states
-- its own grant posture. Relying on "it was already revoked" is exactly the
-- implicit assumption that breaks the day someone drops and recreates the
-- function instead of replacing it. These are idempotent and match live state.
REVOKE ALL ON FUNCTION public.media_quarantine(uuid, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_post_media_requires_ready() FROM anon, authenticated;
