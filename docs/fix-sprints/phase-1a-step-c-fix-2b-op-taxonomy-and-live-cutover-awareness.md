# Phase 1A — Step C.fix-2b: Op-Name Taxonomy Normalization + `unmatched_live` Live-Cutover Awareness — DELTA PATCH PLAN

> **Mode:** PLAN ONLY. No SQL draft. No migration. No deploy. No code change. No rollback execution. No next mutation.
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Extends:** `docs/fix-sprints/phase-1a-step-c-fix-2-option-a-diff-parity-patch-plan.md` (C.fix-2) and the C.fix-3 migration execution document.
> **Trigger:** Mutation #11a (vote canary) produced canonical live rows but the reconciliation matcher reported `unmatched_live=4`, `mismatch_count=8`, `safe_for_shadow_wiring=false`. Root cause was identified in the prior forensic audit and is now formalised here as a delta to the patch plan.

---

## 0. SAFETY ATTESTATION

| Gate | Status |
|---|---|
| 100% SAFE | ✅ (plan only) |
| ZERO DAMAGE | ✅ |
| ZERO SIDE EFFECT | ✅ |
| ZERO FAN-OUT | ✅ |
| ZERO RECURSION | ✅ |
| SQL drafted this step | NONE |
| SQL executed this step | NONE |
| DDL this step | NONE |
| Code changes this step | NONE |
| Rollback executed | N/A |

---

## 1. WHY A DELTA IS NEEDED

C.fix-2 closed gates R1 (Branch-F balance algebra) and R2 (`balance_after_mismatch` counter + gate) and explicitly **deferred R4** (alert paging). After Mutation #11a, two **additional** structural defects in the diff matcher were observed that R1/R2 do not cover:

