-- Phase 1A Step A — enable service_role to invoke wallet_ledger_apply_v2 in dry-run.
-- Live branch still raises P0001; mutation remains structurally impossible.
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(
  text, uuid, numeric, text, text, text, text, boolean
) TO service_role;