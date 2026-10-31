# Phase 1A — Step C0: Canary Blocker Resolution (PLAN ONLY)

> STATUS: PLAN ONLY. NO MIGRATION. NO CODE CHANGE. NO DEPLOY. NO `p_dry_run=false`. NO LIVE MUTATION.
> Purpose: resolve the two blockers identified in `phase-1a-step-c-gift-refund-canary-preflight.md` so a future Step C canary can proceed safely.

---

## 0. Guardrails for this document

- ✅ PLAN ONLY — no SQL applied, no code edited, no edge deploy
- ✅ ZERO DAMAGE — design proposals only
- ✅ ZERO SIDE EFFECT — no triggers, no schedules, no notifications added
- ✅ ZERO FAN-OUT — single new table, single function branch edit, no cascade
- ✅ ZERO RECURSION — function does not call itself; no triggers proposed on the new table

---

## 1. Blocker recap

| # | Blocker | Evidence |
|---|---|---|
| 1 | `wallet_ledger_apply_v2` branch F is `RAISE EXCEPTION 'wallet_ledger_apply_v2 live mutation is not authorized in Step A1...'` (`P0001`). Calling with `p_dry_run=false` errors instead of writing. | `pg_get_functiondef('public.wallet_ledger_apply_v2')` lines 99–103 of preflight doc. |
| 2 | Zero `gift_refund` rows in `wallet_ledger_idempotency`; zero rows in `wallet_ledger_audit_log` for op=`gift_refund`. The dry-run shadow has never been exercised end-to-end in production. | Preflight §3 SQL evidence. |

---

## A. Minimal live-v2 storage layer (DESIGN ONLY)

### A.1 New table: `public.wallet_ledger_v2_rows`

**Purpose:** an append-only, immutable parallel ledger that mirrors what legacy `wallet_transactions` records, but lives entirely separate from `wallets.balance` arithmetic. This table is the only thing the live branch writes.

**Proposed DDL (NOT EXECUTED):**

```sql
CREATE TABLE public.wallet_ledger_v2_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op                text NOT NULL,
  user_id           uuid NOT NULL,
  amount            numeric NOT NULL,                       -- signed; debit < 0, credit > 0
  idempotency_key   text NOT NULL,
  description       text,
  reference_id      text,
  source_path       text,
  balance_before    numeric NOT NULL,                       -- snapshot read from wallets at write time
  balance_after     numeric NOT NULL,                       -- balance_before + amount; informational only
  actor_user_id     uuid,                                   -- auth.uid() at write time
  jwt_role          text,                                   -- request.jwt.claim.role at write time
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wallet_ledger_v2_rows_op_idem_unique UNIQUE (op, idempotency_key)
);

CREATE INDEX wallet_ledger_v2_rows_user_id_created_at_idx
  ON public.wallet_ledger_v2_rows (user_id, created_at DESC);

CREATE INDEX wallet_ledger_v2_rows_op_created_at_idx
  ON public.wallet_ledger_v2_rows (op, created_at DESC);

ALTER TABLE public.wallet_ledger_v2_rows ENABLE ROW LEVEL SECURITY;

-- Read: admins only (mirrors wallet_ledger_idempotency / audit_log pattern)
CREATE POLICY "Admins read wallet_ledger_v2_rows"
  ON public.wallet_ledger_v2_rows
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- No INSERT / UPDATE / DELETE policy at all.
-- Writes happen exclusively through wallet_ledger_apply_v2 (SECURITY DEFINER).
-- Anon, authenticated, and service_role direct DML must all be rejected by RLS.

REVOKE INSERT, UPDATE, DELETE
  ON public.wallet_ledger_v2_rows
  FROM PUBLIC, anon, authenticated;
```

### A.2 Immutability guarantees

- No `updated_at` column → no UPDATE path makes sense.
- No UPDATE / DELETE RLS policy → blocked by default.
- No trigger writes back to `wallets` or `wallet_transactions`.
- No fan-out trigger on the table at all (zero recursion risk).

### A.3 Relationship to existing structures

