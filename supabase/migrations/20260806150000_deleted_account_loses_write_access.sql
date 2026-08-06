-- ============================================================================
-- A DELETED ACCOUNT MUST LOSE WRITE ACCESS IMMEDIATELY, NOT AN HOUR LATER.
--
-- Owner report, 2026-08-06: "after deleting user still accesing app".
-- He was right, and the client-side fix in build 1054 (AUTH-1005) is not why.
--
-- MEASURED, on production, before this was written:
--   * Deletion genuinely works — admin_delete_auth_user removes the auth.users
--     row and it cascades profiles, auth.sessions and auth.refresh_tokens. No
--     NEW token can be issued.
--   * But the access token already in the member's hand is a signed JWT.
--     PostgREST validates its signature and expiry and NEVER looks up
--     auth.users. auth.uid() keeps returning a valid id for an account that is
--     gone. Token lifetime on this project: 3600s.
--   * 207 of 220 write policies are shaped `auth.uid() = user_id`.
--     ZERO of them check that the account still exists.
--   * post_comments has NO foreign key on user_id, so RLS is the only gate.
--   * The RESTRICTIVE "Banned users cannot comment" policy does not help:
--     is_banned() is a COALESCE, so for a deleted member it returns FALSE —
--     "not banned" — and lets them straight through.
--
-- That last point is the same mistake AUTH-1005 fixed in useAuth.tsx one layer
-- up: treating "the row is gone" as "everything is fine".
--
-- WHY RESTRICTIVE, AND WHY NOT REWRITE THE 207 POLICIES:
-- A RESTRICTIVE policy is ANDed with every existing rule, so it can only ever
-- take access away from someone who should not have it and can never grant
-- any. Rewriting 207 permissive policies to fix this would risk breaking real
-- members' access in 207 places; this risks it in one.
--
-- THE (select ...) WRAPPER IS LOAD-BEARING: it makes Postgres evaluate the
-- function once per statement instead of once per row. Without it this is a
-- genuine performance regression on a free-tier database.
--
-- STAGE 1 — post_comments only, the table proven vulnerable. Further tables
-- follow only once this is confirmed live.
--
-- REVERSAL:
--   drop policy "Deleted accounts cannot comment"        on public.post_comments;
--   drop policy "Deleted accounts cannot edit comments"   on public.post_comments;
--   drop policy "Deleted accounts cannot remove comments" on public.post_comments;
-- ============================================================================

create or replace function public.account_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = auth.uid());
$$;

comment on function public.account_is_live() is
  'True when the caller''s account still exists in auth.users. Used by RESTRICTIVE write policies so a deleted account loses write access immediately instead of when its token expires (up to 3600s later).';

grant execute on function public.account_is_live() to authenticated;

-- Verified on production before the policies were created:
--   account_is_live() = true  for a real live member  -> nobody real is blocked
--   account_is_live() = false for a deleted account   -> the hole closes

drop policy if exists "Deleted accounts cannot comment"        on public.post_comments;
drop policy if exists "Deleted accounts cannot edit comments"   on public.post_comments;
drop policy if exists "Deleted accounts cannot remove comments" on public.post_comments;

create policy "Deleted accounts cannot comment"
  on public.post_comments as restrictive for insert to authenticated
  with check ((select public.account_is_live()));

create policy "Deleted accounts cannot edit comments"
  on public.post_comments as restrictive for update to authenticated
  using ((select public.account_is_live()));

create policy "Deleted accounts cannot remove comments"
  on public.post_comments as restrictive for delete to authenticated
  using ((select public.account_is_live()));
