-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEDULED POSTS CARRY THEIR THUMBNAILS.
--
-- Phase B, cycle 3c. One additive column.
--
-- THE DEFECT (found in the B3 pre-audit, measured on production):
-- `scheduled_posts` has no thumbnail_urls column, so the client cannot store
-- thumbnails at compose time even though it GENERATES them (the upload path
-- writes a `-thumb.webp` beside every original). The publisher then inserts
-- into `posts` with no `thumbnail_urls`, and the post serves its FULL-SIZE
-- ORIGINAL wherever a thumbnail belongs — a 14.7 MB class of problem
-- PostMedia.tsx already documents. 9 of 210 production posts are in this
-- state today; at least one arrived through this exact path.
--
-- The fix has three parts, and this migration is only the schema part:
--   1. this column;
--   2. the client stores what it already generates (useScheduledPosts.ts);
--   3. the publisher carries it through (publish-scheduled-posts).
-- The 9 existing posts are repaired by the backfill-thumbnails function, run
-- separately — a backfill is an operation, not a schema change.
--
-- Grants: scheduled_posts already carries member grants and RLS policies
-- (sp_select_own / sp_insert_own / sp_update_own_pending / sp_delete_own_pending);
-- a new column on an already-granted table inherits the table's grants, and
-- column-level restriction is not needed here — the member who may write the
-- row may write its thumbnails. Stated so the newTableGrants gate's question
-- has an answer on the record: this migration creates NO new table.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS thumbnail_urls text[];

COMMENT ON COLUMN public.scheduled_posts.thumbnail_urls IS
  'Thumbnails generated at compose time, index-aligned with image_urls. '
  'Carried into posts.thumbnail_urls by publish-scheduled-posts. NULL on rows '
  'scheduled before 2026-08-14; the publisher treats NULL as "none available" '
  'and backfill-thumbnails repairs the published result.';
