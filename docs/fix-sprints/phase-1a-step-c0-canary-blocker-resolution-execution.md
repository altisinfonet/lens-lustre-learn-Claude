# Phase 1A — Step C0: Canary Blocker Resolution (EXECUTION REPORT)

> **Status:** EXECUTED. C0 ONLY. No caller flipped to `p_dry_run=false`. No canary executed. No wallet balance mutation. No `wallet_transactions` insert. No edge function deployed. No UI change. No cron change.
> **Plan reference:** `docs/fix-sprints/phase-1a-step-c0-canary-blocker-resolution-plan.md`

---

## 0. Guardrails honored

- ✅ C0 ONLY (table + branch F replacement)
- ✅ NO caller change — all 5 edge function callsites still pass `p_dry_run: true`
- ✅ NO `p_dry_run=false` in any deployed edge function
- ✅ NO canary flip
- ✅ NO `wallets` mutation
- ✅ NO `wallet_transactions` INSERT/UPDATE/DELETE
- ✅ NO change to legacy `wallet_transaction()` RPC
- ✅ NO UI change (zero files under `src/`)
- ✅ NO cron change

---

## 1. SQL applied (single migration)

`supabase/migrations/<auto-ts>_wallet_ledger_v2_rows_and_branch_f.sql` (auto-named by tooling).

### A. New table — `public.wallet_ledger_v2_rows`

```sql
CREATE TABLE IF NOT EXISTS public.wallet_ledger_v2_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op              text NOT NULL,
  user_id         uuid NOT NULL,
  amount          numeric NOT NULL,
  idempotency_key text NOT NULL,
  description     text,
  reference_id    text,
  source_path     text,
  balance_before  numeric NOT NULL,
  balance_after   numeric NOT NULL,
  actor_user_id   uuid,
  jwt_role        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_ledger_v2_rows_op_idem_unique UNIQUE (op, idempotency_key)
);

CREATE INDEX IF NOT EXISTS wallet_ledger_v2_rows_user_id_created_at_idx
  ON public.wallet_ledger_v2_rows (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_v2_rows_op_created_at_idx
  ON public.wallet_ledger_v2_rows (op, created_at DESC);

ALTER TABLE public.wallet_ledger_v2_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read wallet_ledger_v2_rows"
  ON public.wallet_ledger_v2_rows FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));

REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_v2_rows
  FROM PUBLIC, anon, authenticated;
```

### B. `wallet_ledger_apply_v2` — branch F replaced (A–E byte-identical)

Branches A (input validation), B (idempotency replay), C (balance read), D (overdraft guard), E (dry-run path) are byte-identical to the pre-migration version. Only branch F was changed:

```sql
-- F. LIVE PATH — append-only insert into wallet_ledger_v2_rows ONLY.
INSERT INTO public.wallet_ledger_v2_rows (...)
VALUES (...)
ON CONFLICT (op, idempotency_key) DO NOTHING
RETURNING id INTO v_v2_row_id;

IF v_v2_row_id IS NULL THEN
  -- race-window replay
  SELECT balance_after INTO v_balance_after FROM ... WHERE op=p_op AND idempotency_key=p_idempotency_key;
  INSERT INTO wallet_ledger_audit_log(... result='replay', dry_run=false ...);
  RETURN jsonb_build_object('ok', true, 'replay', true, 'balance_after', v_balance_after);
END IF;

INSERT INTO wallet_ledger_idempotency(op, idempotency_key, result_txn_id, result_balance_after)
VALUES (p_op, p_idempotency_key, NULL, v_balance_after)
ON CONFLICT (op, idempotency_key) DO NOTHING;

INSERT INTO wallet_ledger_audit_log(... result='live_ok', dry_run=false ...);

RETURN jsonb_build_object('ok', true, 'dry_run', false, 'balance_before', v_balance_before, 'balance_after', v_balance_after, 'v2_row_id', v_v2_row_id);
```

Function permissions re-asserted:

```sql
REVOKE ALL ON FUNCTION public.wallet_ledger_apply_v2(...) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(...) TO service_role;
```

---

## 2. Files touched

| Path | Type | Reason |
|---|---|---|
| `supabase/migrations/20260515120056_*.sql` | new | C0 migration (table + branch F) |
| `docs/fix-sprints/phase-1a-step-c0-canary-blocker-resolution-execution.md` | new | this report |
| `src/integrations/supabase/types.ts` | auto-regenerated | new table appears in generated types only |

**No code in `src/` was edited.** **No edge function was edited or deployed.** **No cron job was touched.**

---

## 3. Verification evidence

### 3.1 Pre-migration baseline (live)

```
wallets_checksum = fd1cc9470fd4f9d2f8709e365e4651ff
wallet_transactions count = 192
```

### 3.2 Synthetic probe (op = `c0_probe`, namespaced, never used by production)

Three calls executed via `supabase--insert` (with cleanup after):

| Call | Args | Result (from `db_audit_logs.operation='c0_probe_results'`) |
|---|---|---|
| 1 — live insert | `p_dry_run=false`, key `c0_probe_key_001` | `ok:true, dry_run:false, balance_before:0, balance_after:0, v2_row_id:f1e3e849-150b-437e-8f65-479d776b896c` |
| 2 — replay same key | `p_dry_run=false`, key `c0_probe_key_001` | `ok:true, replay:true, balance_after:0` (caught by branch B replay; idempotency row already populated) |
| 3 — dry-run unchanged | `p_dry_run=true`, key `c0_probe_key_dry_001` | `ok:true, dry_run:true, balance_before:0, balance_after:0` |

