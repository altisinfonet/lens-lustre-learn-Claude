-- ============================================================================
-- ROLLBACK for 20260815999999_person_name_casing.sql
--
-- ⚠ READ THIS BEFORE RUNNING IT.
--
-- The trigger and the function can be removed cleanly. THE BACKFILL CANNOT BE
-- UNDONE. "AVIJIT SHEEL" became "Avijit Sheel" and the original casing was not
-- kept anywhere — there is no column holding what the member typed, and adding
-- one purely to enable a rollback would mean storing a value the owner has
-- decided must never be displayed.
--
-- So this file restores the BEHAVIOUR (names stop being normalised on write)
-- and not the DATA (the 14 names already corrected stay corrected). That is
-- stated here rather than discovered later, because a rollback file that
-- silently does less than its name implies is worse than none.
--
-- If the original casing is genuinely needed, it is recoverable from a
-- point-in-time restore taken before the migration ran — which is the reason
-- the backup/RESTORE proof is an outstanding item on the plan.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_profiles_normalise_name ON public.profiles;
DROP FUNCTION IF EXISTS public.tg_profiles_normalise_name();
DROP FUNCTION IF EXISTS public.format_person_name(text);
