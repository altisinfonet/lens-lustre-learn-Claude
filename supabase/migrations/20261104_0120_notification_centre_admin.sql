-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0120 · NOTIFICATION CENTRE N6 — what Admin → Notification Centre
-- reads and writes. Admin only; every write is recorded (who, when, before,
-- after). Needs 20261104_0110.
--
-- WHAT IT ADDS
--   column   notification_types.wording_en   optional English wording that
--            replaces the app's built-in sentence for that type (N7 reads it).
--   table    public.notification_centre_changes   history: one row per change
--            to a type or a switch — who, when, which field, before, after.
--   function admin_notif_types()             every type + its numbers
--            (rows written 24 h / 7 d; centre sent / skipped 24 h / 7 d).
--   function admin_notif_type_update(type, patch)   change enabled, channels,
--            default, rate limit, duplicate window, icon, wording; history.
--   function admin_notif_history(key, limit)
--   function admin_notif_switches()          every centre switch + its value.
--   function admin_notif_switch_set(key, mode, users)
--            mode: off | me | members | everyone. THE OWNER'S BUTTONS (N8).
--            This file sets no switch.
--   function admin_notif_member_settings(user)   read-only support lookup:
--            the member's notification settings, quiet hours, block counts.
--   function notification_centre_send_test(type)   one bell row of that type
--            to the calling admin (member types) or the shared admin bell
--            (admin types), written directly and logged with reason 'test'
--            (left out of the numbers); allow-listed in the N5 guard. The
--            normal push / e-mail triggers fire on it like any row.
--
-- Rollback: supabase/rollback/20261104_0120_notification_centre_admin_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0120_notification_centre_admin.sql
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
  IF to_regclass('public.notification_types') IS NULL THEN
    RAISE EXCEPTION 'NC-0120-PRE-001: 20261104_0110 is not applied on this lane';
  END IF;
  IF to_regclass('public.notification_centre_changes') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname IN ('admin_notif_types', 'admin_notif_type_update', 'admin_notif_history',
                                 'admin_notif_switches', 'admin_notif_switch_set',
                                 'admin_notif_member_settings', 'notification_centre_send_test')) THEN
    RAISE EXCEPTION 'NC-0120-PRE-002: already applied — roll back first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'has_role') THEN
    RAISE EXCEPTION 'NC-0120-PRE-003: public.has_role missing';
  END IF;
END
$pre$;

ALTER TABLE public.notification_types
  ADD COLUMN wording_en text CHECK (wording_en IS NULL OR length(wording_en) BETWEEN 1 AND 300);

CREATE TABLE public.notification_centre_changes (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  uuid,
  subject     text        NOT NULL,          -- a type, or a switch key (notif_centre_…)
  field       text        NOT NULL,
  old_value   jsonb,
  new_value   jsonb
);
-- P28: notification_centre_changes · 0 rows at launch (one row per admin edit) · the change-history panel reads one subject newest-first
CREATE INDEX notification_centre_changes_subject_idx ON public.notification_centre_changes (subject, changed_at DESC);
ALTER TABLE public.notification_centre_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_centre_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.notification_centre_changes TO service_role;

-- ── admin guard used by every function below ──────────────────────────────
CREATE FUNCTION public.notif_admin_or_raise()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN _uid;
END;
$fn$;

