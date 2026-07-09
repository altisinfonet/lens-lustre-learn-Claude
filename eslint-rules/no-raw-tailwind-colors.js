/**
 * no-raw-tailwind-colors — Phase 4 slice (UI low-risk).
 *
 * Forbids raw Tailwind palette color classes in className strings, e.g.
 *   bg-blue-500, text-red-600, border-green-400, ring-yellow-300, from-pink-500.
 * Use design-system tokens instead (bg-primary, text-destructive, border-muted,
 * ring-ring, etc.) defined in src/index.css + tailwind.config.ts.
 *
 * Lint-only guardrail. Does NOT migrate existing occurrences — those are
 * baselined by leaving this rule at "warn" until Phase 4 full sweep. Flip to
 * "error" once src/** is clean.
 *
 * Allowlisted dirs (legitimate / out-of-scope):
 *   - eslint-rules/        (this rule itself)
 *   - src/test/, **__tests__**, *.test.ts, *.spec.ts
 *   - tailwind.config.ts   (palette definitions)
 *   - src/index.css        (token definitions)
 */

const PALETTES = [
  "slate","gray","zinc","neutral","stone",
  "red","orange","amber","yellow","lime","green","emerald","teal","cyan","sky","blue","indigo","violet","purple","fuchsia","pink","rose",
];
const PROPS = ["bg","text","border","ring","from","via","to","fill","stroke","divide","outline","placeholder","caret","accent","decoration","shadow"];
const SHADES = "(?:50|100|200|300|400|500|600|700|800|900|950)";
const RAW_RE = new RegExp(
  `\\b(?:${PROPS.join("|")})-(?:${PALETTES.join("|")})-${SHADES}\\b`,
);

const DIR_ALLOWLIST = [
  "/eslint-rules/",
  "/src/test/",
  "/__tests__/",
  "/tailwind.config",
  "/src/index.css",
];

function isAllowed(filename) {
  if (!filename) return false;
  if (/\.(test|spec)\.[tj]sx?$/.test(filename)) return true;
  return DIR_ALLOWLIST.some((d) => filename.includes(d));
}

function checkLiteral(context, node, value) {
  if (typeof value !== "string") return;
  const m = value.match(RAW_RE);
  if (m) {
    context.report({
      node,
      message: `Raw Tailwind color class "${m[0]}" is forbidden. Use a semantic design-system token (e.g. bg-primary, text-destructive, border-muted) defined in src/index.css.`,
    });
  }
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw Tailwind palette color classes in className strings; require semantic design tokens.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowed(filename)) return {};
    return {
      Literal(node) {
        checkLiteral(context, node, node.value);
      },
      TemplateElement(node) {
        checkLiteral(context, node, node.value && node.value.cooked);
      },
    };
  },
};
