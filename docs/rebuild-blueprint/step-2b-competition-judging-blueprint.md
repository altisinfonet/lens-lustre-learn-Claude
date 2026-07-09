# STEP 2B — COMPETITION / SUBMISSION / ENTRY / JUDGING BLUEPRINT

**Strict mode.** All facts below were directly read from the listed files. Items not present in the inspected files are explicitly marked **NOT VERIFIED**.

**Inspected source files:**
- `src/pages/Competitions.tsx` (184 LOC)
- `src/pages/CompetitionDetail.tsx` (461 LOC)
- `src/pages/CompetitionSubmit.tsx` (710 LOC)
- `src/pages/SubmissionDetail.tsx` (877 LOC)
- `src/pages/EntryDetail.tsx` (395 LOC)
- `src/pages/JudgePanel.tsx` (966 LOC)
- `src/pages/Winners.tsx` (279 LOC)
- `src/hooks/competition/*` (10 files)
- `src/hooks/judging/*` (selected: `useJudgeActions`, `useJudgeClassicData`, `useJudgePhotoData`, `useJudgeRounds`, `useJudgeCompetitions`, `useJudgeSession`, `usePhotoDecisions`, `useEntryPublicStatus`, `useGatedEntryStatus`, `useJudgingLock`, `useJudgeAggregateStats`)
- `src/lib/queryKeys.ts`

---

## 1. Competitions.tsx — `/competitions`

| Field | VERIFIED |
|---|---|
| 1. Purpose | List competitions, filterable by phase. (Imports `useCompetitions`, `phaseStatusColors`, `phaseDisplayLabels`.) |
| 6. Child components | `PageSEO`, `<Link>` (router), `motion.*` (framer-motion). |
| 7. Hooks used | `useState`, `useAuth`, `useCompetitions(filter === "all" ? undefined : filter)`. |
| 8. React Query keys | `queryKeys.competitions(phaseFilter \|\| "all")` → `["competitions", filter]`. |
| 9. Tables queried | NOT VERIFIED at page level (delegated to `useCompetitions`). |
| 10. RPCs | None at page level. |
| 11. Edge functions | None. |
| 12. Realtime | None at page level. |
| 13–15. Loading / Empty / Error | `isLoading: loading` from `useCompetitions`. Other states NOT VERIFIED. |

Fields 2, 3, 4, 5, 16–26: **NOT VERIFIED — body of `Competitions.tsx` not deep-inspected in this pass.**

---

## 2. CompetitionDetail.tsx — `/competitions/:id` and `/competitions/:id/entry/:entryId/photo/:photoIndex`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Render single competition: phase banner, entries grid (paginated infinite scroll), voting lightbox, admin POTD action, gated public status overlay. |
| 6. Child components | `PhaseBanner`, `CompetitionLightbox`, `EntryCard`, `Breadcrumbs`, `VotingLightbox`, `InfiniteScrollSentinel`, `RoundPublishPanel` (admin), `PersonalResultBanner`, `PageSEO`, `motion`. |
| 7. Hooks used | `useAuth`, `useIsAdmin`, `useCompetitionDetail(slugOrId, user?.id)` (returns `data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage`), `useCompetitionVoting({ competitionId, userId })` → `{ toggleVote, isVoting }`, `useCompetitionAdmin()` → `{ markAsPOTD, isMarkingPOTD }`, `useCompetitionVoteRealtime({ competitionId, includeDashboard: true })`, `useEntryPublicStatus(entryIdsForGate)`. |
| 8. React Query keys | `queryKeys.competitionDetail(slugOrId)` → `["competition-detail", slugOrId]`; `["competition-entries", competitionId]`; `queryKeys.gatedEntryStatus(sortedIds)` (via `useEntryPublicStatus`→`useGatedEntryStatus`). |
| 9. Tables queried | NOT VERIFIED at page level. (Hooks query: `competition_entries`, `entry_public_status` — see hook section.) |
| 10. RPCs | None at page level. |
| 11. Edge functions | `cast-photo-vote` (via `useCompetitionVoting`). |
| 12. Realtime | `useCompetitionVoteRealtime` channel `competition-vote-sync:${competitionId ?? "global"}`. `useCompetitionDetail` channel `competition-entries-live-${competitionId}`. |
| 13. Loading | `isLoading: loading` from `useCompetitionDetail`. |
| 14/15. Empty/Error | NOT VERIFIED in detail. |
| 17. Role-specific | Admin-only: `RoundPublishPanel`, `markAsPOTD`. Gated by `useIsAdmin`. |
| 21. Security/privacy | `useEntryPublicStatus` enforces gated status (no raw `entry.status`). |

