/**
 * no-raw-progression-decision — Audit v6 B0.2.
 *
 * Forbids surfacing the raw `progression_decision` column into UI / non-judging
 * layers via PostgREST/Supabase string APIs. Specifically blocks:
 *
 *   1. `.select("...progression_decision...")`     — column projected into payload
 *   2. `.update({ progression_decision: ... })`    — column written
 *   3. `.insert({ progression_decision: ... })`    — column written
 *   4. `.upsert({ progression_decision: ... })`    — column written
 *   5. `{ progression_decision: ... }` literal as the FIRST arg to `.rpc(...)`
 *      (RPC payloads carrying raw catalog tokens)
 *
 * Why a separate rule from `no-raw-entry-status`?
 *   `no-raw-entry-status` only catches MEMBER access (`entry.progression_decision`)
 *   and PostgREST string filters (`.eq("progression_decision", "winner")`).
 *   It does NOT catch:
 *     - `.select("id, progression_decision, ...")` — column leaks into payload
 *     - `.update({ progression_decision: "r2_qualified_r3" })` — silent legacy write
 *   Phase B0.2 closes that gap so any new code reading or writing the column
 *   outside the audited judging-internal layer is rejected at lint time.
 *
 * Allowlist: identical philosophy to no-raw-entry-status.
 */
const COLUMN = "progression_decision";

const MUTATION_METHODS = new Set(["update", "insert", "upsert"]);

const DIR_ALLOWLIST = [
  // Judging internals — they OWN this column.
  "/hooks/judging/",
  "/lib/judging/",
  "/components/judge/",
  // Admin surfaces — they audit/repair this column directly.
  "/components/admin/",
  "/pages/admin/",
  "/modules/admin/",
  "/services/admin/",
  // Drift / audit panels are admin-only.
  "/pages/JudgePanel",
  "/pages/Certificates",
  // Tests + the rule files themselves.
  "/test/",
  "/eslint-rules/",
];

const FILE_ALLOWLIST = [
  // SubmissionDetail — selects the column to feed into the gated-status hook.
  // The raw value never reaches render; gating is mandatory downstream.
  "/src/pages/SubmissionDetail.tsx",
  // Server-side writer — DB is the source of truth boundary, not UI.
  // (dashboard-init/index.ts removed: confirmed 0 references on B0.2 audit.)
  "/supabase/functions/complete-round/index.ts",
];

function isAllowlisted(filename) {
  if (!filename) return true;
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

/** Token-aware match: word-boundary on the column name in a select column-list. */
function selectStringContainsColumn(s) {
  if (typeof s !== "string") return false;
  // PostgREST select strings are comma-separated; tokens may include
  // alias / nested forms (e.g. "alias:progression_decision"). Word-boundary
  // match avoids false positives on hypothetical "xprogression_decisiony".
  const re = new RegExp(`(^|[\\s,(:])${COLUMN}(\\s|$|,|\\)|!)`);
  return re.test(s);
}

function objectExpressionHasColumn(node) {
  if (!node || node.type !== "ObjectExpression") return false;
  return node.properties.some((p) => {
    if (!p || p.type !== "Property") return false;
    if (p.computed) return false;
    const k = p.key;
    if (k.type === "Identifier" && k.name === COLUMN) return true;
    if (k.type === "Literal" && k.value === COLUMN) return true;
    return false;
  });
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw .select / .update / .insert / .upsert / .rpc payloads that " +
        "reference the `progression_decision` column outside the audited judging " +
        "and admin layers. Use the gated status hooks / RPCs instead.",
    },
    schema: [],
    messages: {
      select:
        "Audit v6 B0.2: `.select(\"...progression_decision...\")` projects the " +
        "raw catalog token into UI payload. Drop the column and consume status " +
        "via useGatedEntryStatus / useEntryPublicStatus, or move this query " +
        "into hooks/judging/** (allowlisted).",
      mutation:
        "Audit v6 B0.2: `.{{method}}({ progression_decision: ... })` writes a " +
        "raw catalog token. This must happen only in server-side judging " +
        "writers (complete-round / dashboard-init / hooks/judging/**).",
      rpc:
        "Audit v6 B0.2: passing `{ progression_decision: ... }` to `.rpc(...)` " +
        "leaks raw catalog tokens through the API boundary. Use a gated RPC " +
        "or move the call into the allowlisted judging layer.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowlisted(filename)) return {};

    function checkCall(node) {
      const callee = node.callee;
      if (!callee || callee.type !== "MemberExpression" || callee.computed) return;
      const methodName = callee.property && callee.property.name;
      if (!methodName) return;
      const args = node.arguments;
      if (!args || args.length === 0) return;

      // 1. .select("...progression_decision...")
      if (methodName === "select") {
        const lit = literalString(args[0]);
        if (lit && selectStringContainsColumn(lit)) {
          context.report({ node, messageId: "select" });
        }
        return;
      }

      // 2. .update / .insert / .upsert / .rpc with { progression_decision: ... }
      if (MUTATION_METHODS.has(methodName)) {
        const arg = args[0];
        if (objectExpressionHasColumn(arg)) {
          context.report({ node, messageId: "mutation", data: { method: methodName } });
        }
        // .insert / .upsert can take an array of objects
        if (arg && arg.type === "ArrayExpression") {
          for (const el of arg.elements) {
            if (objectExpressionHasColumn(el)) {
              context.report({ node, messageId: "mutation", data: { method: methodName } });
              break;
            }
          }
        }
        return;
      }

      if (methodName === "rpc") {
        // .rpc("name", { progression_decision: ... })
        const payload = args[1];
        if (objectExpressionHasColumn(payload)) {
          context.report({ node, messageId: "rpc" });
        }
        return;
      }
    }

    return { CallExpression: checkCall };
  },
};

export default rule;
