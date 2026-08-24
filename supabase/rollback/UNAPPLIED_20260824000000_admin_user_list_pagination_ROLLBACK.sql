-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for UNAPPLIED_20260824000000_admin_user_list_pagination.sql
--
-- Safe to run at any time. The forward migration is purely ADDITIVE: it
-- creates one new function and one new index, and touches nothing that
-- existed before. `admin_search_users` (v1) is not modified by the forward
-- migration, so it is not restored here — there is nothing to restore.
--
-- PRECONDITION. Run this only when the UI is NOT calling v2. If
-- AdminUsers.tsx has already been switched to admin_search_users_v2, dropping
-- the function makes the admin member list fail with
-- "Could not find the function public.admin_search_users_v2". Roll the UI
-- back first, or accept that outage knowingly.
--
-- The index drop is separable and almost never wanted: idx_profiles_created_at_id_desc
-- helps any ordering of profiles by recency and harms nothing. Drop it only if
-- you are removing this change wholesale.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.admin_search_users_v2(text, text, text, text, integer, integer);

-- Optional. Comment this line out to keep the index, which is independently useful.
drop index if exists public.idx_profiles_created_at_id_desc;

-- ── Verification after rollback ───────────────────────────────────────────
-- Expect 0 rows from the first, and v1 still present in the second.
--
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_search_users_v2';
--
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_search_users';
