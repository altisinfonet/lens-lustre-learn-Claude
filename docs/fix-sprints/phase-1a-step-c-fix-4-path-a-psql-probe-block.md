# Phase 1A · Step C.fix-4 — PATH A · Copy-Paste `psql` Probe Block

> **Mode:** AUDIT-ONLY DELIVERABLE. No SQL was executed by Lovable for this step.
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Source of truth:** `docs/fix-sprints/phase-1a-step-c-fix-2-option-a-diff-parity-patch-plan.md` §7 + C.fix-3 applied state.
> **Tool actions taken this step:** 2× `code--view` (read-only file reads). **0 DB calls. 0 mutations. 0 migrations. 0 edge-fn changes. 0 cron changes. 0 `p_dry_run` flips. 0 live canary.**

---

## 0. SAFETY ATTESTATION

| Gate | Status |
|---|---|
| 100% SAFE TO RUN (this Lovable step) | ✅ |
| ZERO DAMAGE | ✅ |
| ZERO SIDE EFFECT | ✅ |
| ZERO FAN-OUT | ✅ |
| ZERO RECURSION | ✅ |
| Live canary status | 🛑 **HOLD** (stays HOLD until you paste psql output back) |

Note on **your** psql session: the mutation block in §2 is wrapped in `BEGIN … ROLLBACK`, so even on commit-failure Postgres aborts the whole txn. Zero residue is guaranteed **as long as you do not change `ROLLBACK` to `COMMIT`**.

---

## 1. PREREQUISITES BEFORE YOU PASTE

1. You are connected to the **same** database that received C.fix-3 (production Supabase project `isywidnfnjhtydmdfgtk`).
2. You have a real `psql` shell (NOT the Supabase SQL editor — the editor auto-commits and will violate the no-residue gate).
3. Pick **one operator wallet** that you control and that has **balance ≥ 1.00** so the `-0.01` probe never underflows. You will substitute its `user_id` into the `:'op_uid'` variable below.
4. Confirm `expire-gift-credits` is **not** about to fire in the next 60 s (avoid overlap). If unsure, wait until you are between cron ticks.
5. Have a scratchpad ready — you will copy back **every `NOTICE` line and every `SELECT` row** the block emits.

---

## 2. PATH A — SINGLE TX-WRAPPED MUTATION BLOCK (P1, P2, P4, P5)

> Paste this **entire block** as one unit into `psql`. It **must** end with `ROLLBACK;` — do not change that line.
> Replace `REPLACE_WITH_OPERATOR_USER_UUID` with your chosen operator `user_id` (UUID). Nothing else needs editing.

