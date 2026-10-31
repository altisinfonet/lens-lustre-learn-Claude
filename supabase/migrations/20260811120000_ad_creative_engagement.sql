-- ============================================================================
-- SPONSORED ADS GET LIKE, COMMENT AND SHARE — LIKE A NORMAL POST.
--
-- Owner instruction, 2026-08-11:
--   "For All sponsored Ad, Like Comment share is required like a normal post."
--
-- He also chose, when asked: the FULL build (real reactions, a real comment
-- thread, real shares) and a new /ad/<id> permalink page so an ad can be
-- opened and shared the way a post can.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT AN "AD" IS, AND WHY ENGAGEMENT HANGS OFF ad_creatives
--
-- A story-card ad in the feed is rendered by src/components/ads/AdZone.tsx from
-- ONE OF TWO sources:
--
--   * a row of public.ad_creatives — the picture library the admin fills in
--     /admin/advertisements. This has a stable id.
--   * the zone's single legacy image, stored inside the ad_zones config JSON.
--     This has NO id of any kind.
--
-- Engagement needs something to attach to, so it attaches to ad_creatives.id.
-- The legacy single-image path gets no action row: there is nothing to key a
-- like to, and inventing a synthetic id would silently merge every zone's
-- legacy image into one comment thread. AdZone therefore only renders the row
-- when it picked a library creative. This is a real limitation and it is
-- deliberate — the fix, if the legacy path ever matters, is to migrate that
-- image into the library, which the admin panel already supports.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY SEPARATE TABLES AND NOT A NULLABLE ad_creative_id ON post_comments
--
-- Reusing post_comments / post_reactions / post_shares was the smaller diff and
-- was rejected. Those three tables carry the busiest triggers on the site
-- (comment counts, reaction counts, the job queue that fans notifications out,
-- and every RLS policy that joins back to posts). Making post_id nullable to
-- fit an ad in would have put all of that in the blast radius of an advertising
-- feature. The owner's standing rule is "no damaging other functionality", and
-- three new tables touch nothing that exists.
--
-- What IS reused, because it is genuinely generic:
--   * public.enforce_comment_blocklist() — reads only NEW.content, so the same
--     function guards ad comments with the same admin keyword list. No copy.
--   * public.account_is_live() — the deleted-account write lock, applied below
--     in exactly the shape 20260806160000 applies it everywhere else.
--   * public.has_role(auth.uid(), 'admin') — the existing role check.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS FILE CREATES
--
--   1. ad_creative_reactions  — one reaction per member per creative
--   2. ad_creative_comments   — a thread, one level of replies
--   3. ad_creative_shares     — one share per member per creative
--   4. RLS on all three, plus the restrictive account-liveness guards
--   5. enforce_comment_blocklist attached to ad_creative_comments
--   6. comment_reports.ad_comment_id + flag_ad_comment_for_review, so a flagged
--      ad comment lands in the SAME admin review queue as a post comment
--   7. get_ad_engagement(uuid[]) — every count and the viewer's own state for a
--      whole screen of ads in ONE round trip
--   8. ad_comment_reply notifications, so a reply on an ad is not silent
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NOT DONE HERE, ON PURPOSE
--
-- "Share to your wall" is NOT offered for an ad. On a post it copies the post
-- onto the sharer's wall; doing that with an advertisement would publish an ad
-- under a member's name, on their own profile, to their friends. That is a
-- product and possibly a legal decision, not a technical one, so the ad share
-- action copies the /ad/<id> link and records the share. Flagged to the owner.
--
-- Migrations do NOT auto-apply on this project. This file is the record; the
-- statements were run by hand in the Supabase SQL editor.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) REACTIONS
--
-- Column names mirror public.post_reactions exactly (user_id, reaction_type)
-- so ReactionPicker and the reaction catalog need no special case. One row per
-- member per creative, enforced by the unique constraint rather than by client
-- code — the same shape post_reactions uses.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_creative_reactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id   uuid NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  reaction_type text NOT NULL DEFAULT 'like',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creative_reactions_one_per_member UNIQUE (creative_id, user_id),
  CONSTRAINT ad_creative_reactions_known_type
    CHECK (reaction_type IN ('like','love','haha','wow','sad','angry'))
);

