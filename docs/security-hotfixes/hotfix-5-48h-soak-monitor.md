# HOTFIX-5 — 48h Soak Monitor (Pre-HOTFIX-6 Gate)

**Mode:** AUDIT-ONLY. No policy drop. No code refactor. No migration.
**Mandate:** `/docs/forensic-engineering-mandate.md` (Zero Assumption / Zero Guesswork).
**Purpose:** Continuously observe `submit-deposit` running on the new `create_pending_deposit` SECURITY DEFINER RPC for 48 production hours before authorising **HOTFIX-6** (`DROP POLICY "System can insert transactions" ON public.wallet_transactions;`).

---

## 0. Soak Window

| Marker | UTC Timestamp |
|---|---|
| **T+0 (window opens)** | 2026-05-13 04:45:00Z (immediately after STEP 3 smoke + cleanup) |
| **T+24h checkpoint** | 2026-05-14 04:45:00Z |
| **T+48h close (verdict due)** | 2026-05-15 04:45:00Z |

Cleanup of the two STEP 3 smoke rows confirmed at 2026-05-13 04:45:02Z (`354de8e9-…` UPI + `545d0eed-…` Bank Transfer; `admin_notifications` rows where `message LIKE '%HOTFIX5-SMOKE-%'` also removed).

---

## 1. Eight Monitored Signals — Exact Audit Queries

> All queries are **READ-ONLY**. None mutate state. All scoped to `created_at > now() - interval '48 hours'` so they self-rotate without manual reset.

### Signal 1 — `submit-deposit` edge-fn invocations
Tool: `supabase--edge_function_logs` with `function_name='submit-deposit'`.
Pass criterion: every recent invocation ends 200 (or 4xx for known validation rejects) — **no 5xx, no Deno boot loops**.

### Signal 2 — `create_pending_deposit` RPC calls
```sql
SELECT count(*) AS rpc_calls_48h
FROM public.wallet_transactions
WHERE type = 'deposit'
  AND created_at > now() - interval '48 hours'
  AND metadata ? 'idempotency_key';   -- only the new RPC writes this key
```
Pass criterion: `rpc_calls_48h ≥ 1` AND equal to total pending+approved+rejected deposits in the window (i.e. **100% of new deposits flow through the RPC**, no legacy path leaking).

### Signal 3 — Any `42501` (RLS denial) errors
Tool: `supabase--analytics_query` against `function_edge_logs` for `function_id` of `submit-deposit`, plus `postgres_logs` for `error_severity='ERROR'` containing `42501`.
```sql
-- postgres_logs scan
SELECT identifier, postgres_logs.timestamp, event_message
FROM postgres_logs
CROSS JOIN unnest(metadata) AS m
CROSS JOIN unnest(m.parsed) AS parsed
WHERE postgres_logs.timestamp > now() - interval '48 hours'
  AND parsed.error_severity = 'ERROR'
  AND event_message LIKE '%42501%'
ORDER BY postgres_logs.timestamp DESC
LIMIT 50;
```
Pass criterion: **zero hits** traced to `submit-deposit`, `create_pending_deposit`, or any path writing to `wallet_transactions`.

### Signal 4 — Duplicate pending-deposit rows
```sql
-- Same user + same idempotency_key with >1 row inside the 24h window
SELECT user_id, metadata->>'idempotency_key' AS idem, count(*) AS dup_rows
FROM public.wallet_transactions
WHERE type='deposit'
  AND status='pending'
  AND created_at > now() - interval '48 hours'
  AND metadata ? 'idempotency_key'
GROUP BY 1,2
HAVING count(*) > 1;
```
Pass criterion: **0 rows** returned. The SECURITY DEFINER RPC short-circuits on `(user_id, idempotency_key)` within 24h — any group >1 = idempotency regression.

