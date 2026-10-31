-- ═══════════════════════════════════════════════════════════════════════════
-- THE THIRD WRITE SURFACE, FOUND 2026-08-20 DURING THE FINAL CLOSURE AUDIT.
--
-- WHAT WAS MISSED, AND HOW.
--
-- The write-path work closed the composer (`post_publish_with_media`), the
-- draft (`publish_post_draft`) and the scheduler (`publish-scheduled-posts`).
-- A repository-wide re-trace found a fourth path that had been looked at and
-- waved through: `create_system_post`.
--
-- It is SECURITY DEFINER, granted to `authenticated`, and it does a bare
-- INSERT INTO public.posts with `image_urls` and NOTHING ELSE. No
-- media_objects, no post_media, and — worse — no MEDIA-4001, because that
-- counter lives in the composer's client code and this RPC is called from two
-- entirely different places:
--
--   src/pages/MyPhotos.tsx        "added N photos to the album X."
--   src/lib/profilePostHelper.ts  "updated their profile picture."
--
-- So every album upload and every profile-photo change produced a legacy-only
-- post that no counter reported. Measured at the time of this migration: 3
-- system posts existed, 2 of them legacy-only, the newest 2026-08-19.
--
-- ⚠ THE TWO CALLERS ARE NOT THE SAME PROBLEM, AND MUST NOT GET THE SAME FIX.
--
--   MyPhotos      uploads to `avatars/<owner>/my-photos/<album>/<file>` —
--                 written once, never overwritten. IMMUTABLE. These are real
--                 photographs and they belong in the media engine. 15 slides of
--                 exactly this shape (class C) migrated cleanly earlier today.
--
--   profile posts carry `avatars/<owner>/avatar.webp?t=…`, which is MUTABLE by
--                 design — the announcement is *supposed* to show whatever the
--                 member's picture is now. Content identity is meaningless for
--                 it, and `media_mark_ready` refuses it (MEDIA-2102). It cannot
--                 be migrated, today or ever, without changing what the post
--                 means. It stays legacy-only and is COUNTED as such.
--
-- This migration gives the RPC an optional `_media_ids`, so the caller that has
-- real media can supply it and the caller that cannot simply does not.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.create_system_post(
  _content        text,
  _image_url      text,
  _image_urls     text[],
  _thumbnail_urls text[],
  _media_ids      uuid[] default null
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

  -- ── THE ATTACH, GUARDED ─────────────────────────────────────────────────
  --
  -- Same shape as `publish_post_draft`'s DRAFT-005, and for the same reason:
  -- PL/pgSQL's BEGIN…EXCEPTION is a SUBTRANSACTION, so this is all-or-none —
  -- a partial carousel is unreachable — but a refusal must not cost the member
  -- the post. Their photographs are already uploaded and already visible in the
  -- album; losing the announcement on top of that would be a second failure
  -- caused by the first.
  --
  -- `post_attach_media` re-checks everything that matters: ownership,
  -- readiness, ordinal density, and MEDIA-2205 — that each media object's
  -- delivery URL EQUALS image_urls[ord]. Ownership and readiness alone would
  -- accept the member's other photographs; MEDIA-2205 is what pins each
  -- reference to the slide it claims to be.
  IF _media_ids IS NOT NULL AND array_length(_media_ids, 1) > 0 THEN
    BEGIN
      PERFORM public.post_attach_media(_id, _media_ids);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'MEDIA-4008: system post % published without media references: %', _id, SQLERRM;
    END;
  END IF;

  RETURN _id;
END;
$function$;

-- ⚠ THE OLD 4-ARGUMENT OVERLOAD MUST BE DROPPED, NOT LEFT ALONGSIDE.
--
-- Found the hard way while applying this: with a DEFAULT on the fifth argument,
-- a 4-argument call matches BOTH candidates and Postgres refuses it with
-- `function ... is not unique` (42725). Leaving both would have broken the two
-- live callers — profile-photo change and album upload — the moment either ran.
-- The 5-argument version is a strict superset: the existing 4-argument call
-- sites resolve to it unchanged, because `_media_ids` defaults to NULL.
drop function if exists public.create_system_post(text, text, text[], text[]);

-- ⚠ AND THE GRANT MUST BE NARROWED BY HAND.
-- `CREATE OR REPLACE` on a NEW signature takes the server default of EXECUTE to
-- PUBLIC, which silently handed `anon` a post-creating SECURITY DEFINER
-- function. The `auth.uid()` guard refuses it at runtime, but an un-revoked
-- PUBLIC grant on a definer function is not something to leave lying around.
revoke all on function public.create_system_post(text, text, text[], text[], uuid[]) from public, anon;
grant execute on function public.create_system_post(text, text, text[], text[], uuid[]) to authenticated;

comment on function public.create_system_post(text, text, text[], text[], uuid[]) is
  'The only way to create a post_kind=system post. Optionally attaches verified media (guarded, all-or-none). Profile-update posts pass NULL because their avatar URL is mutable and cannot carry content identity — see MEDIA-2102.';
