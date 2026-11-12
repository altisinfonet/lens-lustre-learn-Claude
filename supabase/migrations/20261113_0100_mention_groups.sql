-- ═══════════════════════════════════════════════════════════════════════════
-- 20261113_0100 · @all and @followers (Owner order 2026-11-12, "@all OK").
-- Plan: _control PLAN-2026-11-12-mention-all-followers.md. Lanes: staging, production.
--
-- WHAT THE OWNER DECIDED
--   @all        only a VERIFIED (blue tick) member may use it; it tells EVERY
--               member. Once a day. In a comment: only on the writer's OWN post.
--   @followers  every member may use it; it tells the writer's followers.
--               3 times a day.
--   Where       feed posts and feed comments (not stories).
--   When        only when the post is first published / the comment first
--               posted. Edits never count and never send.
--   Told by     bell + phone push; a member can switch both off.
--
-- THE STRUCTURE (the app only OFFERS the tags; everything is decided here)
--   is_verified_member(uuid)   THE one "who is verified" rule: verified badge
--                              OR admin.
--   mention_group_jobs         one row per (post | comment, tag) — the unique
--                              indexes make "once per post, forever" a fact.
--   tg_mention_groups_post / _comment   AFTER INSERT only: read the saved text
--                              for @[..](all) / @[..](followers) and call
--   mention_group_enqueue()    the gate: switch, live account, verified, own
--                              post, public post, daily limit. Returns the
--                              reason. A hacked app that writes "@all" without
--                              the right gets a refusal row in nobody's bell.
--   mention_groups_tick()      cron, every minute: re-checks the right when
--                              sending STARTS (badge removed → cancelled), then
--                              sends in batches through the notification centre
--                              (which already enforces blocks, the member's
--                              switches, the staged rollout and "not yourself").
--                              A recipient who cannot see the post is skipped.
--   mention_groups_me()        what the app may offer the signed-in member, and
--                              how many are left today.
--   Switches (feature_access, Admin → Features):
--     mention_groups           off | selected | everyone   (created OFF)
--     mention_all_blocked      "selected" list = members who lose @all without
--                              losing the badge                  (created OFF)
--   Member switches: notification_preferences.inapp_mentions_everyone,
--     push_mentions_everyone (default on).
--   Reserved names: nobody can take all / followers / everyone as a handle.
--   Bell wording: notif_action_phrase gains mention_all / mention_followers
--     (twin of src/lib/notifications/describe.ts — pushCatalogParity).
--
-- NOT RE-RUNNABLE (PRE-002). Saving a post or a comment can never fail because
-- of this file: both triggers swallow every error into a WARNING.
-- Rollback: supabase/rollback/20261113_0100_mention_groups_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261113_0100_mention_groups.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE _def text;
BEGIN
  -- PRE-001 · what this file builds on (measured on staging 2026-11-12, PROBE 0090).
  IF to_regclass('public.posts') IS NULL OR to_regclass('public.post_comments') IS NULL
     OR to_regclass('public.follows') IS NULL OR to_regclass('public.user_badges') IS NULL
     OR to_regclass('public.profiles') IS NULL OR to_regclass('public.notification_types') IS NULL
     OR to_regclass('public.notification_preferences') IS NULL
     OR to_regclass('public.feature_access') IS NULL OR to_regclass('public.feature_access_audit') IS NULL
     OR to_regprocedure('public.has_role(uuid,text)') IS NULL
     OR to_regprocedure('public.feature_allowed(text,uuid)') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.notification_centre_emit(text,uuid,uuid,uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.notif_action_phrase(text)') IS NULL
     OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'MG-0100-PRE-001: a table or function this file builds on is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.mention_group_jobs') IS NOT NULL
     OR to_regprocedure('public.is_verified_member(uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.notification_types WHERE type IN ('mention_all', 'mention_followers'))
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mention-groups-tick') THEN
    RAISE EXCEPTION 'MG-0100-PRE-002: already applied — roll back first';
  END IF;
  -- PRE-003 · the wording function is the body this file rewrites (story_comment is its last line).
  _def := pg_get_functiondef('public.notif_action_phrase(text)'::regprocedure);
  IF position('story_comment' IN _def) = 0 OR position('mention_all' IN _def) > 0 THEN
    RAISE EXCEPTION 'MG-0100-PRE-003: notif_action_phrase is not the expected body';
  END IF;
  -- PRE-004 · nobody already holds a reserved handle.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE lower(coalesce(p.custom_url, '')) IN ('all', 'followers', 'everyone')) THEN
    RAISE EXCEPTION 'MG-0100-PRE-004: a member already uses all / followers / everyone as a handle — rename it first';
  END IF;
  -- PRE-005 · never take over a switch somebody already made.
  IF EXISTS (SELECT 1 FROM public.feature_access WHERE feature IN ('mention_groups', 'mention_all_blocked')) THEN
    RAISE EXCEPTION 'MG-0100-PRE-005: the mention switches already exist';
  END IF;