-- ── list with numbers ─────────────────────────────────────────────────────
CREATE FUNCTION public.admin_notif_types()
RETURNS TABLE (type text, audience text, group_key text, icon text, channels text[], default_on boolean,
               member_can_disable boolean, pref_in_app text, pref_push text, pref_email text,
               rate_per_hour integer, dedup_window interval, enabled boolean, wording_en text,
               updated_at timestamptz, rows_24h bigint, rows_7d bigint,
               centre_sent_24h bigint, centre_skipped_24h bigint, centre_sent_7d bigint, centre_skipped_7d bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.notif_admin_or_raise();
  RETURN QUERY
  WITH un AS (
    SELECT u.type, count(*) FILTER (WHERE u.created_at > now() - interval '1 day') AS d1, count(*) AS d7
      FROM public.user_notifications u WHERE u.created_at > now() - interval '7 days' GROUP BY u.type
    UNION ALL
    SELECT a.type, count(*) FILTER (WHERE a.created_at > now() - interval '1 day'), count(*)
      FROM public.admin_notifications a WHERE a.created_at > now() - interval '7 days' GROUP BY a.type
  ), lg AS (
    SELECT l.type,
           count(*) FILTER (WHERE l.sent AND l.created_at > now() - interval '1 day')     AS s1,
           count(*) FILTER (WHERE NOT l.sent AND l.created_at > now() - interval '1 day') AS k1,
           count(*) FILTER (WHERE l.sent)     AS s7,
           count(*) FILTER (WHERE NOT l.sent) AS k7
      FROM public.notification_centre_log l
     WHERE l.created_at > now() - interval '7 days' AND NOT ('test' = ANY (l.reasons))   -- admin tests are not traffic
     GROUP BY l.type
  )
  SELECT t.type, t.audience, t.group_key, t.icon, t.channels, t.default_on, t.member_can_disable,
         t.pref_in_app, t.pref_push, t.pref_email, t.rate_per_hour, t.dedup_window, t.enabled, t.wording_en,
         t.updated_at,
         coalesce((SELECT sum(un.d1) FROM un WHERE un.type = t.type), 0)::bigint,
         coalesce((SELECT sum(un.d7) FROM un WHERE un.type = t.type), 0)::bigint,
         coalesce(lg.s1, 0), coalesce(lg.k1, 0), coalesce(lg.s7, 0), coalesce(lg.k7, 0)
    FROM public.notification_types t
    LEFT JOIN lg ON lg.type = t.type
   ORDER BY t.group_key, t.type;
END;
$fn$;

-- ── edit one type (only the listed fields), with history ──────────────────
CREATE FUNCTION public.admin_notif_type_update(_type text, _patch jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _uid uuid := public.notif_admin_or_raise();
  old  jsonb;
  k    text;
  allowed constant text[] := ARRAY['enabled', 'channels', 'default_on', 'rate_per_hour', 'dedup_window', 'icon', 'wording_en'];
BEGIN
  IF jsonb_typeof(_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'patch must be an object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF NOT k = ANY (allowed) THEN
      RAISE EXCEPTION 'field % cannot be changed here', k USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;
  SELECT to_jsonb(t) INTO old FROM public.notification_types t WHERE t.type = _type FOR UPDATE;
  IF old IS NULL THEN RAISE EXCEPTION 'unknown type %', _type USING ERRCODE = 'no_data_found'; END IF;

  UPDATE public.notification_types t SET
    enabled       = CASE WHEN _patch ? 'enabled'       THEN (_patch ->> 'enabled')::boolean ELSE t.enabled END,
    channels      = CASE WHEN _patch ? 'channels'      THEN ARRAY(SELECT jsonb_array_elements_text(_patch -> 'channels')) ELSE t.channels END,
    default_on    = CASE WHEN _patch ? 'default_on'    THEN (_patch ->> 'default_on')::boolean ELSE t.default_on END,
    rate_per_hour = CASE WHEN _patch ? 'rate_per_hour' THEN nullif(_patch ->> 'rate_per_hour', '')::integer ELSE t.rate_per_hour END,
    dedup_window  = CASE WHEN _patch ? 'dedup_window'  THEN (_patch ->> 'dedup_window')::interval ELSE t.dedup_window END,
    icon          = CASE WHEN _patch ? 'icon'          THEN _patch ->> 'icon' ELSE t.icon END,
    wording_en    = CASE WHEN _patch ? 'wording_en'    THEN nullif(btrim(_patch ->> 'wording_en'), '') ELSE t.wording_en END,
    updated_at    = now(),
    updated_by    = _uid
   WHERE t.type = _type;

  INSERT INTO public.notification_centre_changes (changed_by, subject, field, old_value, new_value)
  SELECT _uid, _type, f, old -> f, (SELECT to_jsonb(t) -> f FROM public.notification_types t WHERE t.type = _type)
    FROM jsonb_object_keys(_patch) f
   WHERE (old -> f) IS DISTINCT FROM (SELECT to_jsonb(t) -> f FROM public.notification_types t WHERE t.type = _type);
END;
$fn$;

CREATE FUNCTION public.admin_notif_history(_subject text DEFAULT NULL, _limit integer DEFAULT 50)
RETURNS TABLE (changed_at timestamptz, changed_by uuid, changed_by_name text, subject text, field text,
               old_value jsonb, new_value jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.notif_admin_or_raise();
  RETURN QUERY
  SELECT c.changed_at, c.changed_by, coalesce(p.full_name, p.custom_url, '')::text, c.subject, c.field, c.old_value, c.new_value
    FROM public.notification_centre_changes c
    LEFT JOIN public.profiles p ON p.id = c.changed_by
   WHERE _subject IS NULL OR c.subject = _subject
   ORDER BY c.changed_at DESC
   LIMIT LEAST(GREATEST(coalesce(_limit, 50), 1), 500);
END;
$fn$;

-- ── the switches (N8: the Owner's buttons) ────────────────────────────────
CREATE FUNCTION public.admin_notif_switches()
RETURNS TABLE (key text, label text, mode text, members integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.notif_admin_or_raise();
  RETURN QUERY
  WITH k(key, label, ord) AS (VALUES
    ('notif_centre_ui',                   'New notification screens', 0),
    ('notif_centre_likes_comments',       'Likes and comments', 1),
    ('notif_centre_follows_friends',      'Follows and friends', 2),
    ('notif_centre_competitions',         'Competitions and judging', 3),
    ('notif_centre_announcements',        'Announcements', 4),
    ('notif_centre_account',              'Account', 5),
    ('notif_centre_wallet_support_roles', 'Wallet, support and roles', 6),
    ('notif_centre_admin_alerts',         'Admin alerts', 7))
  SELECT k.key, k.label,
         CASE WHEN s.value IS NULL THEN 'off'
              WHEN s.value = to_jsonb('live'::text) AND k.key <> 'notif_centre_ui' THEN 'everyone'
              WHEN s.value = to_jsonb('on'::text)   AND k.key =  'notif_centre_ui' THEN 'everyone'
              WHEN jsonb_typeof(s.value) = 'object' THEN 'members'
              ELSE 'off' END,
         CASE WHEN jsonb_typeof(s.value -> 'users') = 'array' THEN jsonb_array_length(s.value -> 'users') ELSE 0 END
    FROM k LEFT JOIN public.site_settings s ON s.key = k.key
   ORDER BY k.ord;
END;
$fn$;

CREATE FUNCTION public.admin_notif_switch_set(_key text, _mode text, _users uuid[] DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _uid uuid := public.notif_admin_or_raise();
  old  jsonb;
  val  jsonb;
BEGIN
  IF _key NOT IN ('notif_centre_ui', 'notif_centre_likes_comments', 'notif_centre_follows_friends',
                  'notif_centre_competitions', 'notif_centre_announcements', 'notif_centre_account',
                  'notif_centre_wallet_support_roles', 'notif_centre_admin_alerts') THEN
    RAISE EXCEPTION 'unknown switch %', _key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _key = 'notif_centre_admin_alerts' AND _mode IN ('me', 'members') THEN
    RAISE EXCEPTION 'admin alerts are shared by every admin: only off or everyone' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT s.value INTO old FROM public.site_settings s WHERE s.key = _key;
  val := CASE _mode
           WHEN 'off'      THEN NULL
           WHEN 'me'       THEN jsonb_build_object('users', jsonb_build_array(_uid::text))
           WHEN 'members'  THEN jsonb_build_object('users',
                                 (SELECT coalesce(jsonb_agg(DISTINCT u::text), '[]'::jsonb) FROM unnest(_users) u))
           WHEN 'everyone' THEN to_jsonb(CASE WHEN _key = 'notif_centre_ui' THEN 'on' ELSE 'live' END)
         END;
  IF _mode IS NULL OR _mode NOT IN ('off', 'me', 'members', 'everyone') THEN
    RAISE EXCEPTION 'mode must be off, me, members or everyone' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _mode = 'members' AND (val -> 'users') = '[]'::jsonb THEN
    RAISE EXCEPTION 'choose at least one member' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF val IS NULL THEN
    DELETE FROM public.site_settings s WHERE s.key = _key;
  ELSE
    INSERT INTO public.site_settings (key, value) VALUES (_key, val)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF old IS DISTINCT FROM val THEN
    INSERT INTO public.notification_centre_changes (changed_by, subject, field, old_value, new_value)
    VALUES (_uid, _key, 'switch', old, val);
  END IF;
  RETURN _mode;
END;
$fn$;

-- ── read-only support lookup ──────────────────────────────────────────────
CREATE FUNCTION public.admin_notif_member_settings(_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE prefs jsonb; qh jsonb;
BEGIN
  PERFORM public.notif_admin_or_raise();
  SELECT to_jsonb(np) - 'id' - 'user_id' INTO prefs FROM public.notification_preferences np WHERE np.user_id = _user;
  SELECT jsonb_build_object('starts', q.starts, 'ends', q.ends, 'tz', q.tz) INTO qh
    FROM public.notification_quiet_hours q WHERE q.user_id = _user;
  RETURN jsonb_build_object(
    'has_settings_row', prefs IS NOT NULL,
    'settings', coalesce(prefs, '{}'::jsonb),
    'quiet_hours', qh,
    'blocks_made', (SELECT count(*) FROM public.user_blocks b WHERE b.blocker_id = _user),
    'blocked_by',  (SELECT count(*) FROM public.user_blocks b WHERE b.blocked_id = _user),
    'notifications_7d', (SELECT count(*) FROM public.user_notifications u
                          WHERE u.user_id = _user AND u.created_at > now() - interval '7 days'));
END;
$fn$;

-- ── send a test to me (the centre's write path; ignores the switch) ───────
CREATE FUNCTION public.notification_centre_send_test(_type text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _uid uuid := public.notif_admin_or_raise();
  t    public.notification_types%ROWTYPE;
  nid  uuid;
BEGIN
  SELECT * INTO t FROM public.notification_types nt WHERE nt.type = _type;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown type %', _type USING ERRCODE = 'no_data_found'; END IF;
  -- one test per type per minute (per admin for member types; for admin types
  -- across all admins, since every admin sees the shared alert); serialised so
  -- two quick clicks cannot both pass
  PERFORM pg_advisory_xact_lock(hashtextextended('notif-test:' || _type || ':' ||
            CASE WHEN t.audience = 'admin' THEN 'all' ELSE _uid::text END, 0));
  IF EXISTS (SELECT 1 FROM public.notification_centre_log l
              WHERE l.type = _type AND 'test' = ANY (l.reasons)
                AND (t.audience = 'admin' OR l.recipient_id = _uid)
                AND l.created_at > now() - interval '1 minute') THEN
    RAISE EXCEPTION 'a test of this type was sent less than a minute ago' USING ERRCODE = 'check_violation';
  END IF;
  IF t.audience = 'member' THEN
    INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, email_sent)
    VALUES (_uid, NULL, _type, 'Test: ' || _type, coalesce(t.wording_en, 'This is a test notification.'), true)
    RETURNING id INTO nid;
  ELSE
    INSERT INTO public.admin_notifications (type, title, message)
    VALUES (_type, 'Test: ' || _type, coalesce(t.wording_en, 'This is a test notification.'))
    RETURNING id INTO nid;
  END IF;
  INSERT INTO public.notification_centre_log (type, recipient_id, sent, reasons, channels, notification_id)
  VALUES (_type, _uid, true, ARRAY['test'], jsonb_build_object('in_app', true), nid);
  RETURN nid;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notif_admin_or_raise() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_notif_types() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_notif_type_update(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_notif_history(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_notif_switches() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_notif_switch_set(text, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_notif_member_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_centre_send_test(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notif_admin_or_raise() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_notif_types() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_notif_type_update(text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_notif_history(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_notif_switches() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_notif_switch_set(text, text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_notif_member_settings(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_centre_send_test(text) TO authenticated, service_role;

COMMIT;
