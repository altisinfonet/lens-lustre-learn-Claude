-- ═══════════════════════════════════════════════════════════════════════════
-- VID-7 · 20261005_0004 — feature switches: Off / Selected members / All members
-- D1, T1. Lanes: staging and production. Plan: docs/evidence/d2/phase5/VID-1/
-- DECISION.md §8 (signed, #376) as amended by the Owner's R-102 and R-103.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE RULE (R-91 VID-7, R-102, R-103): every feature has three modes —
--   'off'       nobody (the default; the app behaves exactly as today);
--   'selected'  only the members on the feature's list;
--   'everyone'  all members.
-- Enforced on the SERVER by public.feature_allowed(feature, uid); the client
-- only reads it (feature_allowed_me) to show or hide a button. Changes take
-- effect at once in the database — no app release.
-- Features: video_posts, video_ads, copyright_music_check. (R-102/R-103 put
-- the music check in the same switch; DECISION.md §8's "never a copyright row"
-- is superseded by the Owner's later ruling.)
--
-- SAFETY RULES
--   * The member list is kept whatever the mode: switching everyone → selected
--     brings the saved list back; switching to off does not delete it.
--   * copyright_music_check cannot be set to 'selected' or 'everyone' while the
--     music-API key is not configured (vault secret 'music_check_api_key',
--     non-empty). Refused with FEATURE-003; nothing changes. Members may still
--     be added while it is off, so the list can be prepared.
--   * Every change writes one audit row (who, when, feature, old → new, member,
--     note) in the same transaction. The audit table is append-only (a trigger
--     refuses UPDATE and DELETE for every role).
--   * Nothing is written directly: the three tables have no API grant at all.
--     Admins act through SECURITY DEFINER RPCs that check has_role(admin).
--
-- OBJECTS (reservation): public.feature_access, public.feature_access_members,
-- public.feature_access_audit; public.feature_allowed(text,uuid),
-- public.feature_allowed_me(text), public.feature_set_mode(text,text,text),
-- public.feature_add_member(text,uuid,text), public.feature_remove_member(text,uuid,text),
-- public.feature_admin_state(), public.feature_member_search(text,int),
-- public.music_check_key_configured(); trigger fn public.tg_feature_audit_append_only().
-- NOT RE-RUNNABLE: PRE-002 refuses once feature_allowed() exists.
-- ROLLBACK: supabase/rollback/20261005_0004_vid7_feature_access_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_vid7_feature_access.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
BEGIN
  -- PRE-001 · what the switch reads.
  IF to_regclass('public.profiles') IS NULL OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'VID7-0004-PRE-001: profiles, has_role(uuid,app_role), vault or auth.users is missing' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · not applied already. (The rollback keeps the three tables — the
  -- list and the audit trail are records, never dropped blind — so a re-apply
  -- finds them and reuses them; the functions are what mark "applied".)
  IF to_regprocedure('public.feature_allowed(text,uuid)') IS NOT NULL
     OR to_regprocedure('public.feature_set_mode(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'VID7-0004-PRE-002: feature_allowed() already exists — 20261005_0004 is applied' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_access (
  feature     text PRIMARY KEY CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check')),
  mode        text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'selected', 'everyone')),
  note        text CHECK (note IS NULL OR char_length(note) <= 500),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.feature_access_members (
  feature   text NOT NULL REFERENCES public.feature_access(feature) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by  uuid,
  added_at  timestamptz NOT NULL DEFAULT now(),
  note      text CHECK (note IS NULL OR char_length(note) <= 500),
  PRIMARY KEY (feature, user_id)
);
-- P28: FK user_id → profiles ON DELETE CASCADE; without it every account deletion scans the list; reviewed by D1 2026-10-05.
CREATE INDEX IF NOT EXISTS idx_feature_access_members_user_id ON public.feature_access_members (user_id);
CREATE TABLE IF NOT EXISTS public.feature_access_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      uuid,
  feature    text NOT NULL,
  action     text NOT NULL CHECK (action IN ('mode', 'add', 'remove')),
  old_value  text,
  new_value  text,
  user_id    uuid,
  note       text
);
-- P28: the admin history reads one feature's newest changes; reviewed by D1 2026-10-05.
CREATE INDEX IF NOT EXISTS idx_feature_access_audit_feature_at ON public.feature_access_audit (feature, at DESC);

