# Phase 1A — Step C: Path 2 Synthetic `gift_refund` Dry-Run Probe — PLAN ONLY

> **Mode:** PLAN ONLY. Zero data mutation, zero code change, zero migration, zero deploy, zero `p_dry_run=false`, zero live canary.
> **Authority:** Forensic Engineering Mandate Rules 1, 2, 5.
> **Predecessors:**
> - `docs/fix-sprints/phase-1a-step-c-upcoming-gift-expiry-inspection.md` → `USE SYNTHETIC PROBE`
> - `docs/fix-sprints/phase-1a-step-c0-canary-blocker-resolution-execution.md` → v2 storage live, dry-run path proven
> - `docs/fix-sprints/phase-1a-step-c-gift-refund-canary-preflight-rerun.md` → Blocker #2 (no observed `gift_refund` dry-run row) still open
> **Goal:** Close Blocker #2 by triggering exactly ONE `gift_refund` shadow dry-run via the real `expire-gift-credits` cron path, against a controlled synthetic gift, with full reversibility and zero impact on production users or production wallet checksum.

---

## 1. Constraints (binding — every step in §4 must satisfy all 10)

| # | Constraint | Enforcement in plan |
|---|---|---|
| 1 | Tiny value only | Synthetic gift `amount = 0.01` USD |
| 2 | Dev/test user only | Target = **admin user** `mr.neilbasu@gmail.com` (id `4c200b33-ae64-46f0-ba5d-1a97152e6a6c`, current balance `5.00`) — the only admin and the operator's own account; no end-user wallet touched |
| 3 | One synthetic gift only | Single `gift_credits` + single `gift_announcements` row, both tagged `reason='SYNTHETIC PROBE C-Path2 (DELETE)'` for grep-ability |
| 4 | `expires_at` in past so cron processes it | `expires_at = now() - interval '1 minute'` set at insertion |
| 5 | `p_dry_run` remains TRUE | No code change to `expire-gift-credits/index.ts`; `shadowApplyV2GE` already hard-codes `p_dry_run: true` (line 17 of edge fn). Confirmed in §6 |
| 6 | Legacy authoritative | `wallet_transaction(_type='gift_expiry', _amount=-0.01)` runs FIRST; v2 shadow runs AFTER, post-success only (line 66 of edge fn) |
| 7 | v2 only shadow-logs | `wallet_ledger_v2_rows` count must remain **0** after probe; only `wallet_ledger_audit_log` (`result='dry_run_ok'`) and `wallet_ledger_shadow_log` gain ONE row each |
| 8 | Cleanup documented | §5 — full reversal SQL + post-state assertions |
| 9 | Wallet balance before/after documented | Pre: `5.00`; post-cron (legacy gift_expiry): `4.99`; post-cleanup admin credit (`+0.01`): `5.00` (back to baseline) |
| 10 | Zero production-user impact | Target user_id is hard-pinned in §4.1; SQL uses `WHERE user_id = '4c200b33-…'` everywhere; no broadcast, no public surface |

---

## 2. Pre-state snapshot to capture (READ ONLY, in §4 step 0)

```sql
-- snapshot.json
SELECT
  (SELECT md5(string_agg(user_id::text || ':' || balance::text, ',' ORDER BY user_id))
     FROM public.wallets) AS wallets_checksum,
  (SELECT count(*) FROM public.wallet_transactions) AS wallet_txn_count,
  (SELECT count(*) FROM public.wallet_ledger_v2_rows) AS v2_rows_count,
  (SELECT count(*) FROM public.wallet_ledger_audit_log
     WHERE op='gift_refund') AS gift_refund_audit_count,
  (SELECT count(*) FROM public.wallet_ledger_shadow_log
     WHERE op='gift_refund') AS gift_refund_shadow_count,
  (SELECT balance FROM public.wallets
     WHERE user_id='4c200b33-ae64-46f0-ba5d-1a97152e6a6c') AS target_balance_before;
```

Expected reference values (from prior preflight): `wallets_checksum = fd1cc9470fd4f9d2f8709e365e4651ff`, `wallet_txn_count = 192`, `v2_rows_count = 0`, both audit/shadow gift_refund counts = 0, `target_balance_before = 5.00`.

---

## 3. Synthetic data shape (one row each table)

