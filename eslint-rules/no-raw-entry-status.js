/**
 * no-raw-entry-status — Audit v6 P-01..P-06 + R6 DX + B0.1 PostgREST extension.
 *
 * Forbids reading `entry.status`, `entry.placement`, or `entry.progression_decision`
 * directly anywhere outside a narrow, audited allowlist. UI MUST consume these
 * via `useGatedEntryStatus` / `useEntryPublicStatus` so unpublished round
 * outcomes never leak to participants or the public.
 *
 * R6 SCOPE EXTENSION: This rule also runs against `src/lib/**` and
 * `supabase/functions/**`. Per-file allowlist below for legitimate raw readers.
 *
 * B0.1 EXTENSION (string-filter coverage): the rule now ALSO flags PostgREST
 * string-filter calls that target the `status` or `progression_decision`
 * column with a judging-outcome literal — closing the leak class that the
 * MemberExpression check could not see (e.g. `.eq("status", "winner")`).
 *
 *   FORBIDDEN string-filter shape (any of):
 *     .eq("status" | "progression_decision",       <judging-outcome literal>)
 *     .neq("status" | "progression_decision",      <judging-outcome literal>)
 *     .filter("status" | "progression_decision", _, <judging-outcome literal>)
 *     .in("status" | "progression_decision",       [array containing >=1 outcome])
 *
 *   BENIGN literals NOT flagged (workflow values, not judging outcomes):
 *     submitted, draft, pending_review, withdrawn, archived, disqualified,
 *     active, inactive, pending, approved (verification), rejected (verification)
 *
 *   JUDGING-OUTCOME literals (always flagged outside allowlist):
 *     winner, runner_up, runner-up, shortlisted, qualified, qualified_r3,
 *     finalist, top_50, top_100, honorary_mention, honorary, special_jury,
 *     not_selected, eliminated, needs_review, placement
 *
 * Same DIR_ALLOWLIST + FILE_ALLOWLIST applies to both checks.
 *
 * Identifiers explicitly NOT flagged (member-expression check): `entry.status`
 * patterns where the LHS variable name is `app`, `log`, `result`, `req`,
 * `verification`, etc. We only match objects literally named `entry` or `e`.
 */
// Phase 0B-3 — `status_legacy` is the dual-emit retired vocabulary column;
// any new read leaks pre-publish outcomes via the legacy alias path.
// `submission.status` mirrors the same leak class on the entry alias.
const FORBIDDEN_PROPS = new Set(["status", "placement", "progression_decision", "status_legacy"]);

// Object identifier names guarded for raw member-expression reads.
const FORBIDDEN_OBJECTS = new Set(["entry", "e", "submission"]);

// PostgREST column names this rule guards.
const FILTERED_COLUMNS = new Set(["status", "progression_decision", "status_legacy"]);

// Literals that REPRESENT JUDGING OUTCOMES — surfacing them via PostgREST
// filters bypasses the publish gate. Lowercased for case-insensitive compare.
const JUDGING_OUTCOMES = new Set([
  "winner",
  "runner_up",
  "runner-up",
  "shortlisted",
  "qualified",
  "qualified_r3",
  "finalist",
  "top_50",
  "top_100",
  "honorary_mention",
  "honorary",
  "special_jury",
  "not_selected",
  "eliminated",
  "needs_review",
  "placement",
]);

// PostgREST filter methods we inspect.
const FILTER_METHODS = new Set(["eq", "neq", "in", "filter"]);

const DIR_ALLOWLIST = [
  "/hooks/judging/",
  "/hooks/competition/",
  "/hooks/profile/",
  "/components/admin/",
  "/pages/admin/",
  "/components/judge/",
  "/src/lib/judging/",
  "/test/",
  "/pages/JudgePanel",
  "/pages/Certificates",
];

const FILE_ALLOWLIST = [
  // Server-side gate, not UI.
  "/src/lib/exportJudgingResults.ts",
  // Admin CSV export of raw truth.
  "/supabase/functions/request-photo-verification/index.ts",
  // B0.1 fix — pre-filters `.eq("status","winner")` for performance, then runs
  // every candidate through `useGatedEntryStatus` + WINNER_PUBLIC_KEYS before
  // render (see Winners.tsx L114-122). Same pattern in ProfileActivityFeed
  // (B1.10/B1.11 migration). Raw filter is not a leak: gate is downstream.
  "/src/pages/Winners.tsx",
  "/src/components/profile/ProfileActivityFeed.tsx",
  // B0.1 fix — server builds the dashboard payload from raw entry truth; the
  // client UI consumes it through gated hooks. Edge fn is the source-of-truth
  // boundary, not a UI surface.
  "/supabase/functions/dashboard-init/index.ts",
];

