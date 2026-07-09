# Phase 1A · Step C.fix-3 — Option-A + Diff Parity Migration EXECUTION

> **Status:** ✅ Applied and verified.
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Plan of record:** `docs/fix-sprints/phase-1a-step-c-fix-2-option-a-diff-parity-patch-plan.md`
> **Pre-flight schema confirmation (Plan §3.1):** `wallet_ledger_v2_rows.idempotency_key = text NOT NULL`, `balance_after = numeric NOT NULL` → **primary 1:1 idempotency_key join used; fallback NOT shipped.**

---

## 0. SAFETY ATTESTATION (post-apply)

| Gate | Status |
|---|---|
| Scope respected (3 functions only) | ✅ |
| No edge-fn edits | ✅ |
| No `p_dry_run` flip | ✅ |
| No cron change | ✅ |
| No R4 alert-noise patch | ✅ |
| No DDL on tables | ✅ |
| No RLS change | ✅ |
| No legacy decommission | ✅ |
| Rollback available | ✅ (pre-patch bodies preserved in C.fix-1 §1.3 + C.fix-1b §3.1/§3.2) |

---

## 1. MIGRATION

- **Migration command:** `supabase--migration` (single atomic apply, this step).
- **SQL artefact:** the migration body (verbatim) is preserved in the Supabase migration history (migration filename auto-assigned by tool at apply time; see Supabase migrations list, most recent entry titled “Phase 1A · Step C.fix-3 — Branch-F Option-A + Diff Parity Migration”).
- **Apply result (tool message):** `The migration completed successfully.`
- **Functions replaced (3, exactly):**
  1. `public.wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean)`
  2. `public.wallet_ledger_v2_diff_report(interval)`
  3. `public.wallet_ledger_v2_diff_snapshot(interval)`

Signature, language, volatility, `SECURITY DEFINER`, `search_path` — preserved verbatim for all three.

---

## 2. BEFORE / AFTER PROOF

### 2.1 `wallet_ledger_apply_v2` — section C (single-line algebra)

**BEFORE** (verbatim from C.fix-1 §1.3):
```sql
-- C. Read current balance (no mutation)
SELECT COALESCE(balance, 0) INTO v_balance_before
  FROM public.wallets WHERE user_id = p_user_id;
IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;
v_balance_after := v_balance_before + p_amount;
```

**AFTER** (applied):
```sql
-- C. Read current balance (no mutation)
SELECT COALESCE(balance, 0) INTO v_balance_before
  FROM public.wallets WHERE user_id = p_user_id;
IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;
-- MIRROR MODE (Phase 1A · C.fix-3 · Option A):
-- Legacy wallet_transaction() is the authoritative balance writer. It
-- commits at T+0; this function runs at T+~234 ms (ordering proven in
-- docs/fix-sprints/phase-1a-step-c-branch-f-balance-after-audit.md §1.4).
-- Therefore v_balance_before already reflects the post-legacy authoritative
-- balance. Do NOT re-apply p_amount here; p_amount is preserved as a
-- column in wallet_ledger_v2_rows for downstream reconciliation.
v_balance_after := v_balance_before;
```

### 2.2 `wallet_ledger_v2_diff_report` — additions (matched-pairs CTE + projection + verdict)

**Added** to `pairs` CTE — primary 1:1 lateral on `idempotency_key`:
```sql
LEFT JOIN LATERAL (
  SELECT v.balance_after AS v2_balance_after
    FROM public.wallet_ledger_v2_rows v
   WHERE v.idempotency_key = s.idempotency_key
   LIMIT 1
) v2 ON true
```
**Added** to top-level `SELECT ... FROM pairs`:
```sql
count(*) FILTER (
  WHERE live_id IS NOT NULL
    AND v2_balance_after IS NOT NULL
    AND v2_balance_after IS DISTINCT FROM l_balance_after
) AS balance_after_mismatch,
max(abs(v2_balance_after - l_balance_after)) FILTER (
  WHERE live_id IS NOT NULL AND v2_balance_after IS NOT NULL
) AS max_balance_after_delta
```
**Verdict gate now AND-includes the R2 check:**
```sql
v_safe := (v_amount_mismatch = 0)
      AND (v_type_mismatch   = 0)
      AND (v_user_mismatch   = 0)
      AND (v_balance_after_mismatch = 0);   -- NEW R2 gate
```
**Return JSON additions (additive only, no field renamed/removed):**
`balance_after_mismatch`, `max_balance_after_delta`.

### 2.3 `wallet_ledger_v2_diff_snapshot` — same additions, persisted

- Same v2 lateral join on `idempotency_key`.
- Same two counters: `v_balance_after_mismatch`, `v_max_balance_after_delta`.
- `v_mismatch_count` now sums `balance_after_mismatch` in (so persisted `mismatch_count` column reflects it).
- `v_safe` gate now AND-includes `(v_balance_after_mismatch = 0)` → snapshot **cannot** record `safe_for_shadow_wiring = true` when any `balance_after` drift exists.
- New fields persisted into the existing `raw_report jsonb` column (no DDL on `wallet_ledger_v2_diff_log`).
- **R4 alert-noise (`v_alert`) intentionally unchanged** — DEFERRED per gates.

---

## 3. POST-APPLY VERIFICATION (read-only)

