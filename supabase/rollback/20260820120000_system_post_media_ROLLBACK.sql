-- ROLLBACK for 20260820120000_system_post_media.sql
--
-- Restores the 4-argument `create_system_post` exactly as it was before, and
-- drops the 5-argument overload.
--
-- ⚠ WHAT YOU LOSE. Album posts from MyPhotos go back to being created
-- image_urls-only, with no media_objects and no post_media — and, because the
-- MEDIA-4001 counter lives in the composer's client code and not here, with
-- nothing reporting it. That is the exact hole this migration closed: on
-- 2026-08-20 there were 3 system posts, 2 of them legacy-only, and no counter
-- had ever mentioned them.
--
-- Run this only if the guarded attach is causing harm, and re-open the delta
-- question the same day.

drop function if exists public.create_system_post(text, text, text[], text[], uuid[]);

create or replace function public.create_system_post(
  _content        text,
  _image_url      text,
  _image_urls     text[],
  _thumbnail_urls text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
DECLARE
  _uid uuid := auth.uid();
  _id  uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH-0001: sign-in required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.posts (user_id, content, image_url, image_urls, thumbnail_urls, privacy, post_kind, categories)
  VALUES (_uid, _content, _image_url, COALESCE(_image_urls,'{}'), _thumbnail_urls, 'public', 'system', '{}')
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

grant execute on function public.create_system_post(text, text, text[], text[]) to authenticated;