Other fields: **NOT VERIFIED** at this depth (would require body-level read).

---

## 3. CompetitionSubmit.tsx — `/competitions/:id/submit`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Submit a competition entry: collect photos, EXIF, hash, ownership disclaimer, debit wallet, call submission RPC, reward referrals. |
| 6. Child libraries / components | `storageRemove`, `uploadImageWithThumbnail`, `compressImageToFiles`, `scanFileWithToast`, `extractExif`/`summarizeExif`, `computeImageHash`. |
| 7. Hooks used | `useAuth`, `useUserRoles`, `useWallet()` → `{ balance, deductFunds, loading }`, `useSubmitCompetitionEntry()` (mutation). |
| 9. Tables queried | NOT VERIFIED at page level (state from `competitions` table fetched by direct `supabase.*` calls — not isolated in grep, but `supabase` is imported). |
| 10. RPCs | `process_referral_reward` (line 325, cast `as any`). Submission RPC: `submit_competition_entry` (called inside `useSubmitCompetitionEntry`). |
| 11. Edge functions | None directly invoked from page. |
| 12. Realtime | None. |
| 17. Role-specific | `useUserRoles` consumed; specific gating logic NOT VERIFIED. |
| 21. Security | File security scan via `scanFileWithToast`; image hash via `computeImageHash`; ownership disclaimer state. Wallet deduction via `deductFunds` from `useWallet`. |
| 24. Submission workflow | Verified call chain: `compressImageToFiles` → `scanFileWithToast` → `extractExif` → `computeImageHash` → `uploadImageWithThumbnail` → `useSubmitCompetitionEntry` (`submit_competition_entry` RPC) → `process_referral_reward` RPC. |

Other fields: **NOT VERIFIED**.

---

## 4. SubmissionDetail.tsx — `/dashboard/submission/:competitionId[/entry/...]`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Participant view of own submission: per-photo status, judging stamps, certificate readiness, judging tags, scores/comments per photo. |
| 6. Child components | `JudgingStampBadge`, `ParticipantStageBadge`, `UserNextStepPanel`, `PhaseWatermark`. Helpers: `fetchPhotoStatusMaps`, `useEntryPublicStatus`, `buildPublishedParticipantTagMaps`, `PARTICIPANT_PLACEMENT_LABELS`, `participantLabelForJudgingTag`. |
| 7. Hooks used | `useAuth`, `useEntryPublicStatus(entryIds)`. |
| 9. Tables queried (direct from page, lines 327–597) | `competitions`, `competition_entries`, `judge_tag_assignments`, `judge_scores`, `judge_comments`, `judging_rounds`, `judge_decisions` (filtered `round_number = 1`), `competition_round_publish`, `judging_tags`, `certificates`. |
| 10. RPCs | None at page level. |
| 11. Edge functions | None at page level. |
| 12. Realtime | None at page level. |
| 17. Role-specific | Page is participant-scoped (`.eq("user_id", user.id)` on `competition_entries`). |
| 21. Security/privacy | Per-photo status via `fetchPhotoStatusMaps` + `useEntryPublicStatus` (gated). Tag visibility filtered through `buildPublishedParticipantTagMaps`. |
| 25. Awards | Reads `certificates` to detect issued cert (`reference_id = competitionId`, `is_revoked = false`). |

Other fields: **NOT VERIFIED**.

---

## 5. EntryDetail.tsx — `/entry/:entryId`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Public single-entry view: photo grid, engagement, comments, share, vote toggle, judge scores reveal (post-publish), download. |
| 6. Child components | `CommentsSection`, `EngagementFooter`, `FacebookPhotoGrid`, `UserIdentityBlock`, `ImageEngagement`, `UserNextStepPanel`, `PageSEO`, `Breadcrumbs`, `PhaseWatermark`, `PublicJudgeScoresReveal`, `DownloadButton`. |
| 7. Hooks used | `useAuth`, `useDownloadImage`, `useCompetitionVoting`, `useGatedEntryStatus` + `resolveDisplayStatus`. |
| 8. React Query keys | None directly declared in page; relies on `useGatedEntryStatus` → `queryKeys.gatedEntryStatus`. |
| 9/10/11/12. DB / RPC / Edge / Realtime at page level | **None directly in page** (no `supabase.from`, `supabase.rpc`, `functions.invoke`, `.channel(` matched). All data via helpers: `fetchProfileMap`, `fetchEntryFinalVotes`, plus the hooks above. |
| 21. Security/privacy | `PhaseWatermark` overlay; `useGatedEntryStatus` gating; `PublicJudgeScoresReveal` is a separate component (visibility logic NOT VERIFIED). |
| 23. Voting workflow | `useCompetitionVoting` → `cast-photo-vote` edge function. |

