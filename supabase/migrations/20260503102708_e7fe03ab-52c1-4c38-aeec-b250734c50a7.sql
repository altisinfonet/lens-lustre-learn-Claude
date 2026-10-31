ALTER TABLE public.v3_mirror_log DROP CONSTRAINT IF EXISTS v3_mirror_log_action_chk;
ALTER TABLE public.v3_mirror_log ADD CONSTRAINT v3_mirror_log_action_chk
  CHECK (action = ANY (ARRAY['upsert','delete','noop','bypassed','error','r4_award_upsert','r4_award_delete']));