-- ═══════════════════════════════════════════════════════════════════════════
-- 20261030_0701 — S7-b · VID-4 report / takedown: an admin takes a video down.
-- Lanes: staging and production (refuses any other lane). Needs 20261005_0005
-- and 20261030_0700 (the purge queue's not_before). Builder session S7.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PLAN (VID-1 DECISION §10, signed #376): "Upheld → state='taken_down' (hidden
-- at once and added to the Worker's revoked list); the owner is notified and
-- may fix it through §7 as a new version, which is re-checked. Dismissed →
-- closed, and the reporter is told. Every action is audit-logged."
--
-- HIDDEN EVERYWHERE AT ONCE needs no new read rule: feed, profile, post page
-- and ad reads already show a video only while it is 'ready' (videos RLS +
-- postVideoRead.ts marks the post hidden), and play-token refuses anything not
-- 'ready'. The Pages route /api/video/takedown also writes the Worker's
-- revoked list (KV VIDEO_REVOKED) so a token minted before the takedown stops
-- within seconds instead of at its 15-minute expiry.
--
-- WHAT
--   1. public.video_takedown_audit — append-only (who, when, which video and
--      version, action 'taken_down' | 'dismissed', reason, report). RLS on;
--      admins read; no client writes; UPDATE / DELETE refused for everyone.
--   2. public.video_takedown(_video_id, _reason, _report_id) — admin only.
--        • 'ready' → 'taken_down' (the existing legal move). Already
--          'taken_down' → 'already' (idempotent, nothing written twice).
--          Any other state → VID-TD-002 (nothing published to take down).
--        • the version's files are queued for deletion with a 30-day hold
--          (video_r2_purge_queue.not_before = now + 30 days): kept for an
--          appeal, and 0700's rule still keeps them while a fix needs them.
--        • the owner gets a notice (user_notifications, type
--          'video_taken_down', deduplicated per video version).
--        • every pending report of the linked post closes as reviewed,
--          admin_action 'video_taken_down', reviewed_by the admin.
--        • one audit row.
--   3. public.video_report_dismiss(_report_id, _note) — admin only: closes one
--      report as dismissed and audits it. (The admin page's existing
--      "dismiss" still works; this one also leaves an audit row.)
--
-- ROLLBACK: supabase/rollback/20261030_0701_s7b_video_takedown_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261030_0701_s7b_video_takedown.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _bad text := '';
BEGIN
  IF to_regclass('public.video_takedown_audit') IS NOT NULL OR to_regprocedure('public.video_takedown(uuid,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'S7B-0701-PRE-001: 20261030_0701 is applied already' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.video_purge_claim(integer)') IS NULL THEN _bad := _bad || E'\n  20261030_0700 not applied (video_purge_claim missing)'; END IF;
  IF to_regclass('public.post_reports') IS NULL THEN _bad := _bad || E'\n  post_reports missing'; END IF;
  IF to_regclass('public.user_notifications') IS NULL THEN _bad := _bad || E'\n  user_notifications missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_notifications' AND column_name = 'dedup_key') THEN
    _bad := _bad || E'\n  user_notifications.dedup_key missing';
  END IF;
  IF to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN _bad := _bad || E'\n  has_role(uuid, app_role) missing'; END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S7B-0701-PRE-002: preconditions failed:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. audit ─────────────────────────────────────────────────────────────