Other fields: **NOT VERIFIED**.

---

## 6. JudgePanel.tsx — `/judge`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Judge workspace: select competition + round, classic/cinema modes, score per-criterion, tag, comment, complete-round. |
| 6. Child components (verified imports) | `JudgeRoundSidebar` (type only), `StartRoundDialog`, `NavigationBlocker`, `ResumeSessionDialog` + lazy panels (lazy-loaded; specifics NOT VERIFIED). |
| 7. Hooks used (verified imports) | `useDebouncedFeedbackSave`, `useAuth`, `useUserRoles`, `useIsMobile`, `useJudgingLock`, `useJudgeAggregateStats`, `useJudgeCompetitions`, `useJudgeRounds`, `useJudgeClassicData` (+ `getRoundMode`, `saveResumePosition`, `loadResumePosition`), `useJudgeActions`, `useJudgeSession`, `useUpdateEntryPlacement`, `useAddVoteAdjustment`, `useAdminEntryOverride`, `useSystemFlag`, `useUnjudgedDriftMonitor`. |
| 8. React Query keys (from hooks) | `["judge-competitions", userId, isAdmin]`, `["judge-rounds", competitionId]`, `queryKeys.judgePhotoData(competitionId, roundId, judgeId)` → `["judge-photo-data", competitionId, roundId, judgeId]`, `["judge-session", competitionId, userId]`, `["judge-aggregate-stats", userId, competitionIds]`, `queryKeys.perPhotoConsensus(sortedIds)`. |
| 9. Tables queried (via hooks, verified) | `competition_entries` (`useJudgeClassicData`, `useJudgeCompetitions`), `competition_votes` (`useJudgeClassicData`), `judge_scores`, `judge_tag_assignments` (joined to `judging_tags`), `judge_comments`, `judge_decisions` (all in `useJudgePhotoData`), `judge_activity_logs` (`useAdminEntryOverride`). |
| 10. RPCs | `acquire_judge_lock`, `heartbeat_judge_lock`, `release_judge_lock` (all `useJudgingLock`). |
| 11. Edge functions | `complete-round` (called twice in JudgePanel: lines 632, 790). `submitJudgeScoreEdge` (from `@/lib/judgingApi`, used in `useJudgeActions`). |
| 12. Realtime | `useJudgePhotoData` channel (server-side filter by `judge_id`; toggled by `site_settings.judging_realtime_distributed_mode`); `useJudgeRounds` channel `judge-rounds-rt-${competitionId}`. |
| 17. Role-specific | Page is judge/admin only (consumes `useUserRoles`); admin-only mutations: `useUpdateEntryPlacement`, `useAddVoteAdjustment`, `useAdminEntryOverride`. |
| 18. Permission logic | `useJudgingLock` (RPC-based row lock + heartbeat). `useUnjudgedDriftMonitor` (drift telemetry). |
| 22. Judging workflow | Verified primitives: lock → load classic data → score / tag / comment via `useJudgeActions` → debounced feedback save → session resume position → `complete-round` edge fn. |

Other fields including 2–5, 13–16, 19–21, 25, 26: **NOT VERIFIED**.

---

## 7. Winners.tsx — `/winners`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Public winners gallery rendered from R4-declared placements. |
| 6. Child components / helpers | `PageSEO`, `UserIdentityBlock`, `fetchProfileMap`, `fetchCompetitionsByIds`, `getAdminIds`, `resolveBadges`, `getR4AwardStages`. |
| 7. Hooks used | `useGatedEntryStatus` + `resolveDisplayStatus`. |
| 8. React Query keys | `queryKeys.gatedEntryStatus(sortedIds)` (via gated hook). |
| 9–12. DB/RPC/Edge/Realtime at page level | No direct matches; all data fetched via `fetchProfileMap`, `fetchCompetitionsByIds`, `useGatedEntryStatus`. |
| 25. Award workflow | Filter set comes from `getR4AwardStages` (R4 catalog). |