function isAllowlisted(filename) {
  if (!filename) return true; // unknown file — don't false-positive
  const norm = filename.replace(/\\/g, "/");
  if (FILE_ALLOWLIST.some((p) => norm.endsWith(p))) return true;
  return DIR_ALLOWLIST.some((p) => norm.includes(p));
}

function literalString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function isJudgingOutcomeLiteral(node) {
  const s = literalString(node);
  if (s === null) return false;
  return JUDGING_OUTCOMES.has(s.toLowerCase());
}

function arrayHasJudgingOutcome(node) {
  if (!node || node.type !== "ArrayExpression") return false;
  return node.elements.some((el) => el && isJudgingOutcomeLiteral(el));
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw entry.status / entry.placement / entry.progression_decision reads (member access AND PostgREST string filters with judging-outcome values) in user-facing UI. Use useGatedEntryStatus / publicStatus prop instead.",
    },
    schema: [],
    messages: {
      raw:
        "Audit v6 P-01: do not read `entry.{{prop}}` directly in UI. " +
        "Use useGatedEntryStatus (see src/hooks/judging/useGatedEntryStatus.ts) " +
        "or pass `publicStatus` / `publicPlacement` from a gated source. " +
        "Raw reads leak unpublished round outcomes (rejected / shortlisted / winner) " +
        "to participants before the admin clicks Publish Round N.",
      filter:
        "Audit v6 B0.1: PostgREST `.{{method}}(\"{{column}}\", ...)` with a " +
        "judging-outcome literal bypasses the publish gate. Filter via a gated " +
        "view/RPC, or move this query into the allowlisted hooks/lib/judging/** " +
        "layer that owns raw access.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowlisted(filename)) return {};

    function isCatchParam(identNode) {
      // Walk ancestors; if `e`/`entry` is the binding of an enclosing
      // CatchClause param, it's a JS Error, not a competition entry — skip.
      // ESLint flat config: use sourceCode.getScope() (context.getScope() is
      // legacy and emits a deprecation warning).
      const sc = context.sourceCode || context.getSourceCode?.();
      const scope = sc && sc.getScope ? sc.getScope(identNode) : context.getScope?.();
      if (!scope) return false;
      let s = scope;
      while (s) {
        if (s.type === "catch") {
          const v = s.variables.find((vv) => vv.name === identNode.name);
          if (v) return true;
        }
        s = s.upper;
      }
      return false;
    }

    function checkMember(node) {
      if (!node || node.computed) return;
      const obj = node.object;
      const prop = node.property;
      if (!obj || !prop || prop.type !== "Identifier") return;
      if (!FORBIDDEN_PROPS.has(prop.name)) return;
      if (obj.type !== "Identifier") return;
      const name = obj.name;
      if (!FORBIDDEN_OBJECTS.has(name)) return;
      // B0.1 — skip caught Error params (`e.status` on AuthError != entry.status).
      if (isCatchParam(obj)) return;
      context.report({ node, messageId: "raw", data: { prop: prop.name } });
    }

    function checkCall(node) {
      const callee = node.callee;
      if (!callee || callee.type !== "MemberExpression" || callee.computed) return;
      const methodName = callee.property && callee.property.name;
      if (!FILTER_METHODS.has(methodName)) return;
      const args = node.arguments;
      if (!args || args.length < 2) return;
      const colLiteral = literalString(args[0]);
      if (!colLiteral || !FILTERED_COLUMNS.has(colLiteral)) return;

      let valueNode;
      if (methodName === "filter") {
        // .filter(column, operator, value)
        if (args.length < 3) return;
        valueNode = args[2];
      } else {
        valueNode = args[1];
      }

      const violates =
        methodName === "in"
          ? arrayHasJudgingOutcome(valueNode)
          : isJudgingOutcomeLiteral(valueNode);

      if (!violates) return;
      context.report({
        node,
        messageId: "filter",
        data: { method: methodName, column: colLiteral },
      });
    }

    return {
      MemberExpression: checkMember,
      CallExpression: checkCall,
    };
  },
};

export default rule;
