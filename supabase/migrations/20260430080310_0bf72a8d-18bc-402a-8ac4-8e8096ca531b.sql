-- Step 0.1 — Pre-flight snapshot of judging tables (idempotent)
-- Creates frozen copies of 4 live tables into _v3_preflight_snapshot_<name>.
-- Rollback: DROP TABLE public._v3_preflight_snapshot_<name>;

DROP TABLE IF EXISTS public._v3_preflight_snapshot_competition_entries;
DROP TABLE IF EXISTS public._v3_preflight_snapshot_judge_decisions;
DROP TABLE IF EXISTS public._v3_preflight_snapshot_judge_tag_assignments;
DROP TABLE IF EXISTS public._v3_preflight_snapshot_judging_tags;

CREATE TABLE public._v3_preflight_snapshot_competition_entries AS
  SELECT *, now() AS _snapshot_at FROM public.competition_entries;

CREATE TABLE public._v3_preflight_snapshot_judge_decisions AS
  SELECT *, now() AS _snapshot_at FROM public.judge_decisions;

CREATE TABLE public._v3_preflight_snapshot_judge_tag_assignments AS
  SELECT *, now() AS _snapshot_at FROM public.judge_tag_assignments;

CREATE TABLE public._v3_preflight_snapshot_judging_tags AS
  SELECT *, now() AS _snapshot_at FROM public.judging_tags;

-- Lock snapshots: no writes allowed (RLS denies all by default; admin-only read)
ALTER TABLE public._v3_preflight_snapshot_competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._v3_preflight_snapshot_judge_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._v3_preflight_snapshot_judge_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._v3_preflight_snapshot_judging_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshot_admin_read_ce" ON public._v3_preflight_snapshot_competition_entries
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "snapshot_admin_read_jd" ON public._v3_preflight_snapshot_judge_decisions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "snapshot_admin_read_jta" ON public._v3_preflight_snapshot_judge_tag_assignments
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "snapshot_admin_read_jt" ON public._v3_preflight_snapshot_judging_tags
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public._v3_preflight_snapshot_competition_entries IS 'v3 preflight snapshot — frozen copy for rollback. Step 0.1.';
COMMENT ON TABLE public._v3_preflight_snapshot_judge_decisions IS 'v3 preflight snapshot — frozen copy for rollback. Step 0.1.';
COMMENT ON TABLE public._v3_preflight_snapshot_judge_tag_assignments IS 'v3 preflight snapshot — frozen copy for rollback. Step 0.1.';
COMMENT ON TABLE public._v3_preflight_snapshot_judging_tags IS 'v3 preflight snapshot — frozen copy for rollback. Step 0.1.';