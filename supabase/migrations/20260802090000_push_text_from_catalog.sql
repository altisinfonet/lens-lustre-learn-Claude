-- ============================================================================
-- THE PUSH MESSAGE STOPS DISAGREEING WITH THE APP.        (Stage 3b, 2026-08-02)
--
-- WHAT WAS WRONG
--   push_on_notification() sent `NEW.message` as the push body. That column is
--   frozen text, composed by whichever trigger created the row, sometimes months
--   ago. So one event read two ways:
--
--     push          "Payel Kundu Basu commented on your post"
--     in the app    "Payel Kundu Basu commented on your photo."
--
--   Stage 3a (PR #40) made the bell and /notifications compose their sentence
--   from one function, src/lib/notifications/describe.ts. The push body was the
--   one surface left that could still say something different, because it is
--   built inside the database and never goes near that TypeScript.
--
--   Three further faults rode along with the frozen column, all verified against
--   production on 2026-08-02:
--
--   1. A DELETED MEMBER'S NAME IS STILL IN THERE. delete-user and
--      delete-my-account both run
--        update user_notifications set actor_id = null where actor_id = <id>
--      to anonymise the row -- but they leave `message` untouched. 33 rows on
--      this database still read "<real name> started following you" for an
--      account that no longer exists, and every one of them would push that
--      name again if it were re-sent. Composing from actor_id instead means a
--      row with no actor can no longer name anybody.
--   2. NO BRAND RULE. Every other surface renders an admin as the brand rather
--      than a real person (src/lib/adminBrand.ts). The push body had no such
--      rule. It does not leak today only because the single admin account's
--      full_name happens to be the brand already -- a second admin with a
--      personal name would have pushed it. This closes that door.
--   3. "Someone commented on your photo" -- 3 rows still carry it. The word is
--      banned from the app now; it must not survive in push either.
--
-- WHAT THIS CHANGES
--   Adds three small functions and points the trigger at them. The push body
--   becomes the same sentence the app shows, built at send time from live data.
--
--   `NEW.message` is NOT deleted and NOT rewritten. It stays as the record of
--   what the trigger wrote, and it is still the body for any type this catalog
--   does not phrase (competition results, certificates, courses, tickets --
--   61 of the 993 rows on this database). Rewriting 993 rows of history to fix
--   a send-time bug would be a bulk mutation with no way back; this needs none.
--
-- WHAT DOES NOT CHANGE
--   * The push TITLE. It is a category label ("New Reaction", "Friend Request"),
--     never a person's name -- checked across all 993 rows: 15 types, 16 distinct
--     titles, 0 blank, none containing a member name. It does not conflict with
--     anything the app says, so it is left alone.
--   * Every safety property of the trigger: no push to the person who caused the
--     event, per-user preferences honoured, and a failure still cannot break the
--     notification insert.
--
-- KEPT IN STEP WITH THE TYPESCRIPT
--   The phrase table below is a copy of ACTION_CATALOG in
--   src/lib/notifications/describe.ts. `pushCatalogParity.test.ts` reads THIS
--   FILE and fails CI if a single character differs, so the two cannot drift.
--   If you edit a phrase here, edit it there.
--
-- ROLLBACK (one statement -- the trigger goes back to the frozen column):
--   see the commented-out block at the foot of this file.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) One actor's display name. The same three rules as actorDisplayName().
--
--    Order matters and is not arbitrary:
--      admin        wins over everything, including a real name being present
--      no actor     -> "A member". A social notification always had a human
--                      behind it; when the id has been nulled by an account
--                      deletion we can no longer say who, and we do not guess.
--      no profile   -> "A deleted account" (the id survived, the profile did not)
--      otherwise    full name, then the profile URL handle, then "A member"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_display_name(_actor_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN _actor_id IS NULL                                THEN 'A member'
           WHEN public.has_role(_actor_id, 'admin'::app_role)    THEN '50mm Retina World'
           WHEN p.id IS NULL                                     THEN 'A deleted account'
           ELSE COALESCE(NULLIF(btrim(p.full_name), ''),
                         NULLIF(btrim(p.custom_url), ''),
                         'A member')
         END
  FROM (SELECT 1) AS _one
  LEFT JOIN public.profiles p ON p.id = _actor_id;
$fn$;

COMMENT ON FUNCTION public.notif_display_name(uuid) IS
  'Display name for a notification actor. Mirrors actorDisplayName() in src/lib/notifications/describe.ts -- admin renders as the brand, a missing profile as "A deleted account", a nulled actor as "A member".';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The verb half. Singular only: a push is one event, so the plural forms in
--    ACTION_CATALOG (".many") have no counterpart here and are not copied.
--    NULL means "this file does not phrase that type" -- the stored message is
--    used instead, so a type added tomorrow still pushes its own wording rather
--    than an empty line.
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
           ELSE NULL
         END;
$fn$;

COMMENT ON FUNCTION public.notif_action_phrase(text) IS
  'Singular action phrase for a notification type. Byte-identical copy of ACTION_CATALOG in src/lib/notifications/describe.ts, enforced by pushCatalogParity.test.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The whole sentence, or the stored message when we do not phrase the type.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_push_body(_type text, _actor_id uuid, _message text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN public.notif_action_phrase(_type) IS NULL
             THEN COALESCE(_message, '')
           ELSE public.notif_display_name(_actor_id) || ' ' || public.notif_action_phrase(_type)
         END;
$fn$;

COMMENT ON FUNCTION public.notif_push_body(text, uuid, text) IS
  'The push body. Same sentence the app renders; falls back to the stored message for unphrased types.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) The trigger. IDENTICAL to the version installed on 2026-08-01 except for
--    the one line marked below. Everything else is reproduced unchanged on
--    purpose, so this file is the whole truth about what the trigger does.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _cfg   public.push_config%ROWTYPE;
  _allow boolean := true;
BEGIN
  SELECT * INTO _cfg FROM public.push_config WHERE id LIMIT 1;
  IF _cfg.function_url IS NULL THEN
    RETURN NEW;  -- not configured yet: notification still saved, no push
  END IF;

  -- Never push to the person who caused the event.
  IF NEW.actor_id IS NOT NULL AND NEW.actor_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Per-user preferences. Missing row = all defaults on.
  SELECT CASE
           WHEN np.user_id IS NULL THEN true
           WHEN np.push_enabled = false THEN false
           WHEN NEW.type IN ('post_reaction','image_reaction')            THEN np.push_reactions
           WHEN NEW.type IN ('post_comment','image_comment','comment_reply') THEN np.push_comments
           WHEN NEW.type = 'friend_request'                                THEN np.push_friend_requests
           WHEN NEW.type = 'new_follower'                                  THEN np.push_new_followers
           WHEN NEW.type IN ('competition_vote','entry_approved','entry_rejected',
                             'competition_winner','new_competition')       THEN np.push_competition_updates
           ELSE true
         END
    INTO _allow
  FROM (SELECT 1) AS _one
  LEFT JOIN public.notification_preferences np ON np.user_id = NEW.user_id;

  IF _allow IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget. pg_net queues the request; failures never reach this
  -- transaction, so the notification insert is always safe.
  PERFORM net.http_post(
    url     := _cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-internal-secret', _cfg.internal_secret
               ),
    body    := jsonb_build_object(
                 'user_id', NEW.user_id,
                 'title',   NEW.title,
                 -- ▼ THE ONE CHANGED LINE. Was: COALESCE(NEW.message, '')
                 'body',    public.notif_push_body(NEW.type, NEW.actor_id, NEW.message),
                 'data',    jsonb_build_object(
                              'type', NEW.type,
                              'reference_id', COALESCE(NEW.reference_id::text, '')
                            )
               )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A push problem must never break notifications. But it must not be silent
  -- either -- that is precisely how the wrong-schema bug survived undetected.
  RAISE LOG 'push_on_notification failed for user % : % / %', NEW.user_id, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$fn$;

-- The trigger itself is unchanged and is NOT recreated here; CREATE OR REPLACE
-- FUNCTION rebinds it in place.

-- ============================================================================
-- ROLLBACK -- restores the frozen column as the push body. The three helper
-- functions can be left in place; nothing else calls them.
--
--   CREATE OR REPLACE FUNCTION public.push_on_notification() ... with
--     'body', COALESCE(NEW.message, '')
--   (i.e. re-run supabase/migrations/20260801120000_fix_push_net_schema.sql)
-- ============================================================================
