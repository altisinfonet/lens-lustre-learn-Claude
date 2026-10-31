-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261018_0004 — S12-F5 + F6 Following / Favourites, admin mix
-- Lanes: staging and production (refuses any other lane).
--
-- Pre-state restored:
--   * get_following_feed, get_favourites_feed, feed_author_timeline,
--     feed_mix_set, feed_mix_admin_stats dropped (exact signatures);
--   * public.feed_favourite_authors dropped with its trigger function — the
--     members' ★ favourites are LOST (they are a preference, not a record);
--   * feed_score_config.favourites_max removed.
-- KEPT, on purpose:
--   * feature_access_audit_action_check stays widened to (mode, add, remove,
--     mix) and every 'mix' audit row stays — the audit trail is append-only by
--     design (VID-7). The wider CHECK is a superset; 0004's PRE-002 accepts it,
--     so 0004 applies again after this rollback.
--   * mix_circle / mix_suggested / mix_fair keep the last values an admin saved
--     (they belong to 20261018_0003). Put them back with Admin → Feed →
--     Personal Feed BEFORE this rollback if you want 6 / 2 / 2.
--
-- CLIENT IMPACT: a bundle with the tabs keeps working — Following / Favourites
-- answer "function does not exist", the client shows an empty tab with its
-- message (no crash); the ★ button's outbox item is refused (table missing) and
-- dropped; Admin → Personal Feed shows "Couldn't load the numbers".
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb_pre$
BEGIN
  -- RB-PRE-001 · the migration is applied (exact signatures).
  IF to_regclass('public.feed_favourite_authors') IS NULL
     OR to_regprocedure('public.get_following_feed(uuid[],integer,integer,text[],text)') IS NULL
     OR to_regprocedure('public.get_favourites_feed(uuid[],integer,integer,text[],text)') IS NULL THEN
    RAISE EXCEPTION 'S12F56-0004-RB-PRE-001: feed_favourite_authors / get_following_feed / get_favourites_feed missing — nothing to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_pre$;

DROP FUNCTION public.get_following_feed(uuid[], integer, integer, text[], text);
DROP FUNCTION public.get_favourites_feed(uuid[], integer, integer, text[], text);
DROP FUNCTION public.feed_author_timeline(text, uuid[], integer, text[]);
DROP FUNCTION public.feed_mix_set(integer, integer, integer);
DROP FUNCTION public.feed_mix_admin_stats(integer);
DROP TABLE public.feed_favourite_authors;
DROP FUNCTION public.feed_favourite_authors_before();
DELETE FROM public.feed_score_config WHERE key = 'favourites_max';

DO $rb_post$
DECLARE
  _bad text := '';
BEGIN
  IF to_regclass('public.feed_favourite_authors') IS NOT NULL THEN _bad := _bad || E'\n  feed_favourite_authors still exists'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
               AND proname IN ('get_following_feed', 'get_favourites_feed', 'feed_author_timeline',
                               'feed_mix_set', 'feed_mix_admin_stats', 'feed_favourite_authors_before')) THEN
    _bad := _bad || E'\n  a 0004 function still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feed_score_config WHERE key = 'favourites_max') THEN
    _bad := _bad || E'\n  favourites_max still exists';
  END IF;
  IF to_regprocedure('public.get_personal_feed(uuid[],integer,integer,text[],text)') IS NULL THEN
    _bad := _bad || E'\n  get_personal_feed (0003) is gone — this rollback must not touch it';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F56-0004-RB-POST:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S12F56-0004 ROLLBACK: favourites table + 5 functions + favourites_max removed; audit CHECK and mix values kept';
END
$rb_post$;

COMMIT;
