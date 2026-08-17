-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260817102540_hashtag_grants_and_cascade.sql
--
-- ⚠ READ THIS BEFORE RUNNING IT. This rollback REOPENS a security hole. It
-- exists because every migration must have one, not because running it is ever
-- a good idea. It restores `recount_hashtags` and `suggest_hashtags` to being
-- callable by `anon` — an unauthenticated write path into public.hashtags at
-- /rest/v1/rpc/recount_hashtags — and removes the cascade that stops a deleted
-- member's junction rows outliving their account.
--
-- If something broke after 20260817102540, the far likelier cause is the
-- FOREIGN KEY, not the grants. Consider dropping only section 2 first.
--
-- NO DATA IS LOST EITHER WAY. Nothing here deletes a row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Restore the grants exactly as they were before the migration ───────
-- Measured pre-migration ACLs:
--   recount_hashtags(uuid[])          =X/postgres | postgres | anon | authenticated | service_role
--   suggest_hashtags(text,integer)    postgres | anon | authenticated | service_role
grant execute on function public.recount_hashtags(uuid[]) to public;
grant execute on function public.recount_hashtags(uuid[]) to anon;
grant execute on function public.recount_hashtags(uuid[]) to authenticated;

grant execute on function public.suggest_hashtags(text, integer) to anon;
-- `authenticated` was granted before and remains granted; nothing to restore.

-- ── 2. Drop the cascade ───────────────────────────────────────────────────
-- Dropping a foreign key removes only the constraint. Every one of the 163
-- junction rows survives untouched.
alter table public.post_hashtags
  drop constraint if exists post_hashtags_author_id_fkey;

-- ── VERIFY THE ROLLBACK ───────────────────────────────────────────────────
--   select has_function_privilege('anon','public.recount_hashtags(uuid[])','EXECUTE');
--     -- expect true again (the hole is back open)
--   select has_function_privilege('anon','public.suggest_hashtags(text,integer)','EXECUTE');
--     -- expect true again
--   select count(*) from pg_constraint where conname='post_hashtags_author_id_fkey';
--     -- expect 0
--   select count(*) from public.post_hashtags;   -- must still be 163
--   select count(*) from public.hashtags;        -- must still be 81
--
-- NOTE: the defining migration 20260817051750_hashtag_index.sql was amended to
-- describe the CORRECTED system. Running this rollback puts production back to
-- the old behaviour while that file continues to describe the new one — a
-- deliberate, documented divergence for as long as the rollback is in force.
