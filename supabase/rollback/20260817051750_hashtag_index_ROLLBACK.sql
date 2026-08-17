-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260816T1900_hashtag_index.sql
--
-- Returns the database to exactly the state it was in before the hashtag
-- system existed. This is genuinely reversible because the migration ADDED
-- everything and CHANGED nothing: no existing table, column, function or
-- policy was altered, and `posts` was not touched beyond gaining a trigger.
--
-- NOTHING IS LOST BY RUNNING THIS. Every hashtag row was derived from
-- posts.content, which is untouched and remains the source of truth. Re-running
-- the migration reproduces identical rows from identical captions.
--
-- `global_search_hashtags` — the pre-existing full-scan search RPC — is NOT
-- referenced by this migration and is unaffected either way.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Stop the writer first, so nothing repopulates while we drop.
drop trigger if exists trg_posts_sync_hashtags on public.posts;
drop trigger if exists trg_posts_unsync_hashtags on public.posts;

-- 2. Functions added by the migration.
drop function if exists public.suggest_hashtags(text, integer);
drop function if exists public.sync_post_hashtags();
drop function if exists public.unsync_post_hashtags();
drop function if exists public.recount_hashtags(uuid[]);
drop function if exists public.extract_hashtags(text);
drop function if exists public.normalize_hashtag(text);

-- 3. Tables. post_hashtags first — it points at hashtags.
--    Both drop their own indexes and policies with them.
drop table if exists public.post_hashtags;
drop table if exists public.hashtags;

-- ── VERIFY THE ROLLBACK ───────────────────────────────────────────────────
-- Expect: 0, 0, 0 — and posts still holding every caption.
--
--   select count(*) from information_schema.tables
--    where table_schema='public' and table_name in ('hashtags','post_hashtags');
--
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and p.proname in ('suggest_hashtags','sync_post_hashtags',
--                        'recount_hashtags','extract_hashtags','normalize_hashtag');
--
--   select count(*) from pg_trigger where tgname='trg_posts_sync_hashtags';
--
--   select count(*) from posts;                     -- must still be 223
--   select count(*) from posts where content ~ '#'; -- captions untouched
