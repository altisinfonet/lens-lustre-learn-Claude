# Phase 1A — Step C.fix-1: Branch F `balance_after` Semantics Forensic Audit

> **Mode:** READ-ONLY. No mutation, no DDL, no deploy, no flag flips, no edge-fn edits, no live wallet ops.
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Source-of-truth:** `pg_get_functiondef()` live pull (2026-05-18) + `wallet_ledger_v2_rows` + `wallet_transactions` canary residue.

---

## 1. VERIFIED FINDINGS

### 1.1 Function inventory (live DB)

`SELECT proname FROM pg_proc WHERE proname LIKE 'wallet_ledger%'` →

| # | Function | Exists? |
|---|---|---|
| 1 | `wallet_ledger_apply_v2` | ✅ |
| 2 | `wallet_ledger_v2_diff_report` | ✅ |
| 3 | `wallet_ledger_v2_diff_snapshot` | ✅ |
| 4 | `wallet_ledger_v2_drift_report` | ✅ |
| 5 | **`wallet_ledger_v2_record`** | 🛑 **DOES NOT EXIST** |

The audit prompt asked for a dump of `wallet_ledger_v2_record`. This function is not present in the live DB. Treat any prior reference to it as **NOT VERIFIED** / mis-named. The append-only insert into `wallet_ledger_v2_rows` is performed inline inside `wallet_ledger_apply_v2` section F (lines quoted below), not via a separate recorder helper.

### 1.2 Structural finding — there is NO conditional "Branch F"

The audit prompt names a "Branch F keyed on `p_source_path='legacy_mirror'`". **No such conditional branch exists** in `wallet_ledger_apply_v2`.

What does exist:
- A linear function body with letter-commented sections A → F.
- **Section F is labelled `-- F. LIVE PATH`**, which is what the prompt has been calling "Branch F".
- `p_source_path` is **only ever stored** (audit log, shadow log, v2 rows). It is **never read** in any `IF` / `CASE`. There is zero behavioural divergence based on its value (`'legacy_mirror'` vs anything else).
- The string literal `'legacy_mirror'` **does not appear** anywhere in the function body. The canary calls pass `p_source_path = 'supabase/functions/expire-gift-credits'`, not `'legacy_mirror'`.

This is a **first-class semantic finding**: the design contract implied by the prompt ("Branch F mirrors when source_path = legacy_mirror") is **not implemented**. The same code path is used for shadow-mode validation AND live appends, distinguished only by `p_dry_run`.

### 1.3 Exact failing line

From `pg_get_functiondef(wallet_ledger_apply_v2)`, section C (computed once, reused for both dry-run and live):

```sql
-- C. Read current balance (no mutation)
SELECT COALESCE(balance, 0) INTO v_balance_before
  FROM public.wallets WHERE user_id = p_user_id;
IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;
v_balance_after := v_balance_before + p_amount;       --  ← THE BUG LINE
```

Then section F persists that computed value verbatim:

```sql
-- F. LIVE PATH — append-only insert into wallet_ledger_v2_rows ONLY.
INSERT INTO public.wallet_ledger_v2_rows (
  op, user_id, amount, idempotency_key, ..., balance_before, balance_after, ...
) VALUES (
  p_op, p_user_id, p_amount, p_idempotency_key, ...,
  v_balance_before, v_balance_after, ...                --  ← stores 4.98
)
```

### 1.4 Authoritative ordering proof — live canary residue

| Row | Source table | `created_at` | `balance_after` | Delta vs prior |
|---|---|---|---|---|
| Legacy `gift_expiry` −0.01 | `wallet_transactions` | **14:30:22.599803+00** | **4.99** | 5.00 → 4.99 |
| v2 mirror `gift_refund` −0.01 | `wallet_ledger_v2_rows` | **14:30:22.833210+00** (234 ms later) | **4.98** | 4.99 → 4.98 |
| Cleanup `admin_adjustment` +0.01 | `wallet_transactions` | 14:31:22.714476+00 | 5.00 | 4.99 → 5.00 |

**Proven ordering:** legacy `wallet_transaction()` commits **first** (T+0 ms), then `wallet_ledger_apply_v2` runs **second** (T+234 ms) and reads an already-debited `wallets.balance = 4.99`, then **subtracts the same `−0.01` a second time** to compute `4.98`. Drift is **deterministic** (= `−p_amount`) and **structural** (will repeat for every op that flips to live).

### 1.5 Semantic-ownership matrix (verified)

| Surface | Owns `wallets.balance`? | Writes `wallet_transactions`? | Writes `wallet_ledger_v2_rows`? |
|---|---|---|---|
| `wallet_transaction()` (legacy RPC) | ✅ AUTHORITATIVE | ✅ | ✗ |
| `wallets` table | (mutated only by legacy RPC) | n/a | n/a |
| `wallet_transactions` table | n/a | (written only by legacy RPC) | n/a |
| `wallet_ledger_apply_v2` section F | ✗ (read-only on wallets) | ✗ | ✅ append-only |
| `wallet_ledger_v2_rows` | n/a | n/a | (sink) |

