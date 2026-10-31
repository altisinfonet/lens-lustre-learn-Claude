-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0110 · NOTIFICATION CENTRE N2 — one type registry + one centre
-- function, every switch OFF. Changes nothing a member sees.
--
-- Owner, 2026-10-31: "notifications: approve" (N0–N8).
--
-- WHAT IT ADDS
--   table    public.notification_types        the registry: per type its
--            audience, group, wording key, icon, channels, default, whether a
--            member may turn it off, the notification_preferences column per
--            channel, grouping, duplicate window, rate limit, on/off.
--   table    public.notification_quiet_hours  per-member push quiet hours
--            (empty until N7's settings screen; read by the decision only).
--   table    public.notification_centre_log   one row per centre decision,
--            written ONLY by notification_centre_emit while a group is live.
--   function public.notification_centre_live(group)  the switch, per group:
--            site_settings key notif_centre_<group> = "live". No row = OFF.
--            THIS FILE INSERTS NO SWITCH ROW. Switching on is the Owner's.
--   function public.notification_centre_decide(type, recipient, actor,
--            reference, at, exclude_id) → {send, reasons[], channels{}}.
--            STABLE, writes nothing. Order: type registered and on → self →
--            blocked (either way) → duplicate in window → rate per hour →
--            member settings per channel (push master switch covers every
--            push) → quiet hours (holds push only).
--   function public.notification_centre_emit(...)  write once + log. While
--            the type's group is not live it returns NULL and writes NOTHING,
--            so today's makers stay the only writers. N3 moves each group.
--   function public.notification_centre_replay(since, until)  READ ONLY: the
--            centre's decision for every row today's makers wrote in a window,
--            per type — the N2 shadow, run by PROBE on each lane.
--
-- Nothing calls emit yet; no trigger is added; no existing object changes.
-- Server-only: RLS on with no policy; no grant to anon/authenticated.
--
-- Rollback: supabase/rollback/20261104_0110_notification_centre_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0110_notification_centre.sql
-- Shadow:   supabase/migrations/PROBE_20261104_0111_notification_shadow.sql
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
BEGIN
  -- PRE-001 · not applied before
  IF to_regclass('public.notification_types') IS NOT NULL
     OR to_regclass('public.notification_quiet_hours') IS NOT NULL
     OR to_regclass('public.notification_centre_log') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname LIKE 'notification\_centre\_%') THEN
    RAISE EXCEPTION 'NC-0110-PRE-001: already applied (a table or function exists) — roll back first';
  END IF;
  -- PRE-002 · everything this file reads, with the columns it reads
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND
        ((table_name = 'site_settings'            AND column_name IN ('key', 'value')) OR
         (table_name = 'user_notifications'       AND column_name IN ('id', 'user_id', 'actor_id', 'type', 'title', 'message',
                                                                       'reference_id', 'dedup_key', 'email_sent', 'created_at')) OR
         (table_name = 'admin_notifications'      AND column_name IN ('id', 'type', 'title', 'message', 'reference_id', 'created_at')) OR
         (table_name = 'notification_preferences' AND column_name IN ('user_id', 'push_enabled')) OR
         (table_name = 'user_blocks'              AND column_name IN ('blocker_id', 'blocked_id')))) <> 22 THEN
    RAISE EXCEPTION 'NC-0110-PRE-002: a table or column this file reads is missing';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'NC-0110-PRE-003: auth.users missing';
  END IF;
END
$pre$;


