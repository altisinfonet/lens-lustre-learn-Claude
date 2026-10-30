-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261103_0501 · re-create the four indexes exactly as they were
-- (definitions asserted by the apply's PRE gate). Apply only via
-- apply-migration.yml. Plain CREATE INDEX (not CONCURRENTLY) because the
-- workflow runs one transaction; tables are small at launch.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

-- P28: email_unsubscribe_tokens · restores a duplicate of the UNIQUE token index (rollback only).
CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens USING btree (token);
-- P28: suppressed_emails · restores a duplicate of the UNIQUE email index (rollback only).
CREATE INDEX IF NOT EXISTS idx_suppressed_emails_email ON public.suppressed_emails USING btree (email);
-- P28: post_reactions · restores a duplicate of the UNIQUE (post_id, user_id) index (rollback only).
CREATE INDEX IF NOT EXISTS idx_post_reactions_post_user ON public.post_reactions USING btree (post_id, user_id);
-- P28: feed_events · restores a duplicate of idx_feed_events_post_id (rollback only).
CREATE INDEX IF NOT EXISTS idx_feed_events_post ON public.feed_events USING btree (post_id);

COMMIT;
