-- ═══════════════════════════════════════════════════════════════════════════
-- 20261103_0501 · cleanup runner · drop four duplicate indexes.
--
-- Each dropped index has an exact twin on the same table: same columns, same
-- operator classes, no expression, no predicate (PROBE 0501 DUPIDX, staging run
-- 41018483103 and production run 41023653669). The twin that is KEPT is the
-- UNIQUE constraint index where there is one, so no constraint changes:
--
--   dropped                              kept (twin)
--   idx_unsubscribe_tokens_token         email_unsubscribe_tokens_token_key  (UNIQUE)
--   idx_suppressed_emails_email          suppressed_emails_email_key         (UNIQUE)
--   idx_post_reactions_post_user         post_reactions_post_id_user_id_unique (UNIQUE)
--   idx_feed_events_post                 idx_feed_events_post_id
--
-- Callers: an index has none by name. No ON CONFLICT ON CONSTRAINT, hint or
-- test names any of the four (git grep: migrations and dated evidence only);
-- none backs a constraint (pg_constraint.conindid, checked below).
--
-- PRE refuses unless, for each pair, the dropped index has exactly the
-- definition its rollback re-creates, and its twin exists, is valid and ready.
-- Rollback: supabase/rollback/20261103_0501_cleanup_duplicate_indexes_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261103_0501_cleanup_duplicate_indexes.sql
-- Apply ONLY via apply-migration.yml. Staging first; production after main.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %)',
      coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE
  r record;
  _bad text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('idx_unsubscribe_tokens_token', 'email_unsubscribe_tokens_token_key',
     -- P28: expected live definition (compared, never executed) · dropped as a duplicate
     'CREATE INDEX idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens USING btree (token)'),
    ('idx_suppressed_emails_email', 'suppressed_emails_email_key',
     -- P28: expected live definition (compared, never executed) · dropped as a duplicate
     'CREATE INDEX idx_suppressed_emails_email ON public.suppressed_emails USING btree (email)'),
    ('idx_post_reactions_post_user', 'post_reactions_post_id_user_id_unique',
     -- P28: expected live definition (compared, never executed) · dropped as a duplicate
     'CREATE INDEX idx_post_reactions_post_user ON public.post_reactions USING btree (post_id, user_id)'),
    ('idx_feed_events_post', 'idx_feed_events_post_id',
     -- P28: expected live definition (compared, never executed) · dropped as a duplicate
     'CREATE INDEX idx_feed_events_post ON public.feed_events USING btree (post_id)')
  ) AS v(drop_name, keep_name, drop_def)
  LOOP
    IF to_regclass('public.' || r.drop_name) IS NULL THEN
      _bad := _bad || format(' %s(absent)', r.drop_name);
      CONTINUE;
    END IF;
    IF pg_get_indexdef(('public.' || r.drop_name)::regclass) <> r.drop_def THEN
      _bad := _bad || format(' %s(definition differs from rollback)', r.drop_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ('public.' || r.drop_name)::regclass) THEN
      _bad := _bad || format(' %s(backs a constraint)', r.drop_name);
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index d JOIN pg_index k ON k.indrelid = d.indrelid
       WHERE d.indexrelid = ('public.' || r.drop_name)::regclass
         AND k.indexrelid = to_regclass('public.' || r.keep_name)
         AND k.indisvalid AND k.indisready
         AND k.indkey::text = d.indkey::text AND k.indclass::text = d.indclass::text
         AND k.indexprs IS NULL AND d.indexprs IS NULL
         AND k.indpred IS NULL AND d.indpred IS NULL
    ) THEN
      _bad := _bad || format(' %s(twin %s missing, invalid or not identical)', r.drop_name, r.keep_name);
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'APPLY REFUSED 20261103_0501 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
END
$pre$;

DROP INDEX public.idx_unsubscribe_tokens_token;
DROP INDEX public.idx_suppressed_emails_email;
DROP INDEX public.idx_post_reactions_post_user;
DROP INDEX public.idx_feed_events_post;

DO $post$
BEGIN
  IF to_regclass('public.idx_unsubscribe_tokens_token') IS NOT NULL
     OR to_regclass('public.idx_suppressed_emails_email') IS NOT NULL
     OR to_regclass('public.idx_post_reactions_post_user') IS NOT NULL
     OR to_regclass('public.idx_feed_events_post') IS NOT NULL THEN
    RAISE EXCEPTION 'POST FAILED 20261103_0501: a dropped index is still present';
  END IF;
  RAISE NOTICE 'APPLIED 20261103_0501 (lane %): 4 duplicate indexes dropped; twins kept', current_setting('p32.lane');
END
$post$;

COMMIT;
