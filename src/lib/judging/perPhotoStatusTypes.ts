/**
 * perPhotoStatusTypes — single source of truth for the PerPhotoStatus union.
 *
 * Phase 5 (executed 2026-05-02) — DROPPED the `status_legacy` dual-emit.
 *
 * The DB function `get_per_photo_consensus` now emits ONLY the canonical
 * Frozen Contract v3 `status` column. The `LegacyPerPhotoStatus` union has
 * been deleted; the reader hook (`usePhotoDecisions`) consumes `status`
 * directly with no fallback.
 *
 * Re-exports:
 *   - `src/hooks/judging/usePhotoDecisions.ts`    re-exports `PerPhotoStatus`
 *   - `src/lib/perPhotoStatus.ts`                 re-exports `PerPhotoStatus`
 */

// ---------------------------------------------------------------------------
// CANONICAL keys — Frozen Contract v3 (Phase 1 / Phase 2)
// ---------------------------------------------------------------------------
// Round 1
export type R1CanonicalStatus =
  | "r1_accepted"
  | "r1_shortlisted_r2"
  | "r1_needs_review"
  | "r1_rejected";

// Round 2
export type R2CanonicalStatus =
  | "r2_accepted"
  | "r2_qualified_r3";

// Round 3
export type R3CanonicalStatus =
  | "r3_accepted"
  | "r3_qualified_final";

// Round 4 — Frozen Contract v3 R4 award keys (Phase 3, sourced from
// `get_per_photo_placement` sibling RPC). 8 canonical keys.
export type R4CanonicalStatus =
  | "r4_winner"
  | "r4_runner_up_1"
  | "r4_runner_up_2"
  | "r4_finalist"
  | "r4_top_50"
  | "r4_top_100"
  | "r4_honorary_mention"
  | "r4_special_jury";

export type CanonicalPerPhotoStatus =
  | R1CanonicalStatus
  | R2CanonicalStatus
  | R3CanonicalStatus
  | R4CanonicalStatus;

// ---------------------------------------------------------------------------
// LEGACY keys — kept ONLY because the consensus RPC still emits a handful of
// historical R1/R2/R3/R4 strings in the canonical `status` column for
// back-compat with existing badge components. Strictly compile-time aliases;
// not produced by status_legacy any more (Phase 5 dropped that column).
// ---------------------------------------------------------------------------
export type LegacyPerPhotoStatus =
  | "submitted"
  | "round1_qualified"
  | "shortlisted"
  | "needs_review"
  | "rejected"
  | "round2_qualified"
  | "round2_not_selected"
  | "round3_not_selected"
  | "r2_not_selected"
  | "r3_not_selected"
  | "qualified_final"
  | "winner"
  | "finalist";

// ---------------------------------------------------------------------------
// SENTINELS — server-side "no consensus" / pre-publish indicator.
// ---------------------------------------------------------------------------
export type SentinelPerPhotoStatus = "pending_consensus";

// ---------------------------------------------------------------------------
// FULL union — what the reader hook surfaces.
// ---------------------------------------------------------------------------
export type PerPhotoStatus =
  | CanonicalPerPhotoStatus
  | LegacyPerPhotoStatus
  | SentinelPerPhotoStatus;

export type PhotoStatusMap = {
  [photoIndex: number]: PerPhotoStatus;
};
