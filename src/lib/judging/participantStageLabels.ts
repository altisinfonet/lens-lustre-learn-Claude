/**
 * participantStageLabels — back-compat thin delegator.
 *
 * Plan Phase 2 / Task 2.4 (16-Key Frozen Contract v3) — 2026-05-01.
 *
 * The canonical participant wording now lives in `participantWording.ts`,
 * keyed by `v3_stage_catalog.stage_key`. This file is preserved purely to
 * avoid breaking the existing public API used by:
 *   - src/hooks/judging/useGatedEntryStatus.ts
 *   - any other consumer that imports `participantStageLabel` /
 *     `PARTICIPANT_R4_TAG_TO_KEY` / `PARTICIPANT_PLACEMENT_LABELS`.
 *
 * NEW CODE MUST IMPORT FROM `participantWording.ts` directly.
 *
 * The `PARTICIPANT_STAGE_LABELS` map below is keyed by ad-hoc UI status
 * tokens (e.g. "judging_in_progress", "approved", "top_50") — NOT by
 * canonical stage_keys. These are kept verbatim for back-compat and
 * normalized to the v3 contract labels where they map 1:1.
 */

import { getStageByTagLabel } from "./stageCatalog";
import { PARTICIPANT_LABELS, participantWordingForStageKey } from "./participantWording";

/**
 * Back-compat: ad-hoc UI status → participant label.
 * Keep the existing keys; values updated to the v3 contract where mapped.
 */
export const PARTICIPANT_STAGE_LABELS = {
  // Pre-publish / interim
  judging_in_progress: "Under Review",
  submitted:           "Under Review",

  // Round outcomes (mapped to v3 contract)
  approved:            PARTICIPANT_LABELS.r1_accepted,            // "Accepted"
  round1_qualified:    PARTICIPANT_LABELS.r1_shortlisted_r2,      // "Qualified for Round 2"

  // R1 → R2 promotion. `shortlisted` is the legacy alias emitted by
  // `usePhotoDecisions` (SOW priority "shortlist") for an R1 photo that
  // advances to R2. It is NOT an R3→Final outcome — that is `finalist`.
  shortlisted:         PARTICIPANT_LABELS.r1_shortlisted_r2,      // "Qualified for Round 2"

  // ───── Phase 2 / D3 — canonical R1 keys (Frozen Contract v3) ─────
  // Resolve to the SAME PARTICIPANT_LABELS.r1_* strings as their legacy
  // siblings above so UI renders identical text before/after Phase 1.
  r1_accepted:         PARTICIPANT_LABELS.r1_accepted,            // "Accepted"
  r1_shortlisted_r2:   PARTICIPANT_LABELS.r1_shortlisted_r2,      // "Qualified for Round 2"
  r1_needs_review:     "Needs Review",                            // matches legacy `needs_review`
  r1_rejected:         PARTICIPANT_LABELS.r1_rejected,            // "Rejected"
  // ──────────────────────────────────────────────────────────────────

  // R2 — distinguishes "Accepted in R2" (qualifies in R2 only) from
  // "Qualified for R3" (advances). round2_qualified is the legacy
  // alias the UI already used for the "advances" case.
  r2_accepted:         PARTICIPANT_LABELS.r2_accepted,            // "Qualified for Round 2"
  r2_qualified_r3:     PARTICIPANT_LABELS.r2_qualified_r3,        // "Shortlisted for Round 3"
  r2_not_selected_r3:  "Not Selected for Round 3",
  round2_qualified:    PARTICIPANT_LABELS.r2_qualified_r3,        // legacy alias

  // R3 — distinguishes "Accepted in R3" (qualifies in R3 only) from
  // "Shortlisted for Final Round" (advances).
  r3_accepted:         PARTICIPANT_LABELS.r3_accepted,            // "Qualified for Round 3"
  r3_qualified_final:  PARTICIPANT_LABELS.r3_qualified_final,     // "Shortlisted for Final Round"
  r3_not_selected_final: "Not Selected for Final Round",

  // Round 4 honors (v3 contract). `finalist` is the R3→R4 advancement.
  finalist:            PARTICIPANT_LABELS.r3_qualified_final,     // "Shortlisted for Final Round"
  qualified_final:     PARTICIPANT_LABELS.r3_qualified_final,     // back-compat
  top_50:              PARTICIPANT_LABELS.r4_top_50,              // "Top 50 Global Photographer"
  top_100:             PARTICIPANT_LABELS.r4_top_100,             // "Top 100 Global Photographer"
  winner:              PARTICIPANT_LABELS.r4_winner,              // "Winner"
  runner_up_1:         PARTICIPANT_LABELS.r4_runner_up_1,         // "1st Runner-Up"
  runner_up_2:         PARTICIPANT_LABELS.r4_runner_up_2,         // "2nd Runner-Up"
  honorary_mention:    PARTICIPANT_LABELS.r4_honorary_mention,    // "Honorary Mention"
  special_jury:        PARTICIPANT_LABELS.r4_special_jury,        // "Special Jury Award"

  // Phase 3 (D-canonical) — Frozen Contract v3 R4 canonical keys emitted by
  // `get_per_photo_placement` RPC. Each maps to the SAME participant string
  // its legacy alias above resolves to. Snapshot test pins parity.
  r4_winner:           PARTICIPANT_LABELS.r4_winner,              // "Winner"
  r4_runner_up_1:      PARTICIPANT_LABELS.r4_runner_up_1,         // "1st Runner-Up"
  r4_runner_up_2:      PARTICIPANT_LABELS.r4_runner_up_2,         // "2nd Runner-Up"
  r4_finalist:         PARTICIPANT_LABELS.r4_finalist,            // "Finalist"
  r4_top_50:           PARTICIPANT_LABELS.r4_top_50,              // "Top 50 Global Photographer"
  r4_top_100:          PARTICIPANT_LABELS.r4_top_100,             // "Top 100 Global Photographer"
  r4_honorary_mention: PARTICIPANT_LABELS.r4_honorary_mention,    // "Honorary Mention"
  r4_special_jury:     PARTICIPANT_LABELS.r4_special_jury,        // "Special Jury Award"

  // Negative / hold (no contract row — UI-only states)
  needs_review:        "Needs Review",
  needs_verification:  PARTICIPANT_LABELS.r1_needs_verification,  // "Verification Required"
  rejected:            PARTICIPANT_LABELS.r1_rejected,            // "Rejected"
  hold:                "Under Consideration",
  results_declared:    "Results Declared",
} as const;

