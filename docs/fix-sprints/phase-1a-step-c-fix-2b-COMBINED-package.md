# Phase-1A · Step C.fix-2b · COMBINED Execution Package (BASE + ADDENDUM)

**Status:** DRAFT ONLY — NO APPLY, NO DEPLOY, NO PROBES YET.
**Authored:** 2026-05-21 (post state reconciliation).
**Supersedes:** the standalone "addendum execution package" doc, which assumed a
base layer that does not exist in production.

## 0. Reconciled live state (evidence)

Verified via read-only `pg_proc` + `pg_get_functiondef` queries this turn:

| Live object | Status |
|---|---|
| `public.wallet_op_to_legacy_type(text)` | **ABSENT** (count=0) |
| `public.wallet_live_canonical_ops()` | **ABSENT** (count=0) |
| `public.wallet_ledger_v2_diff_report` body md5 | `3c444786d17c71de31d37cbd6e175ac2` (C.fix-3 / R2 / C.fix-5d lineage) |
| `public.wallet_ledger_v2_diff_snapshot` body md5 | `e4b072b873421e2883eb2f675841df38` (C.fix-3 / R2 lineage) |
| Either body references `wallet_op_to_legacy_type` | **NO** |
| Either body references `wallet_live_canonical_ops` | **NO** |

Conclusion: this package must ship base + addendum **together** in one atomic
migration. The rollback section reinstates the exact bodies above byte-for-byte.

---

## 1. Scope

### 1.1 In scope
- **Δ1 (BASE)** — create `public.wallet_op_to_legacy_type(text)` helper.
- **Δ2 (BASE)** — `CREATE OR REPLACE` of `wallet_ledger_v2_diff_report` with
  taxonomy-normalized `type_mismatch` predicate
  (`s_op IS DISTINCT FROM wallet_op_to_legacy_type(l_type)` replacing the raw
  `s_op IS DISTINCT FROM l_type`).
- **Δ3 (BASE)** — same taxonomy-normalized rewrite of
  `wallet_ledger_v2_diff_snapshot`.
- **Δ4 (ADDENDUM)** — create `public.wallet_live_canonical_ops()` whitelist
  helper. Single canonical entry today: `('vote_reward_voter',
  '2026-05-21 07:05:25.004937+00')`.
- **Δ5 (ADDENDUM)** — extend Δ2/Δ3 bodies with the routed matcher:
  - **Live-canonical branch:** for ops present in
    `wallet_live_canonical_ops()`, pair with `wallet_transactions` rows where
    `t.created_at >= cutover_at` via `t.reference_id::uuid = s.shadow_id`
    (strict 1:1, no time heuristic).
  - **Shadow-only branch:** all other ops retain the existing
    `(user_id, amount, ±5s)` heuristic.
  - **Pre-cutover exclusion:** whitelisted-op live rows with
    `t.created_at < cutover_at` are filtered out of unmatched_live counting.
  - **Unknown ops:** anything not in the whitelist and without a matching
    shadow row still alerts as `unmatched_live` (no silent suppression).

### 1.2 Out of scope (explicit)
- `deposit_credit` — already legacy-mapped; non-UUID `reference_id` excluded
  from the live-canonical UUID cast (audit confirmed 0 bad rows).
- All other wallet ops not in `wallet_live_canonical_ops()` — shadow-only
  matcher unchanged.
- No edge function changes. No client changes. No `wallet_transactions` /
  `wallet_ledger_shadow_log` / `wallet_ledger_v2_rows` schema changes.

### 1.3 Targeted objects (write set)
| Path / object | Operation | Read-only? |
|---|---|---|
| `public.wallet_op_to_legacy_type(text)` | `CREATE FUNCTION` | WRITE |
| `public.wallet_live_canonical_ops()` | `CREATE FUNCTION` | WRITE |
| `public.wallet_ledger_v2_diff_report(interval)` | `CREATE OR REPLACE` | WRITE |
| `public.wallet_ledger_v2_diff_snapshot(interval)` | `CREATE OR REPLACE` | WRITE |
| Any table | none | — |
| Any edge function | none | — |
| RLS / grants | none | — |

---

## 2. Forward migration (DRAFT — NOT EXECUTED)

