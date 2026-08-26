-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECTION APPLIED 2026-08-26 (revision 2). PREPARED, NOT COMMITTED, NOT RUN.
--
-- Two defects in the draft as supplied, both found by measurement:
--
-- 1. IT NEVER MENTIONED `certificates_heading_only_for_custom`.
--    The forward migration adds that CHECK; the draft had no step for it.
--    Measured on production 2026-08-26: pg_constraint.conkey for that
--    constraint covers columns (type, heading). PostgreSQL drops a table
--    constraint that involves a dropped column automatically, so step 3 below
--    would have removed it silently. Silent is not the same as documented:
--    anyone running only steps 1-2 keeps the constraint, and anyone reading
--    the file could not tell what happens to it. It is now an explicit step.
--    The explicit DROP is also idempotent (`if exists`) and harmless if the
--    implicit drop has already happened.
--
-- 2. THE BASELINE BLOCK BELOW IS STALE. It was measured 2026-08-25.
--    Re-measured 2026-08-26, read-only:
--        production certificates rows ................ 0   (was 23)
--        production rows with non-null heading ........ 0
--        production admin_list_certificates ........... 12 columns, def md5 10d5b0a1075b2fbeb0dfec9a1a817212
--        staging  admin_list_certificates ............. identical md5
--        certificates table ........................... 18 columns, BOTH lanes identical
--    The original 2026-08-25 figures are retained below unaltered, as
--    measured evidence of that date, and are NOT overwritten.
--
-- ⚠ DEPENDENCY IMPACT, measured 2026-08-26. Dropping and recreating
-- admin_list_certificates in step 2 changes its return type from 12 columns to
-- 11. Any client selecting `heading` from it breaks. The candidate tree
-- 702e5ce ships admin certificate screens that read `heading`. Running this
-- rollback therefore REQUIRES rolling the application back in the same window.
-- No production edge function calls admin_list_certificates (checked against
-- the deployed function list, 2026-08-26).
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- DRAFT ROLLBACK for the migration recorded on staging as
--   20260825101651  certificate_custom_heading
--
-- ⚠ THIS IS A DRAFT, AND IT IS DRAFTED FROM THE DATABASE, NOT FROM A FILE.
--
-- That migration has NO file in the repository. It was applied directly to
-- staging. So this rollback was reconstructed by reading staging's live schema
-- on 2026-08-25, not by reversing a source file. Whoever owns that migration
-- must confirm it matches what they actually wrote before it is trusted.
--
-- WHAT WAS MEASURED ON STAGING ztzutckwdhetphwghuzj:
--   certificates gained one column:  heading  text  NULL  no default
--   certificates rows ......................... 1
--   rows with a non-null heading .............. 0
--   admin_list_certificates now returns 12 columns, including `heading`
--     TABLE(id, user_id, title, description, type, heading, issued_at,
--           is_revoked, revoked_at, revoked_reason, certificate_id, total_count)
--
-- Production jtdtehuqtinjxropkkcn has NEITHER the column nor the function.
--
-- ⚠ WHY STEP 1 IS DROP-THEN-CREATE, NOT CREATE OR REPLACE.
-- `create or replace function` CANNOT change a function's return type. Going
-- from 12 output columns back to 11 requires dropping it first. Any script that
-- tries `create or replace` here fails with
--   "cannot change return type of existing function".
--
-- ⚠ ORDER MATTERS. The function must go first: while it still selects
-- c.heading, dropping the column would leave it broken at its next call.
--
-- ⚠ DATA LOSS. Step 2 destroys every value in certificates.heading. It is
-- empty today. Re-check before running:
--     select count(*) from public.certificates where heading is not null;
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Restore admin_list_certificates to its 11-column form (no `heading`).
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

-- 2. Remove the CHECK that the forward migration added. EXPLICIT, not implied.
--    Postgres would drop this automatically with the column in step 3 (its
--    conkey covers type + heading, confirmed on production 2026-08-26), but a
--    rollback that relies on an implicit side effect is not a readable
--    rollback. Idempotent either way.
alter table public.certificates
  drop constraint if exists certificates_heading_only_for_custom;

-- 3. Remove the column. DESTRUCTIVE — see the warning above.
alter table public.certificates drop column if exists heading;
