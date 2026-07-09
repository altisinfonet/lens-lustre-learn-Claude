# Forbidden Patterns — Canonical Numbered List

> **Status:** Authoritative. This file is the single source of truth for the
> "Forbidden patterns #N" references in the SOW and audit phases. All numbered
> patterns below are mechanically enforced — by ESLint, vitest, or both — and
> wired into the `AUDIT FORBIDDEN` GitHub Actions job.
>
> **Mandate Rule 2 ("No Guesswork") cite:** Every pattern below is grounded in
> a real bug class observed in this codebase, with the enforcement file named.

---

## How enforcement maps

| #  | Pattern (forbidden) | Enforcement                                              |
|----|--------------------|----------------------------------------------------------|
| 1  | Raw `entry.status` / `entry.placement` / `entry.progression_decision` read in UI | `eslint-rules/no-raw-entry-status.js` |
| 2  | Phase-gating UI without a `competition.phase` watermark | `eslint-rules/require-phase-watermark.js` |
| 3  | Dropping or renaming one of the 9 judging email templates | `src/test/notifications.spec.ts` |
| 4  | Stripping the idempotency guard from `backfill_judging_notifications` | `src/test/notifications.spec.ts` |
| 5  | UI computes its own per-photo aggregation instead of using the materialized view / RPC | `src/test/judging-invariants.test.ts` (covered by parity check) |
| 6  | Closing a round before 100% judge×photo coverage | `complete-round` edge function (DB-side gate) |
| 7  | Reading `judge_decisions.judge_id` / `judge_scores.judge_id` in participant-facing UI without anonymizer | `src/lib/judgeAnonymizer.ts` is the only legal exit point (see judge-privacy memory) |
| 8  | Bypassing `useGatedEntryStatus` to derive a publish-aware label | `eslint-rules/no-raw-entry-status.js` (covers the underlying read) |
| 9  | Calling the legacy `send-judging-email` edge function from anywhere | `src/test/notifications.spec.ts` |
| 10 | Writing CHECK constraints with non-immutable expressions (e.g. `now()`) | Reviewed at migration time — see `.lovable/memory/judging/...` constraint guidance |
| **11** | **Direct invocation of `send-transactional-email` from UI code OR from any edge function not on the audited allowlist** | `eslint-rules/no-direct-transactional-email.js` + `src/test/notifications.spec.ts` |
| **12** | **Subscribing to `judge_decisions` or `judge_scores` realtime events without a server-side `filter:` argument scoping rows to the current judge or admin context** | `eslint-rules/no-unfiltered-judge-realtime.js` |

---

## Detailed definitions

### #1 — Raw entry status read in UI
Reading `entry.status`, `entry.placement`, or `entry.progression_decision`
directly in user-facing components leaks unpublished round outcomes (rejected,
shortlisted, winner) before the admin clicks "Publish Round N".
**Use:** `useGatedEntryStatus` → `resolveDisplayStatus` / `gatedStatusLabel`.
**Allowlist:** see `eslint-rules/no-raw-entry-status.js`.

### #2 — Missing phase watermark
Any UI that conditionally renders judging/voting controls must be downstream of
a `phase` value derived from `public.current_phase(competition_id)`.
**Enforced by:** `competition-watermark/require-phase-watermark`.

### #3 — Email template registry drift
The 9 transactional judging templates listed in
`src/test/notifications.spec.ts::EXPECTED_TEMPLATES` must remain registered,
renderable, and ship `previewData`.

### #4 — Backfill idempotency guard removed
Any rewrite of `backfill_judging_notifications` or
`backfill_stuck_verifications` that drops the `notification_emit_log`
NOT-EXISTS check fails the regression test of the same name.

### #5 — Local re-aggregation of per-photo decisions
UI must read aggregated decisions through the canonical view / RPC, never by
re-counting `judge_decisions` rows client-side. Local aggregation desyncs from
the server-authoritative majority-vote logic.

### #6 — Round closure without 100% coverage
The `complete-round` edge function blocks closure until every assigned judge
has decided every eligible photo. Removing that gate is forbidden.

### #7 — Judge identity disclosure
`judge_decisions.judge_id` and `judge_scores.judge_id` must never reach a
participant-facing render path without going through `judgeAnonymizer`.

### #8 — Hand-rolled publish-aware status
Even one component computing "is this row safe to show as `winner`?" outside
`useGatedEntryStatus` is a #1 in disguise.

### #9 — Legacy `send-judging-email` invocation
The `send-judging-email` function was retired. Any new caller (UI or edge) is
forbidden — DB triggers + `emit_notification()` are the sole pathway.

### #10 — Non-immutable CHECK constraints
Postgres requires CHECK predicates to be immutable. Validations like
`expire_at > now()` must be expressed as triggers, not CHECKs, or restoration
fails.

### #11 — Direct `send-transactional-email` invocation (NEW)
**Forbidden:** any code that calls `supabase.functions.invoke('send-transactional-email', …)`
or `admin.functions.invoke('send-transactional-email', …)` outside the audited
allowlist.

**Why it matters:** the `emit_notification()` DB function is the single
sanctioned funnel for judging lifecycle emails. Direct invocations bypass the
`notification_emit_log` idempotency table — exactly the bug class fixed in
Phase 1 / Phase 4.

**Audited allowlist (`eslint-rules/no-direct-transactional-email.js`):**
- `supabase/functions/decide-photo-verification/index.ts` — verification
  decision side-effects (Phase G, not driven by a DB trigger).
- `supabase/functions/request-photo-verification/index.ts` — initial
  verification request side-effects.
- `supabase/functions/expire-photo-verifications/index.ts` — cron sweep that
  notifies on auto-expiry; cannot be a DB trigger because the source-of-truth
  expiry is time-based.
- `supabase/functions/process-email-queue/**` — the queue worker itself; it is
  the ultimate destination, not a bypass.

**UI allowlist:** none. UI invocation is always a #11.

### #12 — Unfiltered judge-table realtime subscription (NEW)
**Forbidden:** any `supabase.channel(...).on('postgres_changes', { table:
'judge_decisions' | 'judge_scores', … })` call where the config object does
**not** include a `filter:` key.

**Why it matters:** without a server-side filter (e.g.
`filter: judge_id=eq.${currentJudgeId}`), every connected judge receives every
other judge's live decisions. That is both a privacy leak (judge identity +
score, see Phase 6 / `judge-privacy-phase2` memory) and a collusion vector
(Phase K detector exists precisely because this happened once).

**Allowlisted readers (server-truth admin contexts only):**
- `src/components/admin/**`
- `src/pages/admin/**`
- `src/hooks/judging/useMultiJudgeProgress.ts` — already filters per-round
  server-side and is admin-monitor scope.
- Test files (`src/test/**`).

Everywhere else, the `filter:` argument is mandatory whenever the table is
`judge_decisions` or `judge_scores`.

---

## Adding a new pattern

1. Document it here with a number, definition, and enforcement target.
2. Add the rule (lint, test, or DB) referenced in the table.
3. Add a forensic audit under `scripts/audits/` proving the rule fires
   (planted-then-removed evidence).
4. Update `.lovable/memory/judging/` with a constraint memory.
5. Wire it into `.github/workflows/audit-forbidden.yml` if not already covered.
