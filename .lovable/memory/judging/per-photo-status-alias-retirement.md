---
name: per-photo-status-alias-retirement
description: Why buildPhotoStatusMaps still rewrites 2 R2/R3 canonical keys to legacy aliases and what is required to delete those last arms
type: constraint
---
## Status (Phase 5 closure, 2026-05-02)

`buildPhotoStatusMaps` in `src/hooks/judging/usePhotoDecisions.ts` retains exactly 2 alias rewrite arms:

```ts
status === "r2_qualified_r3"   ? "round2_qualified"
  : status === "r3_qualified_final" ? "finalist"
  : status;
```

Dead arms (`r2_not_selected → round2_not_selected`, `r3_not_selected → round3_not_selected`) were deleted in Phase 5 — proven dead by reading `pg_get_functiondef('public.get_per_photo_consensus(uuid[])')` on 2026-05-02; the live RPC's CASE statement never emits those keys.

## Why the remaining 2 arms cannot be deleted yet

The rewriter is a load-bearing back-compat shim. Seven consumers literally string-compare on `"round2_qualified"` and/or `"finalist"`:

| Consumer | File | Line(s) |
|---|---|---|
| Result banner | `src/components/competition/PersonalResultBanner.tsx` | 54 |
| Stage badge | `src/components/judge/ParticipantStageBadge.tsx` | 106, 110, 111 |
| Dashboard filter chips | `src/pages/Dashboard.tsx` | 732, 789 |
| Admin funnel | `src/components/admin/AdminCompetitionFunnel.tsx` | 13 |
| Admin rounds | `src/components/admin/AdminCompetitionRounds.tsx` | 79 |
| Comp detail status filter | `src/hooks/competition/useCompetitionDetail.ts` | 72, 134 |
| Submission detail RPC-advanced check | `src/pages/SubmissionDetail.tsx` | 582, 586 |

Plus: `LegacyPerPhotoStatus` in `src/lib/judging/perPhotoStatusTypes.ts` keeps these strings in the union because `SubmissionDetail.tsx:557` types `PHOTO_STATUS_WHITELIST` as `ReadonlySet<PerPhotoStatus>` containing `"submitted"`, `"round1_qualified"`, `"shortlisted"`, `"round2_qualified"`, `"finalist"`, `"winner"`, `"rejected"`, `"needs_review"`. Removing any one of those without first migrating SubmissionDetail breaks `tsc`.

## Required migration to delete the 2 arms

1. Rewrite the 7 consumers to switch on canonical keys (`r2_qualified_r3`, `r3_qualified_final`) — or, better, to render via `participantWordingForStageKey()` and stop hard-coding any string.
2. Replace the `PHOTO_STATUS_WHITELIST` in `SubmissionDetail.tsx` with a stage-key whitelist.
3. Update `competition_entries.status` filter `.in("status", […])` arrays in `useCompetitionDetail` to canonical strings (or accept both during a migration window).
4. Then delete the 2 rewrite arms and shrink `LegacyPerPhotoStatus` to just `"winner" | "finalist"` (the only 2 still emitted by the consensus RPC's R4 CASE).
5. Then re-architect the consensus RPC to emit `r4_winner`/`r4_finalist` instead of `winner`/`finalist`, after which `LegacyPerPhotoStatus` can be deleted entirely and `participantStageLabels.ts` can collapse to a thin re-exporter.

## Regression lock

`src/test/build-photo-status-maps-invariant.spec.ts` pins the current rewriter shape: the 2 LIVE arms are asserted to fire, and the 2 DEAD arms are asserted to NOT fire. Any future PR that touches the rewriter must update this spec in the same change.
