# Step 4 — Rebuild Recommendation

**Project:** 50mm Retina World
**Date:** 2026-05-12
**Author:** Forensic rebuild audit (Lovable agent)
**Inputs:** Step 1 (routes), Step 2A–2J (subsystems), Step 3 (risk register, 65 findings).

---

## 0. TL;DR

> **Do NOT do a full from-scratch rewrite. Execute a phased, in-place “strangler” hardening over ~10–14 weeks, with one optional surgical re-skin of the judging surface.**

The current codebase is large (≈900 source files, 271 component files, 80+ hooks, ~35 edge functions, ~120 tables) but **architecturally sound in its core invariants** (UTC truth, soft-delete, RLS-first, single QueryClient, gated status reader, per-judge realtime filter, atomic wallet RPC for votes). The 65 risks in Step 3 are **localized**, not systemic. A rewrite would re-introduce regressions in domains that took 18+ months and dozens of audited migrations to stabilize (judging consensus, wallet reconciliation, notification backbone, RLS).

The cheapest path to “rebuild-grade quality” is to **freeze the contracts** documented in Step 2A–2J and refactor inside them.

---

## 1. Decision Matrix

| Option | Cost | Risk | Time-to-parity | Recommendation |
|--------|------|------|----------------|----------------|
| **A. Full rewrite (greenfield)** | ~$$$$ | Very High — re-derive 18 mo. of judging/wallet invariants | 6–9 mo. | ❌ Reject |
| **B. Fork & re-skin UI only** | ~$$ | Medium — design drift, dual-maintenance | 2–3 mo. | ⚠ Only if brand demands it |
| **C. In-place phased hardening (strangler)** | ~$$ | Low — incremental, reversible | 10–14 wk. | ✅ **Recommended** |
| **D. Status quo + bug-fix only** | $ | High — P0 wallet/judging risks unmitigated | n/a | ❌ Reject |

**Chosen path: C**, with an optional **B-lite** (re-skin of `/judge/*` + `/feed` only) in Phase 4.

---

## 2. Why NOT a full rewrite

1. **Invariant density.** Step 2B + Step 2H document ~40 hard invariants (Frozen Contract v3, NR-only-in-R1, 100% coverage gate, |adj|≤1000, decision token aliases, declared-vs-locked, etc.). Each one was paid for in production incidents. A rewrite restarts that meter.
2. **RLS surface.** ~120 tables with bespoke policies, 8 SECURITY DEFINER helpers, dynamic-trigger validation against `v3_stage_catalog`. Re-deriving these correctly is a multi-month security project on its own.
3. **Notification backbone (Phase 1–5).** DB triggers are now the *only* legal email path, regression-locked by `audit-forbidden.yml` + `notifications.spec.ts`. Throwing this away forfeits a CI-enforced safety net.
4. **Judging realtime + Cinema Mode.** 422-LOC `useJudgePhotoData` is ugly but battle-tested across 4 rounds × N competitions. Rewriting it without the same telemetry is reckless.
5. **Cost asymmetry.** The 65 Step 3 findings cluster heavily in **5 modules** (wallet, judging RPC layer, current_round typing, realtime filters, type generation). Fixing 5 modules ≪ rewriting 900 files.

---

## 3. Why NOT status quo

P0 risks from Step 3 are real and unmitigated:
- Wallet double-debit window (`useWalletWithdrawals` + `admin-process-withdrawal`).
- `current_round TEXT` with mixed `'round2' | 'r3' | '4'` formats — one bad regex away from a trigger crash.
- Direct `INSERT` allowed on `wallet_transactions`.
- `as any` cast on `bank_details` / `referrals` / financial hooks defeats type safety exactly where it matters most.
- Dual-emit `status` + `status_legacy` is a foot-gun for any new consumer.

These are the rebuild justification. Address them in Phase 1.

---

## 4. Recommended Path — Phased In-Place Hardening

```text
Phase 0  Freeze & Guardrails        (1 wk)
Phase 1  P0 Financial + Schema      (3 wk)   ← non-negotiable
Phase 2  Type Safety + RLS Lockdown (2 wk)
Phase 3  Realtime + Cache Hygiene   (2 wk)
Phase 4  UI Consolidation (opt re-skin) (3 wk)
Phase 5  Observability + DX         (2 wk)
Phase 6  Decommission Legacy        (1 wk)
                              Total ≈ 14 wk
```

