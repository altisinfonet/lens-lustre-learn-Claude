# Phase 1A — Step C.fix-2b ADDENDUM: Live-Canonical Whitelist + Per-Op Cutover Map + Dual-Path Matcher

> **Mode:** PLAN ONLY. No SQL drafted. No migration. No deploy. No code change. No probes executed.
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Extends:** `docs/fix-sprints/phase-1a-step-c-fix-2b-op-taxonomy-and-live-cutover-awareness.md` (the C.fix-2b base plan).
> **Trigger:** N3 audit (read-only, evidence captured in conversation memory) proved that the dual-path matcher proposed in C.fix-2b base §4.2 is structurally **incomplete**: only one op class (`vote_reward_voter`) is live-canonical today; all other vote/penalty ops still flow through `shadowApplyV2Vote(...)` with the default `dry_run=true`. Without scope expansion, the matcher will report false-positive `unmatched_live` for every shadow-only class indefinitely.

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
| Edge-fn changes this step | NONE |
| Cron changes this step | NONE |
| Rollback executed | N/A |

---

## 1. ROOT CAUSE N3 — Cutover Asymmetry Across Vote Ops

The C.fix-2b base plan implicitly assumed that **all four vote-path op classes** had been (or would shortly be) cut over to live Branch F. The N3 evidence audit refutes this:

### 1.1 Live-canonical surface today (post-Mutation #11a)

| # | Op class | Caller | `dry_run` | Branch taken | Writes |
|---|---|---|---|---|---|
| 1 | `vote_reward_voter` | `cast-photo-vote/index.ts` | `false` (explicit) | **F (LIVE)** | `wallet_ledger_v2_rows`, `wallet_ledger_idempotency`, `wallet_ledger_audit_log`; legacy writer ALSO writes `wallet_transactions` for parity |
| 2 | `vote_reward_owner` | `cast-photo-vote/index.ts` | default `true` | **E (DRY-RUN)** | `wallet_ledger_shadow_log`, `wallet_ledger_audit_log` only |
| 3 | `vote_unvote_penalty_voter` | `cast-photo-vote/index.ts` | default `true` | **E (DRY-RUN)** | `wallet_ledger_shadow_log` only |
| 4 | `vote_unvote_penalty_owner` | `cast-photo-vote/index.ts` | default `true` | **E (DRY-RUN)** | `wallet_ledger_shadow_log` only |

Additional live-canonical v2 ops observed in `wallet_ledger_v2_rows` over the 7-day window (out of scope for vote-matcher but recorded for accuracy): `deposit_credit`, `gift_refund`.

### 1.2 Consequence

- The C.fix-2b base §4.2 dual-path predicate ("matched if **either** shadow OR v2 has a counterpart") is correct in shape but **insufficiently scoped**: classes 2–4 will never produce a v2-rows counterpart, so the matcher must route them to the shadow side; class 1 will (for new traffic) never produce a shadow_log counterpart, so it must route to the v2 side.
- A single undifferentiated matcher would either (a) under-alert by accepting shadow OR v2 for any op (hiding a missing live write for class 1) or (b) over-alert by demanding both (paging on every healthy class-2/3/4 dry-run).
- Pre-cutover history for class 1 (legacy `wallet_transactions` rows written before the live cutover timestamp) has **no** corresponding v2 row and must be excluded from the v2-matching window or it will trip `unmatched_live` indefinitely.

---

## 2. SCOPE ADDED BY THIS ADDENDUM (purely additive to C.fix-2b base)

| # | Surface | Change class | Caller diff? |
|---|---|---|---|
| Δ2.a | `public.wallet_live_canonical_ops()` | NEW pure IMMUTABLE helper returning the whitelist of `(op, cutover_at)` pairs | ❌ none |
| Δ2.b | `wallet_ledger_v2_diff_report(interval)` body — matcher branch | replace single dual-path predicate with **op-class-routed** predicate (see §4) | ❌ none |
| Δ2.c | `wallet_ledger_v2_diff_snapshot(interval)` body | mirror Δ2.b; same JSON shape | ❌ none |

**Unchanged from base C.fix-2b:** Δ1 (`wallet_op_to_legacy_type`), the verdict gate algebra, the persisted JSON key set, R4 deferral, the function signatures, SECURITY DEFINER, search_path, and grants.

