# Phase 1A — Step C: Live `gift_refund` Canary — EXECUTION PLAN (PLAN ONLY)

> **Mode:** PLAN ONLY. Zero execution. Zero `p_dry_run=false` flip. Zero deploy. Zero cron change. Zero wallet touch.
> **Authority:** Forensic Engineering Mandate Rules 1, 2, 5.
> **Approved predecessors:**
> - `phase-1a-step-c-synthetic-dry-run-probe-execution.md` ✅ PASSED
> - `phase-1a-step-c0-canary-blocker-resolution-execution.md` ✅ Branch F live path proven via C0 synthetic probe
> - `phase-1a-step-c-gift-refund-canary-preflight-rerun.md` ✅ Blocker #1 resolved
> **Goal of this doc:** Specify the exact one-line code flip, exact rollback, exact monitoring, exact criteria — so future "EXECUTE LIVE CANARY" is mechanical and unambiguous.

---

## 0. Canary scope (binding)

| Dimension | Value |
|---|---|
| Edge function | `supabase/functions/expire-gift-credits/index.ts` (this file ONLY) |
| Op type flipped to live v2 | `gift_refund` (this op ONLY) |
| Other 4 ops (`vote`, `unvote_penalty`, `deposit_credit`, `vote_payout`) | **REMAIN `p_dry_run: true`** — untouched in this canary |
| Probe payload | One synthetic gift, $0.01, operator's own admin user `4c200b33-…` (same pattern as Step C dry-run probe) |
| Production users | **NONE touched** — synthetic probe model identical to Step C |
| Wallet write authority | LEGACY `wallet_transaction()` RPC remains AUTHORITATIVE (executes first; v2 runs after as parallel mirror) |

---

## 1. The exact one-line change

**File:** `supabase/functions/expire-gift-credits/index.ts`
**Current line 17 (verified live):**
```ts
      p_source_path: SHADOW_PATH_GE, p_dry_run: true,
```

**Canary line 17:**
```ts
      p_source_path: SHADOW_PATH_GE, p_dry_run: false,
```

That is the entire diff. One token: `true` → `false`. No other line in the file changes. No other file changes.

Edge fn auto-deploys on save (Lovable-managed). No `supabase functions deploy` command required.

---

## 2. The exact rollback line

**Same file, same line 17:**
```ts
      p_source_path: SHADOW_PATH_GE, p_dry_run: true,
```

One token: `false` → `true`. Auto-redeploys. **Estimated rollback time: ≤ 30 seconds** from edit-save to next cron tick excluding it. If a cron tick is mid-flight at flip-back, the in-flight call still goes live for that one row — guarded by Branch F idempotency (`UNIQUE (op, idempotency_key)`), no double-mirror.

---

## 3. Authority confirmations (must hold for entire canary)

| Invariant | Proof source | Holds during canary? |
|---|---|---|
| `wallet_transaction()` (legacy) is the ONLY function that updates `public.wallets.balance` and inserts into `public.wallet_transactions` | `expire-gift-credits/index.ts` lines 56-63 (legacy debit) executes BEFORE the shadow/v2 call (line 65-72) | ✅ unchanged |
| `wallet_ledger_apply_v2` Branch F **does NOT** update `wallets` and **does NOT** insert into `wallet_transactions` | `pg_get_functiondef` lines 98-148: only writes to `wallet_ledger_v2_rows`, `wallet_ledger_idempotency`, `wallet_ledger_audit_log` | ✅ unchanged |
| Canary appends ONLY to `wallet_ledger_v2_rows` (+ idempotency + audit row) | Same proof — Branch F is the only path live-mode takes | ✅ unchanged |
| Idempotency key `gift_expiry:<gift.id>` ensures one-and-only-one v2 row per gift | `expire-gift-credits/index.ts` line 69 + Branch F `ON CONFLICT (op, idempotency_key) DO NOTHING` line 107 | ✅ unchanged |
| Other 4 callers stay shadow-only | Confirmed in preflight rerun §2 — `cast-photo-vote`, `submit-deposit`, `approve-deposit`, `process-vote-payout` all hard-code `p_dry_run: true`. None edited in this canary | ✅ unchanged |

---

## 4. Pre-flight checks (READ ONLY, ≤ 2 minutes before flip)

