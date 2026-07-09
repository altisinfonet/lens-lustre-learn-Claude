---
name: J-05 Active Assignment badge audit
description: The "Active Assignment" pill is already correctly gated on phase='judging' in CinemaDashboard. No code change needed.
type: feature
---

# J-05 — Active Assignment badge gating (no-op)

**Audited**: 2026-04-23
**Outcome**: No code change. Existing gate is correct.

## Single render site

`src/components/judge/CinemaDashboard.tsx:244-253`

```tsx
<span className={`... ${
  heroComp.phase === "judging"
    ? "bg-primary text-primary-foreground"
    : "bg-muted/40 text-muted-foreground border border-border/60"
}`}>
  {heroComp.phase === "judging" ? "Active Assignment" : "Awaiting Judging"}
</span>
```

The label `"Active Assignment"` is rendered **only** when `heroComp.phase === "judging"`.
For all other phases (`submission_open`, `voting`, `result`) the muted fallback
`"Awaiting Judging"` is shown instead.

## Audit scope confirmed

Searched the entire codebase for `Active Assignment` — exactly one render site
(the one above). No leak elsewhere.

## Deferred (not in J-05 scope)

These are *separate* potential refinements and were explicitly deferred by the
user when J-05 was closed:

- The "Awaiting Judging" fallback copy could be split per phase
  (`Submissions Open` / `Public Voting` / `Judging Closed`).
- The `phase === 'judging'` gate could be tightened with
  `currentRound?.status === 'active'` to avoid showing "Active Assignment"
  between rounds.

If either becomes a real bug, open a new ticket — do not re-litigate J-05.
