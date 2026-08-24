-- ═══════════════════════════════════════════════════════════════════════════
-- ADMIN USER LIST — PAGINATION, AND SERVER-SIDE ROLE/BADGE FILTERING.
--
-- WHAT BROKE, AND WHEN
--
-- `admin_search_users` ends its empty-search branch with:
--
--     ORDER BY p.created_at DESC LIMIT 100
--
-- That keeps the hundred NEWEST profiles. Nothing in the UI can reach row 101.
-- profiles crossed 100 rows on 2026-08-21 05:14 UTC (signup #101). At that
-- instant the OLDEST profile — `50mm Retina World`, 4c200b33-…, created
-- 2026-02-25 03:40:24, the owner's own account and the only holder of the
-- `admin` role — fell off the bottom of the list and became invisible.
-- The second-oldest (`Dipannita Sen`) followed on 2026-08-22 09:48 UTC.
--
-- The role filter failed for the same reason, one layer down. AdminUsers.tsx
-- reads user_roles for the role's holders, then intersects that id set with
-- whatever admin_search_users returned — CLIENT-SIDE, against the truncated
-- hundred. The only admin was not in the hundred, so the intersection was
-- empty and the screen rendered "no users found" for a role that has a holder.
--
-- Measured at the time of writing: 102 profiles; role admin 1 holder, 1
-- invisible; badge verified 6 holders, 1 invisible; role user 102 holders,
-- 2 invisible.
--
-- WHY A NEW FUNCTION RATHER THAN A REPLACEMENT
--
-- CREATE OR REPLACE cannot add a column to a function's return type, and this
-- one must return total_count. Replacing v1 in place would mean DROP + CREATE,
-- and the live admin page would break between this migration and the UI
-- deploy. v1 is therefore left untouched and keeps serving until the UI moves.
-- Retiring v1 is a separate, later migration.
--
-- THREE THINGS THIS CHANGES
--
--   1. Paging. _limit / _offset, so the UI can offer numbered pages 1..N.
--   2. Filtering moves INTO the SQL. Role and badge are applied before the
--      limit, never after it. This is the actual defect, not the limit.
--   3. total_count is returned on every row, so the UI can render
--      "Page 3 of 42 — 4,182 members" and can never silently truncate again.
--
-- ORDERING. `created_at DESC, id DESC`. The id tiebreak is not decoration:
-- with OFFSET paging, any two rows sharing a created_at can swap places
-- between two queries, which makes a row appear on both page 1 and page 2, or
-- on neither. A total order is what makes the pages disjoint and complete.
--
-- NOT INCLUDED, DELIBERATELY. Deep OFFSET is O(offset) — page 41,000 of
-- 42,000 makes Postgres walk past 4.1M rows. Immaterial at 102 profiles and
-- fine into the low hundreds of thousands. Keyset paging is the answer beyond
-- that, and it is a different UI (Next/Prev, no jump-to-page). Owner chose
-- numbered pages on 2026-08-24 with that trade-off stated. Likewise, ILIKE
-- '%…%' cannot use a btree index; a pg_trgm index on full_name is the fix at
-- millions of rows and is deliberately left out of this migration.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The ordering index ────────────────────────────────────────────────────
-- profiles has NO index on created_at today (verified against production).
-- Every admin list load is a full scan plus a sort. Harmless at 102 rows,
-- quadratically less harmless later. The index matches the ORDER BY exactly,
-- tiebreak included, so the planner can walk it instead of sorting.
create index if not exists idx_profiles_created_at_id_desc
  on public.profiles (created_at desc, id desc);

-- ── admin_search_users_v2 ─────────────────────────────────────────────────
create or replace function public.admin_search_users_v2(
  _query  text    default '',
  _by     text    default 'name',
  _role   text    default null,
  _badge  text    default null,
  _limit  integer default 100,
  _offset integer default 0
)
returns table (
  id                uuid,
  email             text,
  full_name         text,
  avatar_url        text,
  bio               text,
  is_suspended      boolean,
  suspended_until   timestamp with time zone,
  suspension_reason text,
  created_at        timestamp with time zone,
  total_count       bigint
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Clamped, not trusted. A caller asking for 10,000,000 rows gets 200; a
  -- negative offset becomes 0. The client is not the authority on page size.
  v_limit  integer := least(greatest(coalesce(_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(_offset, 0), 0);
  v_query  text    := coalesce(_query, '');
begin
  -- Identical authorization to v1. Unchanged on purpose: this migration fixes
  -- a visibility defect and must not touch the access boundary.
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Not authorized';
  end if;

  return query
  with matched as (
    select
      p.id,
      au.email::text as email,
      p.full_name,
      p.avatar_url,
      p.bio,
      p.is_suspended,
      p.suspended_until,
      p.suspension_reason,
      p.created_at
    from public.profiles p
    left join auth.users au on au.id = p.id
    where
      -- Search. Empty query matches everything, which is the default list.
      (
        v_query = ''
        or (_by = 'email' and au.email ilike '%' || v_query || '%')
        or (_by <> 'email' and p.full_name ilike '%' || v_query || '%')
      )
      -- Role filter, IN SQL. This is the line whose absence hid the admin.
      and (
        _role is null or _role = ''
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = p.id and ur.role = _role
        )
      )
      -- Badge filter, same reasoning.
      and (
        _badge is null or _badge = ''
        or exists (
          select 1 from public.user_badges ub
          where ub.user_id = p.id and ub.badge_type = _badge
        )
      )
  )
  select
    m.id,
    m.email,
    m.full_name,
    m.avatar_url,
    m.bio,
    m.is_suspended,
    m.suspended_until,
    m.suspension_reason,
    m.created_at,
    -- count(*) over () is the count of the FILTERED set, before limit/offset.
    -- That is what "of 4,182" must mean; counting the page would be a lie.
    count(*) over () as total_count
  from matched m
  order by m.created_at desc, m.id desc
  limit v_limit offset v_offset;
end;
$function$;

-- ── Grants ────────────────────────────────────────────────────────────────
-- Same posture as every other admin RPC: closed to PUBLIC and anon, open to
-- authenticated, with the has_role check above as the real gate. A signed-in
-- non-admin calling this gets 'Not authorized', not data.
revoke all on function public.admin_search_users_v2(text, text, text, text, integer, integer) from public;
revoke all on function public.admin_search_users_v2(text, text, text, text, integer, integer) from anon;
grant execute on function public.admin_search_users_v2(text, text, text, text, integer, integer) to authenticated;