**Out of scope (still):** `wallet_ledger_apply_v2` body, all edge-fn callers, `wallets` / `wallet_transactions` / `wallet_ledger_v2_rows` / `wallet_ledger_shadow_log` / `wallet_ledger_idempotency` schemas, cron, RLS, GRANT, and any flip of `dry_run` for classes 2–4.

---

## 3. Δ2.a — `wallet_live_canonical_ops()` helper (contract only)

### 3.1 Proposed return contract (illustrative — not SQL draft)

Returns one row per live-canonical op, with `(op text, cutover_at timestamptz)`:

| `op` | `cutover_at` |
|---|---|
| `vote_reward_voter` | timestamp of the **first** `wallet_ledger_v2_rows` row authored by `cast-photo-vote` with `op='vote_reward_voter'` (i.e. Mutation #11a, to be captured verbatim at execution time by reading the existing row — no synthetic insert) |

All other vote/penalty op classes are **absent** from this table. Absence ≡ "not cut over" ≡ "matcher routes to shadow side".

### 3.2 Properties

- `LANGUAGE sql IMMUTABLE` (table is a hard-coded VALUES list at this stage; will become a real config table only if/when the next cutover is scheduled).
- `SECURITY INVOKER`, no `SET search_path` beyond schema-qualified inputs.
- Pure, zero side effects, zero writes.
- Single source of truth for both the matcher and any future audit query.
- Cheap to inline; no index needed (constant 1–N rows).

### 3.3 Why a helper (vs hard-coded CASE)

- Adding the next cutover (e.g. flipping `vote_reward_owner` to live) becomes a one-line edit + migration; no matcher rewrite.
- Independently inspectable by ops (`SELECT * FROM wallet_live_canonical_ops()`).
- Trivially reversible: drop the function ⇒ matcher reverts to shadow-only routing for **all** ops (fail-loud, conservative).

---

## 4. Δ2.b / Δ2.c — Revised matcher model

### 4.1 Per-op routing rule

For each candidate live row `L` in `wallet_transactions` within the window:

1. Resolve `op_candidates(L) := { v.op : v ∈ wallet_ledger_v2_rows ∪ wallet_ledger_shadow_log paired to L by user_id + amount + small time window }`. (Used only to classify; the actual pair predicate below is stricter.)
2. Let `legacy_class := L.type` (already a legacy class string, e.g. `vote_reward`).
3. **Whitelist check:** if any op in the whitelist (Δ2.a) maps via `wallet_op_to_legacy_type` to `legacy_class` AND `L.created_at >= cutover_at(op)`, route `L` to the **V2 side**; otherwise route to the **shadow side**.

### 4.2 V2-side pair predicate (for live-whitelisted ops)

A live row `L` is **matched on the v2 side** iff there exists a `wallet_ledger_v2_rows` row `V` such that:

- `V.reference_id::uuid = L.reference_id` (**primary key**; proven 1:1 strict in the N3 reference-id bridge probe for `vote_reward_voter`),
- `V.user_id = L.user_id`,
- `V.amount = L.amount`,
- `V.created_at` within ±5 s of `L.created_at` (defence in depth; not load-bearing because `reference_id` is already 1:1),
- `wallet_op_to_legacy_type(V.op) = L.type` (taxonomy parity, from base Δ1).

`reference_id` is `text` in `wallet_ledger_v2_rows` and `uuid` in `wallet_transactions`. The predicate uses `V.reference_id::uuid = L.reference_id`; pre-apply Q-probe MUST confirm all v2 reference_ids in window cast cleanly to uuid. If any do not, the row falls through to the `(user_id, amount, ±5s)` fallback **only after** an explicit ambiguity check (must return at most one v2 candidate); otherwise the row is flagged `unmatched_live` and the matcher fails loud.

### 4.3 Shadow-side pair predicate (for shadow-only ops)

A live row `L` is **matched on the shadow side** iff there exists a `wallet_ledger_shadow_log` row `S` such that:

- `S.intended_user_id = L.user_id`,
- `S.intended_amount = L.amount`,
- `S.captured_at` within ±5 s of `L.created_at`,
- `wallet_op_to_legacy_type(S.op) = L.type` (taxonomy parity).

This is the base C.fix-2b shadow predicate, unchanged. It already paged GREEN historically for classes 2–4 prior to the v2 dual-path expansion; the addendum simply ensures classes 2–4 stay on this branch and are NOT compared against v2.

### 4.4 Pre-cutover history exclusion

For every live-whitelisted op, **exclude** any live row `L` with `L.created_at < cutover_at(op)` from the v2-matching universe. Such rows are not faults — they are pre-cutover legacy traffic that v2 was never asked to mirror. They are also excluded from the shadow-side check for the same op (the shadow path was never the source of truth for live writes).

Effect: `unmatched_live` falls to 0 for healthy post-cutover traffic on whitelisted ops and stays at 0 for pre-cutover history on the same ops.

### 4.5 Unknown op (fail-loud, unchanged)

If an op appears in `wallet_ledger_v2_rows` OR `wallet_ledger_shadow_log` that maps (via base Δ1 `wallet_op_to_legacy_type`) to a legacy class **not** present in `L.type`, the existing `type_mismatch` counter trips. The whitelist does NOT silence this — pass-through preserves the base C.fix-2b §6 invariant.

### 4.6 Verdict gate — unchanged algebra, additive AND-terms only

```
v_safe_for_shadow_wiring := (v_mismatch_count = 0)
                       AND (v_error_count = 0)
                       AND (v_unmatched_live = 0)
                       AND (v_unmatched_shadow = 0)
                       AND (v_balance_after_mismatch = 0);  -- from C.fix-2
```

Δ2 changes **inputs** (counter values), not the gate. The persisted JSON shape in `wallet_ledger_v2_diff_log.report` retains all base C.fix-2b key names and types.

---

## 5. UPDATED SYNTHETIC PROBES (must pass before apply — PLAN ONLY)

All probes run inside `BEGIN; … ROLLBACK;` against a synthetic operator wallet in staging. No production state mutated.

| # | Probe | Setup | Action | Pass criteria |
|---|---|---|---|---|
| Q1 | Whitelist content | none | `SELECT op, cutover_at FROM wallet_live_canonical_ops()` | Exactly one row: `vote_reward_voter` + a non-null timestamp matching the Mutation #11a v2 row |
| Q2 | Live whitelisted op pairs on V2 side | seed paired `wallet_transactions` + `wallet_ledger_v2_rows` with `op='vote_reward_voter'`, equal `reference_id`, post-cutover `created_at` | `wallet_ledger_v2_diff_report('5 minutes')` | `unmatched_live = 0`; `mismatch_count = 0` |
| Q3 | Shadow-only op pairs on SHADOW side | seed paired `wallet_transactions` + `wallet_ledger_shadow_log` with `op='vote_reward_owner'` (no v2 row at all) | re-run report | `unmatched_live = 0`; `mismatch_count = 0` |
| Q4 | Shadow-only op WITHOUT shadow pair still alerts | seed only `wallet_transactions` with `type='unvote_penalty'`; no shadow_log, no v2_rows | re-run report | `unmatched_live ≥ 1` (proves base alerting intact) |
| Q5 | Live whitelisted op WITHOUT v2 pair still alerts | seed only `wallet_transactions` with `type='vote_reward'` post-cutover; no v2 row | re-run report | `unmatched_live ≥ 1` (proves cutover does not silently swallow missing live writes) |
| Q6 | Pre-cutover history does NOT alert | seed `wallet_transactions` with `type='vote_reward'` and `created_at < cutover_at('vote_reward_voter')`; no v2 row | re-run report | `unmatched_live = 0` (pre-cutover rows excluded) |
| Q7 | Unknown future op still alerts | seed v2 row with `op := 'vote_reward_future_class'`, paired legacy `type := 'vote_reward'`; not in whitelist | re-run report | `type_mismatch ≥ 1` OR `unmatched_live ≥ 1` (pass-through invariant preserved) |
| Q8 | reference_id ambiguity sentinel | seed two `wallet_ledger_v2_rows` sharing the same `reference_id` for a single `wallet_transactions` row | re-run report | Matcher refuses to silently match (either alerts `mismatch_count ≥ 1` via the ambiguity guard, or routes to fallback and produces unmatched_live ≥ 1 with a clear error_code) |
| Q9 | Snapshot mirror | re-run scenarios Q2 + Q3 + Q6 through `wallet_ledger_v2_diff_snapshot('5 minutes')` | persisted JSON shows the same counters; `safe_for_shadow_wiring = true` for healthy cases |
| Q10 | C.fix-2 + C.fix-2b base regression | re-run base C.fix-2b probes Q1–Q8 unchanged | all results identical to base baseline |
| Q11 | Caller compatibility | smoke-call each of the 5 edge functions in current `p_dry_run` mode in staging | identical return JSON shape vs pre-Δ; no new error codes |

**Q1–Q11 all GREEN ⇒ addendum apply prerequisites met.**

---

## 6. ROLLBACK STRATEGY

Single migration containing: Δ2.a `CREATE FUNCTION wallet_live_canonical_ops()` + Δ2.b `CREATE OR REPLACE FUNCTION wallet_ledger_v2_diff_report` + Δ2.c `CREATE OR REPLACE FUNCTION wallet_ledger_v2_diff_snapshot`.

Inverse rollback (drafted side-by-side at execution time):

- `CREATE OR REPLACE FUNCTION wallet_ledger_v2_diff_report` restoring **base C.fix-2b** body (NOT C.fix-3 body — base C.fix-2b is the new floor).
- `CREATE OR REPLACE FUNCTION wallet_ledger_v2_diff_snapshot` restoring **base C.fix-2b** body.
- `DROP FUNCTION public.wallet_live_canonical_ops()` last.

Properties:

- No DDL on tables → pure function-body revert.
- No data migration → no data rollback.
- Idempotent — re-running rollback is a no-op.
- Target time-to-rollback: < 60 s.
- Pre-Δ function bodies captured verbatim into the addendum-execution migration commit message at apply time.

Conservative-failure property: if the rollback is applied **without** also reverting base C.fix-2b, the matcher reverts to the base dual-path predicate; this is strictly more permissive (matches if EITHER side has a pair), so the only regression is increased false-negative risk on classes 1, not new alerting. Acceptable rollback posture.

---

## 7. RISK ASSESSMENT

### 7.1 What could be HIDDEN by this addendum (and mitigations)

| Risk | Mitigation |
|---|---|
| Whitelist entry added prematurely (op flagged live before its writer is actually cut over) | Q5 explicitly proves a missing v2 pair for a whitelisted op still alerts `unmatched_live`. Whitelist change requires its own migration, reviewed against `wallet_ledger_v2_rows` evidence. |
| `cutover_at` set too early → real missing-write events misclassified as pre-cutover history | `cutover_at` MUST be read from an actual `wallet_ledger_v2_rows` row, not chosen freehand. Execution checklist §10 below enforces this. |
| `reference_id::uuid` cast silently fails for non-uuid v2 reference_ids | Q-probe pre-apply enumerates `wallet_ledger_v2_rows.reference_id` in window and confirms all cast cleanly. If any do not, the addendum is HELD until upstream is fixed; matcher does not silently fall through. |
| Two v2 rows sharing one `reference_id` cause silent over-match | Q8 sentinel; ambiguity guard required in matcher body (count check before pairing). |
| Future new live cutover happens without updating the whitelist | Pre-cutover, op stays on shadow branch ⇒ at worst, post-cutover live rows trip `unmatched_live` on the shadow branch because shadow_log will be empty (writer changed). Fail-loud, drift visible within one snapshot interval. Documented as the intended signal that the whitelist needs updating. |
| `(user_id, amount, ±5s)` fallback re-introduces collision risk | Fallback is gated by `reference_id` cast failure AND an ambiguity check (exactly-one v2 candidate). Otherwise `unmatched_live` increments. |

### 7.2 What MUST remain alerting after the addendum

- Missing v2 counterpart for any live-whitelisted op (Q5).
- Missing shadow_log counterpart for any shadow-only op (Q4).
- Unknown op on either side (Q7, base Δ1 pass-through).
- `amount` divergence (predicate unchanged).
- `user_id` divergence (predicate unchanged).
- `balance_after` divergence (C.fix-2 gate, unchanged).
- `error_count > 0` (unchanged).
- `unmatched_shadow > 0` for shadow-only ops where the legacy writer fired without a paired shadow row (unchanged).
- Ambiguous `reference_id` pairing on v2 side (Q8).

### 7.3 What is intentionally NOT alerted on after the addendum

- Pre-cutover legacy history for whitelisted ops (Q6).
- Healthy post-cutover whitelisted-op rows that have a strict 1:1 v2 counterpart (Q2).
- Healthy shadow-only dry-run pairs (Q3).
- Op-name *form* differences between v2/shadow and legacy when base Δ1 says they refer to the same legacy class.

---

## 8. NEGATIVE-SPACE INVENTORY (what this addendum does NOT touch)

- `wallets`, `wallet_transactions`, `wallet_ledger_v2_rows`, `wallet_ledger_shadow_log`, `wallet_ledger_idempotency`, `wallet_ledger_audit_log`, `wallet_ledger_v2_diff_log`, `admin_notifications` — no writes, no schema changes.
- `wallet_ledger_apply_v2` — not touched.
- `cast-photo-vote` and all other edge functions — not touched. `dry_run` flags for classes 2/3/4 stay default (`true`).
- Cron schedules — not touched.
- RLS / GRANT — not touched.
- `wallet_ledger_v2_drift_report` — not touched.
- R4 alert paging — STILL DEFERRED.

---

## 9. DELIVERABLES OF THIS STEP

| Path | Type | Status |
|---|---|---|
| `docs/fix-sprints/phase-1a-step-c-fix-2b-addendum-live-canonical-whitelist.md` | plan addendum | NEW (this file) |

Zero SQL drafted. Zero migration file. Zero edge-fn edits. Zero deploy. Zero code change. Zero probes executed.

---

## 10. EXECUTION PREREQUISITES (for the eventual addendum-execution step, NOT this step)

1. ✅ This addendum approved by user.
2. ✅ Base C.fix-2b plan approved (already done).
3. ✅ C.fix-2 / C.fix-3 already applied.
4. ✅ Read-only re-check: enumerate `wallet_ledger_v2_rows.reference_id` over the audit window; confirm every value casts cleanly to `uuid`. If any do not, HOLD.
5. ✅ Read-only re-check: confirm `vote_reward_voter` is still the **only** op class in `wallet_ledger_v2_rows` that originates from `cast-photo-vote` with `dry_run=false`. If any new class appears, the whitelist must be updated **in the same migration** with its own probed `cutover_at`.
6. ✅ Capture `cutover_at(vote_reward_voter)` verbatim from the earliest matching `wallet_ledger_v2_rows.created_at`.
7. ✅ Migration drafted (Δ2.a + Δ2.b + Δ2.c in a single file); inverse rollback drafted side-by-side.
8. ✅ Probes Q1–Q11 staged.
9. ✅ User explicit `GO PHASE-1A STEP C.fix-2b-ADDENDUM-EXECUTION — APPLY LIVE-CANONICAL WHITELIST + DUAL-PATH MATCHER (SINGLE MIGRATION, ROLLBACK INCLUDED, PROBES FIRST)` command issued.
10. ✅ Post-apply `wallet_ledger_v2_diff_snapshot('5 minutes')` returns `safe_for_shadow_wiring = true` against the Mutation #11a `vote_reward_voter` row already in the v2-rows window AND against any concurrent class-2/3/4 dry-run traffic.

No live mutation, no cron change, no `dry_run` flip in this step or the next.

---

## 11. FINAL VERDICT

# 🟢 ADDENDUM_READY_FOR_REVIEW

The addendum closes N3 by:

1. introducing a single-source-of-truth whitelist of live-canonical ops (currently `{vote_reward_voter}`),
2. routing the matcher per-op to the correct evidence table (`wallet_ledger_v2_rows` for whitelisted ops, `wallet_ledger_shadow_log` for the rest),
3. excluding pre-cutover history from v2 matching,
4. preserving every base C.fix-2b alerting invariant (Q4, Q5, Q7, Q8), and
5. remaining strictly reversible with no schema or data changes.

**Next authorised command (do NOT execute without explicit user `GO`):**

> `GO PHASE-1A STEP C.fix-2b-ADDENDUM-EXECUTION — APPLY LIVE-CANONICAL WHITELIST + DUAL-PATH MATCHER (SINGLE MIGRATION, ROLLBACK INCLUDED, PROBES FIRST)`