| Existing | Touched? | How |
|---|---|---|
| `public.wallets` | ❌ Read only at branch F write time (snapshot). No mutation. |
| `public.wallet_transactions` | ❌ Untouched. Legacy `wallet_transaction()` RPC remains the sole writer. |
| `public.wallet_ledger_idempotency` | ✅ Existing table reused. Branch F INSERTs `(op, idempotency_key, result_txn_id=NULL, result_balance_after)` after a successful v2 row insert. PRIMARY KEY `(op, idempotency_key)` already guarantees replay safety. |
| `public.wallet_ledger_shadow_log` | ❌ Untouched. Used only by branch E (dry-run). |
| `public.wallet_ledger_audit_log` | ✅ Existing table reused. Branch F adds one row per write outcome (`live_ok` / `live_error`). |

---

## B. `wallet_ledger_apply_v2` live-branch design (DESIGN ONLY)

### B.1 New branch F (replaces the current `RAISE EXCEPTION` stub)

**Pseudocode (NOT APPLIED):**

```sql
-- F. LIVE PATH — append-only v2 row insert; NO mutation of wallets / wallet_transactions
INSERT INTO public.wallet_ledger_v2_rows (
  op, user_id, amount, idempotency_key, description, reference_id, source_path,
  balance_before, balance_after, actor_user_id, jwt_role
) VALUES (
  p_op, p_user_id, p_amount, p_idempotency_key, p_description, p_reference_id, p_source_path,
  v_balance_before, v_balance_after, v_actor, v_role
)
ON CONFLICT (op, idempotency_key) DO NOTHING
RETURNING id INTO v_v2_row_id;

IF v_v2_row_id IS NULL THEN
  -- Lost the race; an earlier call already wrote this exact (op, idempotency_key).
  -- Treat as replay — read existing balance_after, log replay, return success.
  SELECT balance_after INTO v_balance_after
    FROM public.wallet_ledger_v2_rows
   WHERE op = p_op AND idempotency_key = p_idempotency_key;

  INSERT INTO public.wallet_ledger_audit_log(
    op, actor_user_id, target_user_id, amount, idempotency_key,
    request_jwt_role, result, balance_after, dry_run, source_path
  ) VALUES (
    p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
    v_role, 'replay', v_balance_after, false, p_source_path
  );
  RETURN jsonb_build_object('ok', true, 'replay', true, 'balance_after', v_balance_after);
END IF;

-- Mirror into idempotency table (for parity with legacy replay branch B).
INSERT INTO public.wallet_ledger_idempotency(op, idempotency_key, result_txn_id, result_balance_after)
VALUES (p_op, p_idempotency_key, NULL, v_balance_after)
ON CONFLICT (op, idempotency_key) DO NOTHING;

INSERT INTO public.wallet_ledger_audit_log(
  op, actor_user_id, target_user_id, amount, idempotency_key,
  request_jwt_role, result, balance_before, balance_after, dry_run, source_path
) VALUES (
  p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
  v_role, 'live_ok', v_balance_before, v_balance_after, false, p_source_path
);

RETURN jsonb_build_object(
  'ok', true, 'dry_run', false,
  'balance_before', v_balance_before, 'balance_after', v_balance_after,
  'v2_row_id', v_v2_row_id
);
```

### B.2 Hard invariants the live branch must satisfy

1. ❌ **No UPDATE on `public.wallets`.** The legacy RPC is still the sole authority on user balance.
2. ❌ **No INSERT on `public.wallet_transactions`.** Legacy is sole writer.
3. ✅ Branch B (replay) still runs first; duplicates on `wallet_ledger_idempotency` short-circuit before branch F is ever reached, **even on live calls**.
4. ✅ Branch F's `INSERT … ON CONFLICT (op, idempotency_key) DO NOTHING` handles the race window between branch B's SELECT and branch F's INSERT — concurrent identical calls collapse to one row.
5. ✅ Branch F is unreachable when `p_dry_run=true` (branch E returns first). Existing dry-run callers cannot be affected by this change.
6. ✅ All other branches (A input validation, B replay, C balance read, D overdraft, E dry run) remain byte-identical.

### B.3 What branch F does NOT do

- Does not call any other function.
- Does not enqueue any notification.
- Does not write any cron metadata.
- Does not touch `gift_announcements`, `gift_credits`, `withdrawal_requests`, or any other domain table.
- Does not change function signature, return type shape, or `SECURITY DEFINER` / `search_path` declarations.

---

## C. `gift_refund` dry-run coverage plan (DESIGN ONLY)

We need ≥ 1 successful end-to-end dry-run cycle through `expire-gift-credits → wallet_ledger_apply_v2(p_dry_run=true) → wallet_ledger_shadow_log + audit_log` **before** flipping to live mirror.

### Path 1 — Wait for organic expiry (preferred, zero risk)