`wallet_ledger_apply_v2` is **mirror-only, never mutator** — confirmed by the source comment "NO update on wallets. NO insert into wallet_transactions." and by zero `UPDATE/INSERT` against those tables in the function body.

### 1.6 Diff-report parity analysis

`wallet_ledger_v2_diff_report()` matches shadow rows to live rows by `(user_id, amount)` only:

```sql
LEFT JOIN LATERAL (
  SELECT * FROM l
   WHERE l.user_id = s.user_id
     AND l.amount  = s.amount
   ORDER BY abs(extract(epoch FROM (l.created_at - s.captured_at)))
   LIMIT 1
) l ON true
```

It computes `amount_mismatch`, `type_mismatch`, `user_mismatch`, `reference_mismatch` — **but it never compares `balance_after`** between v2 rows and legacy txns. Consequently:

- The diff report **cannot detect** the −0.01 `balance_after` drift discovered in §1.4.
- `safe_for_shadow_wiring` returned TRUE throughout the 72 h soak because the only fields it checks (`amount`, `op→type`, `user_id`) all agreed.
- This is a **second-class semantic finding**: the diff report contract and the recorder contract disagree on what "parity" means.

### 1.7 Future-caller compatibility

The four other production callers currently in dry-run (`vote`, `unvote_penalty`, `deposit_credit`, `vote_payout`) follow the **same legacy-first → v2-mirror-second** pattern as `expire-gift-credits`. Therefore any live flip on any of them under the current section-F algebra will produce the **identical deterministic `−p_amount` `balance_after` drift**. No caller is immune.

---

## 2. NOT VERIFIED ITEMS

- **`wallet_ledger_v2_record`** — does not exist; cannot be dumped (§1.1).
- **Conditional Branch F keyed on `p_source_path='legacy_mirror'`** — not present in code (§1.2).
- **Whether any caller intentionally relies on `balance_after = pre_legacy_balance + p_amount`** — no such caller found in `git grep`; treated as none, but not formally signed off.
- **Whether `wallet_ledger_v2_diff_report` is the *only* parity surface** — `wallet_ledger_v2_diff_snapshot` and `wallet_ledger_v2_drift_report` exist but were not part of this audit's READ scope; their `balance_after` semantics are **NOT VERIFIED HERE** and require a follow-up sub-audit before any fix is shipped.

---

## 3. FILES TOUCHED

| Path | Type | Change |
|---|---|---|
| `docs/fix-sprints/phase-1a-step-c-branch-f-balance-after-audit.md` | report | NEW (this file) |

Zero code, zero SQL, zero edge-fn, zero migration changes.

---

## 4. RISKS

- **R1 (BLOCKING, pre-existing):** Every future live flip of any v2-mirror caller will record `balance_after = wallets.balance − p_amount` instead of `= wallets.balance`. Phase 1B reconciliation will alarm on every row.
- **R2 (NEW, discovered in §1.6):** `wallet_ledger_v2_diff_report` does not compare `balance_after`. Even after R1 is fixed, the diff report will **not** confirm `balance_after` parity. The report's `safe_for_shadow_wiring=true` verdict is therefore **necessary-but-insufficient** for cutover gates.
- **R3 (NEW, discovered in §1.2):** `p_source_path` is stored but never branched on. Any future fix that *does* want mirror-mode vs authoritative-mode semantics must add the missing `IF` branch — it doesn't exist today.

---

## 5. DIFF SUMMARY

None. Audit-only.

---

## 6. VERIFICATION PROOF

- `pg_get_functiondef('public.wallet_ledger_apply_v2')` — full body included §1.3, quoted verbatim.
- `pg_get_functiondef('public.wallet_ledger_v2_diff_report')` — quoted §1.6.
- `SELECT proname FROM pg_proc WHERE proname LIKE 'wallet_ledger%'` — 4 rows; `wallet_ledger_v2_record` absent.
- `SELECT … FROM wallet_ledger_v2_rows ORDER BY created_at DESC LIMIT 5` — one canary row, `balance_after = 4.98`.
- `SELECT … FROM wallet_transactions WHERE type IN ('gift_expiry','admin_adjustment')` — paired legacy row at `balance_after = 4.99`, 234 ms earlier.
- `grep -c "legacy_mirror"` in function body → **0 occurrences**.
- `grep -c "IF p_source_path"` in function body → **0 occurrences**.

---

## 7. ROLLBACK PLAN

N/A — read-only audit. Nothing to roll back.

---

## 8. RECOMMENDED FIX OPTION

### Option evaluation matrix

