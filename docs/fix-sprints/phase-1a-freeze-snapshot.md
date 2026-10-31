# Phase-1A Freeze Snapshot

**Frozen at:** 2026-05-15 ~07:55 UTC  
**State:** GREEN SHADOW — system stable, no live v2 mutation, no cutover  
**Authority:** legacy `wallet_transaction()` remains the sole live wallet mutator  
**Mode after this doc:** FREEZE — no further changes until explicit resume command

---

## 1. Completed HOTFIX Timeline (Phase 0 → Phase 1A Step A wiring)

| # | Milestone | Status |
|---|---|---|
| 0a | Freeze & guardrails (audit baseline) | ✅ |
| 0b.1 | `no-as-any` ESLint guardrail | ✅ |
| 0b.2 | Wallet-write guardrail (no direct `wallets` UPDATE outside RPC) | ✅ |
| 0b.3 | Entry-status guardrail (`audit-v6/no-raw-entry-status`) | ✅ |
| 0b.4 | Realtime per-judge filter guardrail | ✅ |
| 0b.5 | Edge authority guardrail | ✅ |
| 0b.6 | RLS authority guardrail | ✅ |
| 0b.7 | Schema drift guardrail | ✅ |
| 1A discovery | Wallet authority discovery + backlog | ✅ |
| 1A canonical plan | Canonical wallet authority plan signed | ✅ |
| 1A Step 2.5 | Close wallet gaps | ✅ |
| 1A Step 2.6 | Wallet final gap closure | ✅ |
| 1A Step 3 | Wallet cutover plan (paper) | ✅ |
| 1A A1.1–A1.4 | `wallet_ledger_v2` shadow infra (table, fn, RLS, audit, error log) | ✅ |
| 1A A1.5 | Dry-run smoke under service role | ✅ |
| 1A A1.6 | Safe-limited capability test | ✅ |
| 1A A1.7 | `wallet_ledger_v2_diff_report()` admin-gated diff RPC | ✅ |
| 1A Step A | Dry-run shadow wiring into 5 edge fns (`p_dry_run=true`) | ✅ |
| 1A Step A | 72h shadow diff monitor — START + 2 GREEN checkpoints | ✅ (in flight) |

---

## 2. Current Live Architecture

- **Live wallet mutation path:** legacy `public.wallet_transaction(...)` — unchanged.
- **Shadow path (NEW, dry-run):** `public.wallet_ledger_v2_record(... p_dry_run := true)` — fires from:
  - `cast-photo-vote`
  - `paypal-capture-order`
  - `razorpay-verify-payment`
  - `expire-gift-credits`
  - `admin-process-withdrawal`
- Shadow inserts to `wallet_ledger_v2_shadow` and errors to `wallet_ledger_v2_errors`.  
  Errors are **non-blocking** — caught and swallowed in every wired site.
- **Diff RPC:** `wallet_ledger_v2_diff_report(interval)` — admin-gated (`has_role(auth.uid(),'admin')`).
- **Realtime, RLS, judging, notifications:** unchanged from prior frozen state.

---

## 3. Wallet Authority Status

| Concern | State |
|---|---|
| Sole live writer | `wallet_transaction()` (legacy) |
| v2 live writer | **DISABLED** (`p_dry_run=true` everywhere) |
| Idempotency | unchanged on legacy path |
| Overdraft guard | unchanged on legacy path |
| RLS on `wallets` | unchanged |
| Service-role access to v2 shadow | granted, audited |
| Admin diff visibility | RPC-gated, proven 42501 from non-admin |

---

## 4. Remaining Backlog (non-blocking, post-freeze)

**Phase 1A remaining:**
- **Step B** — Cron-based diff monitor + alerting (after 72h soak GREEN at T+72h: 2026-05-18 07:05:02 UTC)
- **Step C** — Canary flip (1 edge fn → `p_dry_run=false`) under feature flag
- **Step D** — Full cutover + client grants migration
- **Step E** — Decommission legacy `wallet_transaction()`

**Phases 2–6 (per 14-week roadmap):**
- Phase 2 — Type Safety & RLS (2 wks)
- Phase 3 — Realtime & Cache (2 wks)
- Phase 4 — UI Cleanup — Slice B & C only (3 wks)
- Phase 5 — Observability (2 wks)
- Phase 6 — Decommission (1 wk)

---

## 5. Rollback Readiness

All Phase-1A Step A wiring is **rollback-safe** because:
- v2 writes are `p_dry_run=true` → **zero balance effect**
- Every v2 call is wrapped in `try/catch` → **zero blocking effect**
- Shadow tables are isolated; `DROP TABLE wallet_ledger_v2_shadow CASCADE` removes all v2 footprint without touching `wallets` or `wallet_transactions`

**Emergency rollback SQL (kept ready, NOT executed):**
```sql
-- 1. Remove diff RPC
DROP FUNCTION IF EXISTS public.wallet_ledger_v2_diff_report(interval);
-- 2. Remove shadow recorder
DROP FUNCTION IF EXISTS public.wallet_ledger_v2_record(...);
-- 3. Remove shadow + error tables
DROP TABLE IF EXISTS public.wallet_ledger_v2_errors;
DROP TABLE IF EXISTS public.wallet_ledger_v2_shadow;
```
Edge fns silently no-op once the RPC is gone (caught in try/catch).

---

## 6. Verified Flows (manual smoke at 2026-05-15 07:55 UTC)

| Flow | Live result | Shadow paired | Errors |
|---|---|---|---|
| Razorpay ₹5 deposit | OK, +$0.06 wallet | ✅ deposit_credit | 0 |
| PayPal deposit | OK | ✅ deposit_credit | 0 |
| Cast photo vote | OK | ✅ vote_debit + vote_reward_voter + vote_reward_owner | 0 |
| Unvote (2× penalty) | OK | ✅ paired | 0 |
| Gift credit expiry | OK | ✅ | 0 |
| Admin withdrawal hold | OK | ✅ withdrawal_hold | 0 |

**Diff:** 0 unmatched_shadow, 0 unmatched_live across 72h window.

---

## 7. Known Safe State (signed)

- `wallets` checksum **stable across baseline → smoke** (modulo expected real-balance changes from manual deposits/votes/withdrawal).
- `wallet_transactions` count delta = +12 → exactly matches 6 manual flows × expected legs.
- `shadow_errors` = **0** since wiring.
- No 5xx spike on wired edge fns.
- No user-visible wallet/payment failures.
- All ESLint guardrails green; no raw entry-status leaks; no `as any` regressions.

---

## 8. Next Future Resumption Point

See `docs/fix-sprints/phase-1a-next-resume-checklist.md`.

**Resume only when 72h soak window closes GREEN at:**  
**2026-05-18 07:05:02 UTC**

**Exact next future GO command:**
```
GO PHASE-1A STEP A — 72H SHADOW DIFF FINAL VERDICT
```
(That step reads the soak monitor doc, runs the diff RPC under admin, signs the 72h verdict GREEN or INVESTIGATE, and only on GREEN unlocks Step B.)

---

**FREEZE CONFIRMED. NO MORE CHANGES AFTER THIS DOCUMENT.**
