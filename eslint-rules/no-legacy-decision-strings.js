/**
 * no-legacy-decision-strings — Judging v3 Phase Plan v2 · Step 5.1.
 *
 * Forbids raw legacy decision strings (canonical stage_keys, decision_tokens,
 * and tag_label_canonical values from `v3_stage_catalog`) from appearing as
 * string literals anywhere in `/src` *outside* a narrow allowlist of files
 * that legitimately speak the canonical vocabulary.
 *
 * The rule exists because Phase 4 (Step 4.1) made `src/lib/judging/stageCatalog.ts`
 * the single source of truth on the client. Any other file hardcoding e.g.
 * `"Top 50 Finalist"` or `"qualified_r3"` re-introduces the v5 dual-vocabulary
 * drift this entire phase plan was written to eliminate. Consumers MUST import
 * `getStageByKey`, `getStageByTagLabel`, `getR4AwardStages`, etc.
 *
 * ── Forbidden literals ───────────────────────────────────────────────────
 *   • All 19 active `stage_key` values (e.g. "r4_winner", "r2_qualified_r3")
 *   • All canonical `decision_token` values that map 1:1 to stages and have
 *     no other plausible meaning in the codebase ("qualified_r3",
 *     "shortlisted_final", "not_selected_r3", "not_selected_final",
 *     "runner_up_1", "runner_up_2"). Generic tokens like "winner", "accept",
 *     "reject", "shortlist", "finalist" are NOT forbidden — they appear in
 *     unrelated contexts (CSS classes, role names, audit log keys).
 *   • All canonical `tag_label_canonical` values that are unique to judging
 *     (e.g. "Top 50 Finalist", "Best Moment Award", "Qualified for 2nd Round").
 *
 * ── Allowlist ────────────────────────────────────────────────────────────
 * Files/directories that legitimately reference the canonical vocabulary:
 *   - src/lib/judging/**          (catalog itself + helpers)
 *   - src/hooks/judging/**        (judging data layer)
 *   - src/components/judge/**     (judge panel UI: tag pills, sidebar, etc.)
 *   - src/test/**                 (parity + invariants tests)
 *   - eslint-rules/**             (this file references the strings)
 *
 * ── How to fix a violation ───────────────────────────────────────────────
 *   import { getStageByKey, getStageByTagLabel } from "@/lib/judging/stageCatalog";
 *   const winner = getStageByKey("r4_winner")?.tag_label_canonical;
 */

const FORBIDDEN_STAGE_KEYS = new Set([
  // Round 1
  "r1_accepted",
  "r1_needs_review",
  "r1_rejected",
  "r1_shortlisted_for_r2",
  // Round 2
  "r2_accepted",
  "r2_not_selected_r3",
  "r2_qualified_r3",
  // Round 3
  "r3_accepted",
  "r3_not_selected_final",
  "r3_qualified_final",
  // Round 4
  "r4_honorary_mention",
  "r4_qualified_final",
  "r4_runner_up_1",
  "r4_runner_up_2",
  "r4_special_jury",
  "r4_top_100",
  "r4_top_50",
  "r4_winner",
]);

// Decision tokens that are unambiguous (no other plausible non-judging meaning).
// NOTE: `runner_up_1` / `runner_up_2` are intentionally excluded — they double
// as the canonical `placement` enum values (see PARTICIPANT_PLACEMENT_LABELS)
// and appear in many legitimate placement comparisons across user-facing pages.
const FORBIDDEN_DECISION_TOKENS = new Set([
  "qualified_r3",
  "qualified_final",
  "shortlisted_final",
  "not_selected_r3",
  "not_selected_final",
]);

// Canonical tag labels that are unique to v3 judging vocabulary
const FORBIDDEN_TAG_LABELS = new Set([
  "Qualified for 2nd Round",
  "Qualified for 3rd Round",
  "Qualified for Final Round",
  "Not Selected for 3rd Round",
  "Not Selected for Final Round",
  "Shortlist for R2",
]);

const DIR_ALLOWLIST = [
  "/src/lib/judging/",
  "/src/hooks/judging/",
  "/src/components/judge/",
  "/src/test/",
  "/eslint-rules/",
  // Phase R7 — server-side canonical-vocabulary writers (parallel to
  // src/lib/judging/** on the client). These edge fns intentionally write
  // v3_stage_catalog stage_keys to competition_entries.progression_decision
  // and judging_rounds — they ARE the source of truth, not violators.
  "/supabase/functions/complete-round/",
  "/supabase/functions/publish-round/",
];

function isAllowlisted(filename) {
  if (!filename) return true;
  const norm = filename.replace(/\\/g, "/");
  return DIR_ALLOWLIST.some((p) => norm.includes(p));
}

function classify(value) {
  if (typeof value !== "string") return null;
  if (FORBIDDEN_STAGE_KEYS.has(value)) return { kind: "stage_key", value };
  if (FORBIDDEN_DECISION_TOKENS.has(value)) return { kind: "decision_token", value };
  if (FORBIDDEN_TAG_LABELS.has(value)) return { kind: "tag_label", value };
  return null;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw v3 judging stage_keys / decision_tokens / canonical tag labels in /src. Use src/lib/judging/stageCatalog.ts helpers instead.",
    },
    schema: [],
    messages: {
      legacy:
        'Plan Step 5.1: do not hardcode {{kind}} "{{value}}". ' +
        "Import from `@/lib/judging/stageCatalog` (getStageByKey / getStageByTagLabel / getR4AwardStages / getStagesForRound). " +
        "Hardcoded judging vocabulary re-introduces the dual-source drift this rule exists to prevent.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowlisted(filename)) return {};

    function check(node, value) {
      const hit = classify(value);
      if (!hit) return;
      context.report({
        node,
        messageId: "legacy",
        data: { kind: hit.kind, value: hit.value },
      });
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        // Only flag template literals with no expressions (i.e. effectively a static string)
        if (node.expressions.length === 0 && node.quasis.length === 1) {
          check(node, node.quasis[0].value.cooked);
        }
      },
    };
  },
};

export default rule;