- Inspect `gift_announcements` for any row with `is_expired=false AND expires_at IS NOT NULL`.
- Note the soonest `expires_at`.
- After it passes and the existing cron fires, verify a `gift_refund` row appears in `wallet_ledger_audit_log` with `result='dry_run_ok'`.
- ✅ Zero side effect: this is exactly what the production cron already does today.
- ❌ Risk: timing — if no upcoming organic expiry exists, soak window is unbounded.

### Path 2 — One synthetic dev-only expired gift (only if Path 1 has no upcoming expiry within 7 days)

**Only acceptable shape (NOT APPLIED HERE — for Step C0-Execute):**

1. Pick **one** internal test/dev account (admin-owned, low balance, zero downstream notifications expected).
2. Run a single synthetic INSERT in a transaction-bracketed migration:

   ```sql
   BEGIN;

   -- Synthetic expired gift, pre-expired so the cron picks it up on next tick.
   INSERT INTO public.gift_announcements (
     user_id, gift_credit_id, amount, reason, is_expired, expires_at, created_at
   ) VALUES (
     '<dev_account_uuid>', NULL, 0.01, 'C0 dry-run coverage probe',
     false, now() - interval '1 minute', now() - interval '2 minutes'
   ) RETURNING id;

   COMMIT;
   ```

3. Wait for the next `expire-gift-credits` cron tick.
4. Verify:
   - `gift_announcements.is_expired = true` for that row.
   - One `wallet_ledger_audit_log` row with `op='gift_refund'`, `dry_run=true`, `result='dry_run_ok'`.
   - One `wallet_ledger_shadow_log` row.
   - **No** new row in `wallet_ledger_v2_rows` (live branch is still stubbed at this point).
   - Wallet checksum unchanged → minus the legacy 0.01 gift_expiry deduction (which IS expected — legacy is sole writer; the probe gift will produce a real legacy `gift_expiry` `wallet_transactions` row).

**Cleanup (mandatory, same Step C0-Execute):**

```sql
BEGIN;

-- 1. Reverse the legacy gift_expiry transaction with a manual credit using the
--    sanctioned admin_wallet_credit RPC (or equivalent), referencing the probe
--    gift id so reconciliation is unambiguous. NOTE: this is a normal admin
--    credit operation, not a hard DELETE on wallet_transactions.

-- 2. Mark the probe gift_announcements row clearly:
UPDATE public.gift_announcements
   SET reason = reason || ' [C0 PROBE — CLEANED]'
 WHERE id = '<probe_gift_id>';

-- 3. Audit log the probe lifecycle in db_audit_logs for forensic trail.

COMMIT;
```

❌ Do NOT hard-DELETE the `wallet_transactions` row (violates Soft-Delete policy).
❌ Do NOT touch `wallets.balance` directly.
✅ Synthetic probe touches at most one user, one cent, and is fully traceable.

### Path 3 — Skip dry-run coverage entirely

❌ Rejected. Violates Rule 1 (Zero Assumption) — we will not flip to live mirror without observed end-to-end evidence.

---

## D. Rollback design

### D.1 Storage layer (A)

```sql
-- Reversible. Drops the new table; nothing else depends on it.
DROP TABLE IF EXISTS public.wallet_ledger_v2_rows;
```

- `wallet_ledger_idempotency`, `wallet_ledger_audit_log`, `wallet_ledger_shadow_log`, `wallets`, `wallet_transactions` all untouched by rollback.
- No FKs reference `wallet_ledger_v2_rows` (by design), so DROP is clean.

### D.2 Function branch (B)

Restore branch F to the `RAISE EXCEPTION` stub:

```sql
CREATE OR REPLACE FUNCTION public.wallet_ledger_apply_v2(...)
... -- branches A–E unchanged
-- F. LIVE PATH — re-stubbed
RAISE EXCEPTION
  'wallet_ledger_apply_v2 live mutation is not authorized in Step A1 (shadow-only build). Call with p_dry_run=true.'
  USING ERRCODE = 'P0001';
END;
$$;
```

- All callers today pass `p_dry_run=true`, so re-stubbing has zero functional impact on live traffic.

### D.3 Synthetic probe (C, Path 2)

- Cleanup SQL above is part of the same Step C0-Execute migration.
- If the probe is never used (Path 1 succeeds), there is nothing to roll back.

### D.4 Rollback ETA