ALTER TABLE public.feature_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_access_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_access_audit ENABLE ROW LEVEL SECURITY;
-- No policy and no grant for the API roles: every read and write goes through the RPCs below.
REVOKE ALL ON public.feature_access, public.feature_access_members, public.feature_access_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.feature_access_audit_id_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.tg_feature_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  RAISE EXCEPTION 'feature_access_audit is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$fn$;
CREATE TRIGGER tg_feature_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.feature_access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_feature_audit_append_only();

-- Seeded OFF. On a re-apply after a rollback every mode is put back to 'off'
-- (the saved member lists stay), and that reset is audited.
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, feature, 'mode', mode, 'off', '20261005_0004 re-apply: reset to off'
  FROM public.feature_access WHERE mode <> 'off';
INSERT INTO public.feature_access (feature, mode) VALUES ('video_posts', 'off'), ('video_ads', 'off'), ('copyright_music_check', 'off')
ON CONFLICT (feature) DO UPDATE SET mode = 'off', updated_by = NULL, updated_at = now();

-- ── 2. the enforcement point ───────────────────────────────────────────────
CREATE FUNCTION public.feature_allowed(_feature text, _uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT CASE
           WHEN _uid IS NULL THEN false
           ELSE coalesce((SELECT CASE fa.mode
                                   WHEN 'everyone' THEN true
                                   WHEN 'selected' THEN EXISTS (SELECT 1 FROM public.feature_access_members m
                                                                 WHERE m.feature = fa.feature AND m.user_id = _uid)
                                   ELSE false END
                            FROM public.feature_access fa WHERE fa.feature = _feature), false)
         END;
$fn$;
-- Internal only: called by the upload/publish RPCs. Not callable through the
-- API, so no member can probe whether ANOTHER member is on a list.
REVOKE ALL ON FUNCTION public.feature_allowed(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.feature_allowed_me(_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$ SELECT public.feature_allowed(_feature, (SELECT auth.uid())); $fn$;
REVOKE ALL ON FUNCTION public.feature_allowed_me(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feature_allowed_me(text) TO authenticated;

-- The music-API key lives in vault only. True when it is present and non-empty.
CREATE FUNCTION public.music_check_key_configured()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                  WHERE name = 'music_check_api_key' AND length(btrim(coalesce(decrypted_secret, ''))) > 0);
$fn$;
REVOKE ALL ON FUNCTION public.music_check_key_configured() FROM PUBLIC, anon, authenticated;

-- ── 3. admin RPCs (each checks admin, each writes one audit row) ────────────
CREATE FUNCTION public.feature_set_mode(_feature text, _mode text, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _old text;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'FEATURE-001: only an admin can change a feature switch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _mode IS NULL OR _mode NOT IN ('off', 'selected', 'everyone') THEN
    RAISE EXCEPTION 'FEATURE-002: mode must be off, selected or everyone' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT mode INTO _old FROM public.feature_access WHERE feature = _feature FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FEATURE-002: unknown feature %', coalesce(_feature, '<null>') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _feature = 'copyright_music_check' AND _mode <> 'off' AND NOT public.music_check_key_configured() THEN
    RAISE EXCEPTION 'FEATURE-003: the copyright music check cannot be turned on — the music-API key is not configured'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _old = _mode THEN
    RETURN _mode;                                   -- no change, no audit row
  END IF;
  UPDATE public.feature_access SET mode = _mode, note = _note, updated_by = _uid, updated_at = now() WHERE feature = _feature;
  INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
  VALUES (_uid, _feature, 'mode', _old, _mode, _note);
  RETURN _mode;
END;
$fn$;

CREATE FUNCTION public.feature_add_member(_feature text, _user uuid, _note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'FEATURE-001: only an admin can change a feature switch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = _feature) THEN
    RAISE EXCEPTION 'FEATURE-002: unknown feature %', coalesce(_feature, '<null>') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user) THEN
    RAISE EXCEPTION 'FEATURE-004: no such member' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.feature_access_members (feature, user_id, added_by, note) VALUES (_feature, _user, _uid, _note)
  ON CONFLICT (feature, user_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;                                   -- already on the list, no audit row
  END IF;
  INSERT INTO public.feature_access_audit (actor, feature, action, new_value, user_id, note)
  VALUES (_uid, _feature, 'add', 'member', _user, _note);
  RETURN true;
END;
$fn$;

CREATE FUNCTION public.feature_remove_member(_feature text, _user uuid, _note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'FEATURE-001: only an admin can change a feature switch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.feature_access_members WHERE feature = _feature AND user_id = _user;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO public.feature_access_audit (actor, feature, action, old_value, user_id, note)
  VALUES (_uid, _feature, 'remove', 'member', _user, _note);
  RETURN true;
END;
$fn$;

-- The admin Features page: one card per feature, its members, its history.
CREATE FUNCTION public.feature_admin_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'FEATURE-001: only an admin can read the feature switches' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
             'feature', fa.feature, 'mode', fa.mode, 'note', fa.note, 'updated_at', fa.updated_at,
             'key_configured', CASE WHEN fa.feature = 'copyright_music_check' THEN public.music_check_key_configured() END,
             'members', coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'full_name', p.full_name,
                                                                      'username', p.custom_url, 'avatar_url', p.avatar_url,
                                                                      'added_at', m.added_at, 'note', m.note) ORDER BY m.added_at)
                                    FROM public.feature_access_members m JOIN public.profiles p ON p.id = m.user_id
                                   WHERE m.feature = fa.feature), '[]'::jsonb),
             'history', coalesce((SELECT jsonb_agg(h ORDER BY h->>'at' DESC) FROM (
                                    SELECT jsonb_build_object('at', a.at, 'actor', a.actor, 'action', a.action,
                                                              'old', a.old_value, 'new', a.new_value, 'user_id', a.user_id, 'note', a.note) AS h
                                      FROM public.feature_access_audit a WHERE a.feature = fa.feature
                                     ORDER BY a.at DESC LIMIT 50) x), '[]'::jsonb))
           ORDER BY fa.feature)
      FROM public.feature_access fa);
