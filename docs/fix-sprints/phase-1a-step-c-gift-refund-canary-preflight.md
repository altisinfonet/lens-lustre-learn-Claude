# Phase 1A — Step C: gift_refund Canary PRE-FLIGHT (READ-ONLY)

> STATUS: PRE-FLIGHT ONLY. NO MIGRATION. NO CODE CHANGE. NO `p_dry_run=false`. NO DEPLOY. NO CRON CHANGE.
> Verdict at the bottom is **HOLD BEFORE CANARY** — two blocking gaps require Step C-Execute prerequisite work.

---

## 0. Guardrails

- ✅ READ ONLY — only `SELECT` and `pg_get_functiondef` queries executed
- ✅ ZERO DAMAGE — no mutation
- ✅ ZERO SIDE EFFECT — no triggers fired, no rows inserted
- ✅ ZERO FAN-OUT — no edge calls, no notifications
- ✅ ZERO RECURSION — N/A

---

## 1. Idempotency UNIQUE protection

**Table:** `public.wallet_ledger_idempotency`

```
Column                | Type     | Nullable
op                    | text     | not null
idempotency_key       | text     | not null
result_txn_id         | uuid     |
result_balance_after  | numeric  |
created_at            | timestamptz | not null

Indexes:
  "wallet_ledger_idempotency_pkey" PRIMARY KEY, btree (op, idempotency_key)
```

✅ **VERIFIED**: Composite PRIMARY KEY on `(op, idempotency_key)` — guarantees uniqueness across `(operation type, idempotency key)`. No additional UNIQUE constraint required. Duplicate cron runs for the same `gift_expiry:<gift_id>` will hit the replay branch (see §2).

---

## 2. `wallet_ledger_apply_v2` live-branch behavior

Function: `public.wallet_ledger_apply_v2(p_op, p_user_id, p_amount, p_idempotency_key, p_description, p_reference_id, p_source_path, p_dry_run DEFAULT true)` — `SECURITY DEFINER`, `search_path=public`.

Branch order (verbatim from `pg_get_functiondef`):

- **A. Input validation** → returns `INVALID_INPUT` error on missing required args.
- **B. Idempotency replay** → `SELECT FROM wallet_ledger_idempotency WHERE op=$1 AND idempotency_key=$2`. If hit, logs `result='replay'` to `wallet_ledger_audit_log` and returns `{ok:true, replay:true, balance_after, txn_id}` — **no mutation**.
- **C. Read current balance** (no mutation).
- **D. Overdraft guard** → if `balance_after < 0`, logs `OVERDRAFT` error, returns without mutation.
- **E. DRY RUN PATH** (`IF p_dry_run THEN ...`) → inserts into `wallet_ledger_shadow_log` + `wallet_ledger_audit_log` only, returns `{ok:true, dry_run:true, ...}`.
- **F. LIVE PATH** →

  ```sql
  RAISE EXCEPTION
    'wallet_ledger_apply_v2 live mutation is not authorized in Step A1 (shadow-only build). Call with p_dry_run=true.'
    USING ERRCODE = 'P0001';
  ```

🚨 **BLOCKER #1**: The live branch is **explicitly stubbed with `RAISE EXCEPTION`**. Calling with `p_dry_run=false` today will throw `P0001` and the edge function will log a warning, BUT — critically — this means the canary as proposed in `phase-1a-step-c-live-canary-plan.md` (§2.1: "add a second `wallet_ledger_apply_v2` call with `p_dry_run=false`") **cannot succeed without first replacing branch F with a real INSERT path**.

🚨 **BLOCKER #2**: Branch F, when implemented, must (per plan §2.3) write to a v2 ledger table with UNIQUE on the same `(op, idempotency_key)` and use ON CONFLICT DO NOTHING / upsert semantics so duplicate cron runs are no-ops. Today no such write exists; only the idempotency replay table is keyed.

✅ Confirmed: no UNIQUE constraint exists on a `wallet_ledger_v2` rows table because that table-level live insert path **does not exist yet** in `apply_v2`. The only persistence on dry-run is `wallet_ledger_shadow_log` (append-only, no UNIQUE).

---

## 3. `gift_refund` shadow row inventory

```
SELECT count(*), count(DISTINCT idempotency_key)
  FROM public.wallet_ledger_idempotency WHERE op='gift_refund';
→ total=0, distinct_keys=0

SELECT count(*), errors, mismatches FROM public.wallet_ledger_audit_log WHERE op='gift_refund';
→ audit_rows=0, errors=0, mismatches=0

SELECT idempotency_key, count(*) FROM public.wallet_ledger_idempotency
  WHERE op='gift_refund' GROUP BY 1 HAVING count(*)>1;
→ 0 rows (no duplicates — trivially, since table is empty for this op)
```

