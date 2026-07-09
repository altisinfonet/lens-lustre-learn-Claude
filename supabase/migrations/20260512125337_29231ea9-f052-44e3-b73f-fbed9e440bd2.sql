BEGIN;

-- F-1: withdrawal_requests — close cross-user impersonation
ALTER POLICY "Users can create withdrawals"
  ON public.withdrawal_requests
  WITH CHECK (user_id = auth.uid());

-- F-3: wallets — drop unused authenticated INSERT
DROP POLICY "System can insert wallets" ON public.wallets;

-- F-2: wallet_transactions — tighten in place to deposit-pending-only shape
ALTER POLICY "System can insert transactions"
  ON public.wallet_transactions
  WITH CHECK (
    user_id        = auth.uid()
    AND type       = 'deposit'
    AND status     = 'pending'
    AND amount     > 0
    AND balance_after = 0
    AND reference_id   IS NULL
    AND reference_type IS NULL
  );

COMMIT;