- Storage drop: < 5 seconds.
- Function restoration: < 5 seconds (single CREATE OR REPLACE).
- Probe cleanup: included in Step C0-Execute, runs immediately after coverage verification.

---

## 2. Untouched systems (re-confirmed)

- ❎ `wallet_transaction()` legacy RPC — sole authoritative writer
- ❎ `wallets` row mutation paths — unchanged
- ❎ `wallet_transactions` row mutation paths — unchanged
- ❎ All edge functions other than `expire-gift-credits` — untouched (and even that is untouched in C0; canary flip is Step C-Execute)
- ❎ All cron jobs — untouched
- ❎ All UI — untouched
- ❎ All RLS on existing tables — untouched
- ❎ Step B hourly diff monitor — untouched

---

## 3. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Live branch accidentally mutates `wallets` | CRITICAL | Code review checklist explicitly forbids any UPDATE/INSERT on `wallets` or `wallet_transactions` in branch F. CI grep gate optional. |
| New table receives direct DML bypassing function | HIGH | RLS: no INSERT/UPDATE/DELETE policy. REVOKE on PUBLIC/anon/authenticated. Only SECURITY DEFINER function can write. |
| Race between two concurrent calls with same idempotency key | MEDIUM | UNIQUE `(op, idempotency_key)` + `ON CONFLICT DO NOTHING` collapses to one row; replay branch returns success on the loser. |
| Synthetic probe leaks 0.01 to dev wallet | LOW | Mandatory cleanup credit in same migration; logged to `db_audit_logs`. |
| Step B diff monitor sees the new v2 rows as "drift" | MEDIUM | C0 does NOT flip any caller to `p_dry_run=false`. Diff monitor still sees zero v2 rows. The flip happens in Step C-Execute, at which point monitor logic is reviewed for `gift_refund` parity. |

---

## 4. Success criteria for C0-Execute (future, not this doc)

- ✅ `wallet_ledger_v2_rows` exists with UNIQUE + RLS as specified.
- ✅ `wallet_ledger_apply_v2` branch F implemented exactly as §B.1.
- ✅ At least one `gift_refund` row with `result='dry_run_ok'` observed in `wallet_ledger_audit_log`.
- ✅ `wallets_checksum` unchanged from `c385be61a2585085ad4c660cb7cb9b55` (modulo any legacy gift_expiry that occurred organically, which is expected and unrelated to v2).
- ✅ Zero rows in `wallet_ledger_v2_rows` (live branch unreachable until Step C-Execute flips a caller).
- ✅ Zero new errors in `expire-gift-credits` logs.

## 5. Failure criteria (any → halt and rollback C0)

- ❌ Any UPDATE on `wallets` traceable to branch F.
- ❌ Any unexpected INSERT on `wallet_transactions` from the function.
- ❌ Any RLS hole permitting non-admin SELECT on `wallet_ledger_v2_rows`.
- ❌ Any direct INSERT on `wallet_ledger_v2_rows` succeeding outside the function.
- ❌ Synthetic probe cleanup fails or leaves wallet imbalance.

---

## 6. Final verdict

### ✅ SAFE TO IMPLEMENT C0

This plan is implementable as a single, narrowly-scoped Step C0-Execute consisting of:

1. One migration creating `wallet_ledger_v2_rows` with strict RLS + REVOKE.
2. One `CREATE OR REPLACE FUNCTION wallet_ledger_apply_v2` replacing branch F only.
3. (Conditional) one synthetic probe + cleanup if no organic gift expiry is upcoming within 7 days.

C0-Execute does **not** flip any caller to `p_dry_run=false`. The actual canary remains gated to a future Step C-Execute that will require:

- This C0 work merged and verified.
- ≥ 1 observed `gift_refund` dry-run cycle.
- Re-running `phase-1a-step-c-gift-refund-canary-preflight.md`.
- Explicit user approval.

Until then: legacy `wallet_transaction()` remains sole writer; `p_dry_run=true` everywhere; system state frozen.

---

## 7. Files to be generated by C0-Execute (NOT NOW)

- `supabase/migrations/<ts>_wallet_ledger_v2_rows.sql` — table + RLS + REVOKE
- `supabase/migrations/<ts>_wallet_ledger_apply_v2_branch_f.sql` — function update
- (Optional) `supabase/migrations/<ts>_c0_synthetic_probe.sql` — probe + cleanup
- `docs/fix-sprints/phase-1a-step-c0-execution.md` — execution report
