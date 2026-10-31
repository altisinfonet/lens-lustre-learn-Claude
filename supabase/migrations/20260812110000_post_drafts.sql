-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE C — POST DRAFTS
--
-- Scope: the storage and server-side half of the new Create experience.
-- No UI here. The category strip is Stage D. POST-CAT-002 is Stage B2 and
-- this migration DOES NOT activate it — see §4.
--
-- NOT TOUCHED: hashtags (parsed from posts.content at read time), post_tags
-- people-tagging behaviour, the feed RPC and its fairness ordering, the
-- categories taxonomy, and the direct (non-draft) posting path.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE TABLE
--
-- A draft is unfinished by definition, so it is validated more loosely than a
-- post: slugs must be real, the maximum of 5 holds, but there is NO minimum.
-- You must be able to save a draft before you have chosen anything.
CREATE TABLE IF NOT EXISTS public.post_drafts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL,
  content           text        NOT NULL DEFAULT '',
  image_url         text,
  image_urls        text[]      NOT NULL DEFAULT '{}',
  thumbnail_urls    text[],
  privacy           text        NOT NULL DEFAULT 'public',
  indexing_disabled boolean     NOT NULL DEFAULT false,
  categories        text[]      NOT NULL DEFAULT '{}',

  -- ⚠ NOT `tagged_user_ids uuid[]`. That was the first design and it was wrong.
  -- A tag is not a user id: PendingTag is {taggedUserId, taggedUserName,
  -- taggedUserAvatar, photoIndex, xPosition, yPosition}. Storing only ids loses
  -- WHICH photo each person was tagged on and WHERE on it, so every resumed
  -- draft would come back with its people-tags attached to nothing.
  --
  -- jsonb rather than a child table on purpose: this row lives at most 7 days,
  -- is private to one member, and is never queried by tag. A child table would
  -- be machinery for nothing.
  pending_tags      jsonb       NOT NULL DEFAULT '[]',

  scheduled_for     timestamptz,

  -- Phase-1 cleanup marker. Non-NULL means "this draft is on its way out":
  -- it disappears from the member's list immediately (see the RLS policy) and
  -- can no longer be resumed, BEFORE its images are touched. That ordering is
  -- the whole point — see §5.
  expiring_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_drafts_max_5_categories CHECK (cardinality(categories) <= 5),
  CONSTRAINT post_drafts_privacy_check CHECK (privacy IN ('public','friends','private'))
);

COMMENT ON TABLE public.post_drafts IS
  'Unpublished posts. Created only when a member presses Save - never automatically - so an abandoned compose session costs nothing. Deleted 7 days after the last edit by prune-post-drafts.';
COMMENT ON COLUMN public.post_drafts.pending_tags IS
  'Array of {taggedUserId, taggedUserName, taggedUserAvatar, photoIndex, xPosition, yPosition}. Coordinates must survive save/resume or people-tags come back attached to nothing.';
COMMENT ON COLUMN public.post_drafts.expiring_at IS
  'Set by mark_expiring_post_drafts(). Non-NULL hides the draft from its owner and blocks resume, before any image is deleted.';

-- The drafts list: newest first, own rows only.
CREATE INDEX IF NOT EXISTS idx_post_drafts_user
  ON public.post_drafts (user_id, updated_at DESC);

-- The cleanup scan only ever looks at rows not yet marked.
CREATE INDEX IF NOT EXISTS idx_post_drafts_sweep
  ON public.post_drafts (updated_at) WHERE expiring_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY — own rows only, and expiring rows are already gone
--
-- There is deliberately NO admin read path. A draft is unpublished private work
-- and nobody else has a reason to see it.
ALTER TABLE public.post_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pd_select_own ON public.post_drafts;
CREATE POLICY pd_select_own ON public.post_drafts
  FOR SELECT USING (auth.uid() = user_id AND expiring_at IS NULL);