```sql
\set op_uid 'REPLACE_WITH_OPERATOR_USER_UUID'
\set ON_ERROR_STOP on
\timing on

BEGIN;

-- =========================================================================
-- PRE-STATE SNAPSHOT (for cleanup verification at the end)
-- =========================================================================
SELECT 'PRE :: wallet balance' AS label,
       user_id, balance
  FROM public.wallets
 WHERE user_id = :'op_uid'::uuid;

SELECT 'PRE :: v2 rows count (5min window)' AS label,
       count(*)
  FROM public.wallet_ledger_v2_rows
 WHERE user_id = :'op_uid'::uuid
   AND created_at > now() - interval '5 minutes';

SELECT 'PRE :: legacy tx count (5min window)' AS label,
       count(*)
  FROM public.wallet_transactions
 WHERE user_id = :'op_uid'::uuid
   AND created_at > now() - interval '5 minutes';

-- =========================================================================
-- P1 — DRY-RUN IDEMPOTENCE
-- Expect: ok=true, balance_after == wallets.balance (NOT balance - 0.01),
--         and NO row in wallet_ledger_v2_rows for this idem key.
-- =========================================================================
SELECT 'P1 :: dry_run result' AS label,
       public.wallet_ledger_apply_v2(
         p_op              := 'gift_expiry',
         p_user_id         := :'op_uid'::uuid,
         p_amount          := -0.01,
         p_idempotency_key := 'probe-P1-' || gen_random_uuid()::text,
         p_description     := 'C.fix-4 P1 dry-run probe',
         p_reference_id    := NULL,
         p_source_path     := 'probe.c-fix-4.p1',
         p_dry_run         := true
       ) AS p1_result;

SELECT 'P1 :: wallet balance unchanged' AS label,
       balance
  FROM public.wallets WHERE user_id = :'op_uid'::uuid;

SELECT 'P1 :: v2 rows for probe.c-fix-4.p1 (must be 0)' AS label,
       count(*)
  FROM public.wallet_ledger_v2_rows
 WHERE source_path = 'probe.c-fix-4.p1';

-- =========================================================================
-- P2 — LIVE ORDERED MIRROR (legacy first, then v2 mirror)
-- Expect: v2.balance_after == wallets.balance AND == paired wallet_transactions.balance_after.
-- =========================================================================
\set p2_idem 'probe-P2-mirror-fixed-key-for-pairing'

-- (a) legacy authoritative writer
SELECT 'P2a :: legacy wallet_transaction()' AS label,
       public.wallet_transaction(
         p_user_id     := :'op_uid'::uuid,
         p_amount      := -0.01,
         p_type        := 'gift_expiry',
         p_description := 'C.fix-4 P2 legacy leg',
         p_reference_id:= :'p2_idem'
       ) AS p2_legacy_result;

-- (b) v2 mirror (live, p_dry_run := false), same op + same idem key for primary join
SELECT 'P2b :: wallet_ledger_apply_v2 LIVE mirror' AS label,
       public.wallet_ledger_apply_v2(
         p_op              := 'gift_expiry',
         p_user_id         := :'op_uid'::uuid,
         p_amount          := -0.01,
         p_idempotency_key := :'p2_idem',
         p_description     := 'C.fix-4 P2 v2 mirror leg',
         p_reference_id    := :'p2_idem',
         p_source_path     := 'probe.c-fix-4.p2',
         p_dry_run         := false
       ) AS p2_v2_result;

-- Cross-check: v2 row vs wallets vs paired legacy row
SELECT 'P2 :: triple-equality check' AS label,
       w.balance                                AS wallets_balance,
       v.balance_after                          AS v2_balance_after,
       t.balance_after                          AS legacy_balance_after,
       (v.balance_after = w.balance)            AS v2_equals_wallet,
       (v.balance_after = t.balance_after)      AS v2_equals_legacy,
       (v.balance_after - t.balance_after)      AS balance_after_delta
  FROM public.wallets w
  JOIN public.wallet_ledger_v2_rows v
    ON v.user_id = w.user_id AND v.idempotency_key = :'p2_idem'
  LEFT JOIN public.wallet_transactions t
    ON t.user_id = w.user_id
   AND t.reference_id = :'p2_idem'
   AND t.type = 'gift_expiry'
 WHERE w.user_id = :'op_uid'::uuid;

-- =========================================================================
-- P3 IS RUN SEPARATELY (read-only, §3 of this doc) — but we ALSO call it
-- inside this txn so it sees the in-flight P2 mirror row before rollback.
-- Expect inside txn: balance_after_mismatch = 0, safe_for_shadow_wiring = true.
-- =========================================================================
SELECT 'P3-in-txn :: diff_report(5min)' AS label,
       public.wallet_ledger_v2_diff_report('5 minutes'::interval) AS p3_report;

-- =========================================================================
-- P4 — REGRESSION DETECTION (inject fake balance_after drift on P2 v2 row)
-- Expect: balance_after_mismatch >= 1, safe_for_shadow_wiring = false.
-- =========================================================================
UPDATE public.wallet_ledger_v2_rows
   SET balance_after = balance_after - 0.01
 WHERE idempotency_key = :'p2_idem'
   AND user_id = :'op_uid'::uuid;

SELECT 'P4 :: diff_report after drift injection' AS label,
       public.wallet_ledger_v2_diff_report('5 minutes'::interval) AS p4_report;

-- =========================================================================
-- P5 — SNAPSHOT MIRROR (persisted gate must also fail under injected drift)
-- Expect: the row inserted into wallet_ledger_v2_diff_log within this txn
--         carries safe_for_shadow_wiring = false AND balance_after_mismatch >= 1.
-- (The insert is rolled back with the rest of the txn — zero residue.)
-- =========================================================================
SELECT 'P5 :: diff_snapshot(5min) return' AS label,
       public.wallet_ledger_v2_diff_snapshot('5 minutes'::interval) AS p5_snapshot_return;

SELECT 'P5 :: last diff_log row written in this txn' AS label,
       id, captured_at,
       (report->>'safe_for_shadow_wiring')        AS safe_for_shadow_wiring,
       (report->>'balance_after_mismatch')        AS balance_after_mismatch,
       (report->>'max_balance_after_delta')       AS max_balance_after_delta,
       (report->>'mismatch_count')                AS mismatch_count,
       (report->>'unmatched_live')                AS unmatched_live,
       (report->>'unmatched_shadow')              AS unmatched_shadow
  FROM public.wallet_ledger_v2_diff_log
 ORDER BY captured_at DESC
 LIMIT 1;

-- =========================================================================
-- POST-STATE SNAPSHOT (must equal PRE-STATE after ROLLBACK below)
-- =========================================================================
SELECT 'POST(pre-rollback) :: wallet balance' AS label,
       balance
  FROM public.wallets WHERE user_id = :'op_uid'::uuid;

-- =========================================================================
-- MANDATORY ROLLBACK — DO NOT CHANGE THIS LINE
-- =========================================================================
ROLLBACK;

-- =========================================================================
-- POST-ROLLBACK RESIDUE CHECK (run in same psql session, AFTER the rollback)
-- All three counts MUST equal their PRE-STATE values.
-- =========================================================================
SELECT 'RESIDUE :: wallet balance (must equal PRE)' AS label,
       balance
  FROM public.wallets WHERE user_id = :'op_uid'::uuid;

SELECT 'RESIDUE :: v2 rows for probe.c-fix-4.p1/p2 (must be 0)' AS label,
       count(*)
  FROM public.wallet_ledger_v2_rows
 WHERE source_path IN ('probe.c-fix-4.p1','probe.c-fix-4.p2')
    OR idempotency_key = 'probe-P2-mirror-fixed-key-for-pairing';

SELECT 'RESIDUE :: legacy tx for P2 idem (must be 0)' AS label,
       count(*)
  FROM public.wallet_transactions
 WHERE reference_id = 'probe-P2-mirror-fixed-key-for-pairing';

SELECT 'RESIDUE :: diff_log rows captured during txn (must be 0)' AS label,
       count(*)
  FROM public.wallet_ledger_v2_diff_log
 WHERE captured_at > now() - interval '5 minutes'
   AND (report->>'safe_for_shadow_wiring') = 'false'
   AND (report->>'balance_after_mismatch')::int >= 1;
```