Other fields: **NOT VERIFIED**.

---

## A. Competition Lifecycle Map (VERIFIED via imports + memory tokens referenced in code)

```text
draft → upcoming → submission_open → voting → judging → results_published → archived
```
- Phase resolution helpers: `resolvePhase` / `resolveCompetitionPhase` (`src/lib/competitionPhase.ts`).
- Display strings: `phaseDisplayLabels`, `phaseStatusColors` (same lib).
- Server-side canonical resolver: `public.current_phase(uuid)` (referenced in code memory; not re-verified in this pass).

Specific transitions per state: **NOT VERIFIED in code in this pass.**

---

## B. Submission Lifecycle Map (VERIFIED — `CompetitionSubmit.tsx`)

```text
select photos
  → compressImageToFiles
  → scanFileWithToast            (file security scan)
  → extractExif / summarizeExif
  → computeImageHash             (duplicate detection input)
  → uploadImageWithThumbnail
  → useSubmitCompetitionEntry    (RPC: submit_competition_entry)
  → process_referral_reward RPC  (best-effort, fire-after)
```

---

## C. Judging Lifecycle Map (VERIFIED — JudgePanel + judging hooks)

```text
useJudgeCompetitions (assigned competitions)
  → useJudgeRounds            (round meta)
  → acquire_judge_lock RPC    (row lock)
  → heartbeat_judge_lock RPC  (interval; release on unmount)
  → useJudgeClassicData       (entries + votes + status)
  → useJudgePhotoData         (per-photo: scores, tags, comments, decisions)
  → useJudgeActions
       ↳ submitJudgeScoreEdge edge call (judging API helper)
       ↳ direct supabase upserts on judge_tag_assignments
  → useJudgeSession           (resume position, persistence)
  → complete-round edge fn    (locks round; admin must DECLARE separately)
```

---

## D. Voting Lifecycle Map (VERIFIED — `useCompetitionVoting`)

```text
toggleVote(...)
  → optimistic cache update on:
        ["competition-entries", competitionId]
        ["dashboard-init"]
  → supabase.functions.invoke("cast-photo-vote", { body: ... })
  → on success: invalidate ["competition-entries", competitionId] + ["dashboard-init"]
  → on error : restore snapshots from getQueriesData
Realtime sync: useCompetitionVoteRealtime channel
  "competition-vote-sync:${competitionId ?? "global"}"
    → invalidates ["competition-entries", competitionId]
    → invalidates ["dashboard-init"]
```

---

## E. Entry Visibility Matrix (VERIFIED — `useEntryPublicStatus`/`useGatedEntryStatus`)

| Source | VERIFIED behavior |
|---|---|
| `useGatedEntryStatus(entryIds)` | RPC `get_gated_entry_status`; combines `entry_public_status` view + `photo_verification_requests` + `competition_round_publish`. |
| `useEntryPublicStatus(entryIds)` | Thin wrapper over `useGatedEntryStatus` returning legacy row shape `{ entry_id, competition_id, public_status, public_round, public_placement, public_r4_tags }`. |
| Verification override | `resolveDisplayStatus(row)` collapses status to `needs_review` when verification hold is active. |
| Realtime | `useGatedEntryStatus` opens `gated-status-${sortedIds[0]}` channel; on event invalidates `gatedEntryStatusAll` + `entryPublicStatusAll`. |
| Used by | `CompetitionDetail`, `SubmissionDetail`, `EntryDetail`, `Winners`. (`PublicProfile`, `AdminRoundVisibilityAudit` per file comment — NOT re-verified here.) |

---

## F. Judge Permission Matrix (VERIFIED — JudgePanel imports)

| Capability | Source |
|---|---|
| Detect judge access | `useUserRoles` |
| Acquire / heartbeat / release row lock | `useJudgingLock` (RPCs `acquire_judge_lock`, `heartbeat_judge_lock`, `release_judge_lock`) |
| Realtime per-judge filter | `useJudgePhotoData` channel filtered server-side by `judge_id` |
| Admin-only overrides on JudgePanel | `useUpdateEntryPlacement`, `useAddVoteAdjustment`, `useAdminEntryOverride` (logs to `judge_activity_logs`) |
| Drift telemetry | `useUnjudgedDriftMonitor` |