🟡 **OBSERVATION**: Zero `gift_refund` shadow rows exist. The dry-run shadow path in `expire-gift-credits` is wired (lines 4, 6, 11, 16, 66 of `index.ts`), but **no expired gift has flowed through it yet** during the observation window — the cron only fires when `gift_announcements.expires_at < now() AND is_expired=false`, and no such rows have existed.

This means:
- Zero observed errors (✅ no negative signal)
- Zero observed mismatches (✅ no negative signal)
- **Zero observed positive signal either** — the 72h soak Step A and the Step B hourly diff monitor have not actually exercised the `gift_refund` op end-to-end. The "shadow path proven by zero drift" claim in the canary plan is technically vacuous for this op.

---

## 4. `expire-gift-credits` code surface

Grep of `supabase/functions/expire-gift-credits/index.ts`:

```
4:  // Phase 1A Step A — wallet_ledger_apply_v2 dry-run shadow (non-blocking).
6:  async function shadowApplyV2GE(client: any, args: { ... })
11: const { error } = await client.rpc("wallet_ledger_apply_v2", {
16:   p_source_path: SHADOW_PATH_GE, p_dry_run: true,
59: const { error: txnError } = await supabase.rpc("wallet_transaction", {
66: await shadowApplyV2GE(supabase, { op: "gift_refund", ... });
```

✅ Only one shadow call site (`shadowApplyV2GE`), only one op (`gift_refund`), only one boolean to flip (`p_dry_run: true` on line 16).
✅ Rollback = revert that single boolean → `p_dry_run: true` and redeploy. ETA < 2 minutes.
✅ No other op type touched. `wallet_transaction` legacy RPC (line 59) remains the authoritative writer regardless.

---

## 5. Wallet baseline checksum

```
SELECT count(*) FROM public.wallet_transactions;        → 192
SELECT md5(string_agg(user_id||':'||balance, ',' ORDER BY user_id)) FROM public.wallets;
                                                         → c385be61a2585085ad4c660cb7cb9b55
```

✅ Identical to the Step B post-execution forensic baseline. State frozen.

---

## 6. Untouched systems (re-confirmed)

- ❎ `wallet_transaction()` RPC — sole authoritative writer
- ❎ `wallets` / `wallet_transactions` rows — unchanged
- ❎ All other edge functions — untouched
- ❎ All cron jobs — untouched
- ❎ All UI — untouched
- ❎ All RLS — untouched

---

## 7. Final verdict

### 🛑 HOLD BEFORE CANARY

**Reasons:**

1. **BLOCKER #1**: `wallet_ledger_apply_v2` branch F is `RAISE EXCEPTION` — there is currently **no live insert path** for v2 to mirror to. The canary plan as written will only generate `P0001` errors, not live shadow rows. This requires a separate, narrowly scoped migration to implement the live branch with:
   - INSERT into the v2 ledger rows table (which itself must exist)
   - INSERT into `wallet_ledger_idempotency` with ON CONFLICT DO NOTHING on `(op, idempotency_key)`
   - Audit log entry with `result='live_ok'`
   - Return `{ok:true, dry_run:false, balance_after}`

2. **BLOCKER #2**: Zero `gift_refund` shadow rows have been recorded. The dry-run shadow has not yet exercised this op end-to-end in production. Before flipping to live, we should observe ≥ 1 successful dry-run cycle (which requires waiting for an actual expired gift OR seeding a synthetic dev expiry).

3. The other §8 prerequisites (UNIQUE protection on idempotency table, single-line rollback, no other op affected, baseline checksum) are ✅ all verified safe.

### Required Step C-Execute prerequisite work (PLAN ONLY — not run here)

a. Create `wallet_ledger_v2` rows table (or reuse existing) with UNIQUE `(op, idempotency_key)`.
b. Replace `wallet_ledger_apply_v2` branch F with an idempotent live-write implementation.
c. Wait for OR seed at least one observed `gift_refund` dry-run cycle.
d. Re-run this preflight; only then propose the one-line `p_dry_run:false` flip.

Until (a)–(d) are complete and re-verified, **do not flip `expire-gift-credits` to live mirror**.

---

## 8. Files generated

- `docs/fix-sprints/phase-1a-step-c-gift-refund-canary-preflight.md` (this document)

No code, no migration, no edge deploy, no cron change.