### 3.1 `gift_credits`
```sql
INSERT INTO public.gift_credits
  (admin_id, amount, reason, target_type, target_value, recipients_count)
VALUES
  ('4c200b33-ae64-46f0-ba5d-1a97152e6a6c', 0.01,
   'SYNTHETIC PROBE C-Path2 (DELETE)', 'email',
   'mr.neilbasu@gmail.com', 1)
RETURNING id;  -- capture as :gc_id
```

### 3.2 `gift_announcements` (the row `expire-gift-credits` will pick up)
```sql
INSERT INTO public.gift_announcements
  (user_id, gift_credit_id, amount, reason,
   expires_at, is_expired, is_read)
VALUES
  ('4c200b33-ae64-46f0-ba5d-1a97152e6a6c', :gc_id, 0.01,
   'SYNTHETIC PROBE C-Path2 (DELETE)',
   now() - interval '1 minute', false, false)
RETURNING id;  -- capture as :ann_id
```

### 3.3 Wallet TOP-UP precondition (so legacy debit succeeds)

Target balance is `5.00`, gift amount is `0.01`. `Math.min(0.01, 5.00) = 0.01` → legacy debit will succeed without overdraft. **No top-up needed.** Leave wallet untouched at this stage.

---

## 4. Execution plan (when later approved — NOT now)

| Step | Action | Mutates? | Reversible? |
|---|---|---|---|
| 0 | Capture snapshot per §2 | NO (read) | n/a |
| 1 | `INSERT` synthetic `gift_credits` row (§3.1) | YES (1 row) | DELETE by id |
| 2 | `INSERT` synthetic `gift_announcements` row (§3.2) with `expires_at = now() - 1min` | YES (1 row) | DELETE by id |
| 3 | Wait for next `expire-gift-credits` cron tick (max 10 min — job `6` `*/10 * * * *`). OR manually invoke via `supabase functions invoke expire-gift-credits` | YES (legacy `wallet_transactions` row + `wallets.balance −= 0.01` + `gift_announcements.is_expired=true` + 1 v2 shadow + 1 v2 audit + 1 idempotency replay-key for `gift_refund:gift_expiry:<ann_id>`) | Step 5 reverses |
| 4 | Verify post-cron deltas per §6 | NO (read) | n/a |
| 5 | Cleanup per §5 | YES (compensating) | n/a |
| 6 | Verify post-cleanup parity per §7 | NO (read) | n/a |

`p_dry_run` is **never** flipped. No edge fn redeploy. No SQL touches `wallet_ledger_apply_v2` source.

---

## 5. Cleanup (mandatory same-window)

```sql
-- 5.1 Re-credit the 0.01 the legacy path debited (restores wallet checksum).
SELECT public.wallet_transaction(
  _user_id := '4c200b33-ae64-46f0-ba5d-1a97152e6a6c',
  _type := 'admin_adjustment',
  _amount := 0.01,
  _description := 'SYNTHETIC PROBE C-Path2 cleanup (reverse gift_expiry of 0.01)',
  _metadata := jsonb_build_object('probe','phase-1a-step-c-path-2','reverses_gift_announcement', :ann_id)
);

-- 5.2 Delete the synthetic announcement & gift rows.
DELETE FROM public.gift_announcements WHERE id = :ann_id;
DELETE FROM public.gift_credits      WHERE id = :gc_id;
```

The v2 audit/shadow rows and the v2 idempotency row are **kept on purpose** as the artifact proving Blocker #2 closed. They are append-only, admin-read-only, and have no balance effect.

If step 3 never fires (e.g. cron delayed > probe window), abort by:
```sql
DELETE FROM public.gift_announcements WHERE id = :ann_id;  -- removes eligibility
DELETE FROM public.gift_credits      WHERE id = :gc_id;
```
Wallet untouched, no cleanup credit needed.

---

## 6. Expected post-cron evidence (§4 step 4 assertions)