### Signal 5 — Failed `admin_notifications` inserts
```sql
SELECT count(*) AS notif_rows_48h
FROM public.admin_notifications
WHERE type = 'deposit_request'
  AND created_at > now() - interval '48 hours';
```
Pair-check against Signal 2:
```sql
SELECT
  (SELECT count(*) FROM public.wallet_transactions
     WHERE type='deposit' AND created_at > now() - interval '48 hours'
       AND metadata ? 'idempotency_key') AS rpc_deposits,
  (SELECT count(*) FROM public.admin_notifications
     WHERE type='deposit_request' AND created_at > now() - interval '48 hours') AS notif_rows;
```
Pass criterion: `notif_rows ≥ rpc_deposits` (re-submissions short-circuit the RPC but still emit a fresh notification — that is acceptable; the **opposite** would be a bug).

### Signal 6 — UPI / Bank Transfer submission success
```sql
SELECT
  metadata->>'gateway' AS gateway,
  status,
  count(*) AS rows
FROM public.wallet_transactions
WHERE type='deposit'
  AND created_at > now() - interval '48 hours'
GROUP BY 1,2
ORDER BY 1,2;
```
Pass criterion: at least one row per `(gateway ∈ {upi, bank_transfer}, status='pending')` in production traffic. Zero rows where `gateway` is NULL or anything other than `upi` / `bank_transfer`.

### Signal 7 — Admin approval compatibility
```sql
-- Approved deposits that originated through the new RPC.
SELECT count(*) AS approved_via_rpc_48h,
       count(*) FILTER (WHERE balance_after > 0) AS credited_correctly
FROM public.wallet_transactions
WHERE type='deposit'
  AND status='approved'
  AND created_at > now() - interval '48 hours'
  AND metadata ? 'idempotency_key';
```
Pass criterion: `credited_correctly = approved_via_rpc_48h` AND every such row has a matching `wallet_transaction(_…, 'completed')` follow-up (verifiable by joining on `user_id` + `amount` + `created_at` window — `approve_deposit` invokes `wallet_transaction` synchronously).

### Signal 8 — Wallet balance after approval
```sql
WITH approved AS (
  SELECT user_id, amount, created_at
  FROM public.wallet_transactions
  WHERE type='deposit' AND status='approved'
    AND created_at > now() - interval '48 hours'
    AND metadata ? 'idempotency_key'
)
SELECT a.user_id,
       a.amount AS approved_amount,
       w.balance AS wallet_balance_now
FROM approved a
JOIN public.wallets w ON w.user_id = a.user_id
ORDER BY a.created_at DESC;
```
Pass criterion: every approved deposit row has a wallet whose `balance` is ≥ that amount (the participant may already have spent it; the floor is what matters).

---

## 2. T+0 Baseline (snapshot at window open)

Captured from live DB immediately after STEP 3 cleanup:

| Metric | Value |
|---|---|
| Deposits in window | 0 |
| Pending | 0 |
| Approved | 0 |
| Rejected | 0 |
| RPC-path rows (`metadata.idempotency_key` present) | 0 |
| Legacy-path pending rows | 0 |
| `balance_after ≠ 0` while `pending` (invariant breach) | 0 |
| `reference_id IS NOT NULL` while `pending` (invariant breach) | 0 |

Function inventory (live `pg_proc`):

| Function | Args | State |
|---|---|---|
| `create_pending_deposit` | 6 | **PRESENT** (HOTFIX-5 STEP 1) |
| `approve_deposit` | 2 | **PRESENT** (unchanged) |
| `wallet_transaction` | 7 | **PRESENT** (unchanged) |

Smoke evidence already recorded in `rls-hotfix-5-step-1-create-pending-deposit-rpc.md` and the STEP 3 chat log:
- UPI smoke → 200, `transaction_id=354de8e9-47a1-4918-b410-caf7f7d75006`
- Bank smoke → 200, `transaction_id=545d0eed-c9cb-4b8f-a425-9a52050643fa`
- Idempotency replay (same UPI ref) → returned **same** id (no duplicate row)
- DB row shape verified: `status=pending`, `balance_after=0`, `reference_id=NULL`, `metadata.gateway` + `metadata.idempotency_key` populated
- Both smoke rows + their `admin_notifications` rows hard-deleted at 2026-05-13 04:45:02Z

---

## 3. T+24h Checkpoint (to be filled at 2026-05-14 04:45Z)

Re-run all 8 queries above. Record:

