-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261103_0501 · four duplicate indexes gone, their twins intact.
-- FAIL before the apply (the duplicates exist), PASS after. READ ONLY, ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  _bad text := '';
  r record;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('idx_unsubscribe_tokens_token', 'email_unsubscribe_tokens_token_key'),
    ('idx_suppressed_emails_email', 'suppressed_emails_email_key'),
    ('idx_post_reactions_post_user', 'post_reactions_post_id_user_id_unique'),
    ('idx_feed_events_post', 'idx_feed_events_post_id')
  ) AS v(drop_name, keep_name)
  LOOP
    IF to_regclass('public.' || r.drop_name) IS NOT NULL THEN
      _bad := _bad || format(' %s(still present)', r.drop_name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index k WHERE k.indexrelid = to_regclass('public.' || r.keep_name)
                    AND k.indisvalid AND k.indisready) THEN
      _bad := _bad || format(' %s(twin missing or invalid)', r.keep_name);
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261103_0501 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261103_0501 (lane %): 4 duplicates gone, 4 twins valid', current_setting('p32.lane');
END
$probe$;

ROLLBACK;
