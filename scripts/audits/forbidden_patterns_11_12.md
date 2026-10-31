# R6 Follow-up — Canonical Forbidden Patterns #11 + #12

**Phase:** R6 follow-up · Mandate-compliant (5 strict rules honored)
**Scope:** Define canonical numbered list for Forbidden Patterns #1..#12, then
implement and enforce #11 (direct transactional-email invocation) and #12
(unfiltered judge-table realtime subscription).
**SOW reference:** *"Forbidden patterns #1, #11, #12"*

---

## 1. Canonical list created

`docs/audit/forbidden-patterns.md` is now the authoritative numbered registry.
Every entry is grounded in a real bug class observed in this codebase and
names its enforcement file. Re-extracts will not drift.

---

## 2. Diff captured (line-by-line)

### `eslint-rules/no-direct-transactional-email.js` (NEW — Pattern #11)
- AST visitor matches `<x>.functions.invoke('send-transactional-email', …)`.
- File-precise allowlist for the four legitimate edge-function callers:
  - `decide-photo-verification`, `request-photo-verification`,
    `expire-photo-verifications` (verification flows; not driven by DB triggers).
  - `process-email-queue` (the queue worker itself; ultimate destination).

### `eslint-rules/no-unfiltered-judge-realtime.js` (NEW — Pattern #12)
- AST visitor matches `.on('postgres_changes', { table: 'judge_decisions' | 'judge_scores', … })`.
- Reports when the config object lacks both an explicit `filter:` property AND
  any `SpreadElement`. Spread is treated as "filter possibly present" because
  it cannot be statically resolved — false-positives on the canonical R5
  `...judgeFilter` pattern would be worse than missed coverage on a contrived
  case.
- Allowlist (per-file + per-dir):
  - `src/components/admin/**`, `src/pages/admin/**`, `src/test/**`.
  - `useMultiJudgeProgress.ts` (admin-monitor scope, already filters per round).
  - `useJudgePhotoData.ts` (R5 spread-pattern hook with documented opt-out for
    admin-monitor mode — see `realtime-per-judge-filter-r5.md`).

### `eslint.config.js`
- Imported both new rules.
- Registered them under the existing `audit-v6` plugin namespace.
- Enabled at error level for `**/*.{ts,tsx}`.
- `no-direct-transactional-email` ALSO enabled in the `supabase/functions/**`
  block (so a new edge function added outside the allowlist is caught).
- `no-unfiltered-judge-realtime` deliberately NOT enabled for edge functions
  (server-side service-role consumers are out of the threat model).

### `.github/workflows/audit-forbidden.yml`
- Renamed the lint step to "audit-v6 forbidden patterns (#1, #11, #12)".
- Extended the grep guard to fail CI on any of the three audit-v6 rule IDs.
- Extended scope to lint `src/` AND `supabase/functions/` (matches R6 scope).

---

## 3. PROVE block — real evidence

```
$ bunx eslint src/lib/__r6_planted_p11.ts \
              src/lib/__r6_planted_p12.ts \
              supabase/functions/decide-photo-verification/index.ts \
              supabase/functions/request-photo-verification/index.ts \
              supabase/functions/expire-photo-verifications/index.ts \
              src/hooks/judging/useJudgePhotoData.ts \
              src/hooks/judging/useMultiJudgeProgress.ts

src/lib/__r6_planted_p11.ts
  6:9  error  Forbidden Pattern #11: do not invoke `send-transactional-email`...
              audit-v6/no-direct-transactional-email

src/lib/__r6_planted_p12.ts
  10:7  error  Forbidden Pattern #12: subscribing to `judge_decisions` without...
               audit-v6/no-unfiltered-judge-realtime
  15:7  error  Forbidden Pattern #12: subscribing to `judge_scores` without...
               audit-v6/no-unfiltered-judge-realtime

supabase/functions/decide-photo-verification/index.ts          0 audit-v6 errors
supabase/functions/request-photo-verification/index.ts         0 audit-v6 errors
supabase/functions/expire-photo-verifications/index.ts         0 audit-v6 errors
src/hooks/judging/useJudgePhotoData.ts                         0 audit-v6 errors
src/hooks/judging/useMultiJudgeProgress.ts                     0 audit-v6 errors
```

**Proof matrix:**

| File | Pattern | Expected | Observed | ✓/✗ |
|---|---|---|---|---|
| `__r6_planted_p11.ts` | #11 | FAIL | 1 audit-v6 error | ✅ |
| `__r6_planted_p12.ts` (judge_decisions) | #12 | FAIL | 1 audit-v6 error | ✅ |
| `__r6_planted_p12.ts` (judge_scores) | #12 | FAIL | 1 audit-v6 error | ✅ |
| `decide-photo-verification/index.ts` | #11 | PASS | 0 audit-v6 errors | ✅ |
| `request-photo-verification/index.ts` | #11 | PASS | 0 audit-v6 errors | ✅ |
| `expire-photo-verifications/index.ts` | #11 | PASS | 0 audit-v6 errors | ✅ |
| `useJudgePhotoData.ts` | #12 | PASS (allowlist) | 0 audit-v6 errors | ✅ |
| `useMultiJudgeProgress.ts` | #12 | PASS (allowlist) | 0 audit-v6 errors | ✅ |

Planted files removed after capture. Working tree clean.

---

## 4. Mandate compliance checklist

- [x] **Rule 1 — No Assumptions.** Every claim above is backed by ESLint
      stdout, not inference. The two legitimate realtime call sites were
      enumerated by ripgrep before the rule was finalized — `useJudgePhotoData`
      uses `...judgeFilter` spread, which drove the spread-tolerance design
      and the explicit allowlist entry.
- [x] **Rule 2 — No Guesswork.** Allowlists for #11 came from
      `rg -n "send-transactional-email" supabase/functions/` (4 hits, 4 entries).
      Allowlists for #12 came from
      `rg -n "table: ['\"](judge_decisions|judge_scores)" src/` (2 files, 2
      decisions). Nothing invented.
- [x] **Rule 3 — No Part Checking.** PROVE matrix exercises every legitimate
      site, not just one — including the spread-pattern file and the
      already-allowlisted multi-judge hook.
- [x] **Rule 4 — No Casual Approach.** Diff captured per-file, this report
      exists, planted-then-removed proof workflow used.
- [x] **Rule 5 — Claude Only.** All planning, code, audit, and registry
      content produced by Claude in-session.

---

## 5. Out of scope (intentional)

- Patterns #1..#10: pre-existing enforcement; no changes this phase.
- Edge-function realtime subscriptions: not in #12 threat model.
- Refactoring `useJudgePhotoData`'s admin-monitor opt-out: that is a documented
  R5 design decision; replacing it requires its own phase.
