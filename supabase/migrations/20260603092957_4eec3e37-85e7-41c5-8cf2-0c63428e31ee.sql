-- WAVE1-ITEM-1: Revoke anon/PUBLIC EXECUTE on create_pending_deposit
-- Rationale: Authority guard `auth.uid() IS NOT NULL AND auth.uid() <> _user_id`
-- allows anon callers (auth.uid()=NULL) to bypass. Restrict to authenticated+service_role.
-- Rollback: GRANT EXECUTE ON FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text) TO anon;
REVOKE EXECUTE ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) TO authenticated, service_role;