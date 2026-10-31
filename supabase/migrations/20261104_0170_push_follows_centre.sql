-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0170 · NOTIFICATION CENTRE N4 — push follows the centre, per group.
--
-- Today push_on_notification() decides push with a hand-kept CASE: a type not
-- listed is governed only by the master switch (N0 gap G4), and nothing reads
-- quiet hours. The centre's decision already covers every type (its registry
-- names the push setting per type), the master switch, and quiet hours — and
-- the gate (0140) logs that decision for each row it lets through.
--
-- CHANGE: for a group switched on for the recipient, push reads that logged
-- decision (channels.push) and adds notification_id to the push data so the
-- receipt (0160) can link to it. Group off, unregistered type, or no logged
-- decision (a gate fault) → the old CASE, byte for byte. Every switch is off,
-- so today nothing changes.
--
-- PRE pins the live body (md5 8610c27a…, measured identical on both lanes by
-- N0 and equal to git 20260815064043). The rollback restores it exactly.
-- Rollback: supabase/rollback/20261104_0170_push_follows_centre_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0170_push_follows_centre.sql
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
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.push_on_notification()'))
     IS DISTINCT FROM '8610c27a54377ec01d0b17969bc3e47b' THEN
    RAISE EXCEPTION 'NC-0170-PRE-001: live push_on_notification() is not the measured body (md5 8610c27a…) — re-measure before changing it';
  END IF;
  IF to_regprocedure('public.notification_centre_gate()') IS NULL
     OR to_regprocedure('public.notification_centre_live(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'NC-0170-PRE-002: the centre (0110) and its gate (0140) must be applied first';
  END IF;
END
$pre$;

-- P28: notification_centre_log · 0 rows at launch (written only while a group is live) · push_on_notification reads the gate's decision for one row by notification_id on every insert of a live group
CREATE INDEX notification_centre_log_notification_idx ON public.notification_centre_log (notification_id) WHERE notification_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.push_on_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cfg    public.push_config%ROWTYPE;
  _allow  boolean := true;
  _grp    text;
  _ch     jsonb;
  _centre boolean := false;
BEGIN
  SELECT * INTO _cfg FROM public.push_config WHERE id LIMIT 1;
  IF _cfg.function_url IS NULL THEN RETURN NEW; END IF;
  IF NEW.actor_id IS NOT NULL AND NEW.actor_id = NEW.user_id THEN RETURN NEW; END IF;

  -- N4 (20261104_0170): for a group switched on for this member, push follows
  -- the notification centre's decision, which the gate (0140) logged for this
  -- very row: the member's per-type push setting for EVERY type, the master
  -- switch, and quiet hours. No logged decision (group off, or a gate fault)
  -- -> exactly today's rules below.
  -- A fault in this lookup must never cost a push: its own block, and on any
  -- error the old rules decide.
  BEGIN
    SELECT nt.group_key INTO _grp FROM public.notification_types nt WHERE nt.type = NEW.type;
    IF _grp IS NOT NULL AND public.notification_centre_live(_grp, NEW.user_id) THEN
      SELECT l.channels INTO _ch
        FROM public.notification_centre_log l
       WHERE l.notification_id = NEW.id
       ORDER BY l.id DESC
       LIMIT 1;
      IF _ch IS NOT NULL THEN
        _centre := true;
        _allow  := coalesce((_ch ->> 'push')::boolean, false);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    _centre := false;
    RAISE WARNING 'push_on_notification: centre lookup failed (%), using the old rules', SQLSTATE;
  END;

  IF NOT _centre THEN
    SELECT CASE
             WHEN np.user_id IS NULL THEN true
             WHEN np.push_enabled = false THEN false
             WHEN NEW.type IN ('post_reaction','image_reaction')            THEN np.push_reactions
             WHEN NEW.type IN ('post_comment','image_comment','comment_reply') THEN np.push_comments
             WHEN NEW.type = 'friend_request'                                THEN np.push_friend_requests
             WHEN NEW.type = 'new_follower'                                  THEN np.push_new_followers
             WHEN NEW.type = 'new_post_from_following'                       THEN np.push_new_posts
             WHEN NEW.type IN ('competition_vote','entry_approved','entry_rejected',
                               'competition_winner','new_competition')       THEN np.push_competition_updates
             -- ADDED 2026-08-15: the two platform broadcasts. Placed ABOVE
             -- `ELSE true` so they cannot fall through to it, and BELOW the
             -- specific branches above so it cannot swallow one of them.
             -- Neither type appears in any earlier branch (verified against the
             -- live definition before this was written), so nothing above shadows
             -- it and it shadows nothing.
             WHEN NEW.type IN ('journal_published','course_published')        THEN np.push_announcements
             ELSE true
           END
      INTO _allow
    FROM (SELECT 1) AS _one
    LEFT JOIN public.notification_preferences np ON np.user_id = NEW.user_id;
  END IF;
  IF _allow IS DISTINCT FROM true THEN RETURN NEW; END IF;
  PERFORM net.http_post(
    url     := _cfg.function_url,
    headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', _cfg.internal_secret),
    body    := jsonb_build_object('user_id', NEW.user_id, 'title', NEW.title,
                 'body', public.notif_push_body(NEW.type, NEW.actor_id, NEW.message),
                 'data', CASE WHEN _centre
                              -- notification_id lets send-push link its receipt (N4, 0160)
                              THEN jsonb_build_object('type', NEW.type, 'reference_id', COALESCE(NEW.reference_id::text,''),
                                                      'notification_id', NEW.id::text)
                              ELSE jsonb_build_object('type', NEW.type, 'reference_id', COALESCE(NEW.reference_id::text,''))
                         END)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'push_on_notification failed for user % : % / %', NEW.user_id, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;

COMMIT;
