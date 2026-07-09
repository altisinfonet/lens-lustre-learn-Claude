/**
 * no-unfiltered-judge-realtime — Forbidden Pattern #12.
 *
 * Forbids subscribing to postgres_changes on `judge_decisions` or
 * `judge_scores` without a server-side `filter:` argument. Without a filter,
 * every judge receives every other judge's live decisions — a privacy leak
 * (see Phase 6 judge-privacy memory) and a collusion vector.
 *
 * Detection: any object literal passed to `.on('postgres_changes', { … })`
 * (or `.on(<anything>, { table: 'judge_decisions'|'judge_scores' })`) that
 * names one of the protected tables but does NOT include a `filter:` key.
 *
 * Allowlist: admin contexts (admin can legitimately watch every judge),
 * existing per-round filtered admin-monitor hook, and tests.
 *
 * Canonical definition: docs/audit/forbidden-patterns.md (#12).
 */
const PROTECTED_TABLES = new Set(["judge_decisions", "judge_scores"]);

const DIR_ALLOWLIST = [
  "/components/admin/",
  "/pages/admin/",
  "/test/",
];

const FILE_ALLOWLIST = [
  // Already filters per round server-side and is admin-monitor scope.
  "/src/hooks/judging/useMultiJudgeProgress.ts",
  // R5 per-judge filter hook: filter is injected via `...judgeFilter` spread
  // when distributedMode is on; admin-monitor mode is a documented opt-out.
  // See .lovable/memory/judging/realtime-per-judge-filter-r5.md.
  "/src/hooks/judging/useJudgePhotoData.ts",
];

function isAllowlisted(filename) {
  if (!filename) return true;
  const norm = filename.replace(/\\/g, "/");
  if (FILE_ALLOWLIST.some((p) => norm.endsWith(p))) return true;
  return DIR_ALLOWLIST.some((p) => norm.includes(p));
}

function getStringPropValue(objNode, key) {
  if (!objNode || objNode.type !== "ObjectExpression") return undefined;
  for (const prop of objNode.properties) {
    if (prop.type !== "Property" || prop.computed) continue;
    const k = prop.key;
    const name =
      k.type === "Identifier" ? k.name : k.type === "Literal" ? k.value : null;
    if (name !== key) continue;
    const v = prop.value;
    if (v.type === "Literal") return v.value;
    return "__non_literal__";
  }
  return undefined;
}

function hasProp(objNode, key) {
  if (!objNode || objNode.type !== "ObjectExpression") return false;
  return objNode.properties.some((p) => {
    if (p.type !== "Property" || p.computed) return false;
    const k = p.key;
    const name =
      k.type === "Identifier" ? k.name : k.type === "Literal" ? k.value : null;
    return name === key;
  });
}

// A spread element (e.g. `...judgeFilter`) might inject `filter:` at runtime.
// We cannot statically prove it does, but flagging it would false-positive on
// the canonical R5 spread pattern. So spreads suppress the warning; if a file
// uses spreads to fake filter presence, allowlist it explicitly with a memory.
function hasSpread(objNode) {
  if (!objNode || objNode.type !== "ObjectExpression") return false;
  return objNode.properties.some((p) => p.type === "SpreadElement");
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid unfiltered realtime subscriptions on judge_decisions / judge_scores (Forbidden Pattern #12). Always pass a server-side filter scoping rows to the current judge.",
    },
    schema: [],
    messages: {
      unfiltered:
        "Forbidden Pattern #12: subscribing to `{{table}}` without a server-side `filter:` " +
        "argument leaks every judge's live decisions to every other judge. " +
        "Add e.g. `filter: 'judge_id=eq.' + currentJudgeId`. " +
        "See docs/audit/forbidden-patterns.md#12.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowlisted(filename)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        if (!callee.property || callee.property.name !== "on") return;

        // .on(event, configObject, handler)
        const args = node.arguments || [];
        if (args.length < 2) return;
        const cfg = args[1];
        if (!cfg || cfg.type !== "ObjectExpression") return;

        const table = getStringPropValue(cfg, "table");
        if (typeof table !== "string") return;
        if (!PROTECTED_TABLES.has(table)) return;

        if (hasProp(cfg, "filter")) return;
        if (hasSpread(cfg)) return;

        context.report({
          node: cfg,
          messageId: "unfiltered",
          data: { table },
        });
      },
    };
  },
};

export default rule;
