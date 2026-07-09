/**
 * participantWording — central PARTICIPANT_LABELS map keyed by stage_key.
 *
 * Plan Phase 2 / Task 2.2 (16-Key Frozen Contract v3) — 2026-05-01.
 *
 * Source of truth for every PARTICIPANT-facing string derived from a
 * `v3_stage_catalog.stage_key`. Byte-identical to the labels in the
 * Judging_Master_Reference_16Keys_v3 contract document.
 *
 * Hard-coding any of these strings in a participant component is a
 * violation of the Frozen Contract — import from here instead.
 *
 * NOTE: Internal/admin/judge surfaces (Cinema view, sidebar buckets,
 *       vote-audit) MAY use shorter operational vocabulary; do NOT
 *       import this map there. For those surfaces, use
 *       `tag_label_canonical` from `STAGE_CATALOG` directly.
 */

import { STAGE_CATALOG, getStageByKey } from "./stageCatalog";

/**
 * The 16 active participant labels, keyed by canonical stage_key.
 * Each value is byte-identical to the v3 contract "Participant Label" column.
 *
 * If you need to edit a label, update it in BOTH:
 *   1. `v3_stage_catalog.tag_label_canonical` (DB migration)
 *   2. `STAGE_CATALOG` in stageCatalog.ts
 * Then re-run the parity test.
 */
export const PARTICIPANT_LABELS: Readonly<Record<string, string>> = {
  // R1
  r1_accepted:           "Accepted",
  r1_shortlisted_r2:     "Qualified for Round 2",
  r1_needs_verification: "Verification Required",
  r1_rejected:           "Rejected",

  // R2 — vocabulary correction (final_judging_plan-6_corrected_v2):
  //   accept = "qualified in current round only" (no promotion)
  //   qualified_r3 = "shortlisted for next round" (promotes)
  r2_accepted:           "Qualified for Round 2",
  r2_qualified_r3:       "Shortlisted for Round 3",

  // R3 — vocabulary correction (final_judging_plan-6_corrected_v2):
  r3_accepted:           "Qualified for Round 3",
  r3_qualified_final:    "Shortlisted for Final Round",

  // R4 — awards only, all 8 applied in R4
  r4_winner:             "Winner",
  r4_runner_up_1:        "1st Runner-Up",
  r4_runner_up_2:        "2nd Runner-Up",
  r4_honorary_mention:   "Honorary Mention",
  r4_special_jury:       "Special Jury Award",
  r4_top_50:             "Top 50 Global Photographer",
  r4_top_100:            "Top 100 Global Photographer",
  r4_finalist:           "Qualified for Final",
} as const;

export type FrozenStageKey = keyof typeof PARTICIPANT_LABELS;

/**
 * Returns the participant-facing label for a given stage_key, or null if
 * the key is unknown or refers to a retired stage. Callers are responsible
 * for choosing a fallback (e.g. "Under Review") when null is returned.
 */
export function participantWordingForStageKey(
  stage_key: string | null | undefined,
): string | null {
  if (!stage_key) return null;
  const exact = PARTICIPANT_LABELS[stage_key];
  if (exact) return exact;
  // Honor legacy stage_keys via the catalog only if the row is still active
  // (keeps retired keys out of participant UI even if a stale row exists).
  const entry = getStageByKey(stage_key);
  if (entry?.is_active && PARTICIPANT_LABELS[entry.stage_key]) {
    return PARTICIPANT_LABELS[entry.stage_key];
  }
  return null;
}

/**
 * Build-time invariant: every active row in STAGE_CATALOG MUST have a
 * matching entry in PARTICIPANT_LABELS, and every PARTICIPANT_LABELS key
 * MUST correspond to an active catalog row. Throws at module load on drift.
 *
 * NOTE: Byte-equality with `tag_label_canonical` is NOT enforced — judge-
 * facing tag labels and participant-facing labels are intentionally
 * decoupled per final_judging_plan-6_corrected_v2 (e.g. judge sees
 * "Accepted in Round 2", participant sees "Qualified for Round 2").
 */
(function assertCatalogParity(): void {
  for (const entry of STAGE_CATALOG) {
    if (!entry.is_active) continue;
    const wording = PARTICIPANT_LABELS[entry.stage_key];
    if (wording === undefined) {
      throw new Error(
        `[participantWording] missing label for active stage_key '${entry.stage_key}'`,
      );
    }
  }
  const activeKeys = new Set(STAGE_CATALOG.filter((s) => s.is_active).map((s) => s.stage_key));
  for (const k of Object.keys(PARTICIPANT_LABELS)) {
    if (!activeKeys.has(k)) {
      throw new Error(
        `[participantWording] orphan label '${k}' has no active stage_key in STAGE_CATALOG`,
      );
    }
  }
})();