### 1.1 Root Cause N1 — `unmatched_live` is shadow-log-only
- `wallet_ledger_v2_diff_snapshot` defines `unmatched_live` as: rows in `wallet_transactions` (within the window) that have **no pair in `wallet_ledger_shadow_log`** under `(user_id, amount)`.
- `wallet_ledger_apply_v2` only writes to `wallet_ledger_shadow_log` in **Branch E (DRY-RUN)**. The **LIVE Branch F** (the path Mutation #11a took with `p_dry_run := false`) writes exclusively to `wallet_ledger_v2_rows`.
- Therefore any successful **live cutover** write is structurally counted as `unmatched_live`, regardless of correctness.
- Evidence: forensic audit summarised in conversation memory; the 4 unmatched live rows are exactly the 4 `vote_reward_voter`/`vote_reward_owner`/penalty rows produced by Mutation #11a.

### 1.2 Root Cause N2 — Op-name taxonomy mismatch
- Vote-path ops emitted by `wallet_ledger_apply_v2` (used by `cast-photo-vote`): `vote_reward_voter`, `vote_reward_owner`, `vote_unvote_penalty_voter`, `vote_unvote_penalty_owner`.
- Legacy `wallet_transactions.type` values: `vote_reward`, `unvote_penalty`.
- The matcher's `type_mismatch` predicate compares the two raw strings with `IS DISTINCT FROM`, so **every** paired vote row trips `type_mismatch` by construction → `mismatch_count=8` in Mutation #11a.

Both defects make `safe_for_shadow_wiring` permanently `false` whenever any live vote flows, even when the wallet math is correct.

---

## 2. SCOPE (delta only — additive to C.fix-2 / C.fix-3)

| # | Surface | Change class | Caller diff? |
|---|---|---|---|
| Δ1 | `public.wallet_op_to_legacy_type(text)` | NEW pure IMMUTABLE helper function (taxonomy map) | ❌ none |
| Δ2 | `public.wallet_ledger_v2_diff_report(interval)` | extend `type_mismatch` predicate to apply taxonomy map; extend `unmatched_live` to also accept a `wallet_ledger_v2_rows` counterpart via `idempotency_key` | ❌ none |
| Δ3 | `public.wallet_ledger_v2_diff_snapshot(interval)` | mirror Δ2; persist same JSON shape; same verdict gate | ❌ none |

**Out of scope for Δ (unchanged from C.fix-2):**
- `wallet_ledger_apply_v2` body (already patched in C.fix-3 Option A; not re-opened).
- Any edge function caller — zero diffs.
- Cron schedule — unchanged.
- R4 alert paging — still deferred.
- `wallet_ledger_v2_drift_report` — not touched.
- All wallet/finance write paths — not touched.

---

## 3. Δ1 — `wallet_op_to_legacy_type` (NEW HELPER)

### 3.1 Proposed contract (illustrative — not SQL draft)

| Input `p_op` | Output legacy `type` |
|---|---|
| `vote_reward_voter` | `vote_reward` |
| `vote_reward_owner` | `vote_reward` |
| `vote_unvote_penalty_voter` | `unvote_penalty` |
| `vote_unvote_penalty_owner` | `unvote_penalty` |
| any other value | **pass-through** (returns `p_op` unchanged) |

### 3.2 Properties

- `LANGUAGE sql IMMUTABLE` (pure, deterministic, inlineable, indexable).
- `SECURITY INVOKER` (no privilege escalation, no `SET search_path` needed beyond schema-qualified inputs).
- Pure function — zero side effects, zero writes, zero realtime, zero recursion.
- Pass-through fallback guarantees unknown ops (typos, new taxonomy added later) **still trip** `type_mismatch` rather than being silently normalised. **This preserves alerting on real drift.**

### 3.3 Why a helper (vs inline CASE)

- Single source of truth — used by both `diff_report` and `diff_snapshot`, no copy-paste drift.
- Independently unit-testable in the synthetic probe block.
- Reversible: rollback drops the helper after the two callers revert.

---

## 4. Δ2 — `wallet_ledger_v2_diff_report(interval)`

### 4.1 `type_mismatch` predicate — before/after behaviour

**BEFORE (today):**
```
type_mismatch := (live.type IS DISTINCT FROM shadow.op)
```
Result for any vote pair: ALWAYS true (taxonomy guarantees it).

**AFTER (proposed behaviour):**
```
type_mismatch := (live.type IS DISTINCT FROM wallet_op_to_legacy_type(shadow.op))
```
Result for a correct vote pair: FALSE. Result for unknown / drifted op: still TRUE (pass-through).

### 4.2 `unmatched_live` counter — before/after behaviour

**BEFORE (today):** A live `wallet_transactions` row in window is `unmatched_live` iff no `wallet_ledger_shadow_log` row in window shares `(user_id, amount)`.

**AFTER (proposed behaviour):** A live row is `unmatched_live` iff:
- no `wallet_ledger_shadow_log` row in window shares `(user_id, amount)` **AND**
- no `wallet_ledger_v2_rows` row in window shares `idempotency_key` with any candidate pairing for that live row, where `idempotency_key` is the same value `wallet_ledger_apply_v2` writes in both Branch E and Branch F.

Equivalently: a live row counts as matched if **either** legacy-shadow OR v2-rows path produced a counterpart for it. Both paths use the same `wallet_ledger_idempotency` registry, so collisions are bounded by that uniqueness constraint.

### 4.3 Pairing strategy

- **Primary key:** `idempotency_key` (already proven NOT NULL in C.fix-2 §3.1 for `wallet_ledger_v2_rows`; same key shape for `wallet_ledger_shadow_log`).
- **Fallback:** only if §3.1 pre-check re-verifies a NULL exists — `(user_id, amount, abs(created_at − captured_at) < 5s)`. Documented for completeness; not expected to ship.

### 4.4 Verdict gate — unchanged shape, additive AND-term semantics

The verdict gate already AND-includes `(v_unmatched_live = 0)` and `(v_mismatch_count = 0)`. Δ2 changes **what those counters mean**, not the gate algebra. After Δ2:

- `unmatched_live = 0` becomes achievable for live-cutover vote ops.
- `mismatch_count = 0` becomes achievable for correctly-paired vote ops.
- Both still trip on any genuine drift (unknown op, missing pair, value mismatch).

### 4.5 Return JSON

No new top-level keys required. Existing `unmatched_live`, `mismatch_count`, `type_mismatch`, `safe_for_shadow_wiring` keys retain their names and types — only their *computed values* now reflect the corrected matcher. **No client-facing breaking change.**

---

## 5. Δ3 — `wallet_ledger_v2_diff_snapshot(interval)`

### 5.1 Mirror Δ2 inside the persisted snapshot

- Same `type_mismatch` rewrite via `wallet_op_to_legacy_type`.
- Same dual-path `unmatched_live` definition.
- Persisted JSON shape in `wallet_ledger_v2_diff_log.report` unchanged at the key level; values reflect the corrected matcher.

### 5.2 Snapshot verdict — `safe_for_shadow_wiring`

```
v_safe_for_shadow_wiring := (v_mismatch_count = 0)
                       AND (v_error_count = 0)
                       AND (v_unmatched_live = 0)
                       AND (v_unmatched_shadow = 0)
                       AND (v_balance_after_mismatch = 0);   -- from C.fix-2
```
**Unchanged.** Δ3 changes inputs, not the gate.

### 5.3 R4 alert paging — STILL DEFERRED

Per the original gate authorisation, the `v_alert` expression is **not** modified in this delta. After Δ3 ships, hourly pages will correctly fall to zero for healthy vote traffic (instead of paging on every successful live vote), which is the intended observable improvement.

### 5.4 What does NOT change

- Function signatures, language, volatility, SECURITY DEFINER, search_path.
- Writes restricted to `wallet_ledger_v2_diff_log` + `admin_notifications`.
- `wallets_checksum` calculation.
- All Δ stays additive at the SQL surface; existing column names preserved.

---

## 6. NEGATIVE-SPACE INVENTORY (what Δ does NOT touch)

- `wallets` table — no writes.
- `wallet_transactions` table — no writes.
- `wallet_ledger_v2_rows` table — no writes, no schema change.
- `wallet_ledger_shadow_log` table — no writes, no schema change.
- `wallet_ledger_idempotency` table — no change.
- `wallet_ledger_audit_log` table — no change.
- `wallet_ledger_v2_diff_log` table — no schema change.
- `admin_notifications` — no change to writers; no new paging path (R4 deferred).
- `wallet_ledger_v2_drift_report` — not touched.
- `wallet_ledger_apply_v2` — not touched in Δ.
- All edge-function callers — not touched.
- Cron schedules — not touched.
- RLS / GRANT — not touched.

---

## 7. SYNTHETIC PROBES (must pass before apply — PLAN ONLY)

All probes run inside an explicit `BEGIN; … ROLLBACK;` block in a staging session against a synthetic operator wallet only. No production state mutated.

| # | Probe | Setup | Action | Pass criteria |
|---|---|---|---|---|
| Q1 | Helper map correctness | none | `SELECT wallet_op_to_legacy_type(op) FROM (VALUES ('vote_reward_voter'), ('vote_reward_owner'), ('vote_unvote_penalty_voter'), ('vote_unvote_penalty_owner'), ('gift_expiry'), ('made_up_op'))` | first 4 return `vote_reward`/`vote_reward`/`unvote_penalty`/`unvote_penalty`; `gift_expiry` and `made_up_op` return themselves (pass-through) |
| Q2 | Type-mismatch zero on healthy vote | seed paired rows in `wallet_transactions`+`wallet_ledger_v2_rows` for a synthetic voter+owner | call `wallet_ledger_v2_diff_report('5 minutes')` | `mismatch_count = 0`; `type_mismatch` aggregate = 0 |
| Q3 | Type-mismatch alerts on unknown op | inject synthetic v2 row with `op := 'made_up_op'`, legacy row with `type := 'vote_reward'` | re-run `diff_report` | `mismatch_count ≥ 1` (proves pass-through still alerts) |
| Q4 | `unmatched_live` zero on live-cutover vote | seed only the v2-rows side (no shadow_log row) with matching `idempotency_key` to the live row | re-run `diff_report` | `unmatched_live = 0` |
| Q5 | `unmatched_live` still alerts on truly missing pair | seed legacy row only; no shadow_log; no v2_rows row | re-run `diff_report` | `unmatched_live ≥ 1` |
| Q6 | Snapshot mirror | re-run scenarios Q2 + Q4 through `wallet_ledger_v2_diff_snapshot('5 minutes')` | persisted `report` JSON in `wallet_ledger_v2_diff_log` shows the same counters; `safe_for_shadow_wiring = true` for healthy case |
| Q7 | C.fix-2 regression | repeat C.fix-2 probes P1–P5 unchanged | all results identical to C.fix-2 baseline (`balance_after_mismatch = 0`, gate intact) |
| Q8 | Caller compatibility | smoke-call each of the 5 edge functions in current `p_dry_run` mode in staging | identical return JSON shape vs pre-Δ; no new error codes |

**Q1–Q8 all GREEN ⇒ Δ apply prerequisites met.**

---

## 8. ROLLBACK STRATEGY

Single migration containing: Δ1 `CREATE FUNCTION` + Δ2 `CREATE OR REPLACE FUNCTION` + Δ3 `CREATE OR REPLACE FUNCTION`.

Rollback = inverse migration:
- `CREATE OR REPLACE FUNCTION` `wallet_ledger_v2_diff_report` restoring verbatim C.fix-3 body.
- `CREATE OR REPLACE FUNCTION` `wallet_ledger_v2_diff_snapshot` restoring verbatim C.fix-3 body.
- `DROP FUNCTION public.wallet_op_to_legacy_type(text)` last (no dependents remain after the two reverts).

Properties:
- No DDL on tables → pure function-body revert.
- No data migration → no data rollback.
- Idempotent — re-running rollback is a no-op.
- Target time-to-rollback: < 60 s.
- Pre-Δ function bodies will be captured verbatim into the C.fix-2b-execution migration commit message at apply time.

---

## 9. RISK ASSESSMENT

### 9.1 What could be HIDDEN by Δ (and our mitigations)

| Risk | Mitigation |
|---|---|
| Wrong map entry silently normalises a real drift (e.g. `vote_reward_voter` accidentally mapped to `unvote_penalty`) | Probe Q1 enumerates the full map; Probe Q3 verifies unknown ops still trip. Map lives in one helper with no extra branches. |
| Future new op added to `wallet_ledger_apply_v2` without map update | **Pass-through default → trips `type_mismatch`** → drift is visible (fail-loud). Documented as intentional. |
| `idempotency_key` join cross-pairs unrelated rows | `wallet_ledger_idempotency` enforces uniqueness; primary key is 1:1 by construction. Fallback `(user_id, amount, time-window)` only activates if NULL keys detected by pre-check (not expected). |
| Snapshot starts logging GREEN while real money math is wrong | C.fix-2 `balance_after_mismatch` gate remains AND-ed into the verdict; any value drift still flips `safe_for_shadow_wiring` to false. |

### 9.2 What MUST remain alerting after Δ

- Unknown ops (pass-through → `type_mismatch`).
- Missing v2 or legacy counterpart (still counted via the dual-path matcher; absence in BOTH paths → `unmatched_live`).
- `amount` divergence.
- `user_id` divergence (matched-pair predicate unchanged).
- `balance_after` divergence (C.fix-2 gate, unchanged).
- `error_count > 0` (unchanged).
- `unmatched_shadow > 0` (unchanged — dry-run path still expected to log into shadow when used).

### 9.3 What is intentionally NOT alerted on after Δ

- Healthy live-cutover vote rows (the entire reason for Δ).
- Healthy live-cutover penalty rows.
- Op name *form* differences between v2 and legacy when the canonical map says they refer to the same legacy class.

---

## 10. EXECUTION PREREQUISITES (for the eventual C.fix-2b-execution step, NOT this step)

1. ✅ This delta plan approved by user.
2. ✅ C.fix-2 / C.fix-3 already applied (Option A live; `balance_after_mismatch` gate live).
3. ✅ Pre-apply read-only re-check that `wallet_ledger_v2_rows.idempotency_key` and `wallet_ledger_shadow_log.idempotency_key` are NOT NULL across the audit window (no fallback needed).
4. ✅ Migration drafted; inverse rollback drafted side-by-side.
5. ✅ Probes Q1–Q8 staged.
6. ✅ User explicit `GO PHASE-1A STEP C.fix-2b-EXECUTION — APPLY OP TAXONOMY + LIVE-CUTOVER MATCHER MIGRATION (SINGLE MIGRATION, ROLLBACK INCLUDED, PROBES FIRST)` command issued.
7. ✅ Post-apply `wallet_ledger_v2_diff_snapshot('5 minutes')` returns `safe_for_shadow_wiring = true` against the 4 live Mutation #11a rows already in the log window (or the next scheduled snapshot, whichever is sooner).

No live mutation, no cron change, no dry-run flip in this step.

---

## 11. DELIVERABLES OF THIS STEP

| Path | Type | Status |
|---|---|---|
| `docs/fix-sprints/phase-1a-step-c-fix-2b-op-taxonomy-and-live-cutover-awareness.md` | plan | NEW (this file) |

Zero SQL drafted. Zero migration file. Zero edge-fn edits. Zero deploy. Zero code change.

---

## 12. FINAL VERDICT

# 🟢 PATCH_PLAN_READY_FOR_REVIEW

Delta is scope-bound (3 surfaces, additive only), reversible (function-body revert + helper drop), and closes the two structural defects (N1 + N2) that prevented Mutation #11a from reconciling GREEN while preserving all existing alerting on genuine drift.

**Next authorised command (do NOT execute without explicit user `GO`):**

> `GO PHASE-1A STEP C.fix-2b-EXECUTION — APPLY OP TAXONOMY + LIVE-CUTOVER MATCHER MIGRATION (SINGLE MIGRATION, ROLLBACK INCLUDED, PROBES FIRST)`