END;
$fn$;

-- "Selected members" search: name, @username (custom_url) or email. Admins only.
CREATE FUNCTION public.feature_member_search(_q text, _limit integer DEFAULT 20)
RETURNS TABLE (user_id uuid, full_name text, username text, avatar_url text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _t   text := lower(btrim(coalesce(_q, '')));
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'FEATURE-001: only an admin can search members here' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF char_length(_t) < 2 THEN
    RETURN;
  END IF;
  _t := ltrim(_t, '@');
  RETURN QUERY
    SELECT p.id, p.full_name, p.custom_url, p.avatar_url, u.email::text
      FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
     WHERE lower(coalesce(p.full_name, '')) LIKE '%' || _t || '%'
        OR lower(coalesce(p.custom_url, '')) LIKE '%' || _t || '%'
        OR lower(coalesce(u.email::text, '')) LIKE '%' || _t || '%'
     ORDER BY p.full_name NULLS LAST
     LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
END;
$fn$;

REVOKE ALL ON FUNCTION public.feature_set_mode(text, text, text), public.feature_add_member(text, uuid, text),
  public.feature_remove_member(text, uuid, text), public.feature_admin_state(), public.feature_member_search(text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feature_set_mode(text, text, text), public.feature_add_member(text, uuid, text),
  public.feature_remove_member(text, uuid, text), public.feature_admin_state(), public.feature_member_search(text, integer)
  TO authenticated;
REVOKE ALL ON FUNCTION public.tg_feature_audit_append_only() FROM PUBLIC, anon, authenticated;

DO $postconditions$
BEGIN
  IF (SELECT count(*) FROM public.feature_access WHERE mode = 'off') <> 3 THEN
    RAISE EXCEPTION 'VID7-0004-POST-001: the three features are not seeded off' USING ERRCODE = 'raise_exception';
  END IF;
  IF has_table_privilege('authenticated', 'public.feature_access', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.feature_access_members', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.feature_access_audit', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.feature_access', 'SELECT')
     OR has_function_privilege('authenticated', 'public.feature_allowed(text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.feature_allowed_me(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.feature_set_mode(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VID7-0004-POST-002: a table or the internal check is reachable by an API role' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'VID7-0004: video_posts, video_ads, copyright_music_check seeded off; enforced by feature_allowed()';
END
$postconditions$;

COMMIT;
