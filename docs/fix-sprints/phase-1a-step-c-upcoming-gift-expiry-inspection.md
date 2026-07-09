# Phase 1A — Step C: Upcoming Gift Expiry Inspection (READ ONLY)

> **Mode:** READ ONLY. Zero code change, zero migration, zero deploy, zero data mutation, zero `p_dry_run=false`, zero synthetic data.
> **Purpose:** Determine whether an organic `gift_refund` dry-run cycle can be observed soon, OR whether Path 2 (synthetic probe) is required to close Blocker #2.

---

## 1. Live evidence (snapshot @ `2026-05-15 13:47:36.988742+00`)

### 1.1 `gift_announcements` aggregate

| Metric | Value |
|---|---|
| Active unexpired (`is_expired=false`) | **7** |
| Active unexpired AND `expires_at IS NOT NULL` | **0** |
| Already past expiry (`expires_at < now()`) | **0** |
| Eligible within next 24h | **0** |
| Eligible within next 7 days | **0** |
| Nearest future `expires_at` | **NULL** (none exists) |

### 1.2 Per-row inspection (latest 10)

The 7 active unexpired rows ALL have `expires_at = NULL`:

| id | amount | reason | expires_at | is_expired |
|---|---|---|---|---|
| 6f47dcf5… | 5  | Test          | NULL | false |
| ac10bc86… | 10 | Gift          | NULL | false |
| 0290f647… | 10 | Gift          | NULL | false |
| 5e1e8f66… | 10 | Gift Test     | NULL | false |
| 664b119c… | 10 | Promotional Gift | 2026-04-15 23:59:59 | **true** (already expired Apr 15) |
| 880d89b4… | 10 | Promotional Gift | 2026-04-15 23:59:59 | **true** |
| … (5 more historical Promotional Gift rows, all `is_expired=true`) | | | | |

### 1.3 `gift_credits`

| Metric | Value |
|---|---|
| Total rows | 8 |
| With `expires_at` set | 2 |
| Nearest **future** `expires_at` | **NULL** (none exists) |

### 1.4 Cron schedule (`expire-gift-credits`)

Two active jobs both targeting `expire-gift-credits`:

| jobid | jobname | schedule | active |
|---|---|---|---|
| 1 | `expire-gift-credits-hourly`        | `0 * * * *`    | true |
| 6 | `expire-gift-credits-every-10min`   | `*/10 * * * *` | true |

Cron WILL fire within the next 10 minutes and again within the next hour — but the edge function's filter is:

```ts
.eq("is_expired", false).not("expires_at", "is", null).lt("expires_at", new Date().toISOString())
```

With **zero** rows matching that filter (see §1.1), the function will return `{success:true, expired:0}` and the `gift_refund` shadow branch will **never execute**.

---

## 2. Answers to the 6 required questions

1. **Number of active unexpired gifts:** **7** (none with `expires_at` set).
2. **Nearest `expires_at`:** **NONE** (all already-expired rows are historical from Apr 15; no future expiries scheduled).
3. **Will `expire-gift-credits` cron fire within 24h?** **YES** — but with **zero candidate rows**, so the `shadowApplyV2GE("gift_refund", …)` call site is unreachable.
4. **Any gift eligible for `gift_refund` dry-run now?** **NO** (zero rows match the cron's WHERE clause).
5. **Is waiting for organic dry-run practical?** **NO**. No future `expires_at` exists in either `gift_announcements` or `gift_credits`. Waiting = waiting indefinitely.
6. **Recommendation:** Proceed with **Path 2 — synthetic probe** as designed in `phase-1a-step-c0-canary-blocker-resolution-plan.md §C.2`.

---

## 3. Untouched (re-confirmed)

- ❎ No edge function deployed
- ❎ No migration written
- ❎ No `p_dry_run` flipped
- ❎ No row inserted/updated/deleted
- ❎ `wallets` and `wallet_transactions` not read for write — only counted in prior preflight
- ❎ `wallet_ledger_v2_rows` count still 0

---

## 4. Final verdict

### **USE SYNTHETIC PROBE**

Path 1 (organic) is **infeasible** — there is no scheduled gift expiry, anywhere, ever. The cron will continue to fire and continue to no-op. Closing Blocker #2 requires an explicit dev-controlled synthetic gift expiry per Path 2.

---

## 5. Next recommended step (user choice required)

**`GO PHASE-1A STEP C — PLAN PATH 2 SYNTHETIC PROBE`**

Design-only doc covering:
- one $0.01 dev-account `gift_announcements` row pre-set to `expires_at = now() - 1 minute`
- mandatory same-step admin credit cleanup (so wallet checksum returns to baseline)
- `db_audit_logs` lifecycle entries (probe_start, cron_observed, probe_cleanup)
- expected single `gift_refund` row in `wallet_ledger_audit_log` (`result='dry_run_ok'`) and `wallet_ledger_shadow_log`
- expected zero rows in `wallet_ledger_v2_rows` (live branch unreachable while caller still `p_dry_run:true`)
- rollback: delete probe gift row + reverse cleanup credit (or rely on cleanup credit alone if probe never fires)

NO execution. PLAN ONLY.
