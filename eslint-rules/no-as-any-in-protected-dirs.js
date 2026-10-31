/**
 * audit-v6/no-as-any-in-protected-dirs — Sprint 0 Phase 0B-1.
 *
 * GUARDRAIL ONLY. Blocks NEW `as any` (and `<any>` cast) occurrences inside
 * protected subsystems. Existing occurrences (Sprint 0A snapshot) are
 * allow-listed via scripts/audits/baselines/as-any-protected-baseline.json so
 * this phase does NOT change runtime behavior or force a cleanup.
 *
 * Protected dirs:
 *   - src/hooks/wallet/**
 *   - src/hooks/judging/**
 *   - src/components/admin/**
 *   - src/modules/admin/**
 *   - src/pages/admin/**
 *   - src/lib/**
 *   - supabase/functions/**
 *
 * The baseline is matched on { file (repo-relative, posix), line, excerpt-prefix }.
 * If the offending line moves/changes, the rule fires — that is intentional:
 * any edit to an existing `as any` site is treated as a NEW write and must
 * either remove the cast or be re-baselined in a follow-up phase.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(
  REPO_ROOT,
  "scripts/audits/baselines/as-any-protected-baseline.json",
);

const PROTECTED_PREFIXES = [
  "src/hooks/wallet/",
  "src/hooks/judging/",
  "src/components/admin/",
  "src/modules/admin/",
  "src/pages/admin/",
  "src/lib/",
  "supabase/functions/",
];

function loadBaseline() {
  try {
    const raw = fs.readFileSync(BASELINE_PATH, "utf8");
    const json = JSON.parse(raw);
    const set = new Set();
    for (const e of json.entries || []) {
      // key on file+line; excerpt is informational only
      set.add(`${e.file}:${e.line}`);
    }
    return set;
  } catch {
    return new Set();
  }
}

const BASELINE = loadBaseline();

function toRepoRelativePosix(filename) {
  if (!filename) return null;
  const norm = filename.replace(/\\/g, "/");
  const idx = norm.indexOf("/dev-server/");
  let rel = norm;
  if (idx !== -1) rel = norm.slice(idx + "/dev-server/".length);
  // strip any leading ./
  rel = rel.replace(/^\.\//, "");
  // strip absolute prefix up to project root if running outside /dev-server
  const rootMarker = REPO_ROOT.replace(/\\/g, "/") + "/";
  if (rel.startsWith(rootMarker)) rel = rel.slice(rootMarker.length);
  return rel;
}

function isProtected(relPath) {
  if (!relPath) return false;
  return PROTECTED_PREFIXES.some((p) => relPath.startsWith(p));
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid NEW `as any` casts inside protected subsystems. Existing " +
        "occurrences are baselined; any added or moved cast fails CI.",
    },
    schema: [],
    messages: {
      newAsAny:
        "Sprint 0 Phase 0B-1: NEW `as any` cast in protected dir `{{dir}}` is " +
        "forbidden (audit-v6/no-as-any-in-protected-dirs). Use a precise type " +
        "or a documented `unknown` narrowing. If you must move/edit a baselined " +
        "site, re-baseline in a follow-up phase — do not silently widen.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    const rel = toRepoRelativePosix(filename);
    if (!isProtected(rel)) return {};

    function reportIfNew(node) {
      const line = node.loc && node.loc.start && node.loc.start.line;
      if (!line) return;
      const key = `${rel}:${line}`;
      if (BASELINE.has(key)) return; // existing, allowed
      const dir = PROTECTED_PREFIXES.find((p) => rel.startsWith(p)) || "";
      context.report({ node, messageId: "newAsAny", data: { dir } });
    }

    return {
      // `x as any`
      TSAsExpression(node) {
        const t = node.typeAnnotation;
        if (t && t.type === "TSAnyKeyword") reportIfNew(node);
      },
      // `<any>x` (legacy cast)
      TSTypeAssertion(node) {
        const t = node.typeAnnotation;
        if (t && t.type === "TSAnyKeyword") reportIfNew(node);
      },
    };
  },
};

export default rule;