| Signal | Pass / Fail | Notes |
|---|---|---|
| 1 — edge invocations | | |
| 2 — RPC calls | | |
| 3 — 42501 errors | | |
| 4 — duplicate pending | | |
| 5 — admin notifications | | |
| 6 — UPI/Bank success | | |
| 7 — approval compatibility | | |
| 8 — wallet balance after approval | | |

If **any** signal is FAIL → set status to **HOLD HOTFIX-6** and root-cause before continuing the soak.

---

## 4. T+48h Close (to be filled at 2026-05-15 04:45Z)

Re-run all 8 queries. Apply the same pass criteria. The 48h verdict is determined by the matrix below — **all eight rows must be PASS** for HOTFIX-6 authorisation.

| Signal | T+48h Result |
|---|---|
| 1 — edge invocations | |
| 2 — RPC calls | |
| 3 — 42501 errors | |
| 4 — duplicate pending | |
| 5 — admin notifications | |
| 6 — UPI/Bank success | |
| 7 — approval compatibility | |
| 8 — wallet balance after approval | |

---

## 5. Out-of-Band Abort Triggers (act immediately, do not wait for next checkpoint)

Any **one** of the following → **HOLD HOTFIX-6** and rollback per `rls-hotfix-5-submit-deposit-refactor-plan.md` §7:

- `submit-deposit` 5xx rate > 1% over any 1h window.
- A single `42501` error from `wallet_transactions` insert path.
- Any duplicate-pending group from Signal 4.
- An approved deposit where `balance_after = 0` after admin approval (Signal 7).
- Any `admin_notifications` deposit row where the corresponding `wallet_transactions` row is missing.
- Any new deposit row where `metadata.idempotency_key` is missing (proves a legacy-path leak; HOTFIX-6 would break it).

---

## 6. Final Verdict (filled at T+48h)

> **PENDING — soak window in progress (T+0 = 2026-05-13 04:45Z).**
>
> Will be set to one of:
> - **SAFE FOR HOTFIX-6** — all 8 signals PASS for the entire 48h window with ≥1 real production deposit observed.
> - **HOLD HOTFIX-6** — any signal FAIL or any out-of-band trigger fired; root cause + remediation required before re-arming the gate.

**Nothing in HOTFIX-5, HOTFIX-6, or any RLS policy was modified by this monitoring document.** Read-only audit only.

---

## 7. Soak Update Log (append-only)

Each row is a structured snapshot. Format:

```
| timestamp_utc | success_rpc | failed_rpc | err_42501 | dup_txn | approval_fail | bal_mismatch | bad_shape | verdict |
```

| timestamp_utc | success_rpc | failed_rpc | err_42501 | dup_txn | approval_fail | bal_mismatch | bad_shape | verdict |
|---|---|---|---|---|---|---|---|---|
| 2026-05-13 04:55Z (T+0) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | BASELINE — soak open |

**T+0 notes (read-only proof, no execution change):**
- DB snapshot (last 48h): `rpc_pending_deposits=0`, `legacy_path_pending_deposits=0`, `duplicate_idem_groups=0`, `bad_shape_pending=0`, `upi_submissions=0`, `bank_submissions=0`, `pending_missing_notification=0`, `approved_deposits=0`, `balance_mismatch_count=0`.
- `postgres_logs.sql_state_code='42501'` last 48h: **0 hits**.
- `submit-deposit` edge-fn HTTP status histogram last 48h: empty (no production traffic yet against the refactored function — expected; smoke-test rows already cleaned).
- All 3 RPCs present: `create_pending_deposit`, `approve_deposit`, plus `wallet_transaction` core path. Verified via `pg_proc` in HOTFIX-5 STEP 1 report.

**Next checkpoint:** T+24h (2026-05-14 ~05:00Z) — re-run the same 10 queries, append a row, no execution change.
**Verdict cutoff:** T+48h (2026-05-15 ~05:00Z) — set `SAFE FOR HOTFIX-6` or `HOLD HOTFIX-6`.

---

## 8. Reproducible Audit Queries — Canonical Read-Only Set