DROP POLICY IF EXISTS pd_insert_own ON public.post_drafts;
CREATE POLICY pd_insert_own ON public.post_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS pd_update_own ON public.post_drafts;
CREATE POLICY pd_update_own ON public.post_drafts
  FOR UPDATE USING (auth.uid() = user_id AND expiring_at IS NULL)
             WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS pd_delete_own ON public.post_drafts;
CREATE POLICY pd_delete_own ON public.post_drafts
  FOR DELETE USING (auth.uid() = user_id);

-- Supabase's ALTER DEFAULT PRIVILEGES grants ALL on new public tables to anon
-- and authenticated. RLS is what actually restricts this table, but anon has no
-- business here at all, so remove it rather than relying on one layer.
REVOKE ALL ON public.post_drafts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_drafts TO authenticated;
GRANT ALL ON public.post_drafts TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VALIDATION TRIGGER — slugs, and the per-member cap
--
-- SECURITY INVOKER, for the same reason as enforce_post_categories: inside a
-- DEFINER function `current_user` is the owner, not the caller, so any check
-- that keys on the calling role silently stops working.
CREATE OR REPLACE FUNCTION public.enforce_post_draft_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  _bad text;
  _n   integer;
  _client boolean := current_user IN ('authenticated', 'anon');
BEGIN
  -- Normalise exactly as posts do, so a draft and the post it becomes agree.
  -- Order is preserved: a plain DISTINCT reorders, and "the first one is the
  -- primary category" is an obvious future ask.
  NEW.categories := ARRAY(
    SELECT t.slug FROM (
      SELECT DISTINCT ON (lower(btrim(u.c)))
             lower(btrim(u.c)) AS slug, u.ord
      FROM unnest(COALESCE(NEW.categories, '{}')) WITH ORDINALITY AS u(c, ord)
      WHERE btrim(u.c) <> ''
      ORDER BY lower(btrim(u.c)), u.ord
    ) t
    ORDER BY t.ord
  );

  -- Slugs must be real and active. A draft may hold ZERO categories - that is
  -- the point of a draft - but it may never hold one that cannot exist.
  SELECT string_agg(c, ', ') INTO _bad
  FROM unnest(NEW.categories) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories cat WHERE cat.slug = c AND cat.is_active
  );
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'DRAFT-001: unknown or inactive category slug(s): %', _bad
      USING ERRCODE = 'check_violation';
  END IF;

  -- The cap. Without it, drafts are an unbounded upload channel: 500 drafts of
  -- 10 photos each is 5,000 images one member can park in storage for a week.
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO _n FROM public.post_drafts d WHERE d.user_id = NEW.user_id;
    IF _n >= 20 THEN
      RAISE EXCEPTION 'DRAFT-002: a member may keep at most 20 drafts'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF _client THEN
    -- ⚠ BOTH LINES BELOW ARE CLIENT-ONLY, AND THE FIRST VERSION GOT THIS WRONG.
    --
    -- The bug: `updated_at := now()` fired on EVERY update, including the
    -- `UPDATE ... SET expiring_at = now()` inside mark_expiring_post_drafts().
    -- So marking a draft reset the very timestamp the 7-day clock measures,
    -- the mark could never stick, and the whole cleanup chain silently did
    -- nothing. A stale draft would have lived forever. Caught by the harness
    -- returning 0 marked instead of 1.
    --
    -- `updated_at` must mean "when the MEMBER last edited this", not "when any
    -- statement last touched the row". So only a client edit moves it, and the
    -- cleanup functions - which run as the definer, not as authenticated - can
    -- set expiring_at without disturbing the clock.
    NEW.updated_at := now();

    -- And a client may not mark or unmark its own draft. Without this a member
    -- could set expiring_at themselves, hiding the draft from their own list
    -- and queueing its images for deletion. Same pinning pattern as post_kind.
    NEW.expiring_at := OLD.expiring_at;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enforce_post_draft_rules ON public.post_drafts;