> The full text of the rewritten `diff_report` / `diff_snapshot` bodies is
> reproduced in §2.3 / §2.4. They are syntactically derived from the live
> bodies (md5 above) with **two** localized changes per body:
> (a) replace `s_op IS DISTINCT FROM l_type` with
>     `s_op IS DISTINCT FROM public.wallet_op_to_legacy_type(l_type)`;
> (b) replace the single `LEFT JOIN LATERAL` heuristic-match block with a
>     `CASE`-routed `LEFT JOIN LATERAL` (whitelist branch + shadow-only
>     branch) and add the pre-cutover exclusion to the `unmatched_live`
>     subquery.
>
> The §2.3 / §2.4 text below is the **draft** body that will be authored at
> apply time. It is NOT yet shipped.

### 2.1 Δ1 — taxonomy helper
```sql
CREATE OR REPLACE FUNCTION public.wallet_op_to_legacy_type(p_op text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_op
    -- Voting
    WHEN 'vote_reward_voter'      THEN 'vote_reward'
    WHEN 'vote_reward'            THEN 'vote_reward'
    WHEN 'unvote_penalty_voter'   THEN 'unvote_penalty'
    WHEN 'unvote_penalty'         THEN 'unvote_penalty'
    -- Deposits / admin
    WHEN 'deposit_credit'         THEN 'deposit'
    -- Referral
    WHEN 'referral_reward'        THEN 'referral'
    -- Gifts
    WHEN 'gift_send'              THEN 'gift_out'
    WHEN 'gift_receive'           THEN 'gift_in'
    ELSE p_op
  END
$$;
```
> The mapping rows above must be cross-checked against the live
> `wallet_transactions.type` value distribution at apply time (gate G-4
> below). Any unmapped op falls through to identity (`ELSE p_op`) which
> preserves current behavior — no silent suppression.

### 2.2 Δ4 — live-canonical whitelist
```sql
CREATE OR REPLACE FUNCTION public.wallet_live_canonical_ops()
RETURNS TABLE(op text, cutover_at timestamptz)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  VALUES
    ('vote_reward_voter'::text,
     '2026-05-21 07:05:25.004937+00'::timestamptz)
$$;
```

### 2.3 Δ2 + Δ5 — rewritten `wallet_ledger_v2_diff_report`
The forward body is the live md5 `3c444786d17c71de31d37cbd6e175ac2` text with
these surgical edits, fully reproduced (DRAFT) in
`./phase-1a-step-c-fix-2b-COMBINED-diff-report.sql`:

1. New CTE near the top of the body:
   ```sql
   wl AS (SELECT op, cutover_at FROM public.wallet_live_canonical_ops())
   ```
2. `pairs` CTE — replace the existing `LEFT JOIN LATERAL ( … LIMIT 1 ) l`
   block with:
   ```sql
   LEFT JOIN LATERAL (
     SELECT *
       FROM l
      WHERE
        CASE
          WHEN EXISTS (SELECT 1 FROM wl WHERE wl.op = s.op) THEN
            -- live-canonical: strict UUID bridge, post-cutover only
            l.created_at >= (SELECT cutover_at FROM wl WHERE wl.op = s.op)
            AND l.reference_id IS NOT NULL
            AND l.reference_id ~ '^[0-9a-f-]{36}$'
            AND l.reference_id::uuid = s.shadow_id
          ELSE
            -- shadow-only heuristic (unchanged)
            l.user_id = s.user_id
            AND l.amount = s.amount
            AND abs(extract(epoch FROM (l.created_at - s.captured_at))) <= 5
        END
      ORDER BY abs(extract(epoch FROM (l.created_at - s.captured_at)))
      LIMIT 1
   ) l ON true
   ```
3. Aggregate filter for `type_mismatch` becomes:
   ```sql
   count(*) FILTER (
     WHERE live_id IS NOT NULL
       AND s_op IS DISTINCT FROM public.wallet_op_to_legacy_type(l_type)
   )
   ```
4. `unmatched_live` final subquery — exclude pre-cutover whitelisted rows:
   ```sql
   ... AND NOT EXISTS (
         SELECT 1 FROM public.wallet_live_canonical_ops() wl
          WHERE wl.op = public.wallet_op_to_legacy_type(t.type)
            AND t.created_at < wl.cutover_at
       )
   ```
   plus the existing shadow-pair NOT EXISTS clause.
