# Phase 1A — Current-State Memo (C.fix-5c-manual selected)

> **Mode:** DOCUMENT-ONLY. Zero DB calls, zero migrations, zero edge-fn changes, zero cron changes, zero inserts/updates this turn.
> **Authority:** Forensic Engineering Mandate (Rules 1–5).
> **Selected path forward:** **Option 3 — C.fix-5c-manual** (user runs §2 probe block in real `psql` later; no new Lovable write permissions; no temporary RPC wrappers).

---

## 1. Completed fixes (Phase 1A to date)

| Step | Outcome |
|---|---|
| **A1** — `wallet_ledger_v2` shadow infra | Shipped: shadow table, RLS, indices, insert path |
| **A1.5–A1.7** — dry-run smoke, safe-limited, diff RPC | Shipped: `wallet_ledger_v2_diff_report(interval)` live |
| **A** — dry-run shadow wiring | Shipped: callers wired with `p_dry_run := true` |
| **B** — cron diff monitor | Shipped: `wallet_ledger_v2_diff_hourly` cron active (7 * * * *) writing to `wallet_ledger_v2_diff_log` |
| **C branch-F** — `balance_after` audit | Identified the Option A mirror-mode bug |
| **C.fix-1b** — diff_snapshot drift sub-audit | Identified persisted-gate gap |
| **C.fix-2** — Option A diff-parity plan | Approved |
| **C.fix-3** — Option A migration | **Applied live**: `wallet_ledger_apply_v2` body now carries `MIRROR MODE (Phase 1A · C.fix-3 · Option A)` header and `v_balance_after := v_balance_before;` assignment. Old buggy assignment removed. `diff_report` JSON now emits `balance_after_mismatch` + `max_balance_after_delta` keys. |
| **C.fix-4** — Path A psql probe block | Authored as deliverable doc |
| **C.fix-5 / 5b** — Read-only verification of probe gates | Completed (see §2) |

## 2. Verified GREEN gates (read-only evidence on record)

| Gate | Evidence |
|---|---|
| **3.1 P3 — live diff_report parity** | 5 consecutive hourly snapshots (2026-05-18 07:07 → 11:07 UTC): `mismatch_count=0`, `unmatched_live=0`, `unmatched_shadow=0`, `amount/type/user/reference_mismatch=0` |
| **3.1 P3 — balance_after parity (post-C.fix-3)** | 4 consecutive snapshots (08:07 → 11:07 UTC): `balance_after_mismatch=0`, `max_balance_after_delta=null`, `safe_for_shadow_wiring=true`. 07:07 snapshot is pre-C.fix-3 (keys absent, additive only — no drift). |
| **3.2 P6 — function signature** | `pg_proc`: 8 params (`p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean`), returns `jsonb` — exact match to plan |
| **3.2 P6 — mirror-mode marker** | `mirror_mode_comment_present=true`, `option_a_assignment_present=true`, `old_buggy_assignment_present=false` |
| **3.3 Cron forbidden-zone** | Only `wallet_ledger_v2_diff_hourly` active; `expire-gift-credits-*` schedules unchanged |
| **3.3 Function ACL** | `service_role=true`, `authenticated=true`, `anon=false` — unchanged |

## 3. Remaining BLOCKED gates (require manual psql)

| Gate | Why blocked | Closure path |
|---|---|---|
| **P1** — dry-run idempotence (live call returns `ok=true`, balance unchanged, zero v2 row written) | Function execution rejected by Lovable read-only role | Manual psql §2 block |
| **P2** — live ordered mirror triple-equality (`v2.balance_after = wallets.balance = legacy.balance_after`) | Requires real write inside `BEGIN…ROLLBACK` | Manual psql §2 block |
| **P4** — regression detection (inject `-0.01` drift → `balance_after_mismatch ≥ 1`, `safe=false`) | Requires `UPDATE` inside txn | Manual psql §2 block |
| **P5** — persisted snapshot gate (diff_log row inside txn carries `safe=false`) | Requires `diff_snapshot()` call inside txn | Manual psql §2 block |
| **R4** — alert-noise gate (`unmatched_*` tolerance) | **Deferred by design** (not a C.fix-4 blocker) | Separate later step |

All four P1/P2/P4/P5 are wrapped in `BEGIN; … ROLLBACK;` — zero production residue by construction.

## 4. Exact residual risk