CREATE TRIGGER trg_enforce_post_draft_rules
  BEFORE INSERT OR UPDATE ON public.post_drafts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_draft_rules();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PUBLISH — ONE TRANSACTION, SERVER SIDE
--
-- ⚠ WHY THIS IS AN RPC AND NOT TWO CLIENT CALLS.
--
-- Publishing means "create the post AND remove the draft". supabase-js cannot
-- span a transaction - proved during the Phase B architecture work, and the
-- reason posts.categories is an array rather than a join table. Two separate
-- client statements can half-fail, leaving the same content BOTH published and
-- still sitting in Drafts. So both happen here, or neither does.
--
-- ⚠ THIS FUNCTION DOES NOT ENFORCE THE 1-CATEGORY MINIMUM, ON PURPOSE.
--
-- Owner, 2026-08-12: "The new Create UI can enforce 1-5 categories at the UI
-- level, but the database's mandatory minimum rule must remain off until the
-- Android/Web rollout and adoption gate are satisfied."
--
-- Adding a minimum here would be a database-level minimum on this path, which
-- is exactly what was ruled out. Stage B2 turns it on everywhere at once, after
-- adoption is measured. Until then the UI is the gate.
CREATE OR REPLACE FUNCTION public.publish_post_draft(_draft_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _d   public.post_drafts%ROWTYPE;
  _post_id uuid;
  _t   jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH-0001: sign-in required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the row so two taps of Publish cannot both proceed.
  SELECT * INTO _d FROM public.post_drafts
   WHERE id = _draft_id AND user_id = _uid AND expiring_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRAFT-003: draft not found, not yours, or expired'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- post_kind is set explicitly. Inside a SECURITY DEFINER function
  -- current_user is the owner, so enforce_post_categories() does NOT treat this
  -- as a client insert and will not pin post_kind for us. A published draft is
  -- a member post - a person wrote it - so it must say so.
  INSERT INTO public.posts (
    user_id, content, image_url, image_urls, thumbnail_urls,
    privacy, indexing_disabled, categories, post_kind
  ) VALUES (
    _uid, _d.content, _d.image_url, _d.image_urls, _d.thumbnail_urls,
    _d.privacy, _d.indexing_disabled, _d.categories, 'member'
  )
  RETURNING id INTO _post_id;

  -- People-tags. Wrapped so a malformed tag can never cost the member their
  -- post: that is exactly how the direct posting path behaves today (it logs
  -- POST-2005 and carries on), and publishing must not be stricter.
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

  -- The draft row goes. Its IMAGES DO NOT - the post now references those very
  -- URLs. Deleting them here would blank the post that was just created.
  DELETE FROM public.post_drafts WHERE id = _draft_id;

  RETURN _post_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.publish_post_draft(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.publish_post_draft(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CLEANUP — THREE PHASES, EACH A NO-OP IF ALREADY DONE
--
-- ⚠ WHY NOT "DELETE IMAGES THEN DELETE ROW".
--
-- That order was the first proposal and it has a mirror of the failure it was
-- meant to prevent. Row-first risks orphaned files; images-first risks a draft
-- that is STILL VISIBLE and still resumable but whose photos are gone. The
-- second is worse: an orphan costs pennies and nobody sees it, while this is
-- member-visible data loss presented as a working draft.
--
--   1. MARK   expiring_at := now()   → vanishes from the member's list (RLS)
--   2. PURGE  delete storage objects → edge function, retried on failure
--   3. REAP   delete the row         → only once its objects are gone
--
-- Every phase is idempotent, so a crash anywhere is picked up by the next run.
CREATE OR REPLACE FUNCTION public.mark_expiring_post_drafts(_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE _n integer;
BEGIN
  UPDATE public.post_drafts
     SET expiring_at = now()
   WHERE expiring_at IS NULL
     AND updated_at < now() - make_interval(days => _days);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

-- What the purge job reads: marked rows and the objects it must remove.
CREATE OR REPLACE FUNCTION public.expiring_post_drafts()
RETURNS TABLE(id uuid, urls text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.id,
         -- ORDER BY is not decoration: without it DISTINCT returns whatever
         -- order the planner likes, so two runs over the same draft log
         -- different object lists and become impossible to compare when
         -- diagnosing a purge that half-failed.
         ARRAY(SELECT DISTINCT u FROM unnest(
           COALESCE(d.image_urls,'{}') ||
           COALESCE(d.thumbnail_urls,'{}') ||
           CASE WHEN d.image_url IS NULL THEN '{}'::text[] ELSE ARRAY[d.image_url] END
         ) AS u WHERE u IS NOT NULL AND u <> '' ORDER BY u)
  FROM public.post_drafts d
  WHERE d.expiring_at IS NOT NULL
  ORDER BY d.expiring_at
  LIMIT 500;
$$;

-- Phase 3. Only ever removes rows already marked, so it can never race a draft
-- the member is still editing.
CREATE OR REPLACE FUNCTION public.reap_post_drafts(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE _n integer;
BEGIN
  DELETE FROM public.post_drafts
   WHERE id = ANY(COALESCE(_ids,'{}')) AND expiring_at IS NOT NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.mark_expiring_post_drafts(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.expiring_post_drafts()             FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_post_drafts(uuid[])           FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_expiring_post_drafts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expiring_post_drafts()             TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_post_drafts(uuid[])           TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SCHEDULE — mark daily. The purge/reap half is the edge function, invoked
-- on its own schedule, because deleting a storage object is an HTTP call and
-- cannot happen inside Postgres.
DO $$ BEGIN
  PERFORM cron.unschedule('mark-expiring-post-drafts');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule('mark-expiring-post-drafts', '10 3 * * *',
    $cmd$ SELECT public.mark_expiring_post_drafts(7); $cmd$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available here; schedule mark-expiring-post-drafts manually';
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SELF-CHECK. Every value must read exactly as annotated.
SELECT 'post_drafts_table' AS check, count(*)::text AS value
  FROM information_schema.tables
 WHERE table_schema='public' AND table_name='post_drafts'                       -- 1
UNION ALL
SELECT 'rls_enabled', (SELECT relrowsecurity::text FROM pg_class
  WHERE oid='public.post_drafts'::regclass)                                     -- true
UNION ALL
SELECT 'rls_policies', count(*)::text FROM pg_policies
 WHERE schemaname='public' AND tablename='post_drafts'                          -- 4
UNION ALL
SELECT 'anon_has_no_grants', count(*)::text FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='post_drafts' AND grantee='anon'    -- 0
UNION ALL
SELECT 'pending_tags_is_jsonb', count(*)::text FROM information_schema.columns
 WHERE table_schema='public' AND table_name='post_drafts'
   AND column_name='pending_tags' AND data_type='jsonb'                         -- 1
UNION ALL
SELECT 'no_tagged_user_ids_column', count(*)::text FROM information_schema.columns
 WHERE table_schema='public' AND table_name='post_drafts'
   AND column_name='tagged_user_ids'                                            -- 0
UNION ALL
SELECT 'publish_rpc', count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='publish_post_draft'                    -- 1
UNION ALL
SELECT 'cleanup_fns', count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
   ('mark_expiring_post_drafts','expiring_post_drafts','reap_post_drafts')      -- 3
UNION ALL
-- B2 MUST STILL BE OFF. Comments are stripped before matching, because the
-- B1 migration quotes the deferred rule in a comment and a plain LIKE would
-- read the explanation as evidence the rule is live.
SELECT 'B2_STILL_INACTIVE', count(*)::text FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='enforce_post_categories'
   AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%POST-CAT-002%';     -- 0
