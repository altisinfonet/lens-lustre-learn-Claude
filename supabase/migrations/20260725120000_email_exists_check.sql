-- Forgot-password UX: direct account-existence check.
--
-- Owner's explicit product decision (2026-07-25): instead of the generic
-- "If an account exists for X, we've sent a link" message, the forgot-password
-- page tells the user plainly whether an account exists, and routes them to
-- signup when it doesn't. This function is the backing check.
--
-- Trade-off (accepted by owner): this makes email enumeration possible via the
-- RPC. Supabase's built-in auth rate limits still apply to the actual reset
-- email sending; the check itself is a cheap indexed lookup.
create or replace function public.email_exists(_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(_email)
  );
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;
