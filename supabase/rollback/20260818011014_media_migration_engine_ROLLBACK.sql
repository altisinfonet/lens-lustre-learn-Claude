-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260817170000_media_migration_engine.sql
--
-- Safe by construction: the forward migration creates three functions and
-- nothing else. It adds no table, no column, no constraint, no trigger, no
-- grant to a client role, and it changes no existing object. Dropping the three
-- functions therefore restores the schema exactly.
--
-- ⚠ NO DATA IS TOUCHED EITHER WAY. Nothing here deletes a row. If
-- `media_migrate_post` has already been used, the media_objects and post_media
-- rows it wrote SURVIVE this rollback — removing them is a separate, deliberate
-- decision and must not ride along with dropping a function.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.media_migration_reconcile();
drop function if exists public.media_migrate_post(uuid, uuid, jsonb);
drop function if exists public.media_migration_fence_digest(timestamptz);

-- ── VERIFY THE ROLLBACK ───────────────────────────────────────────────────
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('media_migrate_post','media_migration_fence_digest',
--                        'media_migration_reconcile');
--     -- expect 0
--
--   select count(*) from public.media_objects;   -- unchanged by this rollback
--   select count(*) from public.post_media;      -- unchanged by this rollback
