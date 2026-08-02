-- ============================================================================
-- A MEMBER CAN DELETE THEIR OWN NOTIFICATIONS.              (Stage 8, 2026-08-02)
--
-- WHAT WAS WRONG
--   There is no way to remove a notification, anywhere in the app. That is not
--   a missing button — it is a missing PERMISSION. Checked on production before
--   writing this; `user_notifications` carries exactly three policies:
--
--     INSERT  "Admins can insert notifications"
--     SELECT  "Users can view own notifications"
--     UPDATE  "Users can update own notifications"
--
--   No DELETE policy at all. With RLS enabled, no policy means no row may ever
--   be deleted by anybody but the service role. The table only grows: 994 rows
--   today, 207 of them older than 90 days, the oldest from 2026-03-02.
--
-- WHAT THIS ADDS
--   One policy. A member may delete a row that is theirs. Nothing else changes:
--   no column, no trigger, no function, no existing policy.
--
-- SCOPE — deliberately narrow
--   `auth.uid() = user_id` and nothing more. Not "or admin", not "or the actor".
--   A notification belongs to the person it was sent to, and only they may
--   remove it. An admin has no business deleting what landed in someone else's
--   inbox, and this policy makes that impossible rather than merely unlikely.
--
-- IRREVERSIBLE, AND THAT IS THE POINT
--   Deleting is a delete. There is no trash and no undo — the member asked for
--   the row to be gone. The app therefore offers this only on the history
--   screen, where the member is looking at one specific line and choosing to
--   remove it, and NOT on the bell, where the X means "mark read" and always
--   will. Marking read is reversible; deleting is not, and the two must never
--   sit behind the same control.
--
--   Separately, and NOT part of this change: the owner's standing rule is that
--   USER ACCOUNTS are never deleted. This is about a member's own notification
--   rows, which is a different thing entirely.
--
-- RETENTION is not in this migration. Automatically pruning old rows needs a
--   window chosen by the owner, and a scheduled job. Asked; not yet answered.
--
-- ROLLBACK (one line, and nobody can delete anything again):
--   DROP POLICY "Users can delete own notifications" ON public.user_notifications;
-- ============================================================================

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.user_notifications;

CREATE POLICY "Users can delete own notifications"
  ON public.user_notifications
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);
