# Phase 1A · Step C.fix-5c — Partial Verification Report (Lovable-side, READ-ONLY)

> **Mode:** READ-ONLY DB inspection via `supabase--read_query` only. Zero writes, zero migrations, zero edge-fn changes, zero `p_dry_run` flips, zero canary action.
> **Authority:** Forensic Engineering Mandate Rules 1–5.
> **Executed:** 2026-05-18 (UTC).
> **Live canary status:** 🛑 **HOLD** — unchanged.

---

## 0. Honest Scope Statement (Rule 2: Zero Guesswork)

The probe block in `phase-1a-step-c-fix-4-path-a-psql-probe-block.md` is split into two parts:

| Part | Contents | Executable by Lovable? |
|---|---|---|
| **§2** | `BEGIN; … UPDATE … wallet_ledger_apply_v2(p_dry_run:=false) … ROLLBACK;` | **NO** — `supabase--read_query` is SELECT-only; `supabase--migration` auto-commits each statement and cannot honour the mandatory `ROLLBACK`. Running §2 via migration tool would violate the "ROLLBACK must stay ROLLBACK" safety contract. |
| **§3** | Pure `SELECT`s (live diff report, function-shape, cron, diff_log tail) | **YES** — executed below. |

Therefore this report clears **P3 + P6 + cron-residue gates only**. Gates **P1, P2, P4, P5 still require a real `psql` session** (per the manual checklist) or migration of §2 into individual stand-alone idempotent test RPCs (out of scope for this step).

---

## 1. Results — §3.2 P6 (Function-Shape Parity)

### 1.1 Signature

```
proname                 | args                                                                                                                                                  | returns
------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------+--------
wallet_ledger_apply_v2  | p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean   | jsonb
```

**Pass criteria:** args = expected 8-arg shape ✅ · returns = `jsonb` ✅
**Verdict P6 (signature):** 🟢 **GREEN**

### 1.2 Body markers (proves C.fix-3 Option A is active)

| Marker | Required | Actual |
|---|---|---|
| `mirror_mode_comment_present` | `true` | **true** ✅ |
| `option_a_assignment_present` (`v_balance_after := v_balance_before;`) | `true` | **true** ✅ |
| `old_buggy_assignment_present` (`v_balance_after := v_balance_before + p_amount;`) | `false` | **false** ✅ |

**Verdict P6 (body):** 🟢 **GREEN** — C.fix-3 Option A is the live function body.

---

## 2. Results — §3.3 Cron Residue Check

```
jobname                              | schedule       | active
-------------------------------------+----------------+-------
expire-gift-credits-every-10min      | */10 * * * *   | true
expire-gift-credits-hourly           | 0 * * * *      | true
wallet_ledger_v2_diff_hourly         | 7 * * * *      | true
```

**Pass criteria:** unchanged vs C.fix-3 execution doc ✅ — same three active jobs at same schedules.
**Verdict cron:** 🟢 **GREEN** — no silent cron tampering.

---

## 3. Results — §3.3 `wallet_ledger_v2_diff_log` Tail (last 5 hourly runs)

| ran_at (UTC) | safe_for_shadow_wiring | mismatch_count | error_count | unmatched_live | unmatched_shadow | amount/type/user/ref mismatch | alert_fired |
|---|---|---|---|---|---|---|---|
| 2026-05-18 12:07 | **true** | 0 | 0 | 0 | 0 | 0/0/0/0 | false |
| 2026-05-18 11:07 | **true** | 0 | 0 | 0 | 0 | 0/0/0/0 | false |
| 2026-05-18 10:07 | **true** | 0 | 0 | 0 | 0 | 0/0/0/0 | false |
| 2026-05-18 09:07 | **true** | 0 | 0 | 0 | 0 | 0/0/0/0 | false |
| 2026-05-18 08:07 | **true** | 0 | 0 | 0 | 0 | 0/0/0/0 | false |

**5/5 consecutive hourly runs:** `safe_for_shadow_wiring = true`, all mismatch counters = 0, no alerts.
**Verdict cron-driven diff:** 🟢 **GREEN**.

---

## 4. Results — §3.1 P3 (Live Diff Report)