> **All queries below are `SELECT`-only. They DO NOT mutate state. They are the ONLY queries authorised to be run during the 48h soak window.** Tools used: `supabase--read_query` (DB) and `supabase--analytics_query` (logs). Nothing here deploys, migrates, writes, or alters runtime.

### Q1 — `submit-deposit` edge-fn HTTP status histogram (48h)
```sql
-- analytics_query against function_edge_logs
select
  response.status_code,
  count(*) as hits
from function_edge_logs
  cross join unnest(metadata) as m
  cross join unnest(m.response) as response
  cross join unnest(m.request) as request
where m.function_id = (
    select id from functions where name = 'submit-deposit' limit 1
  )
  and function_edge_logs.timestamp > now() - interval '48 hours'
group by 1
order by 1;
```
**Alert rule:** any `status_code >= 500` count > 0 OR overall 5xx rate > 1% of total invocations in any 1h bucket → **HOLD HOTFIX-6**.

### Q2 — `create_pending_deposit` RPC adoption rate (48h)
```sql
-- read_query
select
  count(*)                                              as total_deposits_48h,
  count(*) filter (where metadata ? 'idempotency_key')  as via_rpc,
  count(*) filter (where not (metadata ? 'idempotency_key')) as legacy_path
from public.wallet_transactions
where type = 'deposit'
  and created_at > now() - interval '48 hours';
```
**Alert rule:** `legacy_path > 0` → **HOLD HOTFIX-6** (legacy `system insert` policy still being used; dropping it would break that path).

### Q3 — `42501` RLS denial scan (48h, edge logs + postgres logs)
```sql
-- analytics_query against postgres_logs
select identifier, postgres_logs.timestamp, event_message, parsed.error_severity, parsed.sql_state_code
from postgres_logs
  cross join unnest(metadata) as m
  cross join unnest(m.parsed) as parsed
where postgres_logs.timestamp > now() - interval '48 hours'
  and (parsed.sql_state_code = '42501' or event_message like '%42501%')
order by postgres_logs.timestamp desc
limit 100;
```
```sql
-- analytics_query against function_edge_logs (catch RPC error bodies)
select function_edge_logs.timestamp, event_message
from function_edge_logs
  cross join unnest(metadata) as m
where m.function_id = (select id from functions where name = 'submit-deposit' limit 1)
  and function_edge_logs.timestamp > now() - interval '48 hours'
  and (event_message like '%42501%' or event_message like '%row-level security%' or event_message like '%permission denied for table wallet_transactions%')
order by function_edge_logs.timestamp desc
limit 100;
```
**Alert rule:** any single hit in either query → **HOLD HOTFIX-6** (zero tolerance).

### Q4 — Duplicate pending-deposit detection (idempotency regression)
```sql
-- read_query
select
  user_id,
  metadata->>'idempotency_key' as idem,
  count(*) as dup_rows,
  array_agg(id order by created_at) as txn_ids
from public.wallet_transactions
where type   = 'deposit'
  and status = 'pending'
  and created_at > now() - interval '48 hours'
  and metadata ? 'idempotency_key'
group by 1, 2
having count(*) > 1;
```
**Alert rule:** any row returned (`dup_rows > 0` group count > 0) → **HOLD HOTFIX-6**.

### Q5 — `admin_notifications` orphan / shortfall check
```sql
-- read_query
with rpc_dep as (
  select count(*) as n
  from public.wallet_transactions
  where type='deposit'
    and created_at > now() - interval '48 hours'
    and metadata ? 'idempotency_key'
),
notif as (
  select count(*) as n
  from public.admin_notifications
  where type='deposit_request'
    and created_at > now() - interval '48 hours'
)
select rpc_dep.n as rpc_deposits, notif.n as notif_rows,
       (notif.n - rpc_dep.n) as delta
from rpc_dep, notif;
```
**Alert rule:** `delta < 0` (i.e. `notif_rows < rpc_deposits`) → **HOLD HOTFIX-6**.

### Q6 — Gateway breakdown (UPI / Bank Transfer success)
```sql
-- read_query
select
  metadata->>'gateway' as gateway,
  status,
  count(*) as rows
from public.wallet_transactions
where type='deposit'
  and created_at > now() - interval '48 hours'
group by 1, 2
order by 1, 2;
```
**Alert rule:** any row where `gateway IS NULL` or `gateway NOT IN ('upi','bank_transfer')` → **HOLD HOTFIX-6**.

