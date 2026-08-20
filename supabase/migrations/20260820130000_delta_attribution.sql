-- ═══════════════════════════════════════════════════════════════════════════
-- THE DELTA CHECK LEARNS TO SAY *WHY*.
--
-- `media_write_path_delta` was built this morning to answer one question — is
-- the legacy-only population growing? — and it answered it correctly. But the
-- closure audit found a write surface it could see and could not explain:
-- `create_system_post`, reached from MyPhotos album uploads and from
-- profile-photo changes.
--
-- Those two are not the same thing, and a single number hides the difference:
--
--   ALBUM POSTS      are real photographs at `avatars/<owner>/my-photos/…`,
--                    immutable, and now go through the media engine. A
--                    legacy-only album post is a REGRESSION.
--
--   PROFILE POSTS    point at `avatars/<owner>/avatar.webp?t=…`, which is
--                    overwritten on every profile-photo change. They can never
--                    carry content identity. A legacy-only profile post is
--                    EXPECTED — it is the floor, not a fault.
--
-- ⚠ A DETECTOR THAT CANNOT TELL A FLOOR FROM A LEAK GETS ITS THRESHOLD RAISED
-- AND THEN GETS IGNORED. So the counter now splits the population by whether
-- the media is mutable, and reports the growing edge separately from the floor.
--
-- Still read-only, still committed-rows-only, still no client grants.
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
           p.created_at,
           p.post_kind,
           coalesce(array_length(p.image_urls, 1), 0) as slides,
           (select count(*) from public.post_media pm where pm.post_id = p.id) as refs,
           -- MUTABLE = the object at this key is overwritten in place. Today
           -- that is exactly the avatar/cover pair. Detected by SHAPE, not by
           -- post_kind: the 14 oldest such posts predate post_kind entirely, so
           -- keying off the kind would misclassify every one of them.
           (select bool_or(u.url ~ '^https://cdn\.50mmretina\.com/avatars/[0-9a-f-]{36}/(avatar|cover)\.[A-Za-z0-9]+(\?|$)')
              from unnest(p.image_urls) u(url)) as has_mutable_media
    from public.posts p
    where coalesce(array_length(p.image_urls, 1), 0) > 0
  ),
  legacy as (select * from scoped where refs = 0),
  recent as (select * from scoped where created_at > _since),
  recent_legacy as (select * from recent where refs = 0)
  select jsonb_build_object(
    'since', _since,
    'measured_at', now(),

    'posts_with_images',        (select count(*) from scoped),
    'slides_total',             (select coalesce(sum(slides), 0) from scoped),
    'legacy_only_posts',        (select count(*) from legacy),
    'legacy_only_slides',       (select coalesce(sum(slides), 0) from legacy),
    'partial_posts',            (select count(*) from scoped where refs > 0 and refs < slides),

    -- ── THE FLOOR: legacy-only because it cannot be otherwise ──────────────
    'permanent_legacy_posts',   (select count(*) from legacy where has_mutable_media),
    'permanent_legacy_slides',  (select coalesce(sum(slides), 0) from legacy where has_mutable_media),

    -- ── THE BACKLOG: legacy-only but migratable in principle ───────────────
    'migratable_legacy_posts',  (select count(*) from legacy where not has_mutable_media),
    'migratable_legacy_slides', (select coalesce(sum(slides), 0) from legacy where not has_mutable_media),

    'new_posts',                (select count(*) from recent),
    'new_legacy_only_posts',    (select count(*) from recent_legacy),
    'new_legacy_only_slides',   (select coalesce(sum(slides), 0) from recent_legacy),

    -- ⚠ THE ONE THAT MATTERS. A new legacy-only post whose media is NOT mutable
    -- had no excuse: the media engine could have taken it and did not. This is
    -- the number that must stay at zero, and it is not diluted by the floor.
    'new_unexplained_legacy_posts',
      (select count(*) from recent_legacy where not has_mutable_media),
    'new_permanent_legacy_posts',
      (select count(*) from recent_legacy where has_mutable_media),

    'by_kind', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (select coalesce(post_kind,'(null)') as k, count(*) as n from recent_legacy group by 1) x
    ),

    'newest_legacy_only_post',  (select max(created_at) from recent_legacy),
    'delta_growing',            (select count(*) > 0 from recent_legacy where not has_mutable_media)
  );
$function$;

comment on function public.media_write_path_delta(timestamptz) is
  'Phase 2 delta check. Committed rows only, so a stale client cannot blind it. delta_growing=true means a post created since _since landed image_urls-only WITHOUT the mutable-media excuse. permanent_* is the documented floor (profile/cover announcements); migratable_* is the backlog.';

revoke all on function public.media_write_path_delta(timestamptz) from public, anon, authenticated;