### Phase 0 — Freeze & Guardrails (Week 1)

**Goal:** stop the bleeding, lock contracts.
- Adopt Step 2A–2J as **Frozen Contract v4**; any PR that violates them requires explicit ADR.
- Extend `audit-forbidden.yml` to block: raw `entry.status`, raw `wallet_transactions` insert, raw `send-transactional-email` invoke, `as any` on financial tables.
- Enable `prove-block-required.yml` for ALL P0 surfaces (wallet + judging + RLS migrations), not just judging.
- Snapshot prod DB + storage; create disaster-recovery rehearsal doc.

**Deliverable:** `docs/contracts/frozen-v4.md`, expanded CI gates.

### Phase 1 — P0 Financial & Schema (Weeks 2–4)

**Goal:** eliminate every P0 in Step 3.

1. **Unify wallet ledger.** One RPC: `wallet_transaction(user_id, kind, amount, ref, idempotency_key)`. Revoke `INSERT` on `wallet_transactions` from authenticated. Migrate `useWalletWithdrawals` + `admin-process-withdrawal` + every credit path to it. Add reconciliation cron.
2. **`current_round` migration.** Add `current_round_int smallint`, dual-write for 1 release, swap readers, drop text column. Update `mirror_system_tag_to_decision`, `complete-round`, `entry_public_status` view.
3. **Drop `status_legacy` dual-emit.** Confirm zero consumers via grep + DB log; remove from `get_per_photo_consensus`.
4. **`current_round`-style audit on every TEXT-as-enum column** (`progression_decision`, `kind`, etc.) — convert to enum or constrain via dynamic trigger only.
5. **Idempotency keys** on every edge function that writes to wallet/notifications/competition_entries.

**Exit criteria:** Step 3 P0 list is empty; reconciliation report shows 0 drift for 7 consecutive days.

### Phase 2 — Type Safety + RLS Lockdown (Weeks 5–6)

1. Regenerate `src/integrations/supabase/types.ts`; eliminate every `as any` on financial + judging tables. Land an ESLint rule that bans `as any` in `src/hooks/wallet/**` and `src/hooks/judging/**`.
2. RLS audit pass: every table touched in Step 2H verified via `supabase--linter`; remove direct `service_role` reliance from `manage-notifications`, switch to per-user JWT + RPC.
3. Privacy gate sweep: verify `indexing_disabled`, judge anonymization, voting-phase engagement hiding all still hold post-refactor (regression tests).

### Phase 3 — Realtime + Cache Hygiene (Weeks 7–8)

1. Add server-side filters to `feed-live` (per-followed-author or per-competition), `live-admin-sync` (admin role gate).
2. Consolidate `AutoRole` in-memory cache into React Query (`profileMapCache`) — single source.
3. Audit every `queryClient.invalidateQueries` call site for over-broad keys; tighten via `queryKeys.ts`.
4. Add bandwidth metrics on each realtime channel; alert on >X msg/min/user.

### Phase 4 — UI Consolidation (Weeks 9–11) — **optional re-skin window**

1. Fix `--font-body` → Inter; remove `!important` from `.container`; lint raw color classes (`bg-blue-500` etc.).
2. Extract layout primitives shared by 90 admin components (`<AdminPage>`, `<AdminTable>`, `<AdminToolbar>`).
3. Split `useJudgePhotoData` (422 LOC) into: data-fetch, decision-aggregator, realtime-subscriber, persistence.
4. **Optional re-skin** (only if brand requested): regenerate `/judge/*` Cinema Mode + `/feed` post card via design directions; keep all hooks/contracts intact.
5. Add Storybook + visual regression for top 30 components.

### Phase 5 — Observability + DX (Weeks 12–13)

1. Structured logging on all edge functions (request id + user id + outcome).
2. Dashboards: judging coverage gate, wallet drift, notification queue depth, email bounce rate (surface Brevo webhook data).
3. Dev onboarding doc generated from Step 2A–2J.
4. Migrate `/admin/health` widgets to a single `system_health` RPC (currently N round-trips).

### Phase 6 — Decommission Legacy (Week 14)

- Drop deprecated tables/views/functions flagged in Step 2H (anything with `_legacy`, `_v2`, `_old`).
- Delete dead routes from Step 1.
- Final security scan + RLS lint + bundle audit.

