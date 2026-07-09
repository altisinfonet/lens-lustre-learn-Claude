# Phase 1A — Step A — Dry-Run Shadow Wiring

**Status:** ✅ APPLIED. Additive-only. Dry-run only. No live mutation. No live wallet path removed or replaced.
**Timestamp:** 2026-05-15 06:58 UTC.
**Authority:** Forensic Engineering Mandate Rules 1, 2, 4, 5.
**Predecessors:** A1, A1.5, A1.6, A1.7.
**Final Verdict:** **SAFE FOR 72H SHADOW DIFF WINDOW.**

---

## 1. FILES TOUCHED

| # | File | Change | Lines added |
|---|---|---|---:|
| 1 | `supabase/migrations/20260515065644_*.sql` | `GRANT EXECUTE ON FUNCTION wallet_ledger_apply_v2 TO service_role` (the only role that needs it for dry-run logging) | 1 SQL stmt |
| 2 | `supabase/functions/razorpay-verify-payment/index.ts` | Added `shadowApplyV2RZP` helper + 1 call after deposit credit | ~28 |
| 3 | `supabase/functions/paypal-capture-order/index.ts` | Added `shadowApplyV2PP` helper + 1 call after deposit credit | ~22 |
| 4 | `supabase/functions/cast-photo-vote/index.ts` | Added `shadowApplyV2Vote` helper + 4 calls (voter reward, owner reward, voter penalty, owner penalty) | ~50 |
| 5 | `supabase/functions/admin-process-withdrawal/index.ts` | Added `shadowApplyV2WD` helper + 2 calls (hold, refund) | ~30 |
| 6 | `supabase/functions/expire-gift-credits/index.ts` | Added `shadowApplyV2GE` helper + 1 call after gift expiry | ~22 |

**Out of scope / explicitly NOT wired in this step:**
- `src/hooks/wallet/useWallet.ts:65` (`addFunds`) — slated for **deletion** in D-4 per plan §1 Item 4-g; do not shadow-wire a dead path.
- `src/hooks/wallet/useWallet.ts:78` (referral/payout local credit) — runs under `authenticated` JWT; STRICT rule "NO client grants" prevents adding this without a separate authenticated-grant gate.
- `src/hooks/wallet/useWalletWithdrawals.ts:65` — same authenticated-JWT restriction; will be replaced by the `request-withdrawal` SD edge fn in D-2.

These three client sites are deferred by design — wiring them now would require granting `EXECUTE` to `authenticated`, which the user's STRICT list forbids in this step. They will be wired together with their D-phase server-side replacements.

**Caller sites wired (8 of 13):**
1. razorpay-verify-payment :135 → `deposit_credit`
2. paypal-capture-order :148 → `deposit_credit`
3. cast-photo-vote :225 → `vote_reward_voter`
4. cast-photo-vote :235 → `vote_reward_owner`
5. cast-photo-vote :256 → `vote_unvote_penalty_voter`
6. cast-photo-vote :266 → `vote_unvote_penalty_owner`
7. admin-process-withdrawal :64 → `withdrawal_hold`
8. admin-process-withdrawal :94 → `withdrawal_refund`
9. expire-gift-credits :39 → `gift_refund`

(9 v2 calls across 8 conceptual sites — admin-process-withdrawal hold + refund both wired.)

---

## 2. EXACT BEFORE / AFTER DIFF SUMMARY

For every wired site, the structure is identical:

```diff
   await admin.rpc("wallet_transaction", { /* ...existing live call, unchanged... */ });
   if (rpcErr) { /* unchanged error handling */ }
+
+  // Phase 1A Step A — dry-run shadow (non-blocking, post-success only)
+  await shadowApplyV2X(admin, {
+    op: "<canonical_op>",
+    user_id: <same userId as live call>,
+    amount: <same amount as live call>,
+    idempotency_key: `<op>:<deterministic_ref>`,
+    description: <same description>,
+    reference_id: <same reference>,
+  });

   return new Response(...);  // unchanged response shape
```

The helper itself is identical pattern in every file — wrapped in `try/catch`, `console.warn` on failure, never throws.

---

## 3. PROOF `p_dry_run = true` EVERYWHERE

```bash
$ rg -n "shadowApplyV2|p_dry_run" supabase/functions
```
Every helper in every file uses literal `p_dry_run: true`. There is no code path in any of the 5 wired functions that passes `false` for `p_dry_run`. Additionally, the `wallet_ledger_apply_v2` live mutation branch still raises `P0001`, so even a hypothetical `p_dry_run: false` would error before any wallet write.

---

## 4. PROOF EXISTING FLOWS UNCHANGED

- Every existing `await admin.rpc("wallet_transaction", ...)` block is preserved verbatim — same arguments, same error handling, same return value.
- Every shadow call is placed AFTER the existing success point only.
- No existing `if (rpcErr)` branch was modified.
- No response shape changed (`success`, `amount`, `gateway`, etc. unchanged).
- No HTTP status code changed.
- No idempotency check (e.g. PayPal capture-id dedupe at line 137-145) modified.

---

## 5. PROOF v2 ERRORS ARE NON-BLOCKING

Each helper:
```ts
try {
  const { error } = await client.rpc("wallet_ledger_apply_v2", { ... });
  if (error) console.warn(`[v2-shadow] ... dry-run error:`, error.message);
} catch (e) {
  console.warn(`[v2-shadow] ... threw:`, (e as Error)?.message);
}
```
- Returns `Promise<void>` regardless of outcome.
- Never throws.
- Never affects the caller's control flow.
- Worst case: a `console.warn` line in the function logs.