export type ParticipantStageKey = keyof typeof PARTICIPANT_STAGE_LABELS;

/** Public placement keys (DB enum form: `1st_runner_up`, `2nd_runner_up`). */
export const PARTICIPANT_PLACEMENT_LABELS: Record<string, string> = {
  winner:               PARTICIPANT_LABELS.r4_winner,
  "1st_runner_up":      PARTICIPANT_LABELS.r4_runner_up_1,
  "2nd_runner_up":      PARTICIPANT_LABELS.r4_runner_up_2,
  honorary_mention:     PARTICIPANT_LABELS.r4_honorary_mention,
  honourable_mention:   PARTICIPANT_LABELS.r4_honorary_mention,
  honorable_mention:    PARTICIPANT_LABELS.r4_honorary_mention,
  special_jury:         PARTICIPANT_LABELS.r4_special_jury,
  qualified_final:      PARTICIPANT_LABELS.r3_qualified_final,
  top_50:               PARTICIPANT_LABELS.r4_top_50,
  top_100:              PARTICIPANT_LABELS.r4_top_100,
  finalist:             PARTICIPANT_LABELS.r4_finalist,
};

/** R4 visible-tag DB labels (from `judging_tags.label`) → internal stage keys. */
export const PARTICIPANT_R4_TAG_TO_KEY: Record<string, string> = {
  "Top 50":                       "top_50",
  "Top 50 Global Photographer":   "top_50",
  "Top 100":                      "top_100",
  "Top 100 Global Photographer":  "top_100",
};

