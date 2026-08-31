-- ═══════════════════════════════════════════════════════════════════════════
-- GIFT BY EMAIL — AN INDEXED LOOKUP, NOT A SCAN.
--
-- APPLIED: production 20260824145345 · staging 20260824145121 (2026-08-24).
-- Edge function `send-gift-credit` v23 deployed the same day.
--
-- WHAT BROKE
--
-- `send-gift-credit` resolved a recipient like this:
--
--     const { data } = await supabase.auth.admin.listUsers();   // page 1 only
--     const hit = data?.users?.find(u => u.email === target);    // search 50 rows
--     if (!hit) return 404 "User with this email not found";
--
-- `listUsers()` with no arguments returns ONE PAGE — 50 users. The lookup
-- searched that slice in JavaScript. It worked while the platform was small.
--
-- Measured in production 2026-08-24: 102 auth users, so 52+ were unreachable
-- under any ordering. `pradiptac@gmail.com` (id 85250f9f-…, confirmed, not
-- deleted, not banned) got 404 "not found" for an account that plainly exists.
-- The 50th user signed up 2026-07-29 17:05 UTC; that is when gifting by email
-- began failing. The successful gifts in the history were sent when auth.users
-- held 12 rows, which is why nobody noticed for a month.
--
-- WHY NOT JUST PAGE THROUGH listUsers()
--
-- Because that is O(n) in members. At 100k users a single gift would make 500
-- admin API calls; at 10M it is not a feature, it is an outage. Paging trades
-- a wrong answer for a slow one. The right shape is a single indexed lookup,
-- which is what this function is: one round trip, O(log n), constant whether
-- the platform has 100 members or 100 million.
--
-- WHY THIS IS SAFE TO READ auth.users
--
-- SECURITY DEFINER with a pinned search_path, and EXECUTE granted to
-- `service_role` ONLY — never anon, never authenticated. It is reachable only
-- from an edge function that has already verified the caller is an admin. It
-- returns a uuid and nothing else: no password hash, no token, no metadata.
-- Passing an unregistered address returns NULL — it cannot be used to read a
-- user's data, only to learn whether an address is registered, which the gift
-- form's own 404 already told the admin.
--
-- INDEX. `auth.users` already carries `idx_users_email` (btree on email) and
-- `users_email_partial_key` (unique on email where not is_sso_user). Measured
-- 2026-08-24: 0 of 102 emails contain an uppercase character and 0 are SSO
-- users — GoTrue normalises addresses to lowercase on signup. The predicate is
-- therefore an equality on the stored column, which uses those indexes
-- directly; `lower(email) = …` would not, and would force a sequential scan —
-- exactly the O(n) behaviour this migration exists to remove. The caller is
-- responsible for lowercasing its input, and the edge function does.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_lookup_user_id_by_email(_email text)
returns uuid
language sql
security definer
stable
set search_path to 'public', 'auth'
as $function$
  select u.id
  from auth.users u
  where u.email = lower(trim(coalesce(_email, '')))
    and u.deleted_at is null
  limit 1;
$function$;

-- ── Bulk id -> email, for the notification list ───────────────────────────
-- The same bare `listUsers()` appeared a second time in send-gift-credit,
-- building an id->email map. That one did not 404 — it silently dropped every
-- recipient past the first page from the notification list, which is the
-- quieter and more dangerous half of the same defect.
create or replace function public.admin_emails_for_user_ids(_ids uuid[])
returns table (user_id uuid, email text)
language sql
security definer
stable
set search_path to 'public', 'auth'
as $function$
  select u.id, u.email::text
  from auth.users u
  where u.id = any(coalesce(_ids, '{}'::uuid[]))
    and u.deleted_at is null;
$function$;

-- ── Grants ────────────────────────────────────────────────────────────────
-- service_role ONLY. These read auth.users; no client role may call them.
revoke all on function public.admin_lookup_user_id_by_email(text) from public;
revoke all on function public.admin_lookup_user_id_by_email(text) from anon;
revoke all on function public.admin_lookup_user_id_by_email(text) from authenticated;
grant execute on function public.admin_lookup_user_id_by_email(text) to service_role;

revoke all on function public.admin_emails_for_user_ids(uuid[]) from public;
revoke all on function public.admin_emails_for_user_ids(uuid[]) from anon;
revoke all on function public.admin_emails_for_user_ids(uuid[]) from authenticated;
grant execute on function public.admin_emails_for_user_ids(uuid[]) to service_role;