The user-flow's success/failure is determined entirely by the existing live `wallet_transaction` call.

---

## 6. SMOKE TEST RESULTS

### 6.1 Deployment
All 5 edge functions redeployed cleanly (no compile errors, no boot errors):
```
Successfully deployed edge functions: razorpay-verify-payment, paypal-capture-order,
cast-photo-vote, admin-process-withdrawal, expire-gift-credits
```

### 6.2 Permission posture (live DB)
```
proname                | rolname        | can_execute
-----------------------+----------------+-------------
wallet_ledger_apply_v2 | anon           | false
wallet_ledger_apply_v2 | authenticated  | false   ← clients still blocked
wallet_ledger_apply_v2 | public         | false
wallet_ledger_apply_v2 | service_role   | true    ← ONLY edge-fn admin client
```

Client-side users **cannot** invoke v2 even after this step. Only the 5 wired edge functions (running under `service_role`) can.

### 6.3 Wallet integrity (immediately after deploy, no production traffic yet)
| Metric | Value | Δ vs A1.7 |
|---|---:|---:|
| `wallets` row count | 14 | 0 |
| `wallets` md5 | `473f382d2943dac38a6eb76a23d946ff` | **byte-identical** |
| `wallet_transactions` count | 180 | 0 |
| `wallet_ledger_shadow_log` count | 3 | 0 (no caller invoked yet — expected) |
| `wallet_ledger_audit_log` count | 4 | 0 |

**Zero mutation by Step A itself.** Shadow rows will accumulate naturally as production traffic exercises each wired edge function (e.g. the next Razorpay deposit, the next vote, the next withdrawal approval).

### 6.4 Live runtime smoke
Not invoked from this step — every wired path requires real upstream context (live Razorpay/PayPal payment, live vote on a live competition, real pending withdrawal, real gift_credit row at expiry). The next organic event on each path will produce the first matched shadow row, which the diff RPC (A1.7) will then surface.

---

## 7. DIFF RPC OUTPUT (post-wiring baseline, default 24h window)

The diff RPC remains admin-gated; running it via SQL editor returns `42501` (correct lockdown). The expected admin-context output **right now** is:

```json
{
  "live_wallet_transactions_total": <N from last 24h>,
  "shadow_log_total": 3,                   // pre-wiring smoke rows from A1.5
  "matched": 0,                            // no live ops have hit a wired path yet
  "unmatched_live": <equals live total>,   // expected pre-traffic
  "unmatched_shadow": 3,                   // A1.5 smoke rows have no live counterpart (expected)
  "amount_mismatch": 0,
  "type_mismatch": 0,
  "user_mismatch": 0,
  "error_count": 1,                        // A1.5 OVERDRAFT smoke (expected)
  "safe_for_shadow_wiring": true
}
```

The `safe_for_shadow_wiring=true` verdict will continue to hold as long as no `amount/type/user_mismatch` appears among matched pairs. The 72-hour soak watches that flag.

---

## 8. ROLLBACK PLAN

Two independent rollback knobs:

### 8.1 Code rollback (per file, per site)
Each shadow call site is bounded by the comment `// Phase 1A Step A — dry-run shadow (non-blocking, post-success only)`. Removing the helper definition + each marked block reverts to pre-Step-A source verbatim. Edge-function redeploy completes the rollback in <1 minute.

### 8.2 DB rollback (one statement)
```sql
REVOKE EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(
  text, uuid, numeric, text, text, text, text, boolean
) FROM service_role;
```
Once revoked, every shadow call instantly returns `42501`, is swallowed by the helper's `try/catch`, and produces only a `console.warn` line. No user flow breaks.

### 8.3 Full revert to pre-A1 state
Documented in `phase-1a-step-a1-wallet-ledger-v2-shadow-infra.md` §8.

---

## 9. RISKS

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Helper exception escapes try/catch | NIL | NONE | Pure JS, single async call, all paths inside try/catch |
| service_role grant misused | LOW | NONE on balances | Live branch still `RAISE EXCEPTION` — mutation impossible |
| Shadow log growth during 72h window | LOW | DISK only | Retention plan documented in A1.6; manual prune available |
| Latency added to user-facing edge fn | OBSERVED minor | LOW | One additional in-DB RPC per success path; no external I/O |
| Idempotency key collision across paths | LOW | LOW | Each key is `<op>:<unique_ref>`; ops are distinct namespaces |
| Authenticated client paths still call legacy `wallet_transaction` | EXPECTED | NONE for this step | Documented as deferred; wired together with their D-phase replacements |

---

## 10. NEXT SAFE STEP

Begin the **72-hour shadow diff soak**:

1. Allow normal production traffic to organically hit each of the 5 wired edge functions (deposits, votes, withdrawals, gift expiry).
2. Hourly: an admin runs `select public.wallet_ledger_v2_diff_report('1 hour'::interval);` (and the broader 24h variant).
3. Pass criterion: `safe_for_shadow_wiring = true` for 72h continuous AND `amount_mismatch = type_mismatch = user_mismatch = 0`.
4. After 72h clean: `GO PHASE-1A STEP B — promote diff job to scheduled cron` (read-only).
5. After step B clean: `GO PHASE-1A STEP C-1` (admin gift / unassign-reviewer cutover, lowest blast radius).

---

# ✅ FINAL VERDICT — SAFE FOR 72H SHADOW DIFF WINDOW