5. All other lines, `RETURN jsonb_build_object(...)`, and the
   `safe_for_shadow_wiring` algebra remain bit-identical to the live body.

### 2.4 Δ3 + Δ5 — rewritten `wallet_ledger_v2_diff_snapshot`
Same five surgical edits as §2.3 applied to live md5
`e4b072b873421e2883eb2f675841df38`. Full DRAFT text in
`./phase-1a-step-c-fix-2b-COMBINED-diff-snapshot.sql`.
The `INSERT INTO wallet_ledger_v2_diff_log (...)` and
`admin_notifications` alert blocks remain bit-identical.

---

## 3. Rollback migration (DRAFT — for the same atomic file)

Atomic inverse — restores the exact live bodies captured this turn:

```sql
-- Restore live md5 3c444786d17c71de31d37cbd6e175ac2
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_report(...)
  -- ... verbatim text of lines 1..169 of the read-only dump above ...
$function$;

-- Restore live md5 e4b072b873421e2883eb2f675841df38
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_snapshot(...)
  -- ... verbatim text of lines 170..358 of the read-only dump above ...
$function$;

DROP FUNCTION IF EXISTS public.wallet_live_canonical_ops();
DROP FUNCTION IF EXISTS public.wallet_op_to_legacy_type(text);
```

At apply time the verbatim bodies will be emitted from `pg_get_functiondef`
again (immediately before the `CREATE OR REPLACE` writes) and embedded
inline into the migration file so the rollback is byte-identical to the
state currently in production. Md5 verification is gate G-1 below.

---

## 4. Apply-time gates (MUST be GREEN, in order, before `CREATE OR REPLACE` runs)

| ID | Gate | Pass condition |
|---|---|---|
| G-1 | Body md5 unchanged since this draft | `md5(pg_get_functiondef('public.wallet_ledger_v2_diff_report'::regproc::oid)) = '3c444786d17c71de31d37cbd6e175ac2'` AND same for `_diff_snapshot` = `e4b072b873421e2883eb2f675841df38` |
| G-2 | Helpers still absent | `wallet_op_to_legacy_type` count = 0 AND `wallet_live_canonical_ops` count = 0 |
| G-3 | Cutover invariant | Whitelist timestamp `'2026-05-21 07:05:25.004937+00'::timestamptz` must equal the earliest `wallet_ledger_audit_log.captured_at` where `op='vote_reward_voter' AND dry_run=false AND result='live_ok'`. (NOT the earliest `wallet_ledger_shadow_log` dry-run row — that semantic was wrong in the prior draft and caused the correct apply-time block.) |
| G-4 | Taxonomy coverage | every distinct `wallet_transactions.type` in the last 7 days maps to itself or to a known legacy bucket under `wallet_op_to_legacy_type` (no surprise fallthrough beyond identity) |
| G-5 | Whitelist UUID safety | 0 rows where op ∈ whitelist AND `created_at >= cutover_at` AND `reference_id !~ '^[0-9a-f-]{36}$'` |
| G-6 | Rollback text captured | `pg_get_functiondef` of both functions inlined verbatim into the migration file immediately before the forward `CREATE OR REPLACE` |
| G-7 | Backend health | `supabase--cloud_status` = `ACTIVE_HEALTHY` |

Any RED gate ⇒ **abort, do not run the migration**.

---

## 5. Probes Q1–Q11 (post-apply verification — read-only)