### 3.3 Side-effect inventory (probe row before cleanup)

```
wallets_checksum            = fd1cc9470fd4f9d2f8709e365e4651ff   (UNCHANGED ✅)
wallet_transactions count   = 192                                 (UNCHANGED ✅)
wallet_ledger_v2_rows count = 1   (probe row, op=c0_probe)
wallet_ledger_idempotency op=c0_probe = 1
wallet_ledger_audit_log op=c0_probe   = 3   (live_ok + replay + dry_run_ok)
wallet_ledger_shadow_log op=c0_probe  = 1   (dry-run only)
```

### 3.4 Post-cleanup state

```
wallets_checksum                   = fd1cc9470fd4f9d2f8709e365e4651ff   (UNCHANGED)
wallet_transactions count          = 192                                 (UNCHANGED)
wallet_ledger_v2_rows count        = 0
wallet_ledger_idempotency count    = 0
forbidden grants on v2_rows        = 0   (no INSERT/UPDATE/DELETE for anon/authenticated)
RLS policy count on v2_rows        = 1   (admin SELECT only)
```

### 3.5 Production caller scan

```
$ rg -n "p_dry_run" supabase/functions/
supabase/functions/expire-gift-credits/index.ts:16:      p_dry_run: true,
supabase/functions/paypal-capture-order/index.ts:16:      p_dry_run: true,
supabase/functions/cast-photo-vote/index.ts:44:      p_dry_run: true,
supabase/functions/razorpay-verify-payment/index.ts:21:      p_dry_run: true,
supabase/functions/admin-process-withdrawal/index.ts:16:      p_dry_run: true,
```

All 5 production callers pass `p_dry_run: true`. **Zero callers can reach branch F today.**

---

## 4. Hard invariants confirmed

| Invariant | Evidence |
|---|---|
| Live branch never UPDATEs `wallets` | Probe call did not change wallets_checksum |
| Live branch never INSERTs `wallet_transactions` | wt_count stable at 192 across pre/probe/post |
| Live branch idempotent on duplicate key | Replay call returned `replay:true`, no second v2 row created |
| Dry-run path unchanged | Dry probe returned identical shape, logged to shadow_log + audit_log only |
| Direct DML to `wallet_ledger_v2_rows` blocked for non-admin | REVOKE confirmed; only SELECT policy exists, gated on `has_role(auth.uid(),'admin')` |
| Function still locked to `service_role` | REVOKE ALL + GRANT EXECUTE TO service_role re-asserted |

---

## 5. Untouched systems (re-confirmed live)

- ❎ `public.wallet_transaction()` legacy RPC — definition unchanged, still sole authority on `wallets.balance` + `wallet_transactions`
- ❎ `public.wallets` — no policy, trigger, or column change
- ❎ `public.wallet_transactions` — no policy, trigger, or column change
- ❎ All edge functions — zero deployment, zero file edit
- ❎ All cron jobs — Step B hourly diff monitor still scheduled and untouched
- ❎ All UI under `src/` — zero file edit
- ❎ All RLS policies on existing tables — unchanged

---

## 6. Rollback SQL (verified valid; not executed)

```sql
-- 1. Re-stub branch F
CREATE OR REPLACE FUNCTION public.wallet_ledger_apply_v2(
  p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text,
  p_description text DEFAULT NULL, p_reference_id text DEFAULT NULL,
  p_source_path text DEFAULT NULL, p_dry_run boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
-- ... branches A–E identical to pre-C0 definition (preserved in migration 20260514140749) ...
-- F. LIVE PATH — re-stubbed
RAISE EXCEPTION
  'wallet_ledger_apply_v2 live mutation is not authorized in Step A1 (shadow-only build). Call with p_dry_run=true.'
  USING ERRCODE = 'P0001';
END;
$$;

-- 2. Drop new table (no FKs reference it; clean DROP)
DROP TABLE IF EXISTS public.wallet_ledger_v2_rows;
```

Rollback ETA: < 10 seconds. Pre-C0 function definition is preserved verbatim in migration `20260514140749_9fc0be81-33d4-4d3a-9258-8caae5598960.sql` and is a single `CREATE OR REPLACE` away.

---

## 7. Final verdict

### ✅ SAFE TO RE-RUN GIFT_REFUND CANARY PREFLIGHT

**Blocker #1** (branch F was `RAISE EXCEPTION`) is resolved — branch F is now an idempotent append-only insert into `wallet_ledger_v2_rows`, verified end-to-end with synthetic probe.

**Blocker #2** (zero observed `gift_refund` dry-run cycles) is **NOT** resolved by C0 — that requires either organic gift expiry traffic or a separate synthetic dev probe. Per the plan, this is gated to Step C-Execute prerequisites and is **NOT** part of C0.

### Required before Step C-Execute (canary flip)

1. Re-run `phase-1a-step-c-gift-refund-canary-preflight.md` against the new branch F.
2. Observe ≥ 1 organic `gift_refund` dry-run cycle in `wallet_ledger_audit_log`, OR run the Path 2 synthetic-probe procedure documented in the plan §C.
3. Explicit user approval before any caller is flipped to `p_dry_run: false`.

Until then: legacy `wallet_transaction()` remains the sole authoritative writer; all 5 production callers remain `p_dry_run: true`; system state frozen.

---

## 8. Next recommended step

**`GO PHASE-1A STEP C — RE-RUN GIFT_REFUND CANARY PREFLIGHT`**
(Read-only audit against the new branch F; no execution, no caller flip.)