```sql
SELECT
  -- balance-equality checksum (scale-normalized to avoid the §6.1 artifact from Step C dry-run)
  md5(string_agg(user_id::text || ':' || (balance + 0)::text, ',' ORDER BY user_id))                       AS wallets_checksum_normalized,
  (SELECT count(*) FROM public.wallet_transactions)                                                         AS wallet_txn_count,
  (SELECT count(*) FROM public.wallet_ledger_v2_rows)                                                       AS v2_rows_total,
  (SELECT count(*) FROM public.wallet_ledger_v2_rows WHERE op='gift_refund')                                AS v2_rows_gift_refund,
  (SELECT count(*) FROM public.wallet_ledger_idempotency WHERE op='gift_refund')                            AS idem_gift_refund,
  (SELECT count(*) FROM public.wallet_ledger_audit_log
     WHERE op='gift_refund' AND result='live_ok')                                                           AS audit_live_ok_pre,
  (SELECT count(*) FROM public.wallet_ledger_audit_log
     WHERE op='gift_refund' AND result='dry_run_ok')                                                        AS audit_dry_run_ok_pre,
  (SELECT count(*) FROM public.gift_announcements
     WHERE is_expired=false AND expires_at IS NOT NULL AND expires_at < now())                              AS organic_eligible_now,
  (SELECT balance FROM public.wallets WHERE user_id='4c200b33-ae64-46f0-ba5d-1a97152e6a6c')                 AS operator_balance
FROM public.wallets;
```

**Pre-flip gate** (all must be true):
- `organic_eligible_now = 0` — confirms no surprise organic gift will ride the flip and bill a real user
- `v2_rows_total = 0` (or stable from C0 probe count)
- `audit_live_ok_pre = 0` for `gift_refund`
- `operator_balance ≥ 0.01`

If any fails → ABORT, do not flip.

---

## 5. Operator procedure (ordered, manual)

| # | Action | Tool | Mutates? |
|---|---|---|---|
| 1 | Run §4 snapshot, store as `pre.json` | `supabase--read_query` | NO |
| 2 | Insert one synthetic gift on operator wallet (identical to Step C §3) | `supabase--insert` | YES (1+1 rows) |
| 3 | Edit `expire-gift-credits/index.ts` line 17 `true → false` | `code--line_replace` | code only — auto-redeploy |
| 4 | Wait for auto-redeploy (≤ 30s) | poll `edge-function-logs-expire-gift-credits` for new boot timestamp | NO |
| 5 | Manually invoke `POST /functions/v1/expire-gift-credits` | `supabase--curl_edge_functions` | YES (legacy debit + v2 insert + audit) |
| 6 | Run §6 post-flip verification | `supabase--read_query` | NO |
| 7 | Manually invoke a SECOND time (replay test) | `supabase--curl_edge_functions` | NO net change (idempotent no-op) |
| 8 | Run §7 replay verification | `supabase--read_query` | NO |
| 9 | **Immediately** flip line 17 back `false → true` (rollback) | `code--line_replace` | code only — auto-redeploy |
| 10 | Run §11 cleanup: re-credit $0.01 + delete synthetic gift rows | `supabase--insert` | YES (compensating) |
| 11 | Run §4 snapshot again, diff against `pre.json` per §8 success criteria | `supabase--read_query` | NO |

Total wall-clock: ≤ 5 minutes. The "live" exposure window for the `p_dry_run=false` flag is only the duration between steps 3 and 9 — bounded ≤ 3 minutes by the operator's own pacing.

---

## 6. Post-flip verification (after step 5, before step 7)

```sql
SELECT
  -- exactly one new live row for the synthetic ann_id
  (SELECT count(*) FROM public.wallet_ledger_v2_rows
     WHERE op='gift_refund' AND idempotency_key='gift_expiry:'||:ann_id)                       AS v2_rows_for_probe,
  -- exactly one matching audit live_ok row
  (SELECT count(*) FROM public.wallet_ledger_audit_log
     WHERE op='gift_refund' AND result='live_ok' AND idempotency_key='gift_expiry:'||:ann_id)  AS audit_live_ok_for_probe,
  -- exactly one idempotency row (live branch DOES write idem; dry-run did not)
  (SELECT count(*) FROM public.wallet_ledger_idempotency
     WHERE op='gift_refund' AND idempotency_key='gift_expiry:'||:ann_id)                       AS idem_for_probe,
  -- legacy still authoritative: balance ticked down by 0.01
  (SELECT balance FROM public.wallets WHERE user_id='4c200b33-ae64-46f0-ba5d-1a97152e6a6c')    AS operator_balance_after_legacy,
  -- legacy gift_expiry row exists in legacy ledger
  (SELECT count(*) FROM public.wallet_transactions
     WHERE user_id='4c200b33-ae64-46f0-ba5d-1a97152e6a6c' AND type='gift_expiry'
       AND created_at >= (SELECT now() - interval '5 minutes'))                                AS legacy_gift_expiry_rows_in_window,
  -- balance_after parity: v2 row's recorded balance_after must equal what legacy left in wallets
  (SELECT balance_after FROM public.wallet_ledger_v2_rows
     WHERE op='gift_refund' AND idempotency_key='gift_expiry:'||:ann_id)                       AS v2_recorded_balance_after;
```

