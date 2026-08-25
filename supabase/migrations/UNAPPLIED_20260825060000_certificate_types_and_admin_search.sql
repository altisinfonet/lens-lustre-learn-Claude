-- ═══════════════════════════════════════════════════════════════════════════
-- CERTIFICATES — THE TWO TYPES THE UI OFFERED AND THE DATABASE REFUSED,
-- PLUS AN INDEXED RECIPIENT SEARCH.
--
-- ── 1. `achievement` and `custom` ─────────────────────────────────────────
--
-- AdminCertificates.tsx has offered four types since it was written:
--
--     <option value="course_completion">Course</option>
--     <option value="competition_winner">Winner</option>
--     <option value="achievement">Achievement</option>   <- rejected by the DB
--     <option value="custom">Custom</option>             <- rejected by the DB
--
-- The CHECK constraint permits 14 values and neither of those is among them,
-- so choosing either produced "Create failed" with no explanation. Measured
-- 2026-08-24 on production: 0 of 23 certificates carry either type, because
-- none could ever be written. They were designed and never finished.
--
-- The other twelve permitted types are NOT manual: seven competition awards
-- are written by `trg_auto_certificate_r4_award` when an admin sets a Round-4
-- placement, and the participation/finalist types are requested by the member
-- from their own certificates page. `achievement` and `custom` are the only
-- genuinely hand-issued kinds, which is exactly why the dropdown offered them.
--
-- ⚠ THE CONSTRAINT IS REPLACED, NOT DROPPED-AND-FORGOTTEN. The full list is
-- restated below so the permitted set is readable in one place. Every existing
-- value is carried over verbatim; this migration only ADDS two.
--
-- ── 2. `admin_search_certificate_recipients` ──────────────────────────────
--
-- The admin's recipient lookup was:
--
--     .from("profiles").select("id, full_name").ilike("full_name", `%q%`).limit(1)
--
-- `.limit(1)` takes the FIRST match and says nothing about the rest. Two
-- members called "Pradipta" and the certificate is issued to whichever one
-- Postgres returned first — silently, to the wrong person, with no way for the
-- admin to notice. Email is the only field that reliably separates two people
-- with the same name, and the old lookup did not select it.
--
-- This returns every match with the email, capped and counted, so the UI can
-- show a chooser and say how many were found.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The type constraint ────────────────────────────────────────────────
alter table public.certificates drop constraint if exists certificates_type_check;

alter table public.certificates add constraint certificates_type_check check (
  type = any (array[
    -- Hand-issued by an admin (the only two that are)
    'achievement'::text,                      -- NEW
    'custom'::text,                           -- NEW
    -- Course completion — issue_course_completion_certificate()
    'course_completion'::text,
    -- Competition awards — trg_auto_certificate_r4_award()
    'competition_winner'::text,
    'competition_runner_up_1'::text,
    'competition_runner_up_2'::text,
    'competition_honorary_mention'::text,
    'competition_special_jury'::text,
    'competition_top_50'::text,
    'competition_top_100'::text,
    -- Member-requested from the certificates page
    'winner'::text,
    'finalist'::text,
    'participation_r1'::text,
    'participation_r2'::text,
    'participation_r3'::text,
    'participation_r4'::text
  ])
);

-- ── 2. Recipient search ───────────────────────────────────────────────────
create or replace function public.admin_search_certificate_recipients(
  _query text,
  _limit integer default 20
)
returns table (
  id           uuid,
  full_name    text,
  email        text,
  avatar_url   text,
  total_count  bigint
)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_limit integer := least(greatest(coalesce(_limit, 20), 1), 50);
  v_q     text    := trim(coalesce(_query, ''));
begin
  -- Same authorization posture as every other admin RPC. The caller being an
  -- admin is the gate; SECURITY DEFINER only exists so auth.users is readable
  -- for the email, which is the field that disambiguates two identical names.
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Not authorized';
  end if;

  -- An empty query returns nothing rather than everyone. A blank box is not a
  -- request for the whole member table.
  if v_q = '' then
    return;
  end if;

  return query
  with matched as (
    select p.id, p.full_name, au.email::text as email, p.avatar_url
    from public.profiles p
    left join auth.users au on au.id = p.id
    where p.full_name ilike '%' || v_q || '%'
       or au.email    ilike '%' || v_q || '%'
  )
  select m.id, m.full_name, m.email, m.avatar_url,
         -- Count of ALL matches, before the limit. The UI needs this to say
         -- "showing 20 of 34" instead of implying 20 is everyone.
         count(*) over () as total_count
  from matched m
  order by m.full_name nulls last, m.id
  limit v_limit;
end;
$function$;

revoke all on function public.admin_search_certificate_recipients(text, integer) from public;
revoke all on function public.admin_search_certificate_recipients(text, integer) from anon;
grant execute on function public.admin_search_certificate_recipients(text, integer) to authenticated;

-- ── 3. Paging + counting for the admin certificate list ───────────────────
-- The list was `.order(issued_at desc).limit(50)` with no paging: at 51
-- certificates the oldest silently vanished, the same defect as the member
-- list. Ordering carries an `id` tiebreak so pages cannot overlap or skip.
create or replace function public.admin_list_certificates(
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
    select c.id, c.user_id, c.title, c.description, c.type, c.issued_at,
           c.is_revoked, c.revoked_at, c.revoked_reason, c.certificate_id::text
    from public.certificates c
    where (v_q = '' or c.title ilike '%' || v_q || '%')
      and (_type is null or _type = '' or c.type = _type)
  )
  select m.id, m.user_id, m.title, m.description, m.type, m.issued_at,
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

-- Supports the ORDER BY above, tiebreak included.
create index if not exists idx_certificates_issued_at_id_desc
  on public.certificates (issued_at desc, id desc);
