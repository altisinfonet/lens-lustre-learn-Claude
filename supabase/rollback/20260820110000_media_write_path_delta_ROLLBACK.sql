-- ROLLBACK for 20260820110000_media_write_path_delta.sql
--
-- SAFE AND COMPLETE. The forward migration adds ONE read-only function and
-- issues no grants, creates no table, alters no policy and writes no row.
-- Dropping it therefore restores the previous state exactly.
--
-- ⚠ WHAT YOU LOSE BY RUNNING THIS. media_write_path_delta() is the only Phase 2
-- instrument that does not live inside the client it watches. Without it, a
-- browser running a pre-write-path bundle can publish legacy-only posts and
-- nothing in the system will say so — that is exactly what happened on
-- 2026-08-20 at 07:08 UTC, and it is why this function was written. Drop it
-- only if it is being replaced by something with the same property.

drop function if exists public.media_write_path_delta(timestamptz);