| # | Probe | Pass condition |
|---|---|---|
| Q1 | Helpers present | `wallet_op_to_legacy_type` count=1, `wallet_live_canonical_ops` count=1 |
| Q2 | New body md5 differs from G-1 hashes | yes (sanity: write happened) |
| Q3 | Whitelist returns expected row | `SELECT * FROM wallet_live_canonical_ops()` returns exactly `('vote_reward_voter', 2026-05-21 07:05:25.004937+00)` |
| Q4 | Live-canonical match | for a known `vote_reward_voter` shadow id with paired live row post-cutover, `diff_report('24h')` shows `matched++` and **no** entry in `amount_mismatch / type_mismatch / user_mismatch / reference_mismatch` |
| Q5 | Shadow-only parity | a non-whitelisted op (e.g. `gift_send`) still pairs via heuristic and produces same `matched` count as pre-migration |
| Q6 | Pre-cutover exclusion | live `vote_reward_voter` rows with `created_at < cutover_at` no longer count toward `unmatched_live` |
| Q7 | Unknown-op still alerts | injected synthetic `unmatched_live` op (read-only via diff_report on a contrived window where no pairing exists) still bumps `unmatched_live` |
| Q8 | Taxonomy mismatch zero for live-canonical | `type_mismatch` for vote_reward_voter shadow ↔ vote_reward live = 0 |
| Q9 | Mutation #11a rows reconcile | the 4 Mutation #11a rows shown in earlier audit produce `matched=4, reference_mismatch=0` |
| Q10 | `safe_for_shadow_wiring` re-evaluates | last `diff_log` row written by snapshot flips from `false` to `true` for the live-canonical scope while still alerting on any genuine drift |
| Q11 | No regression in non-vote ops | snapshot writes one `wallet_ledger_v2_diff_log` row; `wallets_checksum` stable across pre/post apply |

All probes are pure `SELECT` / function calls; no probe mutates state. Q10/Q11
read the auto-inserted snapshot row written by `_diff_snapshot` itself.

---

## 6. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Live body drifted between draft and apply | High | G-1 md5 gate aborts |
| Forward body references missing helper | High | Single atomic file; helper Δ1 + Δ4 run before `CREATE OR REPLACE` Δ2/Δ3 in the same transaction |
| Non-UUID `reference_id` in whitelisted live rows | Medium | G-5 + regex guard `~ '^[0-9a-f-]{36}$'` before `::uuid` cast |
| Taxonomy fallthrough hides a real type_mismatch | Medium | `ELSE p_op` preserves current strict equality; G-4 reviews the 7-day op set |
| Shadow-only ops silently re-routed to live-canonical | Medium | Whitelist is a hard-coded VALUES list — addition requires a future migration |
| Snapshot row schema changes | Low | None — same `INSERT INTO wallet_ledger_v2_diff_log(...)` column list preserved |
| Rollback bodies not byte-identical | High | G-6 requires verbatim inline capture at apply time |
| Backend mid-migration restart | Medium | G-7 health check; single transaction so a crash leaves no helper without function rewrite (or vice versa) |
| Hidden alerting suppression | High | `unmatched_live` only excludes **pre-cutover** whitelisted rows; post-cutover unmatched still alerts |

### 6.1 What remains intentionally alerting (must not be silenced)
- Any non-whitelisted op with no shadow pair.
- Any whitelisted op with `reference_id` mismatch or NULL post-cutover.
- Any `balance_after_mismatch` (R2 invariant, unchanged).
- Any `error_count > 0` from `wallet_ledger_audit_log`.

### 6.2 What can still drift (and is acceptable)
- Pre-cutover legacy `vote_reward` rows with no shadow pair — explicitly
  excluded by design; surfaced only via a separate historical reconcile
  report (out of scope here).

---

## 7. Execution plan (NOT executed)

1. Re-read live function bodies → confirm G-1.
2. Inline verbatim rollback text into the migration file → satisfy G-6.
3. Run G-2 / G-3 / G-4 / G-5 / G-7 as read-only `SELECT`s.
4. Only if all GREEN: open `supabase--migration` with the combined SQL
   (Δ1 → Δ4 → Δ2 → Δ3 in a single transaction; rollback statements
   embedded as commented-out `-- ROLLBACK:` block).
5. After approval and apply: run probes Q1–Q11 read-only.
6. If any probe RED: run the embedded rollback `CREATE OR REPLACE` + `DROP`
   statements via a second migration.

---

## 8. Final verdict

**COMBINED_PACKAGE_READY_FOR_REVIEW**

No SQL was executed. No migration tool was called. No edge function, no
client file, no schema, no data, no RLS, no grant was changed in this turn.
Only `SELECT` against `pg_proc` / `pg_get_functiondef` ran (read-only).

Awaiting explicit `GO PHASE-1A STEP C.fix-2b-COMBINED-APPLY` before any
write occurs.