```sql
SELECT public.wallet_ledger_v2_diff_report('60 minutes'::interval);
-- ERROR: 42501 permission denied for function wallet_ledger_v2_diff_report
```

**Verdict P3 (direct call):** ⚠️ **NOT-EXECUTED-BY-LOVABLE** — function is correctly locked (`REVOKE ALL`, per A1 design memo). The Lovable `read_query` role lacks EXECUTE.

**Indirect substitute:** §3 diff_log tail (above) covers 5 hours of cron-invoked diff reports, all GREEN. This is functionally equivalent evidence for the live-diff gate.

**Treat P3 as 🟢 GREEN by substitution** (cron-driven evidence) — but acknowledge a direct `psql`-session call from a privileged role would be the formal proof.

---

## 5. Schema Drift Note (Rule 1: Zero Assumption)

The C.fix-4 probe doc (§3.3) referenced columns `captured_at` and a `report` JSONB. The live table has **flat columns** (`ran_at`, `safe_for_shadow_wiring`, `mismatch_count`, etc.) — no JSONB blob, no `captured_at`.

**Impact:** The §3.3 query in the probe doc as written would error in real `psql` too. Operator running the manual checklist will hit the same `column "captured_at" does not exist` error.

**Action required (deferred, doc-only):** Update §3.3 in `phase-1a-step-c-fix-4-path-a-psql-probe-block.md` to use the actual columns. Not done in this step (read-only mandate). Flag added here for tracking.

---

## 6. Per-Gate Verdict Matrix

| Gate | Source | Verdict | Notes |
|---|---|---|---|
| **P1** dry-run idempotence | §2 | 🟡 **PENDING-OPERATOR** | Requires transactional `psql` |
| **P2** live ordered mirror (triple-equality) | §2 | 🟡 **PENDING-OPERATOR** | Requires transactional `psql` |
| **P3** live diff report | §3.1 (direct) / §3.3 (cron-substitute) | 🟢 **GREEN by substitution** | 5/5 hourly runs clean |
| **P4** regression detection (drift injection) | §2 | 🟡 **PENDING-OPERATOR** | Requires transactional `psql` |
| **P5** snapshot mirror under drift | §2 | 🟡 **PENDING-OPERATOR** | Requires transactional `psql` |
| **P6** caller-shape + body parity | §3.2 | 🟢 **GREEN** | Signature + Option A markers confirmed |
| **Cron residue** | §3.3 | 🟢 **GREEN** | No tampering |
| **diff_log residue** | §3.3 | 🟢 **GREEN** | 5/5 hourly clean |

---

## 7. Live Canary Decision

**`gift_refund` live canary remains 🛑 HOLD.**

Reason: P1/P2/P4/P5 cannot be cleared by Lovable's read-only DB role. Authority on those four gates still sits with a privileged transactional psql session.

**Two paths forward (no automatic action — operator picks):**

1. **Operator runs §2 in real `psql`** (per `phase-1a-manual-psql-checklist.md`) and pastes E1–E6 transcript. Lovable then writes the final all-GREEN/HOLD verdict.
2. **Defer P1/P2/P4/P5 indefinitely** — accept 4 hours of cron-driven diff GREEN (now 5 hours) + P6 GREEN as sufficient evidence to authorise a *single* `gift_refund` canary. This is a **lower-rigour** path; not recommended unless operator explicitly accepts the residual risk in writing.

---

## 8. Negative-Space Inventory

| Surface | Touched this step? |
|---|---|
| Any wallet/ledger table | ❌ read-only SELECTs only |
| Any DB function execution | ❌ (one attempted call → permission denied, no side effect) |
| Any migration / DDL | ❌ |
| Any edge function | ❌ |
| Any `p_dry_run` flag | ❌ |
| Any cron job | ❌ |
| Source code / ESLint / CI | ❌ |
| Memory index | ❌ |

Files written this step: **only this report.**

---

## 9. Final Verdict

# 🟢 GREEN for P3 (by substitution), P6, Cron, diff_log residue
# 🟡 PENDING-OPERATOR for P1, P2, P4, P5
# 🛑 HOLD for live `gift_refund` canary

Awaiting either the E1–E6 manual transcript or an explicit operator decision to accept the lower-rigour deferral path.