-- ── 1. the type registry ───────────────────────────────────────────────────
CREATE TABLE public.notification_types (
  type               text        PRIMARY KEY CHECK (type ~ '^[a-z][a-z0-9_]{0,59}$'),
  audience           text        NOT NULL CHECK (audience IN ('member', 'admin')),
  group_key          text        NOT NULL CHECK (group_key IN
                       ('likes_comments', 'follows_friends', 'competitions', 'wallet_support_roles',
                        'admin_alerts', 'announcements', 'account')),
  wording_key        text        NOT NULL,
  icon               text        NOT NULL DEFAULT 'bell',
  channels           text[]      NOT NULL DEFAULT ARRAY['in_app']
                       CHECK (channels <@ ARRAY['in_app', 'push', 'email'] AND cardinality(channels) > 0),
  default_on         boolean     NOT NULL DEFAULT true,
  member_can_disable boolean     NOT NULL DEFAULT true,
  pref_in_app        text        CHECK (pref_in_app ~ '^inapp_[a-z_]+$'),
  pref_push          text        CHECK (pref_push   ~ '^push_[a-z_]+$'),
  pref_email         text        CHECK (pref_email  ~ '^email_[a-z_]+$'),
  group_by           text        NOT NULL DEFAULT 'none' CHECK (group_by IN ('none', 'reference', 'actor')),
  dedup_window       interval    NOT NULL DEFAULT interval '60 seconds'
                       CHECK (dedup_window BETWEEN interval '0' AND interval '7 days'),
  rate_per_hour      integer     CHECK (rate_per_hour IS NULL OR rate_per_hour > 0),
  enabled            boolean     NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid
);
ALTER TABLE public.notification_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_types FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_types TO service_role;

