-- Backfill the missing wallet credit for the orphaned gift announcement.
-- Uses the canonical 8-arg admin_wallet_credit (the only remaining overload after the prior migration).
DO $$
DECLARE
  v_admin_id uuid;
  v_tx_id uuid;
BEGIN
  -- Resolve the admin who issued the gift
  SELECT admin_id INTO v_admin_id
  FROM public.gift_credits
  WHERE id = 'fa7a7396-b118-40af-8252-5359894147c8';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Source gift_credit not found';
  END IF;

  -- Idempotency guard: only credit if no wallet tx already exists for this gift
  IF NOT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE user_id = 'cbb7cda6-484b-4002-a02b-9b6d7c2ae781'
      AND reference_id = 'fa7a7396-b118-40af-8252-5359894147c8'
  ) THEN
    SELECT public.admin_wallet_credit(
      v_admin_id,
      'cbb7cda6-484b-4002-a02b-9b6d7c2ae781'::uuid,
      10::numeric,
      'gift',
      'Gift Test (backfill — duplicate-function bug recovery)',
      'fa7a7396-b118-40af-8252-5359894147c8'::uuid,
      'gift_credit',
      jsonb_build_object('backfill', true, 'reason', 'PGRST203 overload ambiguity')
    ) INTO v_tx_id;

    RAISE NOTICE 'Backfilled wallet tx: %', v_tx_id;
  ELSE
    RAISE NOTICE 'Wallet tx already exists — skipping backfill';
  END IF;
END $$;