CREATE INDEX IF NOT EXISTS idx_ad_creative_reactions_creative
  ON public.ad_creative_reactions (creative_id);

COMMENT ON TABLE public.ad_creative_reactions IS
  'Member reactions on a sponsored ad creative. Mirrors post_reactions. Owner request 2026-08-11: ads need like/comment/share like a normal post.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) COMMENTS
--
-- parent_id gives one level of replies, the same depth PostCommentsSection
-- renders. A reply to a reply attaches to the top-level parent, which is what
-- the post thread already does in practice.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_creative_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  content     text NOT NULL,
  parent_id   uuid REFERENCES public.ad_creative_comments(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creative_comments_not_empty CHECK (length(btrim(content)) > 0),
  CONSTRAINT ad_creative_comments_length CHECK (length(content) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_ad_creative_comments_creative
  ON public.ad_creative_comments (creative_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ad_creative_comments_parent
  ON public.ad_creative_comments (parent_id) WHERE parent_id IS NOT NULL;

COMMENT ON TABLE public.ad_creative_comments IS
  'Member comments on a sponsored ad creative. Guarded by the same enforce_comment_blocklist() trigger as post_comments, and flagged into the same comment_reports queue.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) SHARES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_creative_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creative_shares_one_per_member UNIQUE (creative_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_creative_shares_creative
  ON public.ad_creative_shares (creative_id);

COMMENT ON TABLE public.ad_creative_shares IS
  'One row per member who shared a sponsored ad. Mirrors post_shares.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS
--
-- READ is open to any signed-in member, because the ad itself is shown to any
-- signed-in member and a comment thread nobody can read is not a thread.
-- WRITE is your own row only. Admins may delete anything, which is how a bad
-- comment comes off an advertiser's ad.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ad_creative_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_creative_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_creative_shares    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read ad reactions" ON public.ad_creative_reactions;
CREATE POLICY "Members read ad reactions" ON public.ad_creative_reactions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Members react as themselves" ON public.ad_creative_reactions;
CREATE POLICY "Members react as themselves" ON public.ad_creative_reactions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members change their own ad reaction" ON public.ad_creative_reactions;
CREATE POLICY "Members change their own ad reaction" ON public.ad_creative_reactions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members remove their own ad reaction" ON public.ad_creative_reactions;
CREATE POLICY "Members remove their own ad reaction" ON public.ad_creative_reactions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members read ad comments" ON public.ad_creative_comments;
CREATE POLICY "Members read ad comments" ON public.ad_creative_comments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Members comment as themselves" ON public.ad_creative_comments;
CREATE POLICY "Members comment as themselves" ON public.ad_creative_comments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members edit their own ad comment" ON public.ad_creative_comments;
CREATE POLICY "Members edit their own ad comment" ON public.ad_creative_comments
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members or admins delete an ad comment" ON public.ad_creative_comments;
CREATE POLICY "Members or admins delete an ad comment" ON public.ad_creative_comments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Members read ad shares" ON public.ad_creative_shares;
CREATE POLICY "Members read ad shares" ON public.ad_creative_shares
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Members share as themselves" ON public.ad_creative_shares;
CREATE POLICY "Members share as themselves" ON public.ad_creative_shares
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members remove their own ad share" ON public.ad_creative_shares;
CREATE POLICY "Members remove their own ad share" ON public.ad_creative_shares
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- The deleted-account write lock, in the exact shape 20260806160000 applies to
-- every other member-writable table. RESTRICTIVE, so it can only ever take
-- access away. Without these three, a deleted account could still comment on an
-- ad — which is the P0 that migration was written to close.
DO $lock$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_creative_reactions','ad_creative_comments','ad_creative_shares']
  LOOP
    EXECUTE format('drop policy if exists %I on public.%I', 'Deleted accounts cannot insert', t);
    EXECUTE format('drop policy if exists %I on public.%I', 'Deleted accounts cannot update', t);
    EXECUTE format('drop policy if exists %I on public.%I', 'Deleted accounts cannot delete', t);
    EXECUTE format('create policy %I on public.%I as restrictive for insert to authenticated with check ((select public.account_is_live()))', 'Deleted accounts cannot insert', t);
    EXECUTE format('create policy %I on public.%I as restrictive for update to authenticated using ((select public.account_is_live()))', 'Deleted accounts cannot update', t);
    EXECUTE format('create policy %I on public.%I as restrictive for delete to authenticated using ((select public.account_is_live()))', 'Deleted accounts cannot delete', t);
  END LOOP;
END
$lock$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) MODERATION — the SAME blocklist that guards post comments
--
-- enforce_comment_blocklist() reads nothing but NEW.content, so it is attached
-- unchanged. An ad comment containing an auto_hide keyword is refused with the
-- identical error the post thread produces, which the client already knows how
-- to show.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_enforce_ad_comment_blocklist ON public.ad_creative_comments;
CREATE TRIGGER trg_enforce_ad_comment_blocklist
  BEFORE INSERT OR UPDATE ON public.ad_creative_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_comment_blocklist();

-- keep updated_at honest
CREATE OR REPLACE FUNCTION public.set_ad_comment_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ad_comment_updated_at ON public.ad_creative_comments;
CREATE TRIGGER trg_ad_comment_updated_at
  BEFORE UPDATE ON public.ad_creative_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_ad_comment_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) REVIEW QUEUE — one queue, not two
--
-- comment_reports already carries post_comment_id. A nullable ad_comment_id is
-- added beside it so a flagged ad comment appears in the SAME admin list. Every
-- existing row keeps NULL there and every existing query is unaffected: this
-- only ADDS a column.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.comment_reports
  ADD COLUMN IF NOT EXISTS ad_comment_id uuid
  REFERENCES public.ad_creative_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_comment_reports_ad_comment
  ON public.comment_reports (ad_comment_id) WHERE ad_comment_id IS NOT NULL;

COMMENT ON COLUMN public.comment_reports.ad_comment_id IS
  'Set when the report is about an ad_creative_comments row instead of a post_comments row. Exactly one of post_comment_id / ad_comment_id is set.';

-- The sibling of flag_post_comment_for_review. Same keyword helper, same queue,
-- same 'keyword_flag' source, so the admin panel needs no new concept.
CREATE OR REPLACE FUNCTION public.flag_ad_comment_for_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE _hit text;
BEGIN
  _hit := public._flag_review_keyword_hit(NEW.content);
  IF _hit IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.comment_reports
    WHERE ad_comment_id = NEW.id AND source = 'keyword_flag'
  ) THEN
    INSERT INTO public.comment_reports (ad_comment_id, reporter_id, reason, details, status, source)
    VALUES (NEW.id, NULL, 'auto_flagged_keyword', 'Auto-flagged by blocklist review keyword', 'pending', 'keyword_flag');
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_flag_ad_comment_for_review ON public.ad_creative_comments;
CREATE TRIGGER trg_flag_ad_comment_for_review
  AFTER INSERT OR UPDATE OF content ON public.ad_creative_comments
  FOR EACH ROW EXECUTE FUNCTION public.flag_ad_comment_for_review();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) ONE ROUND TRIP FOR A WHOLE SCREEN OF ADS
