-- ═══════════════════════════════════════════════════════════════════════════
-- THE DELTA CHECK THAT DOES NOT TRUST THE CLIENT.
--
-- WHY THIS EXISTS, WITH THE INCIDENT THAT CAUSED IT.
--
-- On 2026-08-20 at 05:16 UTC the media write path went live. At 07:08:49 a
-- member published one photograph and it landed `image_urls`-only: no
-- media_objects row, no post_media row. The delta grew, which is the single
-- thing Phase 2 exists to stop.
--
-- Every counter built to detect that failed to fire:
--
--   MEDIA-4001..4004  are `logger.warn` calls inside the NEW client code.
--   MEDIA-4005        is inside the scheduled publisher.
--
-- The browser was running a bundle from before the deploy. None of that code
-- was present, so none of it could report its own absence. The edge logs
-- showed no call to media_begin_upload at all, and client_errors held no
-- MEDIA-4001 — the incident was invisible to every instrument aimed at it.
--
-- ⚠ THE LESSON, WRITTEN DOWN SO IT IS NOT RE-LEARNED: a regression detector
-- that ships inside the thing it watches cannot detect the thing not shipping.
-- This function reads only committed rows. It does not care which client
-- wrote them, whether that client is current, or whether it logged anything.
--
-- IT IS READ-ONLY AND IT IS NOT A CLIENT API. No table grants are issued; it
-- is callable by the service role only, which is what the admin health screen
-- and any scheduled check already use. Phase 2's standing rule is that
-- media_objects and post_media carry no client grants, and this does not
-- weaken that by one row.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.media_write_path_delta(_since timestamptz default now() - interval '24 hours')
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with scoped as (
    select p.id,
           coalesce(array_length(p.image_urls, 1), 0) as slides,
           (select count(*) from public.post_media pm where pm.post_id = p.id) as refs,
           p.created_at
    from public.posts p
    where coalesce(array_length(p.image_urls, 1), 0) > 0
  ),
  recent as (select * from scoped where created_at > _since)
  select jsonb_build_object(
    'since', _since,
    'measured_at', now(),
    -- The whole population, so a number can be compared with the closure report.
    'posts_with_images',        (select count(*) from scoped),
    'slides_total',             (select coalesce(sum(slides), 0) from scoped),
    'legacy_only_posts',        (select count(*) from scoped where refs = 0),
    'legacy_only_slides',       (select coalesce(sum(slides), 0) from scoped where refs = 0),
    -- A post holding SOME references but not one per slide. The publish gate
    -- and post_attach_media both make this unreachable; if it is ever non-zero
    -- something wrote post_media directly and the ord set has a hole in it.
    'partial_posts',            (select count(*) from scoped where refs > 0 and refs < slides),
    -- ⚠ THE ONE THAT MATTERS. Anything above zero here means a post created
    -- AFTER the write path shipped still went down the legacy path, and the
    -- legacy-only population is growing rather than shrinking.
    'new_posts',                (select count(*) from recent),
    'new_legacy_only_posts',    (select count(*) from recent where refs = 0),
    'new_legacy_only_slides',   (select coalesce(sum(slides), 0) from recent where refs = 0),
    'newest_legacy_only_post',  (select max(created_at) from recent where refs = 0),
    'delta_growing',            (select count(*) > 0 from recent where refs = 0)
  );
$function$;

comment on function public.media_write_path_delta(timestamptz) is
  'Phase 2 delta check. Reads committed rows only, so it detects a stale client that cannot report itself. delta_growing=true means a post created since _since landed image_urls-only.';

revoke all on function public.media_write_path_delta(timestamptz) from public, anon, authenticated;