-- ── 2. quiet hours (push only; filled from N7's settings screen) ───────────
CREATE TABLE public.notification_quiet_hours (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  starts     time        NOT NULL,
  ends       time        NOT NULL,
  tz         text        NOT NULL DEFAULT 'UTC',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_quiet_hours ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_quiet_hours FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_quiet_hours TO service_role;

-- ── 3. the log (written only by the centre when a group is live) ──────────
CREATE TABLE public.notification_centre_log (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  type            text        NOT NULL,
  recipient_id    uuid,
  actor_id        uuid,
  reference_id    uuid,
  sent            boolean     NOT NULL,
  reasons         text[]      NOT NULL DEFAULT '{}',
  channels        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notification_id uuid
);
CREATE INDEX notification_centre_log_created_idx ON public.notification_centre_log (created_at);
CREATE INDEX notification_centre_log_type_created_idx ON public.notification_centre_log (type, created_at);
ALTER TABLE public.notification_centre_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_centre_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.notification_centre_log TO service_role;

-- ── 4. the switch, per group: site_settings notif_centre_<group> = "live" ──
CREATE FUNCTION public.notification_centre_live(_group text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.site_settings s
                  WHERE s.key = 'notif_centre_' || _group AND s.value = to_jsonb('live'::text));
$fn$;

-- ── 5. the decision: type on? → self / blocked → duplicate → rate → member
--      settings per channel → quiet hours. Pure (STABLE); writes nothing. ──
CREATE FUNCTION public.notification_centre_decide(
  _type text, _recipient uuid, _actor uuid, _reference uuid,
  _at timestamptz DEFAULT now(), _exclude_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  t        public.notification_types%ROWTYPE;
  prefs    jsonb;
  reasons  text[] := '{}';
  ch_inapp boolean := false;
  ch_push  boolean := false;
  ch_email boolean := false;
  qh       public.notification_quiet_hours%ROWTYPE;
  local_t  time;
BEGIN
  SELECT * INTO t FROM public.notification_types nt WHERE nt.type = _type;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('send', false, 'reasons', to_jsonb(ARRAY['type_unregistered']),
                              'channels', jsonb_build_object('in_app', false, 'push', false, 'email', false));
  END IF;

  IF NOT t.enabled THEN reasons := array_append(reasons, 'type_off'); END IF;

  IF t.audience = 'member' THEN
    IF _recipient IS NULL THEN reasons := array_append(reasons, 'no_recipient'); END IF;
    IF _actor IS NOT NULL AND _actor = _recipient THEN reasons := array_append(reasons, 'self'); END IF;
    IF _actor IS NOT NULL AND _recipient IS NOT NULL AND (
         EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = _recipient AND b.blocked_id = _actor)
      OR EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = _actor AND b.blocked_id = _recipient)) THEN
      reasons := array_append(reasons, 'blocked');
    END IF;
    IF t.dedup_window > interval '0' AND EXISTS (
         SELECT 1 FROM public.user_notifications un
          WHERE un.user_id = _recipient AND un.type = _type
            AND un.actor_id IS NOT DISTINCT FROM _actor
            AND un.reference_id IS NOT DISTINCT FROM _reference
            AND un.created_at >= _at - t.dedup_window AND un.created_at <= _at
            AND (_exclude_id IS NULL OR un.id <> _exclude_id)
            AND (_exclude_id IS NULL OR un.created_at < _at
                 OR un.id < _exclude_id)) THEN
      reasons := array_append(reasons, 'duplicate');
    END IF;
    IF t.rate_per_hour IS NOT NULL AND (
         SELECT count(*) FROM public.user_notifications un
          WHERE un.user_id = _recipient AND un.type = _type
            AND un.created_at >= _at - interval '1 hour' AND un.created_at < _at
            AND (_exclude_id IS NULL OR un.id <> _exclude_id)) >= t.rate_per_hour THEN
      reasons := array_append(reasons, 'rate_limited');
    END IF;

    SELECT to_jsonb(np) INTO prefs FROM public.notification_preferences np WHERE np.user_id = _recipient;
    prefs := coalesce(prefs, '{}'::jsonb);

    ch_inapp := 'in_app' = ANY (t.channels) AND t.default_on
                AND NOT (t.member_can_disable AND t.pref_in_app IS NOT NULL AND coalesce(prefs ->> t.pref_in_app = 'false', false));
    ch_push  := 'push' = ANY (t.channels) AND t.default_on
                AND NOT coalesce(prefs ->> 'push_enabled' = 'false', false)          -- master switch covers every push
                AND NOT (t.member_can_disable AND t.pref_push IS NOT NULL AND coalesce(prefs ->> t.pref_push = 'false', false));
    ch_email := 'email' = ANY (t.channels) AND t.default_on
                AND NOT (t.member_can_disable AND t.pref_email IS NOT NULL AND coalesce(prefs ->> t.pref_email = 'false', false));

    IF 'in_app' = ANY (t.channels) AND NOT ch_inapp THEN reasons := array_append(reasons, 'pref_in_app_off'); END IF;

    IF ch_push THEN
      SELECT * INTO qh FROM public.notification_quiet_hours q WHERE q.user_id = _recipient;
      IF FOUND THEN
        local_t := (_at AT TIME ZONE coalesce(nullif(qh.tz, ''), 'UTC'))::time;
        IF (qh.starts < qh.ends AND local_t >= qh.starts AND local_t < qh.ends)
           OR (qh.starts > qh.ends AND (local_t >= qh.starts OR local_t < qh.ends)) THEN
          ch_push := false;                                 -- held, not a reason to skip the bell row
        END IF;
      END IF;
    END IF;
  ELSE
    -- admin alerts: one bell for all admins; only type-off and duplicates apply
    ch_inapp := true;
    IF t.dedup_window > interval '0' AND EXISTS (
         SELECT 1 FROM public.admin_notifications an
          WHERE an.type = _type AND an.reference_id IS NOT DISTINCT FROM _reference
            AND an.created_at >= _at - t.dedup_window AND an.created_at <= _at
            AND (_exclude_id IS NULL OR an.id <> _exclude_id)
            AND (_exclude_id IS NULL OR an.created_at < _at OR an.id < _exclude_id)) THEN
      reasons := array_append(reasons, 'duplicate');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'send', cardinality(reasons) = 0,
    'reasons', to_jsonb(reasons),
    'channels', jsonb_build_object('in_app', ch_inapp AND cardinality(reasons) = 0,
                                   'push',   ch_push   AND cardinality(reasons) = 0,
                                   'email',  ch_email  AND cardinality(reasons) = 0));
END;
$fn$;

