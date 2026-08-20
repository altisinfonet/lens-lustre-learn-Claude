-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260820073000_media_attach_for_deferred_publish.
--
-- ⚠ READ BEFORE RUNNING.
--
-- This restores `publish_post_draft` to the version that does not attach media,
-- and drops `post_attach_media`. Drafts and scheduled posts then publish
-- legacy-only again — MEDIA-4001 does not fire for them (that counter is on the
-- immediate composer path), so the only visible signal is the legacy-only
-- population starting to grow again in the reconciliation. Say so out loud if
-- you run this.
--
-- ⚠ THE COLUMNS ARE NOT DROPPED. `post_drafts.media_ids` and
-- `scheduled_posts.media_ids` stay. Dropping them would throw away media ids
-- the client has already registered — the `media_objects` rows would survive
-- with nothing pointing at them, the orphan sweep would report them (correctly)
-- as unreferenced, and re-applying the migration could not recover the link.
-- An unused column costs nothing; a lost reference costs a re-upload.
--
-- ⚠ POSTS ALREADY PUBLISHED WITH REFERENCES ARE NOT AFFECTED and must NOT be
-- "cleaned up". They carry correct `post_media` rows AND correct `image_urls`,
-- so they read identically either way. Deleting their media rows to "undo" the
-- migration destroys verified provenance for no gain.
--
-- This does NOT redeploy `publish-scheduled-posts`. The deployed version calls
-- `post_attach_media`; once this rollback drops it, that call fails and is
-- caught — the post still publishes and `mediaUnattached` counts it. That is
-- the designed behaviour, not a breakage. Redeploy v22 separately if the call
-- itself must go.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.publish_post_draft(_draft_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _d   public.post_drafts%ROWTYPE;
  _post_id uuid;
  _t   jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH-0001: sign-in required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO _d FROM public.post_drafts
   WHERE id = _draft_id AND user_id = _uid AND expiring_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRAFT-003: draft not found, not yours, or expired'
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.posts (
    user_id, content, image_url, image_urls, thumbnail_urls,
    privacy, indexing_disabled, categories, post_kind
  ) VALUES (
    _uid, _d.content, _d.image_url, _d.image_urls, _d.thumbnail_urls,
    _d.privacy, _d.indexing_disabled, _d.categories, 'member'
  )
  RETURNING id INTO _post_id;

  BEGIN
    FOR _t IN SELECT * FROM jsonb_array_elements(COALESCE(_d.pending_tags, '[]'::jsonb))
    LOOP
      INSERT INTO public.post_tags (
        post_id, tagger_id, tagged_user_id, photo_index, x_position, y_position
      ) VALUES (
        _post_id, _uid,
        (_t->>'taggedUserId')::uuid,
        COALESCE((_t->>'photoIndex')::int, 0),
        COALESCE((_t->>'xPosition')::numeric, 0),
        COALESCE((_t->>'yPosition')::numeric, 0)
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'DRAFT-004: people-tags skipped for post %: %', _post_id, SQLERRM;
  END;

  DELETE FROM public.post_drafts WHERE id = _draft_id;

  RETURN _post_id;
END $function$;

REVOKE ALL ON FUNCTION public.publish_post_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_post_draft(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.post_attach_media(uuid, uuid[]);

COMMIT;