END
$pre$;

-- ── 1. THE one "verified" rule ─────────────────────────────────────────────
CREATE FUNCTION public.is_verified_member(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT _user IS NOT NULL
     AND (EXISTS (SELECT 1 FROM public.user_badges b WHERE b.user_id = _user AND b.badge_type = 'verified')
          OR public.has_role(_user, 'admin'::text));
$fn$;
REVOKE ALL ON FUNCTION public.is_verified_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_verified_member(uuid) TO service_role;

-- ── 2. the switches, OFF ───────────────────────────────────────────────────
LOCK TABLE public.feature_access IN ACCESS EXCLUSIVE MODE;

DO $switch$
DECLARE _def text; _keys text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.feature_access'::regclass AND c.conname = 'feature_access_feature_check';
  IF _def IS NULL OR _def !~ '^CHECK \(\(feature = ANY \(ARRAY\[''[a-z0-9_]+''::text(, ''[a-z0-9_]+''::text)*\]\)\)\)$' THEN
    RAISE EXCEPTION 'MG-0100-PRE-006: feature_access_feature_check is not a plain key list (read: %)', coalesce(_def, '<none>');
  END IF;
  SELECT array_agg(t.m[1] ORDER BY t.i) INTO _keys
    FROM regexp_matches(_def, '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS t(m, i);
  EXECUTE format(
    'ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check, '
    'ADD CONSTRAINT feature_access_feature_check CHECK (feature IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY i)
       FROM unnest(_keys || ARRAY['mention_groups', 'mention_all_blocked']) WITH ORDINALITY AS u(k, i)));
END
$switch$;

WITH ins AS (
  INSERT INTO public.feature_access (feature, mode) VALUES ('mention_groups', 'off'), ('mention_all_blocked', 'off')
  RETURNING feature
)
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, ins.feature, 'mode', NULL, 'off', '20261113_0100: switch created, Off (@all / @followers)'
  FROM ins;

-- ── 3. reserved handles ────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_custom_url_not_group_tag
  CHECK (custom_url IS NULL OR lower(custom_url) NOT IN ('all', 'followers', 'everyone'));

-- ── 4. the member's switches ───────────────────────────────────────────────
ALTER TABLE public.notification_preferences
  ADD COLUMN inapp_mentions_everyone boolean NOT NULL DEFAULT true,
  ADD COLUMN push_mentions_everyone  boolean NOT NULL DEFAULT true;

-- ── 5. the two notification types (through the centre only) ────────────────
INSERT INTO public.notification_types
  (type, audience, group_key, wording_key, icon, channels, member_can_disable,
   pref_in_app, pref_push, pref_email, group_by, dedup_window, rate_per_hour)
VALUES
  ('mention_all', 'member', 'follows_friends', 'notif.type.mention_all', 'megaphone', ARRAY['in_app', 'push'], true,
   'inapp_mentions_everyone', 'push_mentions_everyone', NULL, 'none', interval '0', NULL),
  ('mention_followers', 'member', 'follows_friends', 'notif.type.mention_followers', 'megaphone', ARRAY['in_app', 'push'], true,
   'inapp_mentions_everyone', 'push_mentions_everyone', NULL, 'none', interval '0', NULL);

-- Bell + push wording. Body = the live body (PROBE 0090, 2026-11-12) + two lines.
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
           WHEN 'story_comment'           THEN 'commented on your story.'
           WHEN 'mention_all'             THEN 'mentioned everyone.'
           WHEN 'mention_followers'       THEN 'mentioned their followers.'
           ELSE NULL
         END;
$fn$;
GRANT EXECUTE ON FUNCTION public.notif_action_phrase(text) TO anon, authenticated, service_role;   -- wording only, as before

-- ── 6. the jobs ────────────────────────────────────────────────────────────
CREATE TABLE public.mention_group_jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text        NOT NULL CHECK (kind IN ('all', 'followers')),
  post_id       uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  comment_id    uuid        REFERENCES public.post_comments(id) ON DELETE CASCADE,
  actor_id      uuid        NOT NULL,
  status        text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'done', 'cancelled')),
  cancel_reason text,
  cursor_id     uuid,                       -- last recipient handled
  asked         integer     NOT NULL DEFAULT 0,
  sent          integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