### Q7 — `approve_deposit` compatibility verification
> Documents: **approved deposit count**, **matching completed `wallet_transaction` count**, **mismatch count**, **orphan approvals**, **orphan completed rows**.
```sql
-- read_query  (compatibility join)
with approved AS (
  select id, user_id, amount, created_at, balance_after, metadata
  from public.wallet_transactions
  where type='deposit'
    and status='approved'
    and created_at > now() - interval '48 hours'
    and metadata ? 'idempotency_key'
),
completions AS (
  -- approve_deposit calls wallet_transaction(...) which writes a credit row with status='completed'
  select id, user_id, amount, created_at
  from public.wallet_transactions
  where status='completed'
    and type in ('deposit','credit','admin_credit')
    and created_at > now() - interval '48 hours'
)
select
  (select count(*) from approved)                                                    as approved_count,
  (select count(*) from completions)                                                 as completed_count,
  (
    select count(*) from approved a
    where not exists (
      select 1 from completions c
      where c.user_id = a.user_id
        and c.amount  = a.amount
        and c.created_at between a.created_at - interval '5 min'
                             and a.created_at + interval '5 min'
    )
  ) as orphan_approvals,
  (
    select count(*) from completions c
    where not exists (
      select 1 from approved a
      where a.user_id = c.user_id
        and a.amount  = c.amount
        and a.created_at between c.created_at - interval '5 min'
                             and c.created_at + interval '5 min'
    )
    and exists (   -- only count completion rows that *should* have an approval (other credit fns excluded)
      select 1 from public.admin_notifications n
      where n.type='deposit_request'
        and n.created_at between c.created_at - interval '1 hour' and c.created_at
    )
  ) as orphan_completions;
```
**Alert rule:** `orphan_approvals > 0` OR `orphan_completions > 0` OR `approved_count != completed_count` (within deposit-credit subset) → **HOLD HOTFIX-6**.

