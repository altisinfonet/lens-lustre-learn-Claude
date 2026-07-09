# Phase 1A — Step C.fix-2b ADDENDUM-EXECUTION — PRE-APPLY PACKAGE (REVIEW ONLY)

> **Mode:** PRE-APPLY REVIEW PACKAGE. No migration applied. No deploy. No production probes executed. No function definition replaced. Read-only DB inspection only (whitelist size + reference_id cast-safety pre-check + verbatim capture of current function body for rollback).
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Source plans:**
> - `docs/fix-sprints/phase-1a-step-c-fix-2b-op-taxonomy-and-live-cutover-awareness.md` (base C.fix-2b)
> - `docs/fix-sprints/phase-1a-step-c-fix-2b-addendum-live-canonical-whitelist.md` (N3 addendum)

---

## 0. SAFETY ATTESTATION (this step)

| Gate | Status |
|---|---|
| 100% SAFE | ✅ (review only) |
| ZERO DAMAGE | ✅ |
| ZERO SIDE EFFECT | ✅ |
| ZERO FAN-OUT | ✅ |
| SQL drafted this step | YES (review only, not applied) |
| SQL executed this step | NONE (only 3 read-only SELECTs to populate the cutover map + reference_id cast pre-check + verbatim body capture) |
| DDL this step | NONE |
| Code changes this step | NONE |
| Edge-fn changes this step | NONE |
| Cron changes this step | NONE |
| Rollback executed | N/A |

---

## 1. READ-ONLY PRE-APPLY EVIDENCE CAPTURE

The three queries below are the ONLY DB interactions of this step. All `SELECT`. No mutation.

### 1.1 Cutover timestamp for `vote_reward_voter`

```sql
SELECT min(created_at) AS cutover_at, count(*) AS n
  FROM public.wallet_ledger_v2_rows
 WHERE op = 'vote_reward_voter';
```

**Result:** `cutover_at = 2026-05-21 07:05:25.004937+00`, `n = 4`.

This is the timestamp authored by Mutation #11a — the first and currently only live-canonical `vote_reward_voter` traffic.

### 1.2 reference_id cast pre-check — full table