-- once per post / per comment, per tag — for ever (rule 5 of the plan)
-- P28: mention_group_jobs (0 rows at launch) · UNIQUE is the rule itself: one job per post per tag; reviewed by D1 2026-11-13.
CREATE UNIQUE INDEX mention_group_jobs_post_once    ON public.mention_group_jobs (post_id, kind)    WHERE comment_id IS NULL;
-- P28: mention_group_jobs · UNIQUE is the rule itself: one job per comment per tag; reviewed by D1 2026-11-13.
CREATE UNIQUE INDEX mention_group_jobs_comment_once ON public.mention_group_jobs (comment_id, kind) WHERE comment_id IS NOT NULL;
-- the daily count per writer, and the worker's "what is open" read
-- P28: mention_group_jobs · the daily-limit count (actor, tag, today) runs on every tagged save; reviewed by D1 2026-11-13.
CREATE INDEX mention_group_jobs_actor_day ON public.mention_group_jobs (actor_id, kind, created_at);
-- P28: mention_group_jobs · the every-minute sender reads only open jobs (partial, stays tiny); reviewed by D1 2026-11-13.
CREATE INDEX mention_group_jobs_open      ON public.mention_group_jobs (created_at) WHERE status IN ('queued', 'sending');
ALTER TABLE public.mention_group_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mention_group_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mention_group_jobs TO service_role;

-- start of "today" for the daily limit: the Owner's day (India)
CREATE FUNCTION public.mention_groups_day_start()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$ SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'; $fn$;
REVOKE ALL ON FUNCTION public.mention_groups_day_start() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mention_groups_day_start() TO service_role;

