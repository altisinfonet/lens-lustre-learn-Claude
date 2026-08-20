-- ═══════════════════════════════════════════════════════════════════════════
-- ✔ APPLIED TO PRODUCTION 2026-08-20 18:08 UTC as version 20260820180836.
--
-- Approved by the owner the same day ("DECISION 3 — APPROVE EXECUTION") after
-- the corrected gates were re-verified read-only: 8 posts / 20 slides /
-- 0 missing targets. Execution passed all three gates and every independent
-- post-check: the 8 posts' after-state matched the predicted digest exactly,
-- all other posts' digest was byte-identical, storage digest unchanged
-- (116 objects), post_media/media_objects untouched (263/265, ref_set_md5
-- dce7bec802523fca3b0a4123ea0a2a6f), rollback captured in media_repair_audit.
--
-- This file previously carried the UNAPPLIED_ prefix; the annotations below
-- are preserved as written for provenance.
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IT REPAIRS
--
-- ⚠ NUMBERS CORRECTED 2026-08-20 (WORKSTREAM 3). This header previously read
-- "17 slides across 15 posts", which mixed two different counts and did not
-- match what the statement below actually selects. Re-derived from production:
--
--     17  DISTINCT OBJECTS have a surviving 1920px original
--     20  SLIDE POSITIONS reference those 17 objects (4 objects are shared)
--      8  POSTS would actually change
--     15  POSTS carry a Supabase -thumb slide at all (7 of them cannot change,
--         because for their objects the original is gone — see note 1)
--
-- The 600px thumbnails display where the member's photograph should be. The
-- 1920px original is present in storage for every one of the 17. Evidence, per
-- object, is in docs/LEGACY_MEDIA_EVIDENCE_MATRIX.md; re-measured 2026-08-20
-- by retrieval (every thumb exactly 600px on its long edge, every original
-- exactly 1920px).
--
-- The pairing is proven rather than assumed: both files were fetched and measured
-- from their header bytes. Every thumb is exactly 600px on its long edge, every
-- original exactly 1920px, and every aspect ratio matches to within integer
-- rounding at 600px (largest difference 0.0011).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY IT IS NOT APPLIED
--
-- It rewrites what 15 posts show to their members. Higher fidelity, same
-- photograph — but unasked. The closure command's rule 4 is "no blind reference
-- rewriting"; this would not be blind, and it would still be unasked.
--
-- ⚠ THREE THINGS TO KNOW BEFORE ENABLING IT
--
--   1. SIX OBJECTS (7 slide positions, across 7 posts) ARE NOT TOUCHED and must
--      not be. Their originals are
--      GONE (avatar/cover objects overwritten long ago), so the thumbnail is the
--      only surviving copy. The WHERE clause below reaches them only if the
--      original exists in storage.objects, which for those six it does not.
--
--   2. TWO OBJECTS ARE SHARED BY TWO POSTS EACH. The rewrite is per-slide across
--      all referring posts, which is correct — but it means the blast radius is
--      posts, not objects.
--
--   3. THIS DOES NOT MIGRATE ANYTHING. These objects live on supabase.co and the
--      migrator only accepts cdn.50mmretina.com (MIG-1015/MIG-1080). After this
--      repair they are still legacy-only. Whether to copy them to R2 is a
--      separate question and is deliberately not answered here.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- HOW TO UNDO IT
--
-- Every rewritten array is captured whole in `media_repair_audit` BEFORE the
-- update. The rollback file restores from that table, so the undo is exact —
-- not a reconstruction.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.media_repair_audit (
  id            bigserial primary key,
  repaired_at   timestamptz not null default now(),
  repair        text        not null,
  post_id       uuid        not null,
  image_urls_before text[]  not null,
  image_urls_after  text[]  not null
);

-- No client ever reads this. It is an audit trail, not an API.
revoke all on table public.media_repair_audit from public, anon, authenticated;

