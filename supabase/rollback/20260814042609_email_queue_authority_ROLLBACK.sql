-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260813200000_email_queue_authority.sql
--
-- ⚠ THIS RESTORES A KNOWN SECURITY EXPOSURE. It exists because the project
-- rule is that every migration has a matching rollback, and because a rollback
-- that has never been written is a rollback that does not work. It is not a
-- recommendation. Restoring these grants makes
-- /rest/v1/rpc/read_email_batch readable by any holder of the public anon key,
-- which means pending authentication mail.
--
-- If this file is ever run, the only acceptable next step is to apply a
-- corrected forward migration in the same session.
--
-- Both function bodies are restored to the definitions read from production
-- with pg_get_functiondef on 2026-08-13, before the forward migration.
-- CREATE OR REPLACE is used, not DROP — the return types are unchanged, so
-- trap #3 does not apply and the grants below are additive rather than
-- reconstructive.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$function$;

-- The exact ACL production held before the forward migration:
--   postgres=X/postgres | service_role=X/postgres | anon=X/postgres | authenticated=X/postgres
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)               TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO anon, authenticated, service_role;

COMMIT;