Per-role allow/deny matrix at component level: **NOT VERIFIED in this pass.**

---

## G. Competition Table Dependency Map (VERIFIED — direct table references found in inspected files)

| Table | Read by | Written by (verified) |
|---|---|---|
| `competitions` | `SubmissionDetail` | — |
| `competition_entries` | `SubmissionDetail`, `useJudgeClassicData`, `useJudgeCompetitions` | (writes via RPC `submit_competition_entry` / admin RPCs — NOT directly verified in inspected files) |
| `competition_votes` | `useJudgeClassicData` | (writes via `cast-photo-vote` edge fn) |
| `competition_round_publish` | `SubmissionDetail` | NOT VERIFIED |
| `competition_judges` | `useCompetitionJudges` | (write via `useCompetitionJudges` invalidations — direct insert NOT VERIFIED) |
| `judging_rounds` | `SubmissionDetail` | NOT VERIFIED |
| `judging_tags` | `SubmissionDetail`, `useJudgePhotoData` (joined) | NOT VERIFIED |
| `judge_decisions` | `SubmissionDetail` (R1 only), `useJudgePhotoData` | (writes via `useJudgeActions` / edge fn) |
| `judge_scores` | `SubmissionDetail`, `useJudgePhotoData` | `useJudgeActions` (`submitJudgeScoreEdge`) |
| `judge_tag_assignments` | `SubmissionDetail`, `useJudgePhotoData` | `useJudgeActions` (verified `supabase.from(...)` upserts) |
| `judge_comments` | `SubmissionDetail`, `useJudgePhotoData` | `useJudgeActions` (verified writes) |
| `judge_activity_logs` | — | `useAdminEntryOverride` (insert) |
| `certificates` | `SubmissionDetail` | NOT VERIFIED |
| `photo_of_the_day` | — | `useCompetitionAdmin` (insert) |
| `profiles` | `useCompetitionJudges` (`select id, full_name`) | — |
| `entry_public_status` (view) | via `get_gated_entry_status` RPC | — |
| `photo_verification_requests` | via `get_gated_entry_status` RPC | — |

---

## H. Hook → UI Map (VERIFIED)

| Hook | Used by |
|---|---|
| `useCompetitions` | `Competitions.tsx` |
| `useCompetitionDetail` | `CompetitionDetail.tsx` |
| `useCompetitionVoting` | `CompetitionDetail.tsx`, `EntryDetail.tsx` |
| `useCompetitionAdmin` | `CompetitionDetail.tsx` |
| `useCompetitionVoteRealtime` | `CompetitionDetail.tsx` |
| `useEntryPublicStatus` | `CompetitionDetail.tsx`, `SubmissionDetail.tsx` |
| `useGatedEntryStatus` | `EntryDetail.tsx`, `Winners.tsx` (and via wrapper above) |
| `useSubmitCompetitionEntry` | `CompetitionSubmit.tsx` |
| `useWallet` | `CompetitionSubmit.tsx` |
| `useUserRoles` | `CompetitionSubmit.tsx`, `JudgePanel.tsx` |
| `useJudgingLock` | `JudgePanel.tsx` |
| `useJudgeAggregateStats` | `JudgePanel.tsx` |
| `useJudgeCompetitions` | `JudgePanel.tsx` |
| `useJudgeRounds` | `JudgePanel.tsx` |
| `useJudgeClassicData` | `JudgePanel.tsx` |
| `useJudgePhotoData` | (judge surface — referenced via realtime + queryKey; direct `JudgePanel` import NOT VERIFIED) |
| `useJudgeActions` | `JudgePanel.tsx` |
| `useJudgeSession` | `JudgePanel.tsx` |
| `useUpdateEntryPlacement`, `useAddVoteAdjustment` | `JudgePanel.tsx` |
| `useAdminEntryOverride` | `JudgePanel.tsx` |
| `useUnjudgedDriftMonitor` | `JudgePanel.tsx` |
| `useDebouncedFeedbackSave` | `JudgePanel.tsx` |
| `usePhotoDecisions` (`get_per_photo_consensus`) | NOT VERIFIED in inspected pages |

---

## I. Competition State Machine