| Opt | Mechanic | Caller change | Algebra correctness | Race-safety vs legacy commit | Future v2-authoritative mode compatible | Blast radius |
|---|---|---|---|---|---|---|
| **A** | After legacy commit, re-read `wallets.balance` and store **that** as `balance_after`; treat `p_amount` as metadata only. | None (zero caller diffs) | ✅ exact | ✅ legacy already committed before re-read | ⚠️ would need rework if v2 ever becomes authoritative | **Smallest** |
| B | Add `p_pre_balance numeric` param; record `p_pre_balance + p_amount`. | 5 caller edits (one new arg each) | ✅ exact (caller must snapshot before legacy call) | ✅ snapshot taken pre-legacy | ✅ | Medium |
| C | Move `wallet_ledger_apply_v2` call **before** `wallet_transaction()`. | 5 caller edits (re-order) | ✅ | 🛑 inverts authoritative ordering; legacy failure would orphan v2 mirror row | ⚠️ semantic regression risk | High |
| D | Store `balance_after = NULL` when mirror-mode; rely on `amount` + later reconciliation. | None | ⚠️ loses running-total invariant | ✅ | ⚠️ | Medium |

### Recommendation: **Option A** with an added parity assertion

Rationale:
1. **Zero caller edits** ⇒ smallest blast radius; matches Forensic Mandate Rule 4 (diff-captured, reversible).
2. **Preserves the canonical contract** "legacy is authoritative; v2 is a faithful post-state mirror".
3. **Algebraically self-correcting**: re-reading `wallets.balance` after legacy commit *by definition* yields the same value the legacy txn just wrote — so v2's `balance_after` will equal `wallet_transactions.balance_after` for the paired row.
4. The parity assertion (`v_post_balance - v_pre_balance == p_amount`, raise `LEDGER_DELTA_MISMATCH` on violation) catches concurrent-mutation races without blocking the happy path.
5. Forward-compatible: when Phase 2+ introduces a true v2-authoritative caller, that work will add the missing `IF p_source_path = 'v2_native' THEN …` branch (R3) — Option A does not foreclose it.

Sketch of the proposed minimal patch (DO NOT APPLY YET — plan only):

```sql
-- after section E (dry-run path) returns; entering section F (LIVE PATH):
SELECT COALESCE(balance, 0) INTO v_balance_after        -- ← re-read AUTHORITATIVE
  FROM public.wallets WHERE user_id = p_user_id;
IF (v_balance_after - v_balance_before) IS DISTINCT FROM p_amount THEN
  -- log + raise; quarantines races, never silently mis-records
  ...
  RETURN jsonb_build_object('ok',false,'error_code','LEDGER_DELTA_MISMATCH', ...);
END IF;
-- then INSERT INTO wallet_ledger_v2_rows ... balance_after = v_balance_after
```

Pair with a **diff-report patch** (separate one-line change) so `wallet_ledger_v2_diff_report` also compares `balance_after`, closing R2.

---

## 9. SYNTHETIC REVALIDATION PLAN (after fix, before any new live canary)

1. **Reset:** none — the prior canary's residue is the regression fixture.
2. **Probe A — dry-run replay:** invoke `wallet_ledger_apply_v2(... p_dry_run := true ...)` for a synthetic `gift_refund` on operator wallet **without** prior legacy debit; assert `balance_after = balance_before + p_amount` (unchanged dry-run contract).
3. **Probe B — live ordered mirror:** in a single transaction inside a throw-away DB session: BEGIN; `SELECT wallet_transaction(...)` legacy −0.01; `SELECT wallet_ledger_apply_v2(... p_dry_run := false ...)`; assert
   `v2_rows.balance_after == wallets.balance AFTER legacy` AND
   `v2_rows.balance_after == wallet_transactions.balance_after for paired row`.
   ROLLBACK.
4. **Probe C — race injection:** between legacy and v2 calls, inject a second legacy `+0.05` admin_adjustment; expect `LEDGER_DELTA_MISMATCH` error code, **no** insert into `wallet_ledger_v2_rows`, audit log row with `result='error'`.
5. **Probe D — diff-report parity:** after Probes A–C, call `wallet_ledger_v2_diff_report('1 hour')`; expect `amount_mismatch=0`, `balance_after_mismatch=0` (new field after R2 patch), `safe_for_shadow_wiring=true`.
6. **All four probes GREEN** ⇒ unlock §8 fix patch → re-run live `gift_refund` canary on operator wallet ($0.01, ≤3 min, `organic_eligible_now=0` gate).

---

## 10. EXPLICIT VERDICT

# 🛑 HOLD — Audit complete. DO NOT patch yet.

**Open gates before any code/SQL change is authorised:**

1. User sign-off on **Option A** (or counter-selection of B / C / D) — §8.
2. User sign-off on the **diff-report parity patch** (closes R2) — §4.
3. Sub-audit of `wallet_ledger_v2_diff_snapshot` and `wallet_ledger_v2_drift_report` `balance_after` semantics — §2.
4. Approval of synthetic revalidation plan §9.

Once 1–4 are signed, the next authorised command is:

> `GO PHASE-1A STEP C.fix-2 — APPLY BRANCH-F OPTION-A PATCH (PLAN ONLY)`

(Plan-only: that step will produce the exact migration SQL diff for user review; it will **not** execute.)

---

## 11. NEXT RECOMMENDED STEP

`GO PHASE-1A STEP C.fix-1b — DIFF/SNAPSHOT/DRIFT BALANCE_AFTER SUB-AUDIT (READ-ONLY)`

to close §2 / R2 before any patch plan is drafted.