### What that block proves

| Probe | Pass criteria (from plan §7) |
|---|---|
| P1 | `p1_result.ok = true`, wallet balance unchanged, v2-row count for `probe.c-fix-4.p1` = **0** |
| P2 | `v2_equals_wallet = true`, `v2_equals_legacy = true`, `balance_after_delta = 0` |
| P3-in-txn | `p3_report.balance_after_mismatch = 0`, `p3_report.safe_for_shadow_wiring = true`, `p3_report.max_balance_after_delta = 0` |
| P4 | `p4_report.balance_after_mismatch ≥ 1`, `p4_report.safe_for_shadow_wiring = false`, `max_balance_after_delta = -0.01` |
| P5 | Last `diff_log` row inside txn has `safe_for_shadow_wiring = false`, `balance_after_mismatch ≥ 1` |
| RESIDUE | All four residue checks return values equal to PRE-STATE (balance unchanged, all counts = 0) |

---

## 3. READ-ONLY VERIFICATION QUERIES (P3 + P6) — run OUTSIDE the txn

These are pure `SELECT`s. Run them in `psql` (or even the Supabase SQL editor) **after** the §2 block has been rolled back. They will only observe the **current live production state**.

### 3.1 P3 — Live diff report parity (production, post-C.fix-3)

```sql
SELECT public.wallet_ledger_v2_diff_report('60 minutes'::interval) AS live_diff_report;
```

Pass criteria:
- `mismatch_count = 0`
- `error_count = 0`
- `unmatched_live = 0` AND `unmatched_shadow = 0` (these may legitimately be > 0; document the value but it does **not** block C.fix-4 — R4 alert-noise gate is deferred)
- `balance_after_mismatch = 0`
- `max_balance_after_delta = 0` or `null`
- `safe_for_shadow_wiring = true` **iff** all of the above hold

If `safe_for_shadow_wiring = false` because of `unmatched_*` only and `balance_after_mismatch = 0`, that is the **known deferred R4 issue** — not a C.fix-4 blocker.

### 3.2 P6 — Caller-shape parity (schema-level, zero side effect)

The five callers of `wallet_ledger_apply_v2` must still see the same return-shape JSON. We verify by reading the function signature and definition (no execution):

```sql
SELECT proname,
       pg_get_function_identity_arguments(oid) AS args,
       pg_get_function_result(oid)             AS returns
  FROM pg_proc
 WHERE proname = 'wallet_ledger_apply_v2'
   AND pronamespace = 'public'::regnamespace;
```

Pass criteria:
- `args` = `p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean`
- `returns` = `jsonb`

