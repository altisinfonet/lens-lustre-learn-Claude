-- ═══════════════════════════════════════════════════════════════════════════
-- THE HEADING LINE ON A CUSTOM CERTIFICATE, WRITTEN BY THE ADMIN.
--
-- Under the word CERTIFICATE the renderer prints a second line: OF COMPLETION,
-- OF MERIT, OF ACHIEVEMENT and so on, chosen by the certificate's type. That
-- is right for the fifteen types that describe a known occasion.
--
-- `custom` exists precisely because the occasion is NOT one of those, so a
-- fixed OF ACHIEVEMENT is the one line on the page the admin cannot say. This
-- column is that line.
--
-- ⚠ CONSTRAINED TO `custom` ON PURPOSE. A competition award or a course
-- certificate must keep the heading its type dictates — otherwise an admin
-- could quietly retitle a Top 50 certificate and the wording would no longer
-- match what the placement actually was. The CHECK makes that impossible
-- rather than merely discouraged.
--
-- NULL or blank falls back to OF ACHIEVEMENT, which is what `custom` prints
-- today, so every existing custom certificate is unchanged by this migration.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.certificates
  add column if not exists heading text;

alter table public.certificates
  drop constraint if exists certificates_heading_only_for_custom;

alter table public.certificates
  add constraint certificates_heading_only_for_custom check (
    heading is null
    or (type = 'custom' and length(btrim(heading)) between 1 and 60)
  );

comment on column public.certificates.heading is
  'Custom certificates only: the line printed under CERTIFICATE, e.g. "OF APPRECIATION". NULL falls back to OF ACHIEVEMENT.';

-- ── admin_list_certificates must return it ────────────────────────────────
-- The function has an explicit column list, so a new column is invisible to
-- the admin screen until it is named here. Body otherwise unchanged.
--
-- ⚠ DROPPED FIRST, NOT `create or replace`. Postgres refuses to change the row
-- type defined by a function's OUT parameters in place:
--   42P13 cannot change return type of existing function
-- The drop and the recreate run in the same migration, so there is no window in
-- which the admin screen has no function to call, and the grants below restore
-- the exact posture it had before.
drop function if exists public.admin_list_certificates(text, text, integer, integer);

create function public.admin_list_certificates(
  _query  text    default '',
  _type   text    default null,
  _limit  integer default 100,
  _offset integer default 0
)
returns table (
  id              uuid,
  user_id         uuid,
  title           text,
  description     text,
  type            text,
  heading         text,
  issued_at       timestamp with time zone,
  is_revoked      boolean,
  revoked_at      timestamp with time zone,
  revoked_reason  text,
  certificate_id  text,
  total_count     bigint
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_limit  integer := least(greatest(coalesce(_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(_offset, 0), 0);
  v_q      text    := trim(coalesce(_query, ''));
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Not authorized';
  end if;

  return query
  with matched as (
    select c.id, c.user_id, c.title, c.description, c.type, c.heading, c.issued_at,
           c.is_revoked, c.revoked_at, c.revoked_reason, c.certificate_id::text
    from public.certificates c
    where (v_q = '' or c.title ilike '%' || v_q || '%')
      and (_type is null or _type = '' or c.type = _type)
  )
  select m.id, m.user_id, m.title, m.description, m.type, m.heading, m.issued_at,
         m.is_revoked, m.revoked_at, m.revoked_reason, m.certificate_id,
         count(*) over () as total_count
  from matched m
  order by m.issued_at desc, m.id desc
  limit v_limit offset v_offset;
end;
$function$;

revoke all on function public.admin_list_certificates(text, text, integer, integer) from public;
revoke all on function public.admin_list_certificates(text, text, integer, integer) from anon;
grant execute on function public.admin_list_certificates(text, text, integer, integer) to authenticated;