| Query | Expected |
|---|---|
| `count(*) FROM wallet_ledger_audit_log WHERE op='gift_refund' AND result='dry_run_ok' AND idempotency_key='gift_expiry:'\|\|:ann_id` | **1** |
| `count(*) FROM wallet_ledger_shadow_log WHERE op='gift_refund' AND idempotency_key='gift_expiry:'\|\|:ann_id` | **1** |
| `count(*) FROM wallet_ledger_v2_rows` | **0** (caller still `p_dry_run:true`) |
| `count(*) FROM wallet_ledger_idempotency WHERE op='gift_refund'` | **0** (dry-run branch deliberately does not write idempotency per Step A1 §5) |
| `wallets.balance` for target | **4.99** (legacy debited 0.01) |
| `count(*) FROM wallet_transactions WHERE user_id=target AND type='gift_expiry'` | +1 |
| `gift_announcements.is_expired` for `:ann_id` | `true` |

If any of these diverge → STOP, do not run cleanup §5.1 (it would compound), instead investigate.

---

## 7. Expected post-cleanup parity (§4 step 6 assertions)

| Query | Expected |
|---|---|
| `wallets.balance` for target | back to **5.00** |
| `wallets_checksum` | back to **`fd1cc9470fd4f9d2f8709e365e4651ff`** (byte-identical to baseline) |
| `count(*) FROM wallet_transactions` | `192 + 2` (1 gift_expiry + 1 admin_adjustment cleanup) — checksum-irrelevant, balance-neutral |
| `gift_credits` / `gift_announcements` synthetic rows | 0 (deleted) |
| `wallet_ledger_audit_log` / `wallet_ledger_shadow_log` for `op='gift_refund'` | **kept = 1 each** (the proof artifact) |
| `wallet_ledger_v2_rows` | still **0** |

Note on checksum: `wallets_checksum` is computed from `(user_id, balance)` only (see §2 query). Adding two zero-net `wallet_transactions` rows does not change it. Confirmed.

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cron does not fire in window | LOW | NONE | Manual invoke fallback (step 3); abort path in §5 fallback |
| Edge fn errors before legacy debit | LOW | NONE | Synthetic rows orphaned → §5 fallback DELETEs them; wallet untouched |
| Edge fn errors AFTER legacy debit, BEFORE shadow call | LOW | Wallet down 0.01 | §5.1 still re-credits 0.01 — fully restorable |
| Edge fn shadow call errors | LOW | NONE | `shadowApplyV2GE` is wrapped in try/catch with `console.warn` (line 19-22 of edge fn) — never throws back to caller |
| `gift_refund` becomes new shadow op + audit count > 1 | VERY LOW | NONE (append-only) | Idempotency key `gift_expiry:<ann_id>` is unique; second cron pass on already-`is_expired=true` row is filtered out at SQL `eq("is_expired", false)` |
| Race with another admin issuing real gift in window | LOW | NONE to probe | Probe is row-scoped by id; concurrent real gifts use different ids |
| Production user observes "0.01 deducted then refunded" | NONE | n/a | Target IS the operator's own admin account; no other user's wallet read or written |
| Cleanup credit `wallet_transaction` RPC absent / signature drift | LOW | Wallet stays at 4.99 | Signature is the same one used by `expire-gift-credits` line 60; verified live |

---

## 9. Untouched (re-confirmed, no change in this plan doc)

- ❎ `supabase/functions/expire-gift-credits/index.ts` — not edited
- ❎ `wallet_ledger_apply_v2` function body — not edited
- ❎ Branch F live-mode invariant — `p_dry_run:true` from the only caller; v2 live branch unreachable
- ❎ All 5 production callers still pass `p_dry_run: true` (rg-verified in preflight rerun)
- ❎ Cron jobs `1` and `6` — schedule not changed
- ❎ RLS on `wallet_ledger_*` — not changed

---

## 10. Final verdict

### **SAFE TO EXECUTE SYNTHETIC DRY-RUN PROBE**

All 10 binding constraints are satisfied by the plan. Maximum at-risk capital = $0.01 on the operator's own admin wallet, fully reversible by §5.1. No production user is touched. No `p_dry_run` flip. No code/migration/deploy. The probe produces exactly one `gift_refund` row in `wallet_ledger_audit_log` (`result='dry_run_ok'`) and one in `wallet_ledger_shadow_log`, closing Blocker #2.

---

## 11. Next step (user choice required)

**`GO PHASE-1A STEP C — EXECUTE PATH 2 SYNTHETIC GIFT_REFUND PROBE`**

Will execute §4 steps 0–6 sequentially with snapshot diffs at each gate. Aborts on any §6 divergence.
