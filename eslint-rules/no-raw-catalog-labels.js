/**
 * no-raw-catalog-labels — Plan Phase 5 / Task 5.6 (16-Key Frozen Contract v3).
 *
 * Forbids hardcoded participant-facing label strings that belong to the
 * v3_stage_catalog. The contract is the single source of truth: any of these
 * strings appearing as a string literal anywhere outside an explicit allowlist
 * is a violation, because it bypasses participantWording.ts and risks drift
 * from `v3_stage_catalog.tag_label_canonical`.
 *
 * To reference one of these strings in user-facing UI, import the value via:
 *   import { participantStageLabel } from "@/lib/judging/participantStageLabels";
 *   import { PARTICIPANT_LABELS, getStageByKey } from "@/lib/judging/...";
 *
 * Allowlisted files / dirs (legitimate sources & internal mappers):
 *   - src/lib/judging/                              (catalog + wording)
 *   - supabase/functions/_shared/stageCatalog.ts    (server mirror)
 *   - supabase/migrations/                          (DB writes the contract)
 *   - eslint-rules/                                 (this rule itself)
 *   - src/test/, **__tests__**, *.test.ts          (parity assertions)
 *   - src/hooks/judging/tagLabelToDecision.ts       (catalog lookup helper)
 *   - src/lib/judging/participantStageLabels.ts     (back-compat delegator)
 */

// Each pattern must be byte-identical to a row in v3_stage_catalog
// (or a closely-related historical alias the rule catches as well).
const FORBIDDEN_LITERALS = new Set([
  // R1
  "Qualified for Round 2",
  "Shortlist for R2",
  "Verification Required",
  // R2
  "Accepted in Round 2",
  "Qualified for Round 3",
  // R3
  "Accepted in Round 3",
  "Qualified for Final Round",
  // R4 awards
  "Top 50 Global Photographer",
  "Top 100 Global Photographer",
  "1st Runner-Up",
  "2nd Runner-Up",
  "Special Jury Award",
  "Finalist (no placement)",
  // Retired but still off-limits as raw strings
  "Not Selected for 3rd Round",
  "Not Selected for Final Round",
]);

const DIR_ALLOWLIST = [
  "/src/lib/judging/",
  "/supabase/functions/_shared/stageCatalog.ts",
  "/supabase/functions/",            // edge fns operate on canonical strings
  "/supabase/migrations/",
  "/eslint-rules/",
  "/src/test/",
  "/__tests__/",
  // Judge-internal surfaces use operational vocabulary mirrored from
  // `judging_tags.label` (a separate source of truth for judges, NOT for
  // participants). The participant-facing wording is enforced elsewhere.
  "/src/components/judge/",
  "/src/components/admin/",
  "/src/pages/admin/",
  "/src/pages/JudgePanel",
  "/src/hooks/judging/",
];

const FILE_ALLOWLIST = [
  "/src/hooks/judging/tagLabelToDecision.ts",
  "/src/hooks/judging/__tests__/tagLabelToDecision.test.ts",
];

function isAllowlisted(filename) {
  if (!filename) return true;
  const norm = filename.replace(/\\/g, "/");
  if (norm.endsWith(".test.ts") || norm.endsWith(".test.tsx")) return true;
  if (FILE_ALLOWLIST.some((p) => norm.endsWith(p))) return true;
  return DIR_ALLOWLIST.some((p) => norm.includes(p));
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw v3_stage_catalog participant labels in source. Import via participantStageLabel() / PARTICIPANT_LABELS instead.",
    },
    schema: [],
    messages: {
      raw:
        "Plan Phase 5 / Task 5.6: do not hardcode participant label '{{value}}'. " +
        "Import it via participantStageLabel(stageKey) or PARTICIPANT_LABELS in " +
        "src/lib/judging/participantStageLabels.ts so the v3 contract stays the " +
        "single source of truth. Edit the label in the DB migration + " +
        "participantWording.ts, never inline.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowlisted(filename)) return {};

    function checkLiteral(node, value) {
      if (typeof value !== "string") return;
      if (!FORBIDDEN_LITERALS.has(value.trim())) return;
      context.report({ node, messageId: "raw", data: { value } });
    }

    return {
      Literal(node) {
        checkLiteral(node, node.value);
      },
      TemplateElement(node) {
        // Only flag fully-static template chunks (no expressions) so we don't
        // false-positive on builders like `${prefix} Round 2`.
        const cooked = node.value && node.value.cooked;
        if (typeof cooked === "string") checkLiteral(node, cooked);
      },
    };
  },
};

export default rule;
