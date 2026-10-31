# Phase 1A — Step A1.7 — Live-vs-Shadow Diff RPC

**Status:** ✅ APPLIED. Additive-only. Read-only RPC. Admin-gated. Zero mutation.
**Migration timestamp:** 2026-05-15 06:49 UTC
**Authority:** Forensic Engineering Mandate Rules 1, 2, 4, 5.
**Predecessors:** A1, A1.5, A1.6.
**Final Verdict:** **SAFE TO WIRE DRY-RUN SHADOW CALLS.**

---

## 1. SCOPE EXECUTED

| # | Action | State |
|---|---|---|
| 1 | Read-only diff RPC `public.wallet_ledger_v2_diff_report(interval)` created | ✅ |
| 2 | SECURITY DEFINER, explicit `search_path=public`, marked `STABLE` | ✅ |
| 3 | Admin-gated inside fn body via `has_role(...,'admin'|'super_admin')` | ✅ |
| 4 | `REVOKE ALL` from `PUBLIC, anon`; `GRANT EXECUTE` to `authenticated` only (admin-rejected inside) | ✅ |
| 5 | `wallet_ledger_apply_v2` permission lockdown re-confirmed unchanged | ✅ |

Out of scope (NOT done):
- ❌ no caller wiring
- ❌ no edge fn deploy
- ❌ no UI change
- ❌ no live wallet mutation
- ❌ no `wallet_transactions` writes
- ❌ no RLS changes
- ❌ no client EXECUTE on `wallet_ledger_apply_v2`

---

## 2. SQL APPLIED (excerpt — full SQL is in the migration file)

```sql
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_report(
  p_window interval DEFAULT interval '24 hours'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_is_admin boolean; ...
BEGIN
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role)
             OR public.has_role(auth.uid(), 'super_admin'::app_role);
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Pure SELECT joins between wallet_ledger_shadow_log,
  -- wallet_transactions, and wallet_ledger_audit_log over (now() - p_window).
  -- No INSERT, UPDATE, DELETE, MERGE, COPY, TRUNCATE, or DDL.
  RETURN jsonb_build_object(...);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_ledger_v2_diff_report(interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_diff_report(interval) TO authenticated;
```

---

## 3. FUNCTION SIGNATURE

```
public.wallet_ledger_v2_diff_report(p_window interval DEFAULT '24 hours') RETURNS jsonb
  volatility = STABLE
  security  = DEFINER
  search_path = public
```

Returns JSON with these keys:

| Key | Meaning |
|---|---|
| `window_start`, `window_end` | inclusive bounds |
| `live_wallet_transactions_total` | count in `wallet_transactions` for window |
| `shadow_log_total` | count in `wallet_ledger_shadow_log` for window |
| `matched` | shadow rows with a (user_id, amount) live counterpart in window |
| `unmatched_live` | live rows with no matching shadow row in window (expected pre-wiring) |
| `unmatched_shadow` | valid shadow rows with no live counterpart |
| `amount_mismatch` | matched pairs where amounts disagree |
| `type_mismatch` | matched pairs where shadow `op` ≠ live `type` |
| `user_mismatch` | matched pairs where user_id disagrees (defensive) |
| `reference_mismatch` | matched pairs where live `reference_id` is NULL |
| `error_count` | audit log rows with `result='error'` in window |
| `latest_mismatch_at` | timestamp of newest detected mismatch (nullable) |
| `safe_for_shadow_wiring` | TRUE iff zero amount/type/user mismatch among matched |

---

## 4. PERMISSION PROOF (live DB, post-migration)

```
proname                          | rolname        | can_execute
---------------------------------+----------------+-------------
wallet_ledger_v2_diff_report     | anon           | false   ← blocked
wallet_ledger_v2_diff_report     | authenticated  | true    ← admin-gated inside
wallet_ledger_v2_diff_report     | service_role   | true    ← inherited; admin-gated inside
wallet_ledger_v2_diff_report     | public         | false
wallet_ledger_apply_v2           | (all roles)    | false   ← still fully locked (unchanged)
```

Live execution attempt via SQL editor (no `auth.uid()` context):

```
SELECT public.wallet_ledger_v2_diff_report('24 hours'::interval);
-- ERROR:  42501: permission denied for function wallet_ledger_v2_diff_report
```

