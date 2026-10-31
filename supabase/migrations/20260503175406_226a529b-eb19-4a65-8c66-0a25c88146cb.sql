ALTER TABLE public.v3_mirror_log
  DROP CONSTRAINT v3_mirror_log_action_chk;

ALTER TABLE public.v3_mirror_log
  ADD CONSTRAINT v3_mirror_log_action_chk
  CHECK (action IN (
    'upsert',
    'delete',
    'noop',
    'bypassed',
    'error',
    'r4_award_upsert',
    'r4_award_delete',
    'alias_resolved',
    'upsert_via_alias',
    'noop_alias_miss'
  ));