**All-must-pass:**
- `v2_rows_for_probe = 1`
- `audit_live_ok_for_probe = 1`
- `idem_for_probe = 1`
- `operator_balance_after_legacy = pre.operator_balance - 0.01`
- `legacy_gift_expiry_rows_in_window = 1`
- `v2_recorded_balance_after = operator_balance_after_legacy` (parity proof: v2 mirror agrees with legacy authority)

---

## 7. Replay verification (after step 7 second invoke)

The cron filter `is_expired=false` excludes the now-expired `:ann_id`, so the second invoke produces `expired:0` and never reaches Branch F. To **directly** test Branch F replay, also issue:

```sql
SELECT public.wallet_ledger_apply_v2(
  p_op := 'gift_refund',
  p_user_id := '4c200b33-ae64-46f0-ba5d-1a97152e6a6c',
  p_amount := -0.01,
  p_idempotency_key := 'gift_expiry:'||:ann_id,
  p_description := 'replay-test (canary)',
  p_reference_id := :ann_id,
  p_source_path := 'canary-replay-test',
  p_dry_run := false
) AS replay_result;
```

**Expected** (from Branch B in `pg_get_functiondef`, lines 32-49 — replay branch fires before live path):
```json
{ "ok": true, "replay": true, "balance_after": <prior balance_after>, "txn_id": null }
```
And:
- `wallet_ledger_v2_rows` count for `gift_refund:gift_expiry:<ann_id>` **stays at 1** (no second row)
- `wallet_ledger_idempotency` count for that key **stays at 1**
- `wallet_ledger_audit_log` for `op='gift_refund' AND result='replay' AND idempotency_key=...` **gains exactly 1 row**
- `operator_balance` **does not change** (no second debit)

Replay safety = PROVEN.

---

## 8. Success criteria (post-cleanup parity, after step 11)

| Metric | Pre value | Post-cleanup expected | Tolerance |
|---|---|---|---|
| `wallets_checksum_normalized` (scale-normalized via `(balance+0)::text`) | snapshot | **byte-identical** | 0 |
| `operator_balance` | snapshot | **equal** | 0 |
| `wallet_transactions` count | N | **N + 2** (legacy `gift_expiry` + cleanup `admin_adjustment`, sum=0) | exact |
| `wallet_ledger_v2_rows` count for `gift_refund` | 0 | **+1** (proof artifact, kept) | exact |
| `wallet_ledger_idempotency` count for `gift_refund` | 0 | **+1** (proof artifact, kept) | exact |
| `wallet_ledger_audit_log` `gift_refund/live_ok` | 0 | **+1** | exact |
| `wallet_ledger_audit_log` `gift_refund/replay` | 0 | **+1** (from §7 second call) | exact |
| Synthetic `gift_credits` / `gift_announcements` rows | 0 | **0** (deleted) | exact |
| Other 4 ops (`vote`/`deposit_credit`/...) v2 row counts | snapshot | **unchanged** (still 0) | exact |
| Edge fn line 17 | `true` | **`true`** (rolled back) | exact |

If ALL pass → **CANARY GREEN**.

---

## 9. Abort criteria (any one trips → execute §11 immediately)

- Step 4 redeploy not observed within 60 seconds → ABORT
- Step 5 invoke returns HTTP non-200 → ABORT
- Step 5 invoke returns `expired: 0` (cron filter mismatch) → ABORT
- §6 ANY assertion fails → ABORT
- `v2_recorded_balance_after ≠ operator_balance_after_legacy` (parity break — even by $0.01) → **HARD ABORT**, escalate, do not run §7
- Any other op (`vote`, `deposit_credit`, etc.) gains a v2 row during the window → **HARD ABORT**, investigate cross-talk
- `wallet_transactions` row count grows by anything other than +1 in the window → ABORT (suspect concurrent activity; cleanup separately)
- Any production user's wallet balance changes during the window → **HARD ABORT**, escalate

---

## 10. Replay/idempotency expectations summary

