BEGIN;
DROP POLICY "System can insert transactions" ON public.wallet_transactions;
COMMIT;