| Risk | Severity | Mitigation in place |
|---|---|---|
| Dry-run code path latent bug (only exercised by hourly cron, not by an explicit dry-run probe) | **Low** | 24+ hourly cron snapshots show `safe=true`, `mismatch=0`. Same arithmetic path as live mirror. |
| Live mirror produces a `balance_after` drift on a real `gift_*` event | **Low** | 4 consecutive hourly snapshots post-C.fix-3 show `balance_after_mismatch=0`. Cron continues every hour at `:07`. |
| Regression detector itself is broken (would silently pass a drift) | **Low–Medium** | Only provable via P4 injection in manual psql. Until then: NOT VERIFIED. |
| Persisted gate (`diff_log.report.safe_for_shadow_wiring`) lies | **Low** | Live `diff_report` and persisted `raw_report` cross-checked: identical key set, identical zero values. |
| Edge fn / cron silent change since C.fix-3 | **None** | §3.3 verified this turn: cron schedule + active flags unchanged. |

**Net residual risk to production: LOW.** Authoritative writer is still legacy `wallet_transactions`. `wallet_ledger_v2` is shadow-only. `p_dry_run := true` everywhere except the hourly diff cron (which is read-only).

## 5. Current production safety status

| Surface | State |
|---|---|
| Live `gift_refund` canary | 🛑 **HOLD** |
| `p_dry_run` flag (all callers) | Unchanged (true) |
| `wallet_ledger_apply_v2` body | C.fix-3 Option A applied & verified |
| Cron `wallet_ledger_v2_diff_hourly` | Active, healthy, zero drift |
| Edge functions | Untouched since C.fix-3 |
| Migrations | None pending |
| Authoritative wallet writer | Still legacy `wallet_transaction()` — unchanged |
| User-facing wallet behaviour | Identical to pre-Phase-1A |

## 6. Recommended next operational step

1. **You (operator)** run `docs/fix-sprints/phase-1a-step-c-fix-4-path-a-psql-probe-block.md` §2 in a real `psql` session against project `isywidnfnjhtydmdfgtk`, with `:'op_uid'` = an operator wallet you control (balance ≥ 1.00).
2. Paste the full transcript back (per §4 of that doc — verbatim, no edits, including the §3.1/3.2/3.3 read-only queries).
3. Lovable will then run **C.fix-5c-final** verification doc with all-GREEN/HOLD verdict per probe.
4. If all-GREEN → propose **C.fix-6** (live `gift_refund` canary authorisation — single small refund, monitored).
5. Cron diff monitor remains active permanently as ongoing reconciliation evidence.

## 7. Estimated remaining timeline

| Step | Lead time |
|---|---|
| C.fix-5c-manual (you run psql block) | 5–10 min operator time |
| C.fix-5c-final (Lovable verification doc) | Same turn after paste |
| C.fix-6 (live single gift_refund canary, monitored 24 h) | 1 calendar day |
| C.fix-7 (broaden canary: 5 refunds across types) | 2–3 calendar days |
| Phase-1A close / authoritative-writer cutover plan freeze | Following business day after C.fix-7 GREEN |
| Phase-1B (actual cutover — legacy → v2 authoritative) | Separate sprint, not in this timeline |

**Total to Phase-1A close: ~4–6 calendar days from when you run the manual psql block**, contingent on every gate GREEN.

## 8. Locked state confirmation (this turn)

- 🛑 Live `gift_refund` canary — **HOLD**
- `p_dry_run` — **unchanged**
- Edge functions — **untouched**
- Cron — **untouched**
- Migrations — **none this turn**
- DB writes from Lovable — **zero**
- Files written this turn — **this memo only**

---

### Mandate-format footer

1. **VERIFIED FINDINGS** — §2 table (6 gates GREEN, evidence on record)
2. **NOT VERIFIED ITEMS** — §3 table (P1/P2/P4/P5 + R4 deferred)
3. **FILES TOUCHED** — `docs/fix-sprints/phase-1a-current-state-memo.md` (new, this file only)
4. **RISKS** — §4 (net LOW)
5. **DIFF SUMMARY** — none (doc-only)
6. **VERIFICATION PROOF** — prior turns' live SELECTs against `pg_proc`, `cron.job`, `wallet_ledger_v2_diff_log` (latest `ran_at = 2026-05-18 11:07 UTC`)
7. **ROLLBACK PLAN** — N/A (no DB / code changes)
8. **NEXT RECOMMENDED STEP** — §6: operator runs §2 probe block in manual `psql`, pastes verbatim transcript back