-- ⚠ PROVENANCE NOTE, 2026-08-20. The line below was NOT part of the script
-- executed as version 20260820180836 — the newTableGrants gate caught the
-- omission eleven minutes later, and it was applied to production as its own
-- migration, 20260820181949_media_repair_audit_rls (kept beside this file and
-- idempotent). It is included here so this file records the table's complete
-- intended definition and so a fresh environment replaying the ledger reaches
-- the same end state at this point. Enabled RLS with zero policies is deny-all
-- for every non-owner role; service_role bypasses RLS and keeps the audit.
alter table public.media_repair_audit enable row level security;

with candidates as (
  select p.id as post_id, p.image_urls as before_urls,
         array(
           select case
             when u.url ~ '^https://jtdtehuqtinjxropkkcn\.supabase\.co/storage/v1/object/public/post-images/.*-thumb\.webp$'
              and exists (
                    select 1 from storage.objects o
                    where o.bucket_id = 'post-images'
                      and o.name = regexp_replace(
                            replace(u.url,'https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/',''),
                            '-thumb\.webp$', '.webp')
                  )
             then regexp_replace(u.url, '-thumb\.webp$', '.webp')
             else u.url
           end
           from unnest(p.image_urls) with ordinality as u(url, ord)
           order by u.ord
         ) as after_urls
  from public.posts p
  where coalesce(array_length(p.image_urls,1),0) > 0
    and not exists (select 1 from public.post_media pm where pm.post_id = p.id)
),
changed as (select * from candidates where before_urls is distinct from after_urls)
insert into public.media_repair_audit (repair, post_id, image_urls_before, image_urls_after)
select 'classF_repoint_originals', post_id, before_urls, after_urls from changed;

update public.posts p
set image_urls = a.image_urls_after,
    image_url  = a.image_urls_after[1]
from public.media_repair_audit a
where a.post_id = p.id
  and a.repair = 'classF_repoint_originals'
  and a.repaired_at > now() - interval '1 minute';

-- ── THE GATE ───────────────────────────────────────────────────────────────
-- Refuse the whole transaction unless exactly the audited population moved, and
-- unless every rewritten URL now resolves to an object that really exists.
-- A repair that silently touched a different number of rows is not a repair.
--
-- ⚠ CORRECTED 2026-08-20 (WORKSTREAM 3). This gate compared the number of
-- CHANGED posts against 15 — the number of posts in the class-F POPULATION.
-- Only 8 of those 15 can change, because for the other 7 the original is gone,
-- so `changed` filters them out one CTE earlier. Evaluated read-only against
-- production, the statement above selects 8 posts / 20 slides, so this file as
-- written would have aborted with REPAIR-001 on its very first run — from the
-- day it was written. The gate was right to refuse; the constant was wrong.
--
-- Both numbers are now checked, because posts alone cannot tell a 4-slide post
-- from a 1-slide one.
do $$
declare _n int; _slides int; _bad int;
begin
  select count(*) into _n from public.media_repair_audit
   where repair='classF_repoint_originals' and repaired_at > now() - interval '1 minute';
  if _n <> 8 then
    raise exception 'REPAIR-001: expected 8 posts to change, audited %', _n;
  end if;

  select count(*) into _slides
    from public.media_repair_audit a
    cross join lateral unnest(a.image_urls_before) with ordinality b(u, i)
    cross join lateral unnest(a.image_urls_after)  with ordinality c(v, j)
   where a.repair='classF_repoint_originals'
     and a.repaired_at > now() - interval '1 minute'
     and b.i = c.j and b.u is distinct from c.v;
  if _slides <> 20 then
    raise exception 'REPAIR-003: expected 20 slides to change, changed %', _slides;
  end if;
  select count(*) into _bad
    from public.media_repair_audit a
    cross join lateral unnest(a.image_urls_after) as x(url)
   where a.repair='classF_repoint_originals'
     and a.repaired_at > now() - interval '1 minute'
     and x.url ~ 'supabase\.co'
     and not exists (
       select 1 from storage.objects o
        where o.bucket_id='post-images'
          and o.name = replace(x.url,'https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/','')
     );
  if _bad > 0 then
    raise exception 'REPAIR-002: % rewritten URLs point at objects that do not exist', _bad;
  end if;
end $$;

commit;
