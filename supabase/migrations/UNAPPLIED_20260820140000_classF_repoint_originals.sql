-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ NOT APPLIED. NOT A MIGRATION YET. RENAME TO ENABLE.
--
-- The `UNAPPLIED_` prefix keeps this out of the migration ledger on purpose.
-- It is a prepared, reversible repair awaiting an owner decision, not work that
-- was done and is being recorded.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IT REPAIRS
--
-- 17 slides across 15 posts display a 600-pixel THUMBNAIL where the member's
-- photograph should be. The 1920-pixel original is present in storage for every
-- one of them. Evidence, per object, is in docs/LEGACY_MEDIA_EVIDENCE_MATRIX.md.
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
--   1. SIX MORE SLIDES ARE NOT TOUCHED and must not be. Their originals are
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
-- Refuse the whole transaction unless exactly the 15 audited posts moved, and
-- unless every rewritten URL now resolves to an object that really exists.
-- A repair that silently touched a different number of rows is not a repair.
do $$
declare _n int; _bad int;
begin
  select count(*) into _n from public.media_repair_audit
   where repair='classF_repoint_originals' and repaired_at > now() - interval '1 minute';
  if _n <> 15 then
    raise exception 'REPAIR-001: expected 15 posts, audited %', _n;
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
