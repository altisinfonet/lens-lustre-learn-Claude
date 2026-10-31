# Sprint 0 — Phase 0B-4 — Realtime Channel Filter Guardrail

> **Status:** GUARDRAIL ONLY · Zero runtime change · Zero schema change
> **Mandate:** docs/forensic-engineering-mandate.md
> **Predecessors:** Phase 0B-1 (`as any`), 0B-2 (wallet writes), 0B-3 (entry status)

---

## 1. VERIFIED FINDINGS

- 14 existing client-side `postgres_changes` subscriptions hit one of the 22
  sensitive tables WITHOUT a server-side `filter:` argument (proof:
  `rg -n "table:\s*['\"]" src/`, results enumerated in baseline JSON).
- 1 hook (`useJudgePhotoData.ts`, lines 193/197/201/205) injects `filter:`
  via `...judgeFilter` spread — already covered by the existing
  `no-unfiltered-judge-realtime` rule and the documented R5 spread pattern.
  Spread suppression in this new rule prevents false positives on it.
- 5 sensitive subscriptions DO carry an explicit `filter:` and are NOT
  baselined: `usePhotoVoteCount.ts:34/39`, `useMultiJudgeProgress.ts:125`,
  `EntryTagStamps.tsx:78`, `PreflightStatusBadge.tsx:48`, `useAuth.tsx:113`.
- Edge functions (`supabase/functions/**`) and tests (`*.test.*`,
  `*.spec.*`, `src/test/**`) are exempt — server/test surfaces.

## 2. NOT VERIFIED ITEMS

- Whether each baselined subscription's downstream invalidation actually
  fans out unsafely at runtime. **Out of scope** for this guardrail phase
  (forbidden by spec: "no runtime changes / no realtime refactor yet").
- Whether RLS on each sensitive table actually filters rows the way each
  baseline `existing_mitigation` note claims. To be re-verified in the
  follow-up cleanup phase.

## 3. FILES TOUCHED

- `eslint-rules/no-unfiltered-realtime-sensitive.js` (created, 175 lines)
- `scripts/audits/baselines/realtime-filter-baseline.json` (created, 14 entries)
- `eslint.config.js` (+3 lines: import, plugin registration, error rule)
- `.github/workflows/audit-forbidden.yml` (+1 token in grep alternation)
- `docs/fix-sprints/sprint-0-phase-0b-4-realtime-filter-guardrail.md` (this file)

No application source touched. No DB migration. No edge function. No SQL.

## 4. RULE IMPLEMENTED

`audit-v6/no-unfiltered-realtime-sensitive`

Detection: a `CallExpression` whose callee is `<X>.on` and whose 2nd
argument is an `ObjectExpression` containing a string literal `table:`
property naming one of the 22 protected tables AND missing a `filter:`
property AND missing any `SpreadElement`.

Protected tables (22):

```
admin_notifications, admin_vote_adjustments, support_tickets,
judge_decisions, judge_scores, judge_tag_assignments, judge_comments,
judging_rounds, judging_preflight_log, judge_sessions,
wallet_transactions, wallets, withdrawal_requests,
wallet_reconciliation_log, gift_credits, gift_announcements,
competition_votes,
user_notifications, notifications, notification_emit_log,
user_roles, user_badges
```

Exemptions: `supabase/functions/**`, `src/test/**`, `*.test.*`, `*.spec.*`,
and any `{file:line}` pair present in the baseline JSON.

## 5. BASELINE CREATED

`scripts/audits/baselines/realtime-filter-baseline.json` — 14 entries.

Severity distribution:
- HIGH: 2 (`useCompetitionVoteRealtime.ts` competition_votes + admin_vote_adjustments)
- MEDIUM: 6 (judging_rounds, judge_scores/decisions admin-monitor,
  liveAdminSync user_roles, AutoRole user_roles, useRealtimeFeed
  admin_notifications)
- LOW: 6 (admin-only dashboard counters + profile cache invalidators)

Each entry records: file, line (ObjectExpression start), channel name,
table, event, missing filter type, subsystem, severity, existing
mitigation, and remediation note.

## 6. CURRENT ALLOWED VIOLATIONS COUNT