### Q8 — Wallet balance mismatch after approval
```sql
-- read_query
with approved AS (
  select user_id, sum(amount) as approved_total_48h
  from public.wallet_transactions
  where type='deposit'
    and status='approved'
    and created_at > now() - interval '48 hours'
    and metadata ? 'idempotency_key'
  group by 1
)
select
  a.user_id,
  a.approved_total_48h,
  w.balance as wallet_balance_now,
  (w.balance - a.approved_total_48h) as headroom
from approved a
join public.wallets w on w.user_id = a.user_id
where w.balance < a.approved_total_48h - coalesce((
  -- subtract any debits that happened after the approvals (legitimate spend)
  select sum(amount) from public.wallet_transactions wt
  where wt.user_id = a.user_id
    and wt.type in ('debit','withdrawal','vote','purchase')
    and wt.status='completed'
    and wt.created_at > now() - interval '48 hours'
), 0);
```
**Alert rule:** any row returned → **HOLD HOTFIX-6** (a wallet's balance is below the approved-deposit floor net of legitimate spend).

### Q9 — Bad-shape pending invariant scan
```sql
-- read_query
select id, user_id, status, balance_after, reference_id, metadata
from public.wallet_transactions
where type='deposit'
  and status='pending'
  and created_at > now() - interval '48 hours'
  and (balance_after <> 0 or reference_id is not null or not (metadata ? 'idempotency_key') or not (metadata ? 'gateway'));
```
**Alert rule:** any row → **HOLD HOTFIX-6** (invariant breach: pending must have `balance_after=0`, `reference_id=NULL`, `metadata.idempotency_key` set, `metadata.gateway` set).

### Q10 — RPC idempotency replay behaviour (cross-check)
```sql
-- read_query
-- Same (user_id, idem_key) seen multiple times in last 48h MUST collapse to a single row.
select user_id, metadata->>'idempotency_key' as idem,
       count(*) as physical_rows
from public.wallet_transactions
where type='deposit'
  and created_at > now() - interval '48 hours'
  and metadata ? 'idempotency_key'
group by 1, 2
having count(*) > 1;
```
**Alert rule:** any row → **HOLD HOTFIX-6** (RPC short-circuit failed; idempotency window broke).

---

## 9. `approve_deposit` Compatibility Window — Per-Checkpoint Record

Filled at T+24h and T+48h from **Q7**. Empty at T+0 (no traffic yet).

| checkpoint | approved_count | completed_count | mismatch | orphan_approvals | orphan_completions | verdict |
|---|---|---|---|---|---|---|
| T+0  (2026-05-13 04:55Z) | 0 | 0 | 0 | 0 | 0 | BASELINE — soak open |
| T+1h15 (2026-05-13 ~06:05Z) | 0 | 0 | 0 | 0 | 0 | PRECHECK #1 — INVESTIGATE BEFORE HOTFIX-6 (structural-PASS, empirical-PENDING, zero traffic) |
| T+~10h (2026-05-13 ~14:15Z) | 0 | 0 | 0 | 0 | 0 | **OPERATOR DECISION: WAIT FOR T+48H** — Path A selected. No policy drop. No code changes. No migrations. |
| T+~10h (2026-05-13 ~14:25Z) | 0 | 0 | 0 | 0 | 0 | **OPERATOR HOLD HOTFIX-6** — explicit HOLD command. Verdict remains `INVESTIGATE BEFORE HOTFIX-6`. No drop/migration/code/deployment. |
| T+24h | _to be filled_ | | | | | |
| T+48h | _to be filled_ | | | | | |

**Pass condition (all checkpoints):** `mismatch = 0` AND `orphan_approvals = 0` AND `orphan_completions = 0`.

---

## 10. Lightweight Alerting Matrix (mapped 1:1 to queries above)

| # | Signal | Source query | Trigger | On trigger |
|---|---|---|---|---|
| A1 | `42501` count > 0 | Q3 | rows returned ≥ 1 | **HOLD HOTFIX-6** + page on-call; capture full `event_message` + `txn id`; rollback per refactor-plan §7 |
| A2 | duplicate pending groups > 0 | Q4 / Q10 | rows returned ≥ 1 | **HOLD HOTFIX-6**; freeze RPC; investigate `(user_id, idem_key)` collision window |
| A3 | balance mismatch count > 0 | Q8 | rows returned ≥ 1 | **HOLD HOTFIX-6**; reconciliation snapshot; do NOT touch wallets manually |
| A4 | approval mismatch count > 0 | Q7 | `mismatch>0` OR `orphan_approvals>0` OR `orphan_completions>0` | **HOLD HOTFIX-6**; cross-check `approve_deposit` + `wallet_transaction` call chain in edge logs; no rollback of approved rows |
| A5 | legacy-path leak | Q2 | `legacy_path > 0` | **HOLD HOTFIX-6**; HOTFIX-6 would 42501 the legacy callers — find them first |
| A6 | bad-shape pending | Q9 | rows returned ≥ 1 | **HOLD HOTFIX-6**; invariant breach; root-cause RPC body, do not patch table |
| A7 | submit-deposit 5xx > 1%/h | Q1 | bucket exceeded | **HOLD HOTFIX-6**; inspect Deno boot/log for stack traces |
| A8 | `admin_notifications` shortfall | Q5 | `delta < 0` | **HOLD HOTFIX-6**; admin would be blind to deposits |

**Alerting transport:** none deployed by this document. Operator runs the queries at each checkpoint (T+24h, T+48h) and at any out-of-band suspicion. **No webhook, no cron, no infra was created.** This is a procedural alerting matrix only.

---

## 11. Read-Only Guarantee

This document and its query set:

- ✅ Performs zero `INSERT` / `UPDATE` / `DELETE` / `ALTER` / `DROP` / `CREATE` / `GRANT` / `REVOKE`.
- ✅ Deploys no edge function, no migration, no cron, no webhook, no alerting infra.
- ✅ Touches no production runtime code path.
- ✅ Holds HOTFIX-6 strictly behind the T+48h verdict.
- ✅ Does not modify any RLS policy (the legacy `"System can insert transactions"` policy remains intact and untouched until HOTFIX-6 is explicitly authorised).

