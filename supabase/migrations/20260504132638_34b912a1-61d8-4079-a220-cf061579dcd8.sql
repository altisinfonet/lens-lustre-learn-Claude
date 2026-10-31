-- B1b-MUST-DO: Strip anon write/admin privileges on 9 judging tables.
-- Idempotent: REVOKE on already-missing privileges is a no-op.
-- Reversible: see rollback in the chat.
-- Keeps anon SELECT (RLS still gates row visibility).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'judge_decisions',
    'judge_tag_assignments',
    'judging_tags',
    'judge_scores',
    'v3_stage_catalog',
    'v3_mirror_log',
    'judge_sessions',
    'judging_rounds',
    'judging_config'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon',
      t
    );
  END LOOP;
END $$;