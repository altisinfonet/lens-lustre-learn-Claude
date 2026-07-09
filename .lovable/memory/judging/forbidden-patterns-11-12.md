---
name: Forbidden Patterns canonical registry + #11/#12 enforcement
description: docs/audit/forbidden-patterns.md is the numbered source of truth; #11 blocks direct send-transactional-email invocations, #12 blocks unfiltered judge_decisions/judge_scores realtime subscriptions
type: constraint
---
**Rule:** `docs/audit/forbidden-patterns.md` is the canonical numbered list of Forbidden Patterns #1..#12. Any SOW that says "Forbidden patterns #N" resolves against this file — never re-derive from memory.

**#11 — Direct `send-transactional-email` invocation.** Enforced by `eslint-rules/no-direct-transactional-email.js` (rule id `audit-v6/no-direct-transactional-email`). Rule scope: `src/**` AND `supabase/functions/**`. Allowlisted callers:
- `supabase/functions/decide-photo-verification/index.ts`
- `supabase/functions/request-photo-verification/index.ts`
- `supabase/functions/expire-photo-verifications/index.ts`
- `supabase/functions/process-email-queue/index.ts`

UI invocation is always a violation. Use `emit_notification()` DB function via triggers.

**#12 — Unfiltered judge-table realtime.** Enforced by `eslint-rules/no-unfiltered-judge-realtime.js` (rule id `audit-v6/no-unfiltered-judge-realtime`). Rule scope: `src/**` only (edge functions excluded). Triggers on `.on('postgres_changes', { table: 'judge_decisions' | 'judge_scores', … })` when the config object has no `filter:` property AND no `SpreadElement`. Spread suppresses the warning (canonical `...judgeFilter` pattern). Allowlist: `src/components/admin/**`, `src/pages/admin/**`, `src/test/**`, `useMultiJudgeProgress.ts`, `useJudgePhotoData.ts` (R5 documented opt-out).

**Why:** #11 prevents bypassing `notification_emit_log` idempotency (Phase 1/4 bug class). #12 prevents cross-judge realtime leaks and collusion vectors (Phase 6/K bug class).

**How to apply:** When adding a new email path, route through `emit_notification()`. When adding a realtime subscription on judge tables, always pass `filter: 'judge_id=eq.' + currentJudgeId` (or use the spread pattern). Never widen allowlists casually — every entry needs a one-line justification and a follow-up note in this memory.

**CI gate:** `.github/workflows/audit-forbidden.yml` greps for any of the three `audit-v6/*` rule IDs and fails the build.

**Proof:** `scripts/audits/forbidden_patterns_11_12.md` (planted-then-removed).
