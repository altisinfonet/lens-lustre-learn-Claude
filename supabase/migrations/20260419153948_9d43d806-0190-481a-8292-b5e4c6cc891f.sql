-- Remove single-photo → entry-status sync (violates per-photo policy)
DROP TRIGGER IF EXISTS trg_sync_entry_status_from_decision ON public.judge_decisions;
DROP FUNCTION IF EXISTS public.sync_entry_status_from_decision();