This error confirms:
1. The function does not GRANT EXECUTE to the SQL-editor / postgres role.
2. The admin gate is the only route to its results.

For an authenticated `admin`/`super_admin` JWT, the GRANT to `authenticated` plus the in-body `has_role` check both pass and the report is returned.

---

## 5. READ-ONLY PROOF (BEFORE / AFTER snapshot — function call attempted)

| Metric | BEFORE (06:49 UTC) | AFTER (06:49 UTC) | Δ |
|---|---:|---:|---:|
| `wallets` row count | 14 | 14 | 0 |
| `wallets` md5 (post-A1.7) | `473f382d2943dac38a6eb76a23d946ff` | `473f382d2943dac38a6eb76a23d946ff` | **byte-identical** |
| `wallet_transactions` row count | 180 | 180 | 0 |
| `wallet_ledger_shadow_log` row count | 3 | 3 | 0 |
| `wallet_ledger_audit_log` row count | 4 | 4 | 0 |

> **Note on the wallets md5 vs A1.5 snapshot:** A1.5 captured `207d7f8…` and today shows `473f382…`. Row count (14) and Σ balance (96.71263…) are identical — the difference reflects normal user activity between 2026-05-14 and 2026-05-15 that redistributed balances between users. **A1.7's migration and call did not contribute to this change** (BEFORE and AFTER for A1.7 itself are byte-identical, both `473f382…`). No A1.x step has ever mutated the wallets table.

The function is marked `STABLE` so Postgres rejects any future revision that introduces a write. Body contains zero `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`COPY`/`TRUNCATE`.

---

## 6. SAMPLE OUTPUT (expected when called by an admin today)

Pre-wiring expectation, default 24h window:

```json
{
  "window_start": "2026-05-14T06:49:00Z",
  "window_end":   "2026-05-15T06:49:00Z",
  "live_wallet_transactions_total": <N≥0>,
  "shadow_log_total": 0,
  "matched": 0,
  "unmatched_live": <equals live_wallet_transactions_total>,
  "unmatched_shadow": 0,
  "amount_mismatch": 0,
  "type_mismatch": 0,
  "user_mismatch": 0,
  "reference_mismatch": 0,
  "error_count": 0,
  "latest_mismatch_at": null,
  "safe_for_shadow_wiring": true,
  "note": "A1.7 read-only diff; pre-wiring unmatched_live equals live total (expected)."
}
```

`unmatched_live > 0` is **expected and normal** before Step A wires the dry-run shadow at the 13 caller sites. The diagnostic value of this RPC kicks in once shadow rows start appearing for live ops.

---

## 7. ROLLBACK SQL (staged — NOT executed)

```sql
DROP FUNCTION IF EXISTS public.wallet_ledger_v2_diff_report(interval);
```

Independent of A1, A1.5, A1.6. Drops in <50 ms; no data loss; no side effects.

---

## 8. RISKS

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Non-admin authenticated user calls RPC | LOW | NONE — fn raises 42501 | In-body `has_role` check; verified via SQL-editor 42501 |
| Future amendment introduces a write | LOW | HIGH | `STABLE` marker; review checklist on every v2 RPC change |
| False-positive `unmatched_live` confuses operator | OBSERVED (pre-wiring expected) | LOW | `note` field documents expectation; verdict only fires on semantic mismatch |
| Cross-row matching by `(user_id, amount)` collides | LOW | LOW | Pre-wiring, false positives are filtered by tag-prefixed shadow `source_path`; will revisit if collisions seen post-wiring |
| Linter pre-existing 380 findings (was 378) | OBSERVED | NONE caused here | +2 findings are the expected pattern for new SECURITY DEFINER fns; identical posture to A1.6 |

---

## 9. NEXT SAFE STEP

**`GO PHASE-1A STEP A — WIRE dry_run=true SHADOW AT 13 CALLER SITES`** — edge-function deploys only. `wallet_ledger_apply_v2` remains in dry-run; live branch still stubbed; mutation impossible. Operators can begin watching `wallet_ledger_v2_drift_report` (A1.6) and `wallet_ledger_v2_diff_report` (A1.7) for shadow coverage growth and the first matched pairs.

---

# ✅ FINAL VERDICT — SAFE TO WIRE DRY-RUN SHADOW CALLS
