-- B2 MUST-DO #1: Drop duplicate mirror trigger on judge_tag_assignments.
-- Parity proven: tr_* and trg_* are byte-identical (same timing AFTER, events
-- INSERT|UPDATE|DELETE, FOR EACH ROW, no WHEN, same function, tgtype=29).
-- Function idempotency proven: both judge_decisions and judge_award_tags use
-- ON CONFLICT ... DO UPDATE. Duplicate trigger only inflated v3_mirror_log 2x.
--
-- Canonical kept: trg_mirror_system_tag_to_decision (matches project trg_* convention).
-- Dropped:        tr_mirror_system_tag_to_decision (legacy non-standard prefix).
--
-- ROLLBACK (run if needed):
-- CREATE TRIGGER tr_mirror_system_tag_to_decision
--   AFTER INSERT OR UPDATE OR DELETE ON public.judge_tag_assignments
--   FOR EACH ROW EXECUTE FUNCTION public.mirror_system_tag_to_decision();

DROP TRIGGER IF EXISTS tr_mirror_system_tag_to_decision ON public.judge_tag_assignments;