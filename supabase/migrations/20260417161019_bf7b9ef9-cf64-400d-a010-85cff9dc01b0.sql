-- Step Security Fix 1/3: Remove the dead "WITH CHECK (true)" INSERT policy on
-- public.ai_chat_usage.
--
-- Investigation summary (codebase grep + edge function review):
--   • The only writer is supabase/functions/ask-anything/index.ts which uses
--     the service-role key (`createClient(supabaseUrl, supabaseServiceKey)`).
--   • Service-role bypasses RLS, so this INSERT policy is never exercised.
--   • No client-side `.from('ai_chat_usage').insert(...)` exists.
--
-- The policy is therefore dead code AND a permissive opening (any
-- authenticated user could INSERT arbitrary rows via PostgREST). Drop it.
--
-- Existing policies preserved:
--   • SELECT (Users can view own usage)  — user_id = auth.uid()
--   • UPDATE (Users can update own usage) — user_id = auth.uid()
--
-- RLS remains enabled. Service-role writes continue to work via bypass.

DROP POLICY IF EXISTS "Authenticated users can insert usage"
  ON public.ai_chat_usage;