---

## 5. What to Keep As-Is

These subsystems are production-grade; **do not touch beyond the P0 fixes above**:

| Subsystem | Why keep |
|-----------|----------|
| Notification backbone (Phase 1–5) | DB-trigger-only path, CI-locked, JIT render works |
| `cast-photo-vote` RPC + `entry_final_votes` view | Atomic, capped, audited |
| Frozen Contract v3 stage keys | Just stabilized; Phase 1 only drops `status_legacy` mirror |
| `useGatedEntryStatus` + ESLint enforcement | Single source of UI truth — keystone |
| Per-judge realtime filter (R5) | Privacy invariant; CI-proven |
| `dashboardInitGate` + `dashboard-init` edge fn | Eliminates N+1; expensive to redesign |
| WebP-only image pipeline + Canvas JPEG fallback | Storage cost optimal |
| Brevo email integration | Working; webhook is the only enhancement needed |
| Forensic Mandate + PROVE block CI | Cultural keystone — keep enforcing |

---

## 6. What to Rebuild In-Place (not from scratch)

| Module | Action | Phase |
|--------|--------|-------|
| `useWalletWithdrawals` + admin withdrawal fn | Replace with single RPC | 1 |
| `current_round` text column | Migrate to `smallint` | 1 |
| `wallet_transactions` write path | Revoke direct insert | 1 |
| `manage-notifications` edge fn | Switch off ANON key | 2 |
| `useJudgePhotoData` | Split into 4 hooks | 4 |
| 90 admin components | Extract 3 primitives | 4 |
| `feed-live` / `live-admin-sync` channels | Add server filters | 3 |
| `AutoRole` cache | Merge into React Query | 3 |
| Type generation | Re-pin + lint `as any` | 2 |
| `--font-body` + container CSS | Fix tokens | 4 |

---

## 7. Cost / Effort Estimate

| Phase | Eng-weeks (1 senior FS + 1 DB/security) | External cost |
|-------|------------------------------------------|---------------|
| 0 | 1 | — |
| 1 | 6 | DB review (1 wk consultant) |
| 2 | 4 | Security review (1 wk consultant) |
| 3 | 4 | — |
| 4 | 6 | Optional design sprint (1 wk) |
| 5 | 4 | Observability stack subscription |
| 6 | 2 | — |
| **Total** | **~27 eng-weeks** | ~3 consultant-weeks |

Compare: a full rewrite estimate is **80–120 eng-weeks** before reaching feature parity with judging + wallet + notifications, with materially higher regression risk.

---

## 8. Success Criteria (Phase exit gates)

- [ ] Step 3 P0 list = 0 (Phase 1)
- [ ] `as any` count in `src/hooks/wallet/**` + `src/hooks/judging/**` = 0 (Phase 2)
- [ ] All realtime channels have server-side filters or documented exception (Phase 3)
- [ ] Lighthouse mobile ≥ 85 on `/feed`, `/competitions`, `/judge` (Phase 4)
- [ ] p95 wallet RPC < 200 ms; notification queue depth < 50 sustained (Phase 5)
- [ ] Zero `_legacy` symbols remain in code or DB (Phase 6)

---

## 9. Risks of the Plan Itself

| Risk | Mitigation |
|------|------------|
| Phase 1 wallet RPC migration races live withdrawals | Dual-write + shadow-read for 1 week before cutover |
| `current_round` migration breaks judging mid-round | Run during Round 4 declared period (no active judging) |
| Re-skin scope creep in Phase 4 | Hard freeze on hooks/contracts; design-only PRs |
| CI gate fatigue | Group new gates into one `prove-v4.yml`; monthly review |

---

## 10. Final Recommendation

**Proceed with Path C (in-place phased hardening).**
**Do not greenfield rewrite.**
**Treat Step 2A–2J as Frozen Contract v4.**
**Spend the rewrite budget on Phase 1 + Phase 2 instead — that buys 80% of the rewrite’s quality at 25% of the cost and 0% of the regression risk.**

The codebase is not a liability. It is a 18-month-old, audit-hardened, contract-locked production system whose remaining defects are localized, named, and fixable. Rebuild *the weak modules*, not *the project*.

— End of Step 4 / End of Rebuild Blueprint —