```sql
SELECT count(*) AS bad_uuid
  FROM public.wallet_ledger_v2_rows
 WHERE reference_id IS NOT NULL
   AND reference_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

**Result:** `bad_uuid = 1`.

### 1.3 reference_id cast pre-check — **whitelisted ops only** (the only scope the matcher actually casts)

```sql
SELECT count(*) AS bad_uuid_whitelisted
  FROM public.wallet_ledger_v2_rows
 WHERE op = 'vote_reward_voter'
   AND (reference_id IS NULL
        OR reference_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
```

**Result:** `bad_uuid_whitelisted = 0`.

### 1.4 The single non-uuid row

| field | value |
|---|---|
| id | `f893cb1b-2fc3-439b-9ec5-cfec00c88eed` |
| op | `deposit_credit` |
| reference_id | `pay_SrZsWWt7wXQgFq` (Razorpay payment id) |
| source_path | `supabase/functions/razorpay-verify-payment` |
| created_at | `2026-05-20 10:00:24.709636+00` |

**Interpretation:** `deposit_credit` is **NOT** in the live-canonical whitelist proposed by this addendum (whitelist = `{vote_reward_voter}` only). The matcher will route `deposit_credit` to the shadow-side branch, which does **not** perform any `::uuid` cast on `wallet_ledger_v2_rows.reference_id`. Therefore this row does **not** block the addendum.

> **Tightening:** Addendum §10 Execution Prerequisite #4 originally required "every value casts cleanly to uuid" universally. The accurate scope is **"every value for any op in the live-canonical whitelist casts cleanly to uuid"**. With the whitelist limited to `vote_reward_voter`, prereq #4 is **MET** (§1.3 = 0). Documented and applied below.

---

## 2. EXPLICIT LIVE-CANONICAL WHITELIST

| op | cutover_at | source of truth |
|---|---|---|
| `vote_reward_voter` | `2026-05-21 07:05:25.004937+00` | `min(wallet_ledger_v2_rows.created_at) WHERE op='vote_reward_voter'` (§1.1) |

All other vote/penalty op classes (`vote_reward_owner`, `vote_unvote_penalty_voter`, `vote_unvote_penalty_owner`) are **NOT** in the whitelist and remain shadow-only by design. Other live-canonical ops observed in v2_rows (`deposit_credit`, `gift_refund`) are **out of scope** for the vote/penalty matcher and are intentionally NOT whitelisted in this migration; they continue to route through the shadow-side branch, matching their existing `wallet_ledger_shadow_log` rows where present.

---

## 3. FINAL FORWARD MIGRATION (DRAFT — REVIEW ONLY, NOT APPLIED)

> Single migration file. Three objects: helper `wallet_live_canonical_ops()`, replaced `wallet_ledger_v2_diff_report`, replaced `wallet_ledger_v2_diff_snapshot`. The bodies of the two replaced functions extend the verbatim base C.fix-2b bodies with the per-op routing block in §3.2/§3.3; the legacy / shadow / balance_after CTEs are preserved.
> The draft below is illustrative SQL for review. It is **not** yet applied to any environment. Final apply waits for explicit `GO ... APPLY` from user.

### 3.1 Δ2.a — `wallet_live_canonical_ops()` helper

```sql
CREATE OR REPLACE FUNCTION public.wallet_live_canonical_ops()
RETURNS TABLE (op text, cutover_at timestamptz)
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM (VALUES
    ('vote_reward_voter'::text,
     '2026-05-21 07:05:25.004937+00'::timestamptz)
  ) AS t(op, cutover_at);
$$;

REVOKE ALL ON FUNCTION public.wallet_live_canonical_ops() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_live_canonical_ops() TO authenticated, service_role;
```

### 3.2 Δ2.b — `wallet_ledger_v2_diff_report(interval)` — additive routing block

The new function body wraps the existing C.fix-3 / base-C.fix-2b body. Above the existing `pairs` CTE the following two CTEs are introduced and the existing match counters are computed from `routed_pairs` instead of `pairs`:

```sql
-- NEW (addendum): live-whitelisted V2-side pairing using reference_id::uuid bridge.
v2_pairs AS (
  SELECT l.live_id,
         l.user_id   AS l_user,
         l.amount    AS l_amount,
         l.type      AS l_type,
         l.reference_id AS l_ref,
         l.balance_after AS l_balance_after,
         l.created_at  AS l_ts,
         v.op        AS v_op,
         v.user_id   AS v_user,
         v.amount    AS v_amount,
         v.balance_after AS v_balance_after,
         v.created_at  AS v_ts,
         w.op        AS whitelisted_op,
         w.cutover_at AS w_cutover
    FROM l
    JOIN public.wallet_live_canonical_ops() w
      ON public.wallet_op_to_legacy_type(w.op) = l.type
   LEFT JOIN LATERAL (
     SELECT v.*
       FROM public.wallet_ledger_v2_rows v
      WHERE v.op = w.op
        AND v.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND v.reference_id::uuid = l.reference_id
        AND v.user_id = l.user_id
        AND v.amount  = l.amount
        AND v.created_at BETWEEN l.created_at - interval '5 seconds'
                             AND l.created_at + interval '5 seconds'
      ORDER BY abs(extract(epoch FROM (v.created_at - l.created_at)))
      LIMIT 2  -- two for ambiguity detection
   ) v ON true
   WHERE l.created_at >= w.cutover_at  -- pre-cutover exclusion
),
v2_pairs_unique AS (
  SELECT live_id,
         count(*) AS v2_candidates,
         (array_agg(v_op))[1]            AS v_op,
         (array_agg(v_user))[1]          AS v_user,
         (array_agg(v_amount))[1]        AS v_amount,
         (array_agg(v_balance_after))[1] AS v_balance_after,
         (array_agg(v_ts))[1]            AS v_ts,
         (array_agg(l_user))[1]          AS l_user,
         (array_agg(l_amount))[1]        AS l_amount,
         (array_agg(l_type))[1]          AS l_type,
         (array_agg(l_ref))[1]           AS l_ref,
         (array_agg(l_balance_after))[1] AS l_balance_after,
         (array_agg(l_ts))[1]            AS l_ts
    FROM v2_pairs
   GROUP BY live_id
),
-- Pre-cutover whitelisted-op rows that we intentionally exclude from BOTH branches.
pre_cutover_excluded AS (
  SELECT l.live_id
    FROM l
    JOIN public.wallet_live_canonical_ops() w
      ON public.wallet_op_to_legacy_type(w.op) = l.type
   WHERE l.created_at < w.cutover_at
)
```

The downstream aggregation then computes:

```sql
-- v_unmatched_live: a live row is unmatched iff
--   (a) it is NOT excluded as pre-cutover history, AND
--   (b) it has neither a v2-side match (with v2_candidates = 1) nor a shadow-side match.
v_unmatched_live := (
  SELECT count(*)
    FROM l
   WHERE l.live_id NOT IN (SELECT live_id FROM pre_cutover_excluded)
     AND l.live_id NOT IN (
       SELECT live_id FROM v2_pairs_unique
        WHERE v2_candidates = 1 AND v_user IS NOT NULL
     )
     AND l.live_id NOT IN (
       SELECT live_id FROM pairs WHERE shadow_id IS NOT NULL
     )
);

-- v_mismatch_count: existing C.fix-3 mismatch terms PLUS
--   - v2-side amount/type/user mismatch on whitelisted ops, AND
--   - reference_id ambiguity (v2_candidates > 1).
v_mismatch_count := v_amount_mismatch
                  + v_type_mismatch
                  + v_user_mismatch
                  + v_balance_after_mismatch
                  + (SELECT count(*) FROM v2_pairs_unique WHERE v2_candidates > 1)
                  + (SELECT count(*) FROM v2_pairs_unique
                      WHERE v2_candidates = 1
                        AND (v_amount IS DISTINCT FROM l_amount
                          OR v_user   IS DISTINCT FROM l_user
                          OR public.wallet_op_to_legacy_type(v_op) IS DISTINCT FROM l_type));
```

Verdict gate algebra **unchanged** from base C.fix-2b §4.6.

### 3.3 Δ2.c — `wallet_ledger_v2_diff_snapshot(interval)` — mirror

Same routing block as §3.2 inlined inside the snapshot function. Persisted JSON shape in `wallet_ledger_v2_diff_log.report` retains base C.fix-2b keys; values reflect the routed matcher. No new top-level keys.

---

## 4. FINAL ROLLBACK MIGRATION (DRAFT — REVIEW ONLY, NOT APPLIED)

Inverse of §3. Strict ordering: replace the two functions back to their base C.fix-2b bodies FIRST, then drop the helper LAST.

```sql
-- 1. Restore base C.fix-2b body for wallet_ledger_v2_diff_report
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_report(p_window interval DEFAULT '24:00:00'::interval)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  -- VERBATIM base C.fix-2b body captured at apply time
  -- (the current production body, dumped via pg_get_functiondef and pasted here
  --  as the rollback's literal payload). See §6 below for capture procedure.
$function$;

-- 2. Restore base C.fix-2b body for wallet_ledger_v2_diff_snapshot
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_snapshot(p_window interval DEFAULT '00:05:00'::interval)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $function$
  -- VERBATIM base C.fix-2b body captured at apply time
$function$;

-- 3. Drop helper LAST (no remaining dependents).
DROP FUNCTION IF EXISTS public.wallet_live_canonical_ops();
```

**Rollback guarantees:**

- No DDL on tables. No data migration. No data rollback.
- Idempotent: re-running the rollback is a no-op.
- Target time-to-rollback: < 60 s.
- Conservative-failure: if the rollback runs but the helper drop fails for any reason, the two function bodies are already reverted; the helper is harmless dead code.
- The verbatim base bodies will be captured by running `SELECT pg_get_functiondef(...)` against production immediately before apply, and pasted into the migration commit message AND the rollback migration body. The capture procedure is fixed in §6.

---

## 5. FINAL MATCHER ALGEBRA (post-addendum)

Let `L` be a live `wallet_transactions` row in window. Then:

| Predicate | Definition |
|---|---|
| **whitelisted_class(L)** | `∃ op ∈ wallet_live_canonical_ops() : wallet_op_to_legacy_type(op) = L.type` |
| **pre_cutover(L)** | `whitelisted_class(L) AND L.created_at < cutover_at(op)` |
| **v2_match(L)** | `whitelisted_class(L) AND L.created_at ≥ cutover_at(op) AND ∃! V ∈ wallet_ledger_v2_rows : V.op=op AND V.reference_id::uuid = L.reference_id AND V.user_id=L.user_id AND V.amount=L.amount AND \|V.created_at − L.created_at\| < 5s` |
| **shadow_match(L)** | `∃ S ∈ wallet_ledger_shadow_log : S.intended_user_id=L.user_id AND S.intended_amount=L.amount AND \|S.captured_at − L.created_at\| < 5s AND wallet_op_to_legacy_type(S.op)=L.type` |
| **unmatched_live(L)** | `¬pre_cutover(L) AND ¬v2_match(L) AND ¬shadow_match(L)` |
| **mismatch(L)** | Existing C.fix-3 amount/type/user/balance_after divergences (on shadow pairs) ∪ v2-side amount/type/user divergence on `v2_match=true` rows ∪ reference_id ambiguity (`> 1` v2 candidate within the strict join) |
| **unknown_op** | A v2 or shadow row whose `wallet_op_to_legacy_type(op)` returns a string not present as any legacy `L.type` → existing `type_mismatch` predicate (base Δ1) fires |

Verdict gate (unchanged shape):

```
v_safe_for_shadow_wiring := (v_mismatch_count = 0)
                       AND (v_error_count = 0)
                       AND (v_unmatched_live = 0)
                       AND (v_unmatched_shadow = 0)
                       AND (v_balance_after_mismatch = 0);
```

---

## 6. APPLY-TIME PRE-APPLY CHECKLIST (the exact ordered steps for the eventual APPLY phase — not executed here)

1. **READ-ONLY** — re-run §1.1, §1.2, §1.3 against production. Confirm §1.3 = 0 and §1.1 matches the whitelist value in §3.1. If §1.3 > 0, **HOLD** and re-scope whitelist.
2. **READ-ONLY** — `SELECT pg_get_functiondef('public.wallet_ledger_v2_diff_report(interval)'::regprocedure)` and the snapshot equivalent. Paste verbatim into the rollback migration body §4 step 1 and step 2 and into the commit message.
3. **READ-ONLY** — confirm no concurrent migration in flight (check Cloud project status).
4. Stage probes Q1–Q11 from §7 in staging session inside `BEGIN; … ROLLBACK;`. Confirm all GREEN against staging.
5. Issue `GO PHASE-1A STEP C.fix-2b-ADDENDUM-EXECUTION — APPLY` only after user explicit confirmation.
6. Apply forward migration §3 as a single atomic migration.
7. **READ-ONLY** — call `wallet_ledger_v2_diff_snapshot('5 minutes')` once against production. Confirm `safe_for_shadow_wiring = true` for the Mutation #11a window AND for any concurrent class-2/3/4 dry-run traffic. If `false`, immediately apply rollback §4.

No cron change. No `dry_run` flip. No edge-fn deploy.

---

## 7. FINAL PROBES MATRIX (staged, not executed here)

All probes run inside `BEGIN; … ROLLBACK;` in staging against a synthetic operator wallet.

| # | Probe | Setup | Action | Pass criteria |
|---|---|---|---|---|
| Q1 | Whitelist content | none | `SELECT * FROM wallet_live_canonical_ops()` | exactly one row `(vote_reward_voter, 2026-05-21 07:05:25.004937+00)` |
| Q2 | Live whitelist proof | seed paired `wallet_transactions`+`wallet_ledger_v2_rows` with `op='vote_reward_voter'`, equal `reference_id` (uuid), `created_at = now()` | `wallet_ledger_v2_diff_report('5 minutes')` | `unmatched_live = 0`, `mismatch_count = 0` |
| Q3 | Shadow-only parity proof | seed paired `wallet_transactions`+`wallet_ledger_shadow_log` with `op='vote_reward_owner'`, no v2 row | re-run | `unmatched_live = 0`, `mismatch_count = 0` |
| Q4 | Missing shadow pair still alerts | seed `wallet_transactions` only with `type='unvote_penalty'` | re-run | `unmatched_live ≥ 1` |
| Q5 | Missing v2 pair on whitelisted op still alerts | seed `wallet_transactions` only with `type='vote_reward'`, `created_at > cutover_at` | re-run | `unmatched_live ≥ 1` |
| Q6 | Pre-cutover exclusion proof | seed `wallet_transactions` with `type='vote_reward'`, `created_at < cutover_at`, no v2, no shadow | re-run | `unmatched_live = 0` |
| Q7 | Unknown future op alert proof | seed v2 row with `op='vote_reward_future_class'` paired to legacy `type='vote_reward'`; not in whitelist | re-run | `type_mismatch ≥ 1` OR `unmatched_live ≥ 1` |
| Q8 | reference_id ambiguity sentinel | seed two v2 rows with the same `reference_id` for one live row, op `vote_reward_voter` | re-run | `mismatch_count ≥ 1` (ambiguity flag) |
| Q9 | Snapshot mirror | re-run Q2 + Q3 + Q6 via `wallet_ledger_v2_diff_snapshot('5 minutes')` | persisted JSON shows same counters; `safe_for_shadow_wiring = true` for healthy cases |
| Q10 | C.fix-2 + base C.fix-2b regression | re-run base probes P1–P5 + base Q1–Q8 unchanged | all results identical to base baseline (`balance_after_mismatch = 0`, gate intact) |
| Q11 | Caller compatibility | smoke-call each of the 5 edge functions in current `p_dry_run` mode in staging | identical return JSON shape vs pre-Δ; no new error codes |

**Q1–Q11 all GREEN ⇒ §6 step 5 may proceed.**

---

## 8. RISK SECTION

### 8.1 What can STILL drift after apply

| Drift | Detection signal |
|---|---|
| A new live cutover happens (e.g. `vote_reward_owner` flipped to live) WITHOUT updating the whitelist | New live `wallet_transactions` row of that class has no shadow_log counterpart (writer stopped writing shadow) and no whitelist match ⇒ trips `unmatched_live`. Visible within one snapshot interval. Intended fail-loud. |
| A future v2 row uses a non-uuid `reference_id` for a whitelisted op | `v2.reference_id ~* '^…uuid…$'` filter excludes it ⇒ matcher cannot pair ⇒ `unmatched_live ≥ 1`. Fail-loud. |
| `wallet_ledger_apply_v2` body changes such that Branch F stops writing `reference_id` | Same as above — exclusion ⇒ `unmatched_live ≥ 1`. Fail-loud. |
| `wallet_op_to_legacy_type` map omits a new op family | Pass-through default ⇒ trips `type_mismatch`. Fail-loud (base Δ1 invariant). |
| Snapshot starts logging GREEN while money math is wrong | `balance_after_mismatch` gate from C.fix-2 remains AND-ed into the verdict; any value drift flips `safe_for_shadow_wiring = false`. |
| Ambiguous `reference_id` (two v2 rows, one live row) | Q8-protected: `v2_candidates > 1` increments `mismatch_count`. Fail-loud. |

### 8.2 What remains intentionally ALERTING after apply

- Missing v2 counterpart for any live-whitelisted op (Q5).
- Missing shadow_log counterpart for any shadow-only op (Q4).
- Unknown op on either side (Q7; base Δ1 pass-through).
- `amount`, `user_id`, `balance_after`, `type` divergence (existing predicates unchanged).
- `error_count > 0` (unchanged).
- `unmatched_shadow > 0` (unchanged — dry-run path expected to log into shadow when used).
- `reference_id` ambiguity on whitelisted ops (Q8).

### 8.3 What is intentionally NOT alerted on after apply

- Pre-cutover legacy history for whitelisted ops (Q6).
- Healthy post-cutover whitelisted-op rows that have a strict 1:1 v2 counterpart (Q2).
- Healthy shadow-only dry-run pairs for classes 2/3/4 (Q3).
- Op-name *form* differences between v2/shadow and legacy when base Δ1 says they refer to the same legacy class.
- The single non-uuid `deposit_credit` row (§1.4) — out of matcher scope; not whitelisted.

---

## 9. NEGATIVE-SPACE INVENTORY (what this package does NOT touch — at apply time)

- `wallets`, `wallet_transactions`, `wallet_ledger_v2_rows`, `wallet_ledger_shadow_log`, `wallet_ledger_idempotency`, `wallet_ledger_audit_log`, `wallet_ledger_v2_diff_log`, `admin_notifications` — no writes, no schema changes.
- `wallet_ledger_apply_v2` — not touched.
- `cast-photo-vote` and all other edge functions — not touched. `dry_run` flags for classes 2/3/4 stay default (`true`).
- Cron schedules — not touched.
- RLS / GRANT — only the new helper gets the GRANT shown in §3.1; no other GRANT changes.
- `wallet_ledger_v2_drift_report` — not touched.
- R4 alert paging — STILL DEFERRED.

---

## 10. PRE-APPLY CHECKING REPORT

| Check | Status | Evidence |
|---|---|---|
| Environment validation (Cloud ACTIVE_HEALTHY) | DEFERRED to apply step 3 | not checked in review mode |
| Dependency impact check | ✅ | Only `wallet_op_to_legacy_type` (base Δ1) is a hard dep — applied prior to this addendum |
| File/path verification | ✅ | Targets are 3 SQL functions in `public` schema only |
| Permission scope verification | ✅ | `SECURITY DEFINER` preserved on report/snapshot; helper is `SECURITY INVOKER`; existing `has_role(..., 'admin')` gate in report/snapshot retained verbatim |
| Service/process impact validation | ✅ | No edge fn, no cron, no writer touched; only callers are the existing admin UI + scheduled snapshot job |
| Dry-run availability | ✅ | `BEGIN; … ROLLBACK;` staging session for Q1–Q11 |
| Risk classification | LOW | additive function bodies; full revert ≤ 60 s; conservative-failure properties documented §4, §8 |
| reference_id cast pre-check (full table) | ⚠️ 1 row | §1.2 — out of matcher scope (§1.4) |
| reference_id cast pre-check (whitelisted ops) | ✅ 0 rows | §1.3 |
| Verbatim rollback bodies captured | DEFERRED to apply step 2 | capture procedure fixed in §6 step 2 |

---

## 11. FINAL RECOMMENDATION

# 🟢 SAFE_TO_APPLY (after §6 steps 1–4 GREEN at apply time)

Justification:

- Whitelist scope is minimal (exactly one op) and verifiably correct (§1.1).
- The only `reference_id` cast risk in the database is OUT of matcher scope (§1.3, §1.4); whitelisted-op cast coverage is 100 % (§1.3 = 0).
- Forward migration is purely additive at the SQL surface; rollback is a verbatim function-body restore + helper drop, < 60 s, no data migration.
- Every base C.fix-2b alerting invariant is preserved (Q4, Q5, Q7, Q8).
- Verdict gate algebra is unchanged; only inputs (counter values) reflect the corrected matcher.
- `dry_run` flags, edge fns, cron, RLS, and all wallet tables remain untouched.

**Next authorised command (do NOT execute without explicit user `GO`):**

> `GO PHASE-1A STEP C.fix-2b-ADDENDUM-EXECUTION — APPLY (SINGLE MIGRATION, ROLLBACK BODIES CAPTURED VERBATIM AT APPLY TIME, PROBES Q1–Q11 GREEN FIRST)`
