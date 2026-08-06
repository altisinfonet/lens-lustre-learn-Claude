-- ============================================================================
-- STAGE 2 — the same lock applied to EVERY table a member can write to.
--
-- Stage 1 (20260806150000) proved the mechanism and fixed post_comments.
-- This applies it everywhere. Applied by hand to production 2026-08-06;
-- migrations do not auto-apply on this project, so this file is the record.
--
-- MEASURED BEFORE:  97 tables, 207 write policies, 0 checking the account exists
-- MEASURED AFTER:   0 tables exposed · 97 protected · 291 guard policies
--                   · 356 original PERMISSIVE policies untouched
--
-- WHY A LOOP AND NOT 291 HAND-WRITTEN STATEMENTS: the table list is taken from
-- the database itself, so nothing is missed and nothing is mistyped.
--
-- WHY THIS CANNOT LOCK OUT A REAL MEMBER: a RESTRICTIVE policy is ANDed with
-- the existing rules — it can only ever take access away, never grant it — and
-- account_is_live() was verified on production to return TRUE for a real live
-- member and FALSE only for an account that no longer exists in auth.users.
--
-- Idempotent. Safe to re-run; it skips tables already protected.
--
-- REVERSAL (removes every guard policy this created):
--   do $$ declare r record; begin
--     for r in select tablename, policyname from pg_policies
--              where schemaname='public' and permissive='RESTRICTIVE'
--                and coalesce(with_check,qual) ilike '%account_is_live%'
--     loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
--   end $$;
-- ============================================================================

do $$
declare t text; n int := 0;
begin
  for t in
    select distinct p.tablename
    from pg_policies p
    where p.schemaname = 'public'
      and p.cmd in ('INSERT','UPDATE','DELETE','ALL')
      and coalesce(p.with_check, p.qual) ilike '%auth.uid()%'
      and not exists (
        select 1 from pg_policies q
        where q.schemaname = 'public' and q.tablename = p.tablename
          and q.permissive = 'RESTRICTIVE'
          and coalesce(q.with_check, q.qual) ilike '%account_is_live%')
  loop
    execute format('drop policy if exists %I on public.%I', 'Deleted accounts cannot insert', t);
    execute format('drop policy if exists %I on public.%I', 'Deleted accounts cannot update', t);
    execute format('drop policy if exists %I on public.%I', 'Deleted accounts cannot delete', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check ((select public.account_is_live()))', 'Deleted accounts cannot insert', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using ((select public.account_is_live()))', 'Deleted accounts cannot update', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using ((select public.account_is_live()))', 'Deleted accounts cannot delete', t);
    n := n + 1;
  end loop;
  raise notice 'account-liveness lock applied to % tables', n;
end $$;
