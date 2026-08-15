-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260814090000_queue_and_writer_authority.sql
--
-- ⚠ THIS RESTORES A KNOWN EXPOSURE. It exists because the project rule is that
-- every migration has a matching rollback, and a rollback that has never been
-- written is a rollback that does not work. It is not a recommendation.
--
-- Restoring these grants makes `/rest/v1/rpc/move_to_dlq` callable with the
-- public anon key, which permits `pgmq.delete()` against any queue by id —
-- including pending authentication mail.
--
-- If this file is ever run, the only acceptable next step is a corrected
-- forward migration in the same session.
--
-- The function body is restored to the definition read from production with
-- pg_get_functiondef on 2026-08-14, before the forward migration.
-- CREATE OR REPLACE, not DROP — the signature is unchanged, so trap #3 does not
-- apply.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue text, dlq_name text, message_id bigint, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$function$;

-- Exactly what production held before the forward migration.
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)
  TO anon, authenticated, service_role, PUBLIC;
GRANT EXECUTE ON FUNCTION public._ensure_stats_row(uuid)
  TO anon, authenticated, service_role, PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_push_outcome(uuid, uuid, text, text, text)
  TO anon, authenticated, service_role, PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_diff_snapshot(interval)
  TO anon, authenticated, service_role, PUBLIC;

COMMIT;