--
-- The feed can show 16 story-card ads in a single scroll. Three counts and the
-- viewer's own reaction, fetched per ad, would be 64 requests. This returns all
-- of it for every id at once.
--
-- SECURITY DEFINER with a fixed search_path, and it reads only aggregate
-- engagement on ads — which every signed-in member may read anyway under the
-- policies above. auth.uid() is used for the viewer's own state, so one
-- member can never see another member's reaction as their own.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ad_engagement(_creative_ids uuid[])
RETURNS TABLE (
  creative_id     uuid,
  like_count      integer,
  comment_count   integer,
  share_count     integer,
  my_reaction     text,
  my_shared       boolean,
  reaction_counts jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT
    c.id AS creative_id,
    COALESCE((SELECT count(*) FROM public.ad_creative_reactions r WHERE r.creative_id = c.id), 0)::integer,
    COALESCE((SELECT count(*) FROM public.ad_creative_comments m WHERE m.creative_id = c.id), 0)::integer,
    COALESCE((SELECT count(*) FROM public.ad_creative_shares s WHERE s.creative_id = c.id), 0)::integer,
    (SELECT r.reaction_type FROM public.ad_creative_reactions r
      WHERE r.creative_id = c.id AND r.user_id = auth.uid()),
    EXISTS (SELECT 1 FROM public.ad_creative_shares s
      WHERE s.creative_id = c.id AND s.user_id = auth.uid()),
    COALESCE((
      SELECT jsonb_object_agg(t.reaction_type, t.n)
      FROM (
        SELECT r.reaction_type, count(*) AS n
        FROM public.ad_creative_reactions r
        WHERE r.creative_id = c.id
        GROUP BY r.reaction_type
      ) t
    ), '{}'::jsonb)
  FROM public.ad_creatives c
  WHERE c.id = ANY(_creative_ids);
$fn$;

REVOKE ALL ON FUNCTION public.get_ad_engagement(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_ad_engagement(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_ad_engagement(uuid[]) IS
  'Counts and the calling member''s own reaction/share state for a batch of ad creatives. One round trip for a whole screen of feed ads.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) A REPLY ON AN AD IS NOT SILENT
--
-- Nobody owns an ad, so there is no "owner" notification — but a reply to YOUR
-- comment still has to reach you, exactly as it does on a post. New type
-- ad_comment_reply, phrased in the catalog and linked to /ad/<id>.
--
-- notif_action_phrase is reproduced whole (it is the byte-identical twin of
-- ACTION_CATALOG in src/lib/notifications/describe.ts, enforced by
-- pushCatalogParity.test.ts) with one line added.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_action_phrase(_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE _type
           WHEN 'new_post_from_following' THEN 'shared a photo.'
           WHEN 'post_reaction'           THEN 'reacted to your photo.'
           WHEN 'image_reaction'          THEN 'reacted to your photo.'
           WHEN 'post_comment'            THEN 'commented on your photo.'
           WHEN 'image_comment'           THEN 'commented on your photo.'
           WHEN 'comment_reply'           THEN 'replied to your comment.'
           WHEN 'new_follower'            THEN 'started following you.'
           WHEN 'friend_request'          THEN 'sent you a friend request.'
           WHEN 'friend_accepted'         THEN 'accepted your friend request.'
           WHEN 'post_tag'                THEN 'tagged you in a photo.'
           WHEN 'tagged_post_reaction'    THEN 'reacted to a photo you are tagged in.'
           WHEN 'tagged_post_comment'     THEN 'commented on a photo you are tagged in.'
           WHEN 'ad_comment_reply'        THEN 'replied to your comment on a sponsored post.'
           ELSE NULL
         END;
$fn$;

COMMENT ON FUNCTION public.notif_action_phrase(text) IS
  'Singular action phrase for a notification type. Byte-identical copy of ACTION_CATALOG in src/lib/notifications/describe.ts, enforced by pushCatalogParity.test.ts.';

CREATE OR REPLACE FUNCTION public.notify_ad_comment_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _parent_author uuid;
  _actor_name    text;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT user_id INTO _parent_author
  FROM public.ad_creative_comments WHERE id = NEW.parent_id;

  IF _parent_author IS NULL OR _parent_author = NEW.user_id THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(full_name, 'Someone') INTO _actor_name
  FROM public.profiles WHERE id = NEW.user_id;

  INSERT INTO public.user_notifications
    (user_id, actor_id, type, title, message, reference_id, dedup_key)
  VALUES (
    _parent_author,
    NEW.user_id,
    'ad_comment_reply',
    'New Reply',
    COALESCE(_actor_name, 'Someone') || ' replied to your comment on a sponsored post',
    NEW.creative_id,
    'ad_comment_reply:' || NEW.id::text
  )
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_ad_comment_reply ON public.ad_creative_comments;
CREATE TRIGGER trg_notify_ad_comment_reply
  AFTER INSERT ON public.ad_creative_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_ad_comment_reply();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) The new type joins the two functions that decide HOW it behaves.
--
-- Without these two edits a brand-new type falls through to defaults that are
-- wrong in opposite directions: get_notification_email_enabled would hit
-- ELSE true and mail every reply while ignoring the member's "email me about
-- comments" switch, and notif_group_key would give each reply its own bell row
-- instead of collapsing a burst the way comment_reply already does.
--
-- Both functions are reproduced whole, from the versions installed earlier
-- today by 20260811090000. The ONLY change in each is 'ad_comment_reply'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_group_key(
  _type       text,
  _created_at timestamptz,
  _id         uuid
)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT CASE
           WHEN _type IN ('post_reaction','image_reaction','post_comment',
                          'image_comment','comment_reply','new_post_from_following',
                          'tagged_post_reaction','tagged_post_comment',
                          'ad_comment_reply')
             THEN _type || '|' || to_char(date_trunc('day', _created_at), 'YYYY-MM-DD')
           ELSE _type || '|' || _id::text          -- never grouped: unique key
         END;
$fn$;

COMMENT ON FUNCTION public.notif_group_key(text, timestamptz, uuid) IS
  'The one definition of what counts as a single notification group. Called by get_my_notifications_grouped and get_my_unread_notifications_grouped so the history page and the bell can never disagree.';

CREATE OR REPLACE FUNCTION public.get_notification_email_enabled(_user_id uuid, _notif_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN _notif_type IN ('ticket_reply', 'role_approved', 'role_rejected', 'friend_accepted') THEN true
    -- ADDED 2026-08-11: the tagged fan-out is in-app and push only (owner's
    -- choice). Placed ABOVE the reaction/comment branches so it cannot be
    -- swallowed by them, and above ELSE true so it cannot fall through to mail.
    WHEN _notif_type IN ('tagged_post_reaction', 'tagged_post_comment') THEN false
    WHEN _notif_type IN ('post_reaction', 'image_reaction', 'competition_vote') THEN
      COALESCE((SELECT email_reactions FROM notification_preferences WHERE user_id = _user_id), true)
    -- ad_comment_reply joins the comment family, so it obeys the member's
    -- existing "email me about comments" switch rather than a new one.
    WHEN _notif_type IN ('post_comment', 'comment_reply', 'image_comment', 'ad_comment_reply') THEN
      COALESCE((SELECT email_comments FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('friend_request') THEN
      COALESCE((SELECT email_friend_requests FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('new_follower') THEN
      COALESCE((SELECT email_new_followers FROM notification_preferences WHERE user_id = _user_id), true)
    -- BUG-039: ALL competition-result types respect the Competition Updates toggle
    WHEN _notif_type IN ('entry_approved', 'entry_rejected', 'competition_winner',
                         'entry_qualified', 'entry_finalist', 'entry_shortlisted',
                         'round_results_published', 'potd_featured') THEN
      COALESCE((SELECT email_competition_updates FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('certificate_issued') THEN
      COALESCE((SELECT email_certificates FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('badge_awarded') THEN
      COALESCE((SELECT email_gift_credits FROM notification_preferences WHERE user_id = _user_id), true)
    -- BUG-039: course publishing is an opt-in broadcast (default OFF preserves BUG-038)
    WHEN _notif_type IN ('course_published') THEN
      COALESCE((SELECT email_course_updates FROM notification_preferences WHERE user_id = _user_id), false)
    -- BUG-038: mass-broadcast types never email the whole base
    WHEN _notif_type IN ('new_competition', 'journal_published') THEN false
    ELSE true
  END;
$fn$;

COMMIT;