CREATE TABLE public.video_takedown_audit (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  video_id    uuid,
  version_no  integer,
  post_id     uuid,
  report_id   uuid,
  admin_id    uuid NOT NULL,
  action      text NOT NULL CHECK (action IN ('taken_down', 'dismissed')),
  reason      text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- P28: the admin page reads one video's history, newest first; reviewed by the S7 builder 2026-10-30.
CREATE INDEX idx_video_takedown_audit_video ON public.video_takedown_audit (video_id, created_at DESC);
ALTER TABLE public.video_takedown_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_takedown_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.video_takedown_audit_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.video_takedown_audit TO authenticated;
CREATE POLICY video_takedown_audit_admin_read ON public.video_takedown_audit FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

CREATE FUNCTION public.tg_video_takedown_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  RAISE EXCEPTION 'video_takedown_audit is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$fn$;
CREATE TRIGGER tg_video_takedown_audit_append_only BEFORE UPDATE OR DELETE ON public.video_takedown_audit
  FOR EACH ROW EXECUTE FUNCTION public.tg_video_takedown_audit_append_only();
CREATE TRIGGER tg_video_takedown_audit_no_truncate BEFORE TRUNCATE ON public.video_takedown_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_video_takedown_audit_append_only();

-- ── 2. takedown ──────────────────────────────────────────────────────────
CREATE FUNCTION public.video_takedown(_video_id uuid, _reason text DEFAULT NULL, _report_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  _uid  uuid := (SELECT auth.uid());
  _v    record;
  _post uuid;
  _why  text := nullif(left(btrim(coalesce(_reason, '')), 500), '');
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'VID-TD-001: only an admin may take a video down' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id, owner_id, state, current_version INTO _v FROM public.videos WHERE id = _video_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VID-TD-003: no such video' USING ERRCODE = 'no_data_found';
  END IF;
  IF _v.state = 'taken_down' THEN
    RETURN 'already';
  END IF;
  IF _v.state <> 'ready' THEN
    RAISE EXCEPTION 'VID-TD-002: only a published (ready) video can be taken down; this one is %', _v.state
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT post_id INTO _post FROM public.post_videos WHERE video_id = _video_id;
  IF _report_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.post_reports r WHERE r.id = _report_id AND r.post_id = _post) THEN
    RAISE EXCEPTION 'VID-TD-004: that report is not about this video''s post' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.videos SET state = 'taken_down' WHERE id = _video_id;

  INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix, not_before)
  VALUES (_video_id, _v.owner_id,
          'video/' || _v.owner_id::text || '/' || _video_id::text || '/v' || _v.current_version::text || '/',
          now() + interval '30 days');

  INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id, dedup_key)
  VALUES (_v.owner_id, NULL, 'video_taken_down', 'Video removed',
          'One of your videos was removed after a report. You can upload a fixed version from your profile.',
          coalesce(_post, _video_id),
          'video_taken_down:' || _video_id::text || ':v' || _v.current_version::text)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

  IF _post IS NOT NULL THEN
    UPDATE public.post_reports
       SET status = 'reviewed', admin_action = 'video_taken_down', reviewed_by = _uid, updated_at = now()
     WHERE post_id = _post AND status = 'pending';
  END IF;

  INSERT INTO public.video_takedown_audit (video_id, version_no, post_id, report_id, admin_id, action, reason)
  VALUES (_video_id, _v.current_version, _post, _report_id, _uid, 'taken_down', _why);
  RETURN 'taken_down';
END;
$fn$;

-- ── 3. dismiss ───────────────────────────────────────────────────────────
CREATE FUNCTION public.video_report_dismiss(_report_id uuid, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _r   record;
  _vid uuid;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'VID-TD-001: only an admin may dismiss a report' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id, post_id, status INTO _r FROM public.post_reports WHERE id = _report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VID-TD-003: no such report' USING ERRCODE = 'no_data_found';
  END IF;
  IF _r.status <> 'pending' THEN
    RETURN 'already';
  END IF;
  UPDATE public.post_reports SET status = 'reviewed', admin_action = 'dismissed', reviewed_by = _uid, updated_at = now()
   WHERE id = _report_id;
  SELECT video_id INTO _vid FROM public.post_videos WHERE post_id = _r.post_id;
  INSERT INTO public.video_takedown_audit (video_id, post_id, report_id, admin_id, action, reason)
  VALUES (_vid, _r.post_id, _report_id, _uid, 'dismissed', nullif(left(btrim(coalesce(_note, '')), 500), ''));
  RETURN 'dismissed';
END;
$fn$;

-- ── 4. privileges ────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.tg_video_takedown_audit_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.video_takedown(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.video_report_dismiss(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_takedown(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.video_report_dismiss(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.video_takedown(uuid, text, uuid) IS
  'S7-b VID-4: admin takes a ready video down (hidden at once), queues its version files with a 30-day hold, '
  'notifies the owner, closes the post''s pending reports, audits.';

DO $done$ BEGIN RAISE NOTICE 'S7B-0701: video_takedown, video_report_dismiss, video_takedown_audit (append-only)'; END $done$;

COMMIT;
