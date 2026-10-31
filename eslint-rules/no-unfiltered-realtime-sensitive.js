/**
 * audit-v6/no-unfiltered-realtime-sensitive — Sprint 0 Phase 0B-4.
 *
 * GUARDRAIL ONLY. Blocks NEW `.on('postgres_changes', { table: '<sensitive>' })`
 * subscriptions that lack an explicit server-side `filter:` argument.
 *
 * Sensitive domains (admin, judging, finance/wallet, notifications,
 * roles, moderation). Reads only — does not change runtime behavior.
 *
 * Existing Sprint 0A-snapshot subscription sites are allow-listed via
 *   scripts/audits/baselines/realtime-filter-baseline.json
 * keyed on { file, line }. Any added/moved subscription on a sensitive
 * table without a `filter:` (or `...spread`, see note) fails CI.
 *
 * Spread suppression: the canonical R5 per-judge realtime hook injects
 * `filter:` via `...judgeFilter`. To avoid false positives on that
 * pattern, an object literal containing a SpreadElement suppresses the
 * warning. If a file uses spread to hide an unfiltered subscription,
 * baseline it explicitly with a `note`.
 *
 * Edge functions (supabase/functions/**) and *.test.* / *.spec.* files
 * are EXEMPT (server / test surfaces).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(
  REPO_ROOT,
  "scripts/audits/baselines/realtime-filter-baseline.json",
);

const PROTECTED_TABLES = new Set([
  // admin / moderation
  "admin_notifications",
  "admin_vote_adjustments",
  "support_tickets",
  // judging
  "judge_decisions",
  "judge_scores",
  "judge_tag_assignments",
  "judge_comments",
  "judging_rounds",
  "judging_preflight_log",
  "judge_sessions",
  // finance / wallet
  "wallet_transactions",
  "wallets",
  "withdrawal_requests",
  "wallet_reconciliation_log",
  "gift_credits",
  "gift_announcements",
  "competition_votes",
  // notifications
  "user_notifications",
  "notifications",
  "notification_emit_log",
  // roles
  "user_roles",
  "user_badges",
]);

const EXEMPT_PREFIXES = ["supabase/functions/"];
function isExemptFile(rel) {
  if (!rel) return true;
  if (EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (/\.(test|spec)\.(ts|tsx)$/.test(rel)) return true;
  if (rel.startsWith("src/test/")) return true;
  return false;
}

function loadBaseline() {
  try {
    const raw = fs.readFileSync(BASELINE_PATH, "utf8");
    const json = JSON.parse(raw);
    const set = new Set();
    for (const e of json.entries || []) set.add(`${e.file}:${e.line}`);
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
  rel = rel.replace(/^\.\//, "");
  const rootMarker = REPO_ROOT.replace(/\\/g, "/") + "/";
  if (rel.startsWith(rootMarker)) rel = rel.slice(rootMarker.length);
  return rel;
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

function hasSpread(objNode) {
  if (!objNode || objNode.type !== "ObjectExpression") return false;
  return objNode.properties.some((p) => p.type === "SpreadElement");
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid NEW realtime postgres_changes subscriptions on sensitive " +
        "tables without an explicit server-side `filter:`.",
    },
    schema: [],
    messages: {
      unfiltered:
        "Sprint 0 Phase 0B-4: NEW realtime subscription on sensitive table " +
        "`{{table}}` without `filter:` is forbidden " +
        "(audit-v6/no-unfiltered-realtime-sensitive). Add e.g. " +
        "`filter: 'user_id=eq.' + currentUserId` or baseline this site " +
        "with a documented note.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    const rel = toRepoRelativePosix(filename);
    if (isExemptFile(rel)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        if (!callee.property || callee.property.name !== "on") return;

        const args = node.arguments || [];
        if (args.length < 2) return;
        const cfg = args[1];
        if (!cfg || cfg.type !== "ObjectExpression") return;

        const table = getStringPropValue(cfg, "table");
        if (typeof table !== "string") return;
        if (!PROTECTED_TABLES.has(table)) return;

        if (hasProp(cfg, "filter")) return;
        if (hasSpread(cfg)) return;

        // Key on the ObjectExpression's start line — chained `.on(...).on(...)`
        // calls share the same CallExpression start line, so we must use cfg.
        const line = cfg.loc && cfg.loc.start && cfg.loc.start.line;
        if (!line) return;
        const key = `${rel}:${line}`;
        if (BASELINE.has(key)) return;

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