const TAG_LABEL_TO_PARTICIPANT_KEY: Record<string, string> = {
  "accept": "approved",
  "accepted": "approved",
  "accept for round 2": "r2_accepted",
  "accepted in round 2": "r2_accepted",
  "accept for round 3": "r3_accepted",
  "accepted in round 3": "r3_accepted",
  "shortlist for r2": "round1_qualified",
  "shortlist for round 2": "round1_qualified",
  "qualified for round 2": "round1_qualified",
  "qualified for 2nd round": "round1_qualified",
  "shortlist for round 3": "r2_qualified_r3",
  "qualified for r3": "r2_qualified_r3",
  "qualified for round 3": "r2_qualified_r3",
  "qualified for 3rd round": "r2_qualified_r3",
  "shortlist for final": "qualified_final",
  "shortlist for final round": "qualified_final",
  "shortlisted for final": "qualified_final",
  "qualified for final round": "qualified_final",
  "qualified for final": "finalist",
  "winner": "winner",
  "1st runner-up": "1st_runner_up",
  "runner up 1": "1st_runner_up",
  "runner_up_1": "1st_runner_up",
  "2nd runner-up": "2nd_runner_up",
  "runner up 2": "2nd_runner_up",
  "runner_up_2": "2nd_runner_up",
  "honorary mention": "honorary_mention",
  "honourable mention": "honorary_mention",
  "honorable mention": "honorary_mention",
  "special jury award": "special_jury",
  "special jury": "special_jury",
  "top 50": "top_50",
  "top 50 global photographer": "top_50",
  "top 100": "top_100",
  "top 100 global photographer": "top_100",
  "needs review": "needs_review",
  "rejected": "rejected",
};

const STAGE_KEY_TO_PLACEMENT_KEY: Record<string, string> = {
  r1_accepted: "r1_accepted",
  r1_shortlisted_r2: "round1_qualified",
  r1_needs_verification: "needs_verification",
  r1_rejected: "rejected",
  r2_accepted: "r2_accepted",
  r2_qualified_r3: "r2_qualified_r3",
  r3_accepted: "r3_accepted",
  r4_winner: "winner",
  r4_runner_up_1: "1st_runner_up",
  r4_runner_up_2: "2nd_runner_up",
  r4_honorary_mention: "honorary_mention",
  r4_special_jury: "special_jury",
  r4_top_50: "top_50",
  r4_top_100: "top_100",
  r4_finalist: "finalist",
  r3_qualified_final: "qualified_final",
};

export function participantStageLabel(key: string | null | undefined): string {
  if (!key) return PARTICIPANT_STAGE_LABELS.judging_in_progress;
  return (
    (PARTICIPANT_STAGE_LABELS as Record<string, string>)[key] ??
    PARTICIPANT_STAGE_LABELS.judging_in_progress
  );
}

export function participantKeyForJudgingTag(label: string | null | undefined): string | null {
  if (!label) return null;
  const raw = label.trim().toLowerCase();
  const stage = getStageByTagLabel(label);
  return (stage?.stage_key && STAGE_KEY_TO_PLACEMENT_KEY[stage.stage_key])
    || TAG_LABEL_TO_PARTICIPANT_KEY[raw]
    || null;
}

/**
 * BUG-032/033 — canonical placement-key normalizer.
 * `public_placement` reaches the UI in two vocabularies: token form
 * (runner_up_1, runner_up_2 — what complete-round writes) and enum form
 * (1st_runner_up, 2nd_runner_up — what the badge maps expect). Every
 * placement-consuming surface must route through this before any
 * PLACEMENT_CONFIG / label lookup. Returns null for unknown values.
 */
export function normalizePlacementKey(placement: string | null | undefined): string | null {
  if (!placement) return null;
  if (PARTICIPANT_PLACEMENT_LABELS[placement]) return placement;
  return participantKeyForJudgingTag(placement);
}

export function participantLabelForJudgingTag(label: string | null | undefined): string {
  if (!label) return "";
  const participantKey = participantKeyForJudgingTag(label);
  if (participantKey) {
    return PARTICIPANT_PLACEMENT_LABELS[participantKey] ?? participantStageLabel(participantKey);
  }
  const stage = getStageByTagLabel(label);
  return participantWordingForStageKey(stage?.stage_key) ?? label;
}
