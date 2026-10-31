/**
 * stageCatalog — TypeScript mirror of the `v3_stage_catalog` DB table.
 *
 * Plan Phase 2 (16-Key Frozen Contract v3) — 2026-05-01.
 *
 * SINGLE SOURCE OF TRUTH on the client for:
 *   - canonical stage_key values (used by submit-judge-decision edge fn)
 *   - participant-facing tag_label_canonical
 *   - cert_eligible flag (mirrors complete-round / publish-round logic)
 *   - round/family/decision_token grouping
 *
 * Hardcoding any of these strings elsewhere in /src is forbidden — go through
 * `STAGE_CATALOG`, `getStageByKey`, or one of the helper selectors below.
 *
 * Parity with the DB is enforced by:
 *   - Build-time test:  src/test/stage-catalog-parity.test.ts
 *   - CI audit script:  scripts/audits/v3_catalog_parity.mjs
 *
 * Snapshot taken: 2026-05-01 (Phase 1 catalog resync) — 16 ACTIVE rows.
 *
 * Phase 1 changes vs prior snapshot:
 *   • RENAMED stage_key:    r1_shortlisted_for_r2 → r1_shortlisted_r2
 *   • RELABELED:            "Shortlist for R2" → "Qualified for Round 2"
 *                           "Accepted" → "Accepted in Round 2" / "Accepted in Round 3"
 *                           "Qualified for 3rd Round" → "Qualified for Round 3"
 *                           "Top 50" → "Top 50 Global Photographer"
 *                           "Top 100" → "Top 100 Global Photographer"
 *   • NEW:                  r1_needs_verification (Verification Required)
 *                           r4_finalist (Qualified for Final)
 *   • SOFT-RETIRED (is_active:false, kept for back-compat lookups only):
 *                           r1_needs_review, r2_not_selected_r3,
 *                           r3_not_selected_final, r4_qualified_final
 *
 * Re-run the parity test after every migration that touches v3_stage_catalog.
 */

export type StageFamily =
  | "progression_pass"
  | "progression_fail"
  | "rejection"
  | "needs_review"
  | "verification"
  | "award";

export type DecisionToken =
  | "accept"
  | "reject"
  | "shortlist"
  | "needs_review"
  | "needs_verification"
  | "qualified"
  | "qualified_r3"
  | "qualified_final"
  | "shortlisted_final"
  | "not_selected_r3"
  | "not_selected_final"
  | "finalist"
  | "finalist_only"
  | "winner"
  | "runner_up_1"
  | "runner_up_2"
  | "honorary_mention"
  | "special_jury"
  | "top_50"
  | "top_100";

export interface StageCatalogEntry {
  stage_key: string;
  round_number: 1 | 2 | 3 | 4;
  family: StageFamily;
  decision_token: DecisionToken;
  tag_label_canonical: string;
  advances_to_round: number | null;
  blocks_from_round: number | null;
  cert_eligible: boolean;
  is_active: boolean;
}

/**
 * Canonical 16-stage active catalog + 4 retired rows kept for legacy lookups.
 * Order matches DB ORDER BY round_number, stage_key.
 * Mutating this array in user code is forbidden — treat as readonly.
 */
