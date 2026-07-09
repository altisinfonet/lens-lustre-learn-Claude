/**
 * tagLabelToDecision — canonical client-side mapping from a judging tag label
 * to the corresponding `judge_decisions.decision` value.
 *
 * Plan Phase 5 / Task 5.5 (16-Key Frozen Contract v3) — 2026-05-01.
 *
 * As of Phase 5 the resolver is **catalog-driven**: it looks the label up in
 * `STAGE_CATALOG` (via `getStageByTagLabel`) and maps the canonical
 * `decision_token` to the `judge_decisions.decision` enum value.
 *
 * Returns `null` for tags that are NOT progression decisions (R4 awards,
 * "Needs Verification", "Needs Review"). Callers should skip optimistic
 * decision updates in that case.
 *
 * A small back-compat alias map handles legacy / shorthand strings the UI
 * historically accepted (e.g. "Reject", "Qualified for 2nd Round") so older
 * judging_tags rows still resolve correctly.
 */
import { getStageByTagLabel, type DecisionToken } from "@/lib/judging/stageCatalog";

/**
 * decision_token (catalog) → judge_decisions.decision (DB enum).
 * Tokens not present in this map deliberately return null (e.g. R4 awards,
 * verification, needs_review).
 */
const TOKEN_TO_DECISION: Partial<Record<DecisionToken, "accept" | "reject" | "shortlist">> = {
  accept:             "accept",
  reject:             "reject",
  shortlist:          "shortlist",
  qualified_r3:       "shortlist",
  qualified_final:    "shortlist",
  shortlisted_final:  "shortlist",
  not_selected_r3:    "reject",
  not_selected_final: "reject",
};

/**
 * Legacy / shorthand label aliases → canonical catalog label.
 * Kept narrow on purpose; expand only when a real DB row needs it.
 */
const LABEL_ALIASES: Record<string, string> = {
  // Generic / R1 shorthand
  "reject":                       "Rejected",
  "accept":                       "Accepted",
  "accept for round 1":           "Accepted",
  "shortlist for round 2":        "Qualified for Round 2",
  "shortlist for r2":             "Qualified for Round 2",
  "qualified for 2nd round":      "Qualified for Round 2",

  // R2 judge buttons (post-Block A renames)
  "accept for round 2":           "Accepted in Round 2",
  "accepted":                     "Accepted",                  // R1 fallback (R2/R3 use "Accept for Round X")
  "shortlist for round 3":        "Qualified for Round 3",
  "qualified for r3":             "Qualified for Round 3",
  "qualified for 3rd round":      "Qualified for Round 3",
  "qualified for round 3":        "Qualified for Round 3",
  "not selected for r3":          "Not Selected for 3rd Round",
  "not selected for round 3":     "Not Selected for 3rd Round",
  "not selected for 3rd round":   "Not Selected for 3rd Round",

  // R3 judge buttons (post-Block A renames)
  "accept for round 3":           "Accepted in Round 3",
  "shortlist for final round":    "Qualified for Final Round",
  "shortlist for final":          "Qualified for Final Round",
  "shortlisted for final":        "Qualified for Final Round",
  "qualified for final":          "Qualified for Final Round",
  "qualified for final round":    "Qualified for Final Round",
  "not selected for final":       "Not Selected for Final Round",
  "not selected for final round": "Not Selected for Final Round",
};

export function tagLabelToDecision(label: string | null | undefined): string | null {
  const raw = String(label || "").trim();
  if (!raw) return null;
  // 1. Try direct catalog hit first (so post-Block A canonical labels like
  //    "Qualified for Final" resolve to R4 r4_finalist, not the legacy R3 alias).
  let entry = getStageByTagLabel(raw);
  // 2. Fall back to legacy/judge-button aliases for older labels.
  if (!entry) {
    const aliased = LABEL_ALIASES[raw.toLowerCase()];
    if (aliased) entry = getStageByTagLabel(aliased);
  }
  if (!entry) return null;
  return TOKEN_TO_DECISION[entry.decision_token] ?? null;
}
