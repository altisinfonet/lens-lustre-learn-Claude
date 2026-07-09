-- Phase 2 backfill (separated from the trigger redefinition because the
-- enforce_round_lock guard rejects writes for completed rounds). We bypass
-- the lock for this single backfill statement only.

DO $$
BEGIN
  PERFORM set_config('app.bypass_round_lock', 'on', true);
  PERFORM set_config('app.bypass_mirror_trigger', 'on', true); -- avoid re-firing the trigger we just redefined
END $$;

INSERT INTO public.judge_decisions (entry_id, judge_id, round_number, photo_index, decision)
SELECT jta.entry_id,
       jta.judge_id,
       jta.round_number,
       COALESCE(jta.photo_index, 0),
       sc.decision_token::text
FROM public.judge_tag_assignments jta
JOIN public.judging_tags jt ON jt.id = jta.tag_id
JOIN public.v3_stage_catalog sc
  ON sc.is_active = true
 AND sc.round_number = jta.round_number
 AND lower(trim(sc.tag_label_canonical)) = lower(trim(
       CASE lower(trim(jt.label))
         WHEN 'accept for round 2'        THEN 'Accepted in Round 2'
         WHEN 'shortlist for round 3'     THEN 'Qualified for Round 3'
         WHEN 'qualified for r3'          THEN 'Qualified for Round 3'
         WHEN 'qualified for 3rd round'   THEN 'Qualified for Round 3'
         WHEN 'accept for round 3'        THEN 'Accepted in Round 3'
         WHEN 'shortlist for final round' THEN 'Qualified for Final Round'
         WHEN 'shortlist for final'       THEN 'Qualified for Final Round'
         WHEN 'shortlisted for final'     THEN 'Qualified for Final Round'
         WHEN 'qualified for final'       THEN 'Qualified for Final Round'
         ELSE jt.label
       END))
WHERE jta.round_number IN (2, 3)
ON CONFLICT (entry_id, judge_id, round_number, photo_index)
DO UPDATE SET decision = EXCLUDED.decision, updated_at = now();

DO $$
BEGIN
  PERFORM set_config('app.bypass_round_lock', 'off', true);
  PERFORM set_config('app.bypass_mirror_trigger', 'off', true);
END $$;