-- may this member use this tag on this post right now? NULL = yes, else the reason.
-- ONE function: the gate at save time AND the re-check when sending starts.
CREATE FUNCTION public.mention_group_refusal(_kind text, _post_id uuid, _comment_id uuid, _actor uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _owner   uuid;
  _privacy text;
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('all', 'followers') OR _actor IS NULL OR _post_id IS NULL THEN
    RETURN 'bad_request';
  END IF;
  IF NOT public.feature_allowed('mention_groups', _actor) THEN
    RETURN 'feature_off';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _actor
                  AND coalesce(p.is_suspended, false) = false AND coalesce(p.is_banned, false) = false) THEN
    RETURN 'account_not_live';
  END IF;
  SELECT po.user_id, po.privacy INTO _owner, _privacy FROM public.posts po WHERE po.id = _post_id;
  IF _owner IS NULL THEN
    RETURN 'post_missing';
  END IF;
  IF _kind = 'all' THEN
    IF NOT public.is_verified_member(_actor) THEN
      RETURN 'not_verified';
    END IF;
    IF public.feature_allowed('mention_all_blocked', _actor) THEN
      RETURN 'all_taken_away';
    END IF;
    IF _privacy IS DISTINCT FROM 'public' THEN
      RETURN 'post_not_public';
    END IF;
    IF _comment_id IS NOT NULL AND _owner <> _actor THEN
      RETURN 'not_own_post';
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.mention_group_refusal(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mention_group_refusal(text, uuid, uuid, uuid) TO service_role;

-- how many a member may use per day
CREATE FUNCTION public.mention_group_daily_limit(_kind text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$ SELECT CASE _kind WHEN 'all' THEN 1 WHEN 'followers' THEN 3 ELSE 0 END; $fn$;
REVOKE ALL ON FUNCTION public.mention_group_daily_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mention_group_daily_limit(text) TO service_role;

-- the gate. Returns 'queued' or the reason nothing was queued.
CREATE FUNCTION public.mention_group_enqueue(_kind text, _post_id uuid, _comment_id uuid, _actor uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _why text;
  _id  uuid;
BEGIN
  _why := public.mention_group_refusal(_kind, _post_id, _comment_id, _actor);
  IF _why IS NOT NULL THEN
    RETURN _why;
  END IF;
  -- two saves by the same member at once must not both pass the daily count
  PERFORM pg_advisory_xact_lock(hashtextextended('mention_group:' || _actor::text || ':' || _kind, 0));
  IF (SELECT count(*) FROM public.mention_group_jobs j
       WHERE j.actor_id = _actor AND j.kind = _kind
         AND j.created_at >= public.mention_groups_day_start()
         AND (j.status <> 'cancelled' OR j.started_at IS NOT NULL)) >= public.mention_group_daily_limit(_kind) THEN
    RETURN 'daily_limit';
  END IF;
  INSERT INTO public.mention_group_jobs (kind, post_id, comment_id, actor_id)
  VALUES (_kind, _post_id, _comment_id, _actor)
  ON CONFLICT DO NOTHING
  RETURNING id INTO _id;
  RETURN CASE WHEN _id IS NULL THEN 'already_sent' ELSE 'queued' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.mention_group_enqueue(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mention_group_enqueue(text, uuid, uuid, uuid) TO service_role;

-- ── 7. the triggers: FIRST save only (INSERT), never an edit ───────────────
CREATE FUNCTION public.tg_mention_groups_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  BEGIN
    IF NEW.content ~ '@\[[^\]]*\]\(all\)' THEN
      PERFORM public.mention_group_enqueue('all', NEW.id, NULL, NEW.user_id);
    END IF;
    IF NEW.content ~ '@\[[^\]]*\]\(followers\)' THEN
      PERFORM public.mention_group_enqueue('followers', NEW.id, NULL, NEW.user_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_mention_groups_post: post % not queued: %', NEW.id, SQLERRM;   -- a post is never lost to this
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_mention_groups_post() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.tg_mention_groups_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  BEGIN
    IF NEW.content ~ '@\[[^\]]*\]\(all\)' THEN
      PERFORM public.mention_group_enqueue('all', NEW.post_id, NEW.id, NEW.user_id);
    END IF;
    IF NEW.content ~ '@\[[^\]]*\]\(followers\)' THEN
      PERFORM public.mention_group_enqueue('followers', NEW.post_id, NEW.id, NEW.user_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_mention_groups_comment: comment % not queued: %', NEW.id, SQLERRM;   -- a comment is never lost to this
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_mention_groups_comment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_mention_groups_post
  AFTER INSERT ON public.posts
  FOR EACH ROW WHEN (NEW.content LIKE '%](all)%' OR NEW.content LIKE '%](followers)%')
  EXECUTE FUNCTION public.tg_mention_groups_post();

CREATE TRIGGER trg_mention_groups_comment
  AFTER INSERT ON public.post_comments
  FOR EACH ROW WHEN (NEW.content LIKE '%](all)%' OR NEW.content LIKE '%](followers)%')
  EXECUTE FUNCTION public.tg_mention_groups_comment();

-- ── 8. the sender ──────────────────────────────────────────────────────────
-- One job per call, up to _batch members: saving a post never waits for this,
-- and the centre's one-lock-per-member stays far below the limit that ran the
-- database out of shared memory at 20 000 in one call (see 20261104_0220).
CREATE FUNCTION public.mention_groups_tick(_batch integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  j        public.mention_group_jobs%ROWTYPE;
  _why     text;
  _owner   uuid;
  _privacy text;
  _name    text;
  _type    text;
  _r       uuid;
  _n       integer := 0;
  _sent    integer := 0;
  _last    uuid;
BEGIN
  _batch := least(greatest(coalesce(_batch, 1000), 1), 2000);

  SELECT * INTO j FROM public.mention_group_jobs q
   WHERE q.status IN ('queued', 'sending')
   ORDER BY q.created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('job', NULL);
  END IF;

  -- the right is checked AGAIN when sending starts (badge removed since → cancelled)
  IF j.status = 'queued' THEN
    _why := public.mention_group_refusal(j.kind, j.post_id, j.comment_id, j.actor_id);
    IF _why IS NOT NULL THEN
      UPDATE public.mention_group_jobs SET status = 'cancelled', cancel_reason = _why, finished_at = now() WHERE id = j.id;
      RETURN jsonb_build_object('job', j.id, 'cancelled', _why);
    END IF;
    UPDATE public.mention_group_jobs SET status = 'sending', started_at = now() WHERE id = j.id;
  END IF;

  SELECT po.user_id, po.privacy INTO _owner, _privacy FROM public.posts po WHERE po.id = j.post_id;
  SELECT coalesce(nullif(btrim(p.full_name), ''), 'Someone') INTO _name FROM public.profiles p WHERE p.id = j.actor_id;
  _type := CASE j.kind WHEN 'all' THEN 'mention_all' ELSE 'mention_followers' END;

  FOR _r IN
    SELECT x.id FROM (
      SELECT p.id FROM public.profiles p
       WHERE j.kind = 'all'
         AND (j.cursor_id IS NULL OR p.id > j.cursor_id)
         AND coalesce(p.is_suspended, false) = false AND coalesce(p.is_banned, false) = false
      UNION ALL
      SELECT f.follower_id FROM public.follows f
        JOIN public.profiles p ON p.id = f.follower_id
       WHERE j.kind = 'followers' AND f.following_id = j.actor_id
         AND (j.cursor_id IS NULL OR f.follower_id > j.cursor_id)
         AND coalesce(p.is_suspended, false) = false AND coalesce(p.is_banned, false) = false
    ) x
    ORDER BY x.id
    LIMIT _batch
  LOOP
    _n := _n + 1;
    _last := _r;
    -- never told: the writer, and anyone who cannot see the post
    IF _r <> j.actor_id AND public.can_view_post(_r, _owner, _privacy) THEN
      IF public.notification_centre_emit(
           _type, _r, j.actor_id, j.post_id, 'Mention',
           _name || ' ' || public.notif_action_phrase(_type),
           _type || ':' || j.id::text || ':' || _r::text) IS NOT NULL THEN
        _sent := _sent + 1;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.mention_group_jobs
     SET asked = asked + _n, sent = sent + _sent, cursor_id = coalesce(_last, cursor_id),
         status = CASE WHEN _n < _batch THEN 'done' ELSE 'sending' END,
         finished_at = CASE WHEN _n < _batch THEN now() ELSE NULL END
   WHERE id = j.id;

  RETURN jsonb_build_object('job', j.id, 'kind', j.kind, 'asked', _n, 'sent', _sent, 'done', _n < _batch);
END;
$fn$;
REVOKE ALL ON FUNCTION public.mention_groups_tick(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mention_groups_tick(integer) TO service_role;

-- ── 9. what the app may OFFER the signed-in member ─────────────────────────
CREATE FUNCTION public.mention_groups_me()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH me AS (SELECT (SELECT auth.uid()) AS uid),
       used AS (
         SELECT j.kind, count(*) AS n FROM public.mention_group_jobs j, me
          WHERE j.actor_id = me.uid AND j.created_at >= public.mention_groups_day_start()
            AND (j.status <> 'cancelled' OR j.started_at IS NOT NULL)
          GROUP BY j.kind)
  SELECT jsonb_build_object(
           'on', public.feature_allowed('mention_groups', me.uid),
           'can_all', public.feature_allowed('mention_groups', me.uid)
                      AND public.is_verified_member(me.uid)
                      AND NOT public.feature_allowed('mention_all_blocked', me.uid),
           'all_left', greatest(public.mention_group_daily_limit('all')
                                - coalesce((SELECT n FROM used WHERE kind = 'all'), 0), 0),
           'followers_left', greatest(public.mention_group_daily_limit('followers')
                                - coalesce((SELECT n FROM used WHERE kind = 'followers'), 0), 0))
    FROM me;
$fn$;
REVOKE ALL ON FUNCTION public.mention_groups_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mention_groups_me() TO authenticated;

-- ── 10. the clock ──────────────────────────────────────────────────────────
SELECT cron.schedule('mention-groups-tick', '* * * * *', $cron$SELECT public.mention_groups_tick();$cron$);

COMMIT;