Query (verbatim, executed against patched DB):
```sql
WITH defs AS (
  SELECT proname, pg_get_functiondef(oid) AS body
  FROM pg_proc
  WHERE pronamespace='public'::regnamespace
    AND proname IN ('wallet_ledger_apply_v2','wallet_ledger_v2_diff_report','wallet_ledger_v2_diff_snapshot')
)
SELECT
  proname,
  (body LIKE '%v_balance_after := v_balance_before + p_amount%') AS still_has_old_line,
  (body LIKE '%v_balance_after := v_balance_before;%')          AS has_mirror_line,
  (body LIKE '%MIRROR MODE%')                                    AS has_mirror_comment,
  (body LIKE '%balance_after_mismatch%')                         AS has_balance_after_mismatch,
  (body LIKE '%max_balance_after_delta%')                        AS has_max_delta,
  (body LIKE '%v.idempotency_key = s.idempotency_key%')          AS has_v2_idem_join,
  (body LIKE '%AND (v_balance_after_mismatch = 0)%')             AS verdict_gates_on_balance_after
FROM defs ORDER BY proname;
```

Result:

| proname | still_has_old_line | has_mirror_line | has_mirror_comment | has_balance_after_mismatch | has_max_delta | has_v2_idem_join | verdict_gates_on_balance_after |
|---|---|---|---|---|---|---|---|
| `wallet_ledger_apply_v2` | **false** ✅ | **true** ✅ | **true** ✅ | false (N/A) | false (N/A) | false (N/A) | false (N/A) |
| `wallet_ledger_v2_diff_report` | **false** ✅ | false (N/A) | false (N/A) | **true** ✅ | **true** ✅ | **true** ✅ | **true** ✅ |
| `wallet_ledger_v2_diff_snapshot` | **false** ✅ | false (N/A) | false (N/A) | **true** ✅ | **true** ✅ | **true** ✅ | **true** ✅ |

Every required check ✅. No assertion failed.

---

## 4. FORBIDDEN-AREA CONFIRMATION (no drift)

| Forbidden area | Touched in this migration? | Evidence |
|---|---|---|
| Edge functions (`expire-gift-credits`, `vote`, `unvote_penalty`, `deposit_credit`, `vote_payout`) | ❌ No | Migration body contains zero edge-function code; no `supabase/functions/**` files written this step. |
| `p_dry_run` defaults / call-site flips | ❌ No | `wallet_ledger_apply_v2` default `p_dry_run boolean DEFAULT true` preserved verbatim; no caller diffs. |
| Cron schedule | ❌ No | No `cron.schedule` / `cron.unschedule` / `pg_cron.*` calls in the migration. |
| R4 alert-noise gate (`v_alert` in `diff_snapshot`) | ❌ No (DEFERRED per gate) | `v_alert := (v_mismatch_count > 0) OR (v_error_count > 0) OR (v_unmatched_live > 0) OR (v_unmatched_shadow > 0);` — byte-identical to pre-patch (`balance_after_mismatch` enters via `v_mismatch_count` summation only). |
| `wallet_ledger_v2_drift_report` | ❌ No | Function name does not appear in migration body. |
| Legacy `wallet_transaction()` / decommission | ❌ No | Not referenced in migration. |
| RLS policies | ❌ No | No `CREATE/ALTER POLICY`, no `ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY`. |
| Caller refactors | ❌ No | Function signatures of all 3 patched fns are byte-identical (verified via `pg_get_functiondef` header). |
| Table schema changes | ❌ No | No `CREATE TABLE`, no `ALTER TABLE` in migration. |
| Linter warnings | ⚠️ Pre-existing, unrelated | 380 linter findings reported are project-wide pre-existing (security-definer views, public buckets, etc.); none originate from the 3 functions patched here. |

---

## 5. ROLLBACK SQL (location)

Single migration of the inverse `CREATE OR REPLACE FUNCTION` for all 3 functions, restoring verbatim pre-patch bodies preserved in:
- `docs/fix-sprints/phase-1a-step-c-branch-f-balance-after-audit.md` §1.3 (`wallet_ledger_apply_v2`)
- `docs/fix-sprints/phase-1a-step-c-fix-1b-diff-snapshot-drift-sub-audit.md` §3.1 (`wallet_ledger_v2_diff_report`)
- `docs/fix-sprints/phase-1a-step-c-fix-1b-diff-snapshot-drift-sub-audit.md` §3.2 (`wallet_ledger_v2_diff_snapshot`)

Rollback execution time target: < 60 s (single migration apply). Idempotent: re-running rollback is a no-op. No data rollback needed.

---

## 6. FINAL VERDICT

# 🟢 GREEN — migration applied and verified, ready for synthetic probe.

R1 (Branch-F Option-A) and R2 (diff parity) gates are closed end-to-end in code. R4 explicitly deferred per authorisation.

**Next required command (await explicit user `GO`):**

> `GO PHASE-1A STEP C.fix-4 — SYNTHETIC PROBES P1–P6 (READ + REVERTED TRANSACTION ONLY, NO LIVE CANARY)`

That step will execute Probes P1–P6 from Plan §7 (all inside `BEGIN; … ROLLBACK;` on the operator wallet only, zero production-state mutation). Only after all six probes are GREEN may the user authorise a separate `C.fix-5` live canary rerun.