And confirm the mirror-mode comment is present (proves C.fix-3 is the active body):

```sql
SELECT position('MIRROR MODE (Phase 1A · C.fix-3 · Option A)' IN pg_get_functiondef(oid)) > 0
         AS mirror_mode_comment_present,
       position('v_balance_after := v_balance_before;' IN pg_get_functiondef(oid)) > 0
         AS option_a_assignment_present,
       position('v_balance_after := v_balance_before + p_amount;' IN pg_get_functiondef(oid)) > 0
         AS old_buggy_assignment_present  -- MUST be false
  FROM pg_proc
 WHERE proname = 'wallet_ledger_apply_v2'
   AND pronamespace = 'public'::regnamespace;
```

Pass criteria:
- `mirror_mode_comment_present = true`
- `option_a_assignment_present = true`
- `old_buggy_assignment_present = false`

### 3.3 Forbidden-zone confirmation (read-only)

```sql
-- Confirm no edge-fn or cron was silently touched in this window
SELECT name, schedule, active, jobname
  FROM cron.job
 WHERE jobname ILIKE '%wallet_ledger_v2_diff%'
    OR jobname ILIKE '%expire_gift_credits%'
 ORDER BY jobname;

-- Confirm expire-gift-credits caller still in its current p_dry_run mode
-- (read-only inspection of the diff-log; no fn call):
SELECT captured_at, (report->>'safe_for_shadow_wiring') AS safe, (report->>'mismatch_count') AS mm
  FROM public.wallet_ledger_v2_diff_log
 ORDER BY captured_at DESC
 LIMIT 5;
```

Pass criteria:
- Cron `schedule` and `active` flags are **unchanged** vs C.fix-3 execution doc.
- No new `wallet_ledger_v2_diff_log` row carries `safe='true'` AND `mm=0` AND is dated **before** C.fix-3 apply timestamp (would indicate timeline tampering — should be empty).

---

## 4. EXACT OUTPUT YOU MUST COPY BACK

Paste **all of the following back into chat**, verbatim, as one block. No summarisation, no editing.

1. The full `psql` transcript of §2 (from `BEGIN;` through the last RESIDUE `SELECT`). Include every `NOTICE`, every `LOG`, every error if any, and every result row.
2. The full output of §3.1 (the single `live_diff_report` JSON).
3. The full output of §3.2 — both queries (signature + body-marker check).
4. The full output of §3.3 — both queries (cron + recent diff_log tail).
5. The operator `user_id` you substituted into `:'op_uid'` (so we can correlate).
6. The exact `psql --version` and the timestamp (`SELECT now();`) you ran it at.

**Do NOT** paste partial output. **Do NOT** redact wallet balances (we need the equality check). If anything in §2 errors out, **paste the error verbatim and STOP** — do not retry, do not adjust the block, do not flip `ROLLBACK` to `COMMIT`.

---

## 5. WHAT LOVABLE WILL DO WITH YOUR OUTPUT

On receipt, the next Lovable step (`C.fix-5` — verification & gating) will:

1. Validate every Pass criteria in §2/§3 mechanically against your pasted output.
2. Write `docs/fix-sprints/phase-1a-step-c-fix-5-path-a-probe-verification.md` with the GREEN/HOLD verdict and a per-probe evidence table.
3. **Only if** all probes GREEN → propose authorisation command for the live gift_refund canary rerun (`C.fix-6`).
4. **Any** failing probe → keep canary on HOLD, propose minimal-blast-radius follow-up.

Until that verification doc exists with all-GREEN: **live gift_refund canary stays 🛑 HOLD.** Confirmed.

---

## 6. NEGATIVE-SPACE INVENTORY FOR THIS STEP

| Surface | Touched this step? |
|---|---|
| Database (any table, function, view, trigger, RLS, GRANT, cron) | ❌ (Lovable made zero DB calls) |
| Edge functions | ❌ |
| `p_dry_run` flag of any caller | ❌ |
| R4 alert-noise gate (`v_alert`) | ❌ (still deferred) |
| `wallet_ledger_v2_drift_report` | ❌ |
| Source code, ESLint, CI workflows, types files | ❌ |
| Memory index | ❌ |

Only file written this step: this doc. Zero side effects beyond filesystem.

---

## 7. FINAL VERDICT

# 🟢 GREEN (for this Lovable step) — `psql` probe block ready for you to run manually.

# 🛑 HOLD (live canary) — stays HOLD until you paste the §4 output and Lovable C.fix-5 validates it all-GREEN.
