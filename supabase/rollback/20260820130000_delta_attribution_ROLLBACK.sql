-- ROLLBACK for 20260820130000_delta_attribution.sql
--
-- Restores the flat delta counter from 20260820110000. Re-run that migration's
-- body to get back to the previous definition.
--
-- ⚠ WHAT YOU LOSE. The counter goes back to a single legacy-only number that
-- cannot distinguish the permanent floor (profile-photo announcements, whose
-- media is mutable and can never be registered) from a real regression. That
-- is how a healthy floor starts looking like a growing fault, and how the
-- threshold gets raised until nobody reads the number at all.
--
-- `delta_growing` in particular becomes coarser: it would go true for a
-- profile-photo change, which is expected behaviour and not a defect.

\echo 'Re-apply supabase/migrations/20260820110000_media_write_path_delta.sql to restore the flat counter.'