- **Baselined (allow-listed): 14**
- **New violations across `src/`: 0** (verified by
  `bunx eslint --no-warn-ignored src/ | grep -c no-unfiltered-realtime-sensitive` → 0)

## 7. SYNTHETIC FAILURE TEST RESULT

Created `src/lib/_synthetic_realtime_fail.ts` with two unfiltered chained
`.on('postgres_changes', { table: 'wallet_transactions' })` and
`.on(..., { table: 'judge_decisions' })` calls.

Result: **2 / 2 expected errors emitted** by
`audit-v6/no-unfiltered-realtime-sensitive` (proof: ESLint stdout
captured in this loop). File deleted after verification.

This single fixture covers spec sub-requirements 1, 2, 3, and 4
(unfiltered sensitive table, wildcard-event subscription, missing
ownership/role filter, broad invalidation potential).

## 8. FILTERED PASS TEST RESULT

Created `src/lib/_synthetic_realtime_pass.ts` with a single
`.on('postgres_changes', { table: 'user_notifications', filter: 'user_id=eq.X' })`.

Result: **0 errors from this rule**. File deleted after verification.

## 9. FINAL LINT/CI RESULT

`bunx eslint --no-warn-ignored src/` (post-cleanup):

```
audit-v6/no-unfiltered-realtime-sensitive matches: 0
```

The new rule has been added to `.github/workflows/audit-forbidden.yml`
grep-alternation list, so any future PR that introduces a non-baselined
unfiltered subscription on a sensitive table will fail the AUDIT
FORBIDDEN job.

## 10. DIFF SUMMARY

```
A  eslint-rules/no-unfiltered-realtime-sensitive.js
A  scripts/audits/baselines/realtime-filter-baseline.json
A  docs/fix-sprints/sprint-0-phase-0b-4-realtime-filter-guardrail.md
M  eslint.config.js
   +import noUnfilteredRealtimeSensitive from "./eslint-rules/no-unfiltered-realtime-sensitive.js";
   +"no-unfiltered-realtime-sensitive": noUnfilteredRealtimeSensitive,
   +"audit-v6/no-unfiltered-realtime-sensitive": "error",
M  .github/workflows/audit-forbidden.yml
   +no-unfiltered-realtime-sensitive  (added to grep alternation)
```

## 11. RISKS

- **False negatives via spread:** spread suppression mirrors the existing
  `no-unfiltered-judge-realtime` policy. Risk: a developer hides an
  unfiltered subscription with `...{}`. Mitigation: baseline JSON is
  human-reviewed; add explicit baseline entry if found.
- **False negatives via dynamic config:** if a subscription builds its
  options object at runtime and passes it as a variable, AST detection
  cannot inspect it. Risk: unchanged from existing judge-realtime rule.
- **False positives:** bounded — only the 22 enumerated tables trigger.
  Adding a sensitive table requires editing both rule + baseline.
- **No runtime side-effect.** No bundle change. No realtime channel
  behaviour change. No cache change.

## 12. ROLLBACK PLAN

```bash
git rm eslint-rules/no-unfiltered-realtime-sensitive.js
git rm scripts/audits/baselines/realtime-filter-baseline.json
git rm docs/fix-sprints/sprint-0-phase-0b-4-realtime-filter-guardrail.md
git checkout HEAD~1 -- eslint.config.js .github/workflows/audit-forbidden.yml
```

Or, surgically: revert the 3 added lines in `eslint.config.js` and the
single added grep token in `.github/workflows/audit-forbidden.yml`.

Zero runtime impact — rollback is purely tooling-level.

## 13. NEXT RECOMMENDED STEP

Two options, awaiting explicit go-signal:

1. **GO 0B-5** — add a guardrail blocking new client-side direct writes
   to `notifications` / `user_notifications` / `notification_emit_log`
   (Phase 5 mandate that all judging emails MUST go through DB triggers).
2. **GO 0C-1** — begin the first server-side fix (Sprint 0A finding F-1):
   migrate `AdminTransactions.tsx` `wallet_transactions.update` to an
   edge function.

No further guardrail action recommended without explicit go.