**NOT VERIFIED** at code level for explicit state-transition guards. Phase resolver (`resolvePhase` / `current_phase` RPC) implies states listed in §A; transition triggers (cron, admin action, deadline) were not re-verified here.

---

## J. Realtime Dependency Map (VERIFIED)

| Channel name pattern | Owner hook | Effect |
|---|---|---|
| `competition-entries-live-${competitionId}` | `useCompetitionDetail` | invalidates `["competition-entries", competitionId]`, `["competition-detail"]` |
| `competition-vote-sync:${competitionId ?? "global"}` | `useCompetitionVoteRealtime` | invalidates `["competition-entries", competitionId]`, `["dashboard-init"]` |
| `judge-rounds-rt-${competitionId}` | `useJudgeRounds` | invalidates `["judge-rounds", competitionId]` |
| `judge-photo-data` channel (name var) | `useJudgePhotoData` | server-side filter by `judge_id`; invalidates `judgePhotoData(...)` key. Toggled by `site_settings.judging_realtime_distributed_mode`. |
| `gated-status-${sortedIds[0]}` | `useGatedEntryStatus` | invalidates `gatedEntryStatusAll`, `entryPublicStatusAll` |

---

## K. Edge Function Inventory (VERIFIED uses only)

| Function | Caller (verified) |
|---|---|
| `cast-photo-vote` | `useCompetitionVoting` (mutation) |
| `complete-round` | `JudgePanel.tsx` (lines 632, 790) |
| `submitJudgeScoreEdge` (`@/lib/judgingApi`) | `useJudgeActions` |

Other judge-related edge functions (`decide-photo-verification`, `expire-photo-verifications`, `get-verification-original-url`, `process-email-queue`, `rank-feed`) are referenced in project memory but **not verified in the seven inspected pages or the listed hooks**.

---

## L. RPC Inventory (VERIFIED uses)

| RPC | Caller |
|---|---|
| `submit_competition_entry` | `useSubmitCompetitionEntry` (mutations file) |
| `process_referral_reward` | `CompetitionSubmit.tsx:325` |
| `acquire_judge_lock` | `useJudgingLock` |
| `heartbeat_judge_lock` | `useJudgingLock` |
| `release_judge_lock` | `useJudgingLock` (called twice — useEffect cleanup + explicit release) |
| `get_gated_entry_status` | `useGatedEntryStatus` |
| `get_per_photo_consensus` | `usePhotoDecisions` (per `queryKeys.perPhotoConsensus`) — body NOT VERIFIED here |

---

## M. Known Risks / Issues (VERIFIED ONLY)

| Source | Verified observation |
|---|---|
| `useEntryPublicStatus` header comment | "NEW CODE SHOULD IMPORT `useGatedEntryStatus` DIRECTLY" — wrapper kept only for legacy callers. |
| `useJudgePhotoData` realtime | Cross-judge live updates intentionally OFF; toggled by `site_settings.judging_realtime_distributed_mode`. |
| `useCompetitionVoting` | Optimistic cache touches BOTH `["competition-entries", competitionId]` and every `["dashboard-init"]` snapshot — failure path restores both. |
| `JudgePanel.complete-round` | Called from two distinct sites (lines 632, 790); per memory rule "Round Declaration is Admin-Gated", complete-round only LOCKS — admin must DECLARE separately. Verified that JudgePanel only invokes `complete-round`, not a `declare-round` function. |
| `CompetitionSubmit` | `process_referral_reward` is cast `as any` (no typed RPC). |
| `SubmissionDetail` | All Supabase reads are direct `supabase.from(...)` calls inside the page (no React Query) — no automatic invalidation; refresh is page-local. |
| `EntryDetail` / `Winners` | No direct DB / channel calls; rely entirely on helpers + hooks for data. |

---

## N. Items NOT VERIFIED in this Step

Across all 7 pages: visible sections, exact buttons/forms/modals, full child component trees, loading/empty/error visuals, mobile-specific behavior, granular permission gates inside JSX, full status lifecycle code paths, full cache-invalidation matrix beyond the keys listed above, and the body-level Supabase calls inside `Competitions.tsx`, `CompetitionDetail.tsx`, `CompetitionSubmit.tsx`, `JudgePanel.tsx` (only top-level `supabase.*` matches were extracted in this pass).

These require Step 2B-deep (full body read of each page + `useJudgePhotoData`, `useJudgeClassicData`, `useJudgeActions` body inspection) to complete.