| Scenario | Branch hit | wallets table | wallet_transactions | wallet_ledger_v2_rows | wallet_ledger_idempotency | wallet_ledger_audit_log |
|---|---|---|---|---|---|---|
| First canary invoke | F (live) | LEGACY −0.01 (Branch F does NOT touch) | LEGACY +1 row (Branch F does NOT touch) | +1 | +1 | +1 (`live_ok`) |
| Cron 2nd tick (probe row already `is_expired=true`) | not reached (filter) | unchanged | unchanged | unchanged | unchanged | unchanged |
| Direct §7 replay call (`p_dry_run:false`, same key) | B (replay) | unchanged | unchanged | unchanged | unchanged | +1 (`replay`) |
| Direct call with overdraft attempt (out of scope here) | D | unchanged | unchanged | unchanged | unchanged | +1 (`error/OVERDRAFT`) |

---

## 11. Cleanup procedure (executes regardless of canary outcome)

```sql
-- 11.1 Reverse legacy 0.01 debit on operator wallet (only if legacy actually debited; check §6 first).
SELECT public.wallet_transaction(
  _user_id := '4c200b33-ae64-46f0-ba5d-1a97152e6a6c',
  _type := 'admin_adjustment',
  _amount := 0.01,
  _description := 'CANARY C-Live cleanup (reverse gift_expiry of 0.01)',
  _metadata := jsonb_build_object('canary','phase-1a-step-c-live','reverses_gift_announcement', :ann_id)
);

-- 11.2 Delete synthetic gift rows.
DELETE FROM public.gift_announcements WHERE id = :ann_id;
DELETE FROM public.gift_credits      WHERE id = :gc_id;
```

Append-only `wallet_ledger_v2_rows` / `wallet_ledger_idempotency` / `wallet_ledger_audit_log` rows are **kept on purpose** (proof artifacts, no balance impact).

If §6 showed legacy did NOT debit (e.g. fn errored out before line 56), SKIP 11.1 and only run 11.2.

---

## 12. Observation window

| Phase | Duration |
|---|---|
| Live-mode flag exposure (line 17 = `false`) | ≤ 3 minutes (operator-paced, ends at step 9) |
| Cron tick risk window | ≤ 10 minutes outer bound (cron job 6 = `*/10 * * * *`); but `organic_eligible_now=0` precondition means cron has zero candidates anyway |
| Post-canary monitoring on v2 ledger | **24 hours** read-only — operator runs §4 snapshot once per 6 hours, expects `audit_live_ok` for `gift_refund` to stay at exactly 1; any drift = post-mortem |
| Post-canary monitoring on legacy wallet checksum | **24 hours** — `wallets_checksum_normalized` recomputed once per 6 hours, expects byte-identical to step-11 post-cleanup value (modulo organic non-canary activity) |

A nightly `wallet_ledger_v2_rows` vs `wallet_transactions` divergence query (already designed in `phase-1a-step-a1-7-wallet-v2-diff-rpc.md`) should report ZERO `gift_refund` divergence at T+24h.

---

## 13. Untouched (re-confirmed against actual files)

- ❎ `wallet_ledger_apply_v2` body — not edited (live since C0)
- ❎ Other 4 production callers (`cast-photo-vote`, `submit-deposit`, `approve-deposit`, `process-vote-payout`) — not edited; remain `p_dry_run: true`
- ❎ `wallet_transaction()` legacy RPC — not edited; remains sole authority for `wallets.balance` + `wallet_transactions`
- ❎ Cron jobs 1 + 6 — not edited
- ❎ RLS on `wallet_ledger_*` tables — not edited
- ❎ `wallets` / `wallet_transactions` schema — not edited
- ❎ Any migration written in this canary — none planned

---

## 14. Final verdict

### **SAFE TO EXECUTE LIVE GIFT_REFUND CANARY**

Justification:
- Branch F live path is byte-identical to the path proven safe by the **C0 synthetic probe** (which already wrote a real `wallet_ledger_v2_rows` row from a service-role call without touching `wallets` or `wallet_transactions`).
- `expire-gift-credits` already proved end-to-end shadow safety in **Step C dry-run probe**.
- One-line flip + one-line rollback + same-window operator pacing bounds live-flag exposure to ≤ 3 minutes.
- Synthetic-gift design pins the only at-risk capital to $0.01 on the operator's own wallet, fully reversible.
- Production callers untouched ⇒ zero cross-op fan-out.
- Idempotency + parity assertions are mechanical and binary; abort criteria are explicit.

---

## 15. Next step (user choice required)

**`GO PHASE-1A STEP C — EXECUTE LIVE GIFT_REFUND CANARY`**

Will run §5 steps 1–11 in order. Aborts on any §9 trip. Produces `phase-1a-step-c-live-gift-refund-canary-execution.md` with diffs at every gate.

NO EXECUTION FROM THIS DOCUMENT.