-- ── 6. write once + log. While the type's group switch is not "live" this
--      returns NULL and writes nothing: today's makers keep writing. N3 moves
--      each group's makers onto this call. ─────────────────────────────────
CREATE FUNCTION public.notification_centre_emit(
  _type text, _recipient uuid, _actor uuid, _reference uuid,
  _title text, _message text, _dedup_key text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  t   public.notification_types%ROWTYPE;
  d   jsonb;
  nid uuid;
BEGIN
  SELECT * INTO t FROM public.notification_types nt WHERE nt.type = _type;
  IF NOT FOUND OR NOT public.notification_centre_live(t.group_key) THEN
    RETURN NULL;
  END IF;

  d := public.notification_centre_decide(_type, _recipient, _actor, _reference, now(), NULL);

  IF (d ->> 'send')::boolean THEN
    IF t.audience = 'member' THEN
      INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id, dedup_key, email_sent)
      VALUES (_recipient, _actor, _type, _title, _message, _reference, _dedup_key,
              NOT coalesce((d -> 'channels' ->> 'email')::boolean, false))
      RETURNING id INTO nid;
    ELSE
      INSERT INTO public.admin_notifications (type, title, message, reference_id)
      VALUES (_type, _title, _message, _reference)
      RETURNING id INTO nid;
    END IF;
  END IF;

  INSERT INTO public.notification_centre_log (type, recipient_id, actor_id, reference_id, sent, reasons, channels, notification_id)
  VALUES (_type, _recipient, _actor, _reference, (d ->> 'send')::boolean,
          ARRAY(SELECT jsonb_array_elements_text(d -> 'reasons')), d -> 'channels', nid);
  RETURN nid;
END;
$fn$;

