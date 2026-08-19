-- ═══════════════════════════════════════════════════════════════════════════
-- THE MEDIA READ PATH — ONE FUNCTION, AND THE ONLY WAY A CLIENT REACHES
-- media_objects OR post_media.
--
-- WHY A FUNCTION AND NOT A GRANT. Item B measured both. Column-scoped grants on
-- the two tables are correct and fail closed — but the media_objects RLS policy
-- sub-selects post_media and posts, and Postgres cannot index the opaque
-- STABLE SECURITY DEFINER predicate `can_view_post`. Measured on 2026-08-19:
--
--     policy expression   6.211 ms   can_view_post called 254 times
--                                    (Seq Scan on posts — the WHOLE table)
--     this function       0.858 ms   can_view_post called  21 times
--                                    (Index Scan on posts_pkey, loops = page)
--
-- The grant is O(all posts on the platform) per media read. At 254 posts that
-- is 8x the baseline; at 25,000 posts it is a 25,000-row scan per feed page.
-- This function is O(page).
--
-- ⚠ SECURITY DEFINER BYPASSES RLS COMPLETELY. The `can_view_post` line below is
-- the ONLY thing standing between a member's private photograph and the open
-- internet. Item C proved that by deleting it: anon then read a private post's
-- media, 1 row, and a stranger read a friends-only post. postMediaForSecurity
-- must fail if that line is ever removed, and that mutation is the test's whole
-- point.
--
-- WHAT IT CANNOT DO
--   • it cannot return the content digest, the verification timestamp or the
--     quarantine reason — they are not in the return type, which is stronger
--     than a column grant: there is no `select *` against a function result
--   • it cannot be turned into a bulk exporter — 50 ids per call, MEDIA-1001
--   • it cannot be called by an unauthenticated stranger for anything but
--     public media — auth.uid() is NULL and can_view_post refuses
--   • it grants NOTHING on the tables themselves: anon and authenticated keep
--     zero privilege on media_objects and post_media
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.post_media_for(_post_ids uuid[])
returns table (
  post_id     uuid,
  ord         int,
  object_path text,
  width       int,
  height      int,
  mime        text,
  bytes       bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- No input is not an error. A feed page with no posts asks for nothing.
  if _post_ids is null or array_length(_post_ids, 1) is null then
    return;
  end if;

  -- The cap is what stops this becoming a media export API. The feed asks for
  -- 20; the profile grid asks for fewer. 50 is generous and finite.
  if array_length(_post_ids, 1) > 50 then
    raise exception 'MEDIA-1001 at most 50 post ids per call, got %',
      array_length(_post_ids, 1) using errcode = '22023';
  end if;

  return query
    select pm.post_id, pm.ord, mo.derivatives->>'original',
           mo.width, mo.height, mo.mime, mo.bytes
    from public.post_media pm
    join public.media_objects mo on mo.id = pm.media_id
    join public.posts p          on p.id  = pm.post_id
    where pm.post_id = any(_post_ids)
      -- ⚠ DO NOT REMOVE. This is the entire access control.
      and public.can_view_post(auth.uid(), p.user_id, p.privacy)
    order by pm.post_id, pm.ord;
end;
$$;

revoke all on function public.post_media_for(uuid[]) from public;
grant execute on function public.post_media_for(uuid[]) to anon, authenticated;

comment on function public.post_media_for(uuid[]) is
  'The only client read path to post media. SECURITY DEFINER, so can_view_post '
  'in the WHERE clause is the sole access control. Returns no content digest, '
  'no verification timestamp and no quarantine reason. Capped at 50 post ids '
  '(MEDIA-1001). Grants nothing on media_objects or post_media.';

-- ── DELIBERATELY NOT INCLUDED ─────────────────────────────────────────────
-- No GRANT on public.media_objects. No GRANT on public.post_media. Their RLS
-- policies stay exactly as they are; this function does not rely on them and
-- must not be read as replacing them.
