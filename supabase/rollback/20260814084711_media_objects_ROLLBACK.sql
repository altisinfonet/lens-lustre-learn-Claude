-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260814084711_media_objects.sql
--
-- The forward migration is purely additive — two new tables, their indexes,
-- their RLS policies and one trigger function. Nothing existing was altered,
-- so the rollback is a clean removal and leaves the database in exactly the
-- pre-migration shape.
--
-- ⚠ THIS IS DESTRUCTIVE OF ANY ROWS THOSE TABLES HOLD.
--
-- That is safe for the window this rollback is written for — the forward
-- migration ships with no writer, no backfill and no reader; `posts.image_urls`
-- and `posts.thumbnail_urls` remain authoritative, so at rollback time both
-- tables are empty by construction. It stops being safe the moment the upload
-- path writes here. The guard is the assertion below rather than a note:
-- if either table has rows, this file ABORTS instead of silently deleting a
-- member's media references.
--
-- If you genuinely intend to discard populated tables, comment out the two
-- assertions deliberately and record why in AI_EVIDENCE.md. Do not delete them.
--
-- ⚠ DROP ORDER IS NOT OBVIOUS, AND THE FIRST VERSION OF THIS FILE GOT IT WRONG.
--
-- The two tables depend on each other in OPPOSITE directions:
--   post_media  --FK-->  media_objects        (so media_objects cannot go first)
--   media_objects_select  --policy body -->  post_media
--                                            (so post_media cannot go first)
--
-- Dropping either table first fails with "other objects depend on it". The
-- round-trip on 2026-08-14 caught this: rollback exited 3 and left all five
-- policies and both tables in place. `DROP ... CASCADE` would paper over it,
-- and would also silently drop anything a LATER migration had attached. So the
-- policy is dropped by name first, and the tables then go in FK order.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE _n bigint;
BEGIN
  IF to_regclass('public.post_media') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.post_media' INTO _n;
    IF _n > 0 THEN
      RAISE EXCEPTION 'ROLLBACK ABORTED: public.post_media holds % row(s). '
        'Dropping it would destroy live media references. Resolve deliberately.', _n;
    END IF;
  END IF;

  IF to_regclass('public.media_objects') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.media_objects' INTO _n;
    IF _n > 0 THEN
      RAISE EXCEPTION 'ROLLBACK ABORTED: public.media_objects holds % row(s). '
        'Dropping it would orphan stored bytes in R2 with no index to find them.', _n;
    END IF;
  END IF;
END $$;

-- The trigger goes with the table, but drop it explicitly so this file is also
-- correct if a future cycle has moved the trigger elsewhere.
DROP TRIGGER IF EXISTS trg_post_media_requires_ready ON public.post_media;

-- Breaks the media_objects -> post_media dependency described above. Named,
-- not CASCADE: this removes exactly what the forward migration created.
DROP POLICY IF EXISTS media_objects_select ON public.media_objects;

DROP TABLE IF EXISTS public.post_media;
DROP TABLE IF EXISTS public.media_objects;

-- After the tables are gone nothing can call it. Dropped by full signature —
-- `DROP FUNCTION public.tg_post_media_requires_ready` without the argument list
-- is ambiguous if an overload is ever added.
DROP FUNCTION IF EXISTS public.tg_post_media_requires_ready();

COMMIT;
