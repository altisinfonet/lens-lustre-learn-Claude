-- ROLLBACK of 20261113_0800. Drops the three guards; no data was changed by the
-- migration, so nothing else to restore. (This re-opens the three holes.)
BEGIN;
DROP TRIGGER IF EXISTS trg_0_entry_member_write_guard ON public.competition_entries;
DROP TRIGGER IF EXISTS trg_0_certificate_member_request_guard ON public.certificates;
DROP TRIGGER IF EXISTS trg_0_vote_window_guard ON public.competition_votes;
DROP FUNCTION IF EXISTS public.tg_entry_member_write_guard();
DROP FUNCTION IF EXISTS public.tg_certificate_member_request_guard();
DROP FUNCTION IF EXISTS public.tg_vote_window_guard();
COMMIT;