export const STAGE_CATALOG: ReadonlyArray<StageCatalogEntry> = [
  // ─── Round 1 (4 active) ────────────────────────────────────────────────
  { stage_key: "r1_accepted",            round_number: 1, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted",                       advances_to_round: 2,    blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r1_shortlisted_r2",      round_number: 1, family: "progression_pass", decision_token: "shortlist",          tag_label_canonical: "Qualified for Round 2",          advances_to_round: 2,    blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r1_needs_verification",  round_number: 1, family: "verification",     decision_token: "needs_verification", tag_label_canonical: "Verification Required",         advances_to_round: null, blocks_from_round: null, cert_eligible: false, is_active: true  },
  { stage_key: "r1_rejected",            round_number: 1, family: "rejection",        decision_token: "reject",             tag_label_canonical: "Rejected",                       advances_to_round: null, blocks_from_round: null, cert_eligible: false, is_active: true  },

  // ─── Round 2 (2 active) ────────────────────────────────────────────────
  { stage_key: "r2_accepted",            round_number: 2, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted in Round 2",            advances_to_round: 3,    blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r2_qualified_r3",        round_number: 2, family: "progression_pass", decision_token: "qualified_r3",       tag_label_canonical: "Qualified for Round 3",          advances_to_round: 3,    blocks_from_round: null, cert_eligible: true,  is_active: true  },

  // ─── Round 3 (2 active) ────────────────────────────────────────────────
  { stage_key: "r3_accepted",            round_number: 3, family: "progression_pass", decision_token: "accept",             tag_label_canonical: "Accepted in Round 3",            advances_to_round: 4,    blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r3_qualified_final",     round_number: 3, family: "progression_pass", decision_token: "qualified_final",    tag_label_canonical: "Qualified for Final Round",      advances_to_round: 4,    blocks_from_round: null, cert_eligible: true,  is_active: true  },

  // ─── Round 4 (8 active — awards only, all applied in R4 only) ─────────
  { stage_key: "r4_winner",              round_number: 4, family: "award",            decision_token: "winner",             tag_label_canonical: "Winner",                         advances_to_round: null, blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r4_runner_up_1",         round_number: 4, family: "award",            decision_token: "runner_up_1",        tag_label_canonical: "1st Runner-Up",                  advances_to_round: null, blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r4_runner_up_2",         round_number: 4, family: "award",            decision_token: "runner_up_2",        tag_label_canonical: "2nd Runner-Up",                  advances_to_round: null, blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r4_honorary_mention",    round_number: 4, family: "award",            decision_token: "honorary_mention",   tag_label_canonical: "Honorary Mention",               advances_to_round: null, blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r4_special_jury",        round_number: 4, family: "award",            decision_token: "special_jury",       tag_label_canonical: "Special Jury Award",             advances_to_round: null, blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r4_top_50",              round_number: 4, family: "award",            decision_token: "top_50",             tag_label_canonical: "Top 50 Global Photographer",     advances_to_round: null, blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r4_top_100",             round_number: 4, family: "award",            decision_token: "top_100",            tag_label_canonical: "Top 100 Global Photographer",    advances_to_round: null, blocks_from_round: null, cert_eligible: true,  is_active: true  },
  { stage_key: "r4_finalist",            round_number: 4, family: "award",            decision_token: "finalist_only",      tag_label_canonical: "Qualified for Final",            advances_to_round: null, blocks_from_round: null, cert_eligible: true,  is_active: true  },

  // ─── RETIRED (is_active:false) — kept for legacy stage_key lookups only ───
  { stage_key: "r1_needs_review",        round_number: 1, family: "needs_review",     decision_token: "needs_review",       tag_label_canonical: "Needs Review",                   advances_to_round: null, blocks_from_round: null, cert_eligible: false, is_active: false },
  { stage_key: "r2_not_selected_r3",     round_number: 2, family: "progression_fail", decision_token: "not_selected_r3",    tag_label_canonical: "Not Selected for 3rd Round",     advances_to_round: null, blocks_from_round: 3,    cert_eligible: false, is_active: false },
  { stage_key: "r3_not_selected_final",  round_number: 3, family: "progression_fail", decision_token: "not_selected_final", tag_label_canonical: "Not Selected for Final Round",   advances_to_round: null, blocks_from_round: 4,    cert_eligible: false, is_active: false },
  { stage_key: "r4_qualified_final",     round_number: 4, family: "progression_pass", decision_token: "qualified_final",    tag_label_canonical: "Qualified for Final Round",      advances_to_round: null, blocks_from_round: null, cert_eligible: false, is_active: false },
] as const;

// ─── Indexes (built once at module load) ────────────────────────────────
const BY_KEY: ReadonlyMap<string, StageCatalogEntry> = new Map(
  STAGE_CATALOG.map((s) => [s.stage_key, s] as const),
);

const BY_TAG_LABEL: ReadonlyMap<string, StageCatalogEntry> = STAGE_CATALOG.reduce((map, s) => {
  const key = s.tag_label_canonical.toLowerCase();
  const existing = map.get(key);
  if (!existing || (!existing.is_active && s.is_active)) map.set(key, s);
  return map;
}, new Map<string, StageCatalogEntry>());

// ─── Public selectors ───────────────────────────────────────────────────
export function getStageByKey(stage_key: string): StageCatalogEntry | undefined {
  return BY_KEY.get(stage_key);
}

export function getStageByTagLabel(label: string | null | undefined): StageCatalogEntry | undefined {
  if (!label) return undefined;
  return BY_TAG_LABEL.get(label.trim().toLowerCase());
}

export function getStagesForRound(round: 1 | 2 | 3 | 4): StageCatalogEntry[] {
  return STAGE_CATALOG.filter((s) => s.round_number === round && s.is_active);
}

export function getCertEligibleStages(): StageCatalogEntry[] {
  return STAGE_CATALOG.filter((s) => s.cert_eligible && s.is_active);
}

export function isCertEligibleStage(stage_key: string): boolean {
  return BY_KEY.get(stage_key)?.cert_eligible === true;
}

export function getR4AwardStages(): StageCatalogEntry[] {
  return STAGE_CATALOG.filter((s) => s.round_number === 4 && s.family === "award" && s.is_active);
}
