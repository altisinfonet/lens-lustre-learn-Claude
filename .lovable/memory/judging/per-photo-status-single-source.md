---
name: PerPhotoStatus single source of truth
description: Phase 5 EXECUTED 2026-05-02 — status_legacy column dropped from get_per_photo_consensus + get_per_photo_placement. usePhotoDecisions reads only `status`. LegacyPerPhotoStatus union retained as compile-time alias for back-compat badge components.
type: feature
---
**Single source of truth**: `src/lib/judging/perPhotoStatusTypes.ts` exports `PerPhotoStatus`, `PhotoStatusMap`, plus segmented sub-unions (`R1CanonicalStatus`, `R2CanonicalStatus`, `R3CanonicalStatus`, `R4CanonicalStatus`, `LegacyPerPhotoStatus`, `SentinelPerPhotoStatus`).

**Reader contract** (`src/hooks/judging/usePhotoDecisions.ts`) — Phase 5:
```ts
const status = (r.status as PerPhotoStatus) ?? "pending_consensus";
```
Phase 5 dropped the `status_legacy` column from both RPCs server-side. The reader now consumes the canonical `status` column with no fallback.

**RPC signatures (post Phase 5)**:
- `get_per_photo_consensus(uuid[]) RETURNS TABLE(..., status text)` — no status_legacy
- `get_per_photo_placement(uuid[]) RETURNS TABLE(..., status text, award_label text, declared boolean)` — no status_legacy

**Participant labels** (`src/lib/judging/participantStageLabels.ts`): unchanged. Canonical R1 keys (`r1_accepted`, `r1_shortlisted_r2`, `r1_needs_review`, `r1_rejected`) resolve to the SAME `PARTICIPANT_LABELS.r1_*` strings as their legacy siblings.

**LegacyPerPhotoStatus retention**: kept as a compile-time alias so existing badge components that switch on `"winner" | "finalist" | "round1_qualified"` etc. keep compiling. The DB no longer emits these keys via status_legacy, but the canonical `status` column still emits a few of them (`winner`, `finalist`) for R4 back-compat.

**Regression locks**:
- `src/test/per-photo-status-canonical-parity.spec.ts` — 23 byte-parity assertions (canonical ↔ legacy participant labels)
- `src/test/merge-consensus-and-placement.spec.ts` — 5 merge precedence tests
- `.github/workflows/per-photo-status-types.yml` — runs `tsc --noEmit` + parity test on PR