-- ── 7. the shadow: replay the centre's decision over rows today's makers
--      really wrote in a window, and compare. READ ONLY (STABLE); used by the
--      N2 shadow PROBE. Member settings and blocks are read as they are NOW,
--      not as they were when each row was written (stated in the PROBE). ────
CREATE FUNCTION public.notification_centre_replay(_since timestamptz, _until timestamptz)
RETURNS TABLE (audience text, type text, today_rows bigint, centre_send bigint, centre_skip bigint,
               reasons jsonb, push_would bigint, email_would bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH d AS (
    SELECT 'member'::text AS audience, un.type,
           public.notification_centre_decide(un.type, un.user_id, un.actor_id, un.reference_id, un.created_at, un.id) AS r
      FROM public.user_notifications un
     WHERE un.created_at >= _since AND un.created_at < _until
    UNION ALL
    SELECT 'admin', an.type,
           public.notification_centre_decide(an.type, NULL, NULL, an.reference_id, an.created_at, an.id)
      FROM public.admin_notifications an
     WHERE an.created_at >= _since AND an.created_at < _until
  ), x AS (
    SELECT audience, type, r, reason
      FROM d LEFT JOIN LATERAL jsonb_array_elements_text(r -> 'reasons') reason ON true
  )
  SELECT d.audience, d.type,
         count(*),
         count(*) FILTER (WHERE (d.r ->> 'send')::boolean),
         count(*) FILTER (WHERE NOT (d.r ->> 'send')::boolean),
         coalesce((SELECT jsonb_object_agg(reason, n) FROM (
                     SELECT x.reason, count(*) AS n FROM x
                      WHERE x.audience = d.audience AND x.type = d.type AND x.reason IS NOT NULL
                      GROUP BY x.reason) q), '{}'::jsonb),
         count(*) FILTER (WHERE (d.r -> 'channels' ->> 'push')::boolean),
         count(*) FILTER (WHERE (d.r -> 'channels' ->> 'email')::boolean)
    FROM d
   GROUP BY d.audience, d.type
   ORDER BY 1, 2;
$fn$;

REVOKE ALL ON FUNCTION public.notification_centre_live(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_centre_decide(text, uuid, uuid, uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_centre_replay(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_centre_live(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_centre_decide(text, uuid, uuid, uuid, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_centre_replay(timestamptz, timestamptz) TO service_role;

-- ── 8. the seed: every type today's makers write (git + live, N0) ─────────
-- Columns: type, audience, group, icon, channels, can_disable, in-app pref,
-- push pref, e-mail pref, group_by, dedup window, rate per hour.
-- The push prefs mirror push_on_notification() today; e-mail prefs mirror
-- get_notification_email_enabled(); NULL pref = governed by the push master
-- switch (push) or always on (in-app / e-mail) — exactly today's behaviour.
INSERT INTO public.notification_types
  (type, audience, group_key, wording_key, icon, channels, member_can_disable,
   pref_in_app, pref_push, pref_email, group_by, dedup_window, rate_per_hour)
SELECT v.type, v.audience, v.grp, 'notif.type.' || v.type, v.icon, v.channels::text[], v.can_off,
       v.p_in, v.p_push, v.p_email, v.grp_by, v.dedup::interval, v.rate
FROM (VALUES
  -- likes & comments
  ('post_reaction',          'member','likes_comments','heart',    '{in_app,push,email}', true, 'inapp_reactions','push_reactions','email_reactions','reference','60 seconds', NULL::int),
  ('image_reaction',         'member','likes_comments','heart',    '{in_app,push,email}', true, 'inapp_reactions','push_reactions','email_reactions','reference','60 seconds', NULL),
  ('tagged_post_reaction',   'member','likes_comments','heart',    '{in_app,push}',       true, 'inapp_reactions',NULL,            NULL,             'reference','60 seconds', NULL),
  ('post_comment',           'member','likes_comments','comment',  '{in_app,push,email}', true, 'inapp_comments', 'push_comments', 'email_comments', 'reference','60 seconds', NULL),
  ('image_comment',          'member','likes_comments','comment',  '{in_app,push,email}', true, 'inapp_comments', 'push_comments', 'email_comments', 'reference','60 seconds', NULL),
  ('comment_reply',          'member','likes_comments','reply',    '{in_app,push,email}', true, 'inapp_comments', 'push_comments', 'email_comments', 'reference','60 seconds', NULL),
  ('tagged_post_comment',    'member','likes_comments','comment',  '{in_app,push}',       true, 'inapp_comments', NULL,            NULL,             'reference','60 seconds', NULL),
  ('ad_comment_reply',       'member','likes_comments','reply',    '{in_app,push}',       true, 'inapp_comments', NULL,            NULL,             'reference','60 seconds', NULL),
  ('post_tag',               'member','likes_comments','tag',      '{in_app,push}',       true, 'inapp_social',   NULL,            NULL,             'none',     '60 seconds', NULL),
  ('new_post_from_following','member','likes_comments','image',    '{in_app,push}',       true, 'inapp_social',   NULL,            NULL,             'actor',    '60 seconds', NULL),
  -- follows & friends
  ('new_follower',           'member','follows_friends','user-plus','{in_app,push,email}',true, 'inapp_social','push_new_followers','email_new_followers','none','1 hour', NULL),
  ('friend_request',         'member','follows_friends','users',    '{in_app,push,email}',true, 'inapp_social','push_friend_requests','email_friend_requests','none','1 hour', NULL),
  ('friend_accepted',        'member','follows_friends','users',    '{in_app,push}',      true, 'inapp_social',NULL,              NULL,                  'none','1 hour', NULL),
  -- competitions & judging & awards
  ('competition_vote',       'member','competitions','star',  '{in_app,push,email}', true,  'inapp_competitions','push_competition_updates','email_competition_updates','reference','60 seconds', NULL),
  ('entry_approved',         'member','competitions','check', '{in_app,push,email}', false, NULL,'push_competition_updates','email_competition_updates','none','0 seconds', NULL),
  ('entry_rejected',         'member','competitions','x',     '{in_app,push,email}', false, NULL,'push_competition_updates','email_competition_updates','none','0 seconds', NULL),
  ('entry_shortlisted',      'member','competitions','star',  '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('entry_qualified',        'member','competitions','star',  '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('entry_qualified_round',  'member','competitions','star',  '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('entry_finalist',         'member','competitions','award', '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('entry_award',            'member','competitions','award', '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('competition_winner',     'member','competitions','trophy','{in_app,push,email}', false, NULL,'push_competition_updates','email_competition_updates','none','0 seconds', NULL),
  ('round_published',        'member','competitions','list',  '{in_app,push}',       false, NULL,NULL,NULL,'reference','0 seconds', NULL),
  ('round_results_published','member','competitions','list',  '{in_app,push}',       false, NULL,NULL,NULL,'reference','0 seconds', NULL),
  ('needs_review',           'member','competitions','alert', '{in_app,push,email}', false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('new_competition',        'member','announcements','trophy','{in_app,push}',      true,  'inapp_competitions','push_competition_updates',NULL,'none','0 seconds', NULL),
  ('badge_awarded',          'member','competitions','award', '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('certificate_issued',     'member','competitions','award', '{in_app,push,email}', true,  NULL,NULL,'email_certificates','none','0 seconds', NULL),
  ('potd_featured',          'member','competitions','star',  '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('featured_artist',        'member','competitions','star',  '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  -- announcements
  ('journal_published',      'member','announcements','book', '{in_app,push}',       true,  NULL,'push_announcements',NULL,'none','0 seconds', NULL),
  ('course_published',       'member','announcements','book', '{in_app,push,email}', true,  NULL,'push_announcements','email_course_updates','none','0 seconds', NULL),
  -- account
  ('birthday',               'member','account','cake',       '{in_app,push}',       false, NULL,NULL,NULL,'none','1 day', NULL),
  ('first_post_reminder',    'member','account','image',      '{in_app,push,email}', true,  NULL,NULL,'email_reengagement','none','1 day', NULL),
  ('video_taken_down',       'member','account','alert',      '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('verification_required',  'member','account','shield',     '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  -- wallet / support / roles
  ('ticket_reply',           'member','wallet_support_roles','life-buoy','{in_app,push,email}', false, NULL,NULL,NULL,'reference','0 seconds', NULL),
  ('role_approved',          'member','wallet_support_roles','shield',   '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('role_rejected',          'member','wallet_support_roles','shield',   '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('deposit_approved',       'member','wallet_support_roles','wallet',   '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('deposit_rejected',       'member','wallet_support_roles','wallet',   '{in_app,push}',       false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('admin_verification_pending',  'member','wallet_support_roles','shield','{in_app}',        false, NULL,NULL,NULL,'none','0 seconds', NULL),
  ('admin_verification_submitted','member','wallet_support_roles','shield','{in_app}',        false, NULL,NULL,NULL,'none','0 seconds', NULL),
  -- admin alerts (one shared bell for all admins)
  ('comment_report',         'admin','admin_alerts','flag',    '{in_app}', false, NULL,NULL,NULL,'none','60 seconds', NULL),
  ('post_report',            'admin','admin_alerts','flag',    '{in_app}', false, NULL,NULL,NULL,'none','60 seconds', NULL),
  ('role_application',       'admin','admin_alerts','shield',  '{in_app}', false, NULL,NULL,NULL,'none','60 seconds', NULL),
  ('new_ticket',             'admin','admin_alerts','life-buoy','{in_app}',false, NULL,NULL,NULL,'none','60 seconds', NULL),
  ('user_blocked',           'admin','admin_alerts','ban',     '{in_app}', false, NULL,NULL,NULL,'none','60 seconds', NULL),
  ('backup_reminder',        'admin','admin_alerts','database','{in_app}', false, NULL,NULL,NULL,'none','1 day', NULL)
) AS v(type, audience, grp, icon, channels, can_off, p_in, p_push, p_email, grp_by, dedup, rate);

COMMIT;
