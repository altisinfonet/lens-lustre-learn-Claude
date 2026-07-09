<!--
  Phase R6 — Rule 1: PROVE BEFORE PATCH
  -------------------------------------
  If this PR touches ANY judging surface (src/hooks/judging/**, src/pages/Judge*.tsx,
  src/pages/judging/**, supabase/functions/* judging fns, judging migrations, etc.),
  the PROVE block below is MANDATORY. The `prove-block-required` GitHub Action
  will fail CI when a judging diff is missing the marker or any required field.

  Non-judging PRs may delete the PROVE block entirely.
-->

## Summary

<!-- 1–3 sentences describing intent. -->

## Scope

- [ ] Touches judging code (hooks/pages/edge functions/migrations under judging surfaces)
- [ ] Touches non-judging code only

---

<!-- BEGIN PROVE BLOCK — required for judging diffs. Delete entirely for non-judging PRs. -->

## PROVE

> Mandate Rule 1 — *Prove before patch.* Every claim below must be backed by a SQL
> row, edge fn response, or screenshot. Inference is forbidden.

### 1. SOW citation
<!-- Quote the SOW line(s) this change satisfies. Paste exact text + section. -->

### 2. Failing case (before)
<!-- SQL row, edge fn response, console log, or screenshot showing the bug live. -->
```
<!-- paste row / response / log here -->
```

### 3. Fix (line-by-line diff captured)
<!-- Brief explanation of what changed and why it is the root cause, not a symptom. -->

### 4. Passing case (after)
<!-- SQL row, edge fn response, or screenshot proving the fix on real data. -->
```
<!-- paste row / response / log here -->
```

### 5. Forensic audit checklist
- [ ] Ran full audit (no item skipped)
- [ ] Verified RLS unchanged or tightened
- [ ] Verified no raw `entry.status` / `placement` / `progression_decision` reads in UI
- [ ] Verified notification path (DB trigger only, no client `send-transactional-email`)
- [ ] Verified phase logic via `current_phase` RPC parity (if phase-related)
- [ ] Tests added or updated, and `bunx vitest run` is green locally

### 6. Author attestation
- [ ] All planning, code, and audit content above was produced by Claude (Rule 5).

<!-- END PROVE BLOCK -->
