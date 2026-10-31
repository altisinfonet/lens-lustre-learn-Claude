/**
 * audit-v6/no-direct-wallet-ledger-writes — Sprint 0 Phase 0B-2.
 *
 * GUARDRAIL ONLY. Blocks NEW client/frontend direct mutations
 * (insert/update/delete/upsert) on protected wallet/ledger tables.
 * Reads (.select) are NOT blocked.
 *
 * Existing Sprint 0A write sites are allow-listed via
 *   scripts/audits/baselines/wallet-write-baseline.json
 * keyed on { file, line }. Any added/moved write fails CI; cleanup of
 * baselined sites is intentionally deferred to a later phase.
 *
 * Protected tables (Phase 0B-2 scope):
 *   wallet_transactions, wallets, withdrawal_requests,
 *   wallet_reconciliation_log, competition_payment_details,
 *   competition_orders, gift_credits, raw_commitments
 *
 * Forbidden chain shapes (any chain length, any intermediate calls):
 *   supabase.from("<protected>")....insert(...)
 *   supabase.from("<protected>")....update(...)
 *   supabase.from("<protected>")....delete(...)
 *   supabase.from("<protected>")....upsert(...)
 *
 * Edge functions (supabase/functions/**) and *.test.* / *.spec.* files are
 * EXEMPT — server-side writes are the sanctioned path; tests synthesize
 * fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(
  REPO_ROOT,
  "scripts/audits/baselines/wallet-write-baseline.json",
);

const PROTECTED_TABLES = new Set([
  "wallet_transactions",
  "wallets",
  "withdrawal_requests",
  "wallet_reconciliation_log",
  "competition_payment_details",
  "competition_orders",
  "gift_credits",
  "raw_commitments",
]);

const WRITE_METHODS = new Set(["insert", "update", "delete", "upsert"]);

// File-path exemptions (server / test surfaces).
const EXEMPT_PREFIXES = ["supabase/functions/"];
function isExemptFile(rel) {
  if (!rel) return true;
  if (EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (/\.(test|spec)\.(ts|tsx)$/.test(rel)) return true;
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

/** Walk back through MemberExpression / CallExpression chain to find the
 *  closest `.from("<table>")` call that this write is chained off of. */
function findFromTableInChain(node) {
  let cur = node.callee && node.callee.object;
  while (cur) {
    if (
      cur.type === "CallExpression" &&
      cur.callee &&
      cur.callee.type === "MemberExpression" &&
      cur.callee.property &&
      cur.callee.property.type === "Identifier" &&
      cur.callee.property.name === "from"
    ) {
      const arg = cur.arguments && cur.arguments[0];
      if (arg && arg.type === "Literal" && typeof arg.value === "string") {
        return arg.value;
      }
      return null;
    }
    if (cur.type === "MemberExpression") cur = cur.object;
    else if (cur.type === "CallExpression") cur = cur.callee && cur.callee.object;
    else return null;
  }
  return null;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid NEW client-side insert/update/delete/upsert on protected " +
        "wallet/ledger tables. Existing sites are baselined.",
    },
    schema: [],
    messages: {
      newWrite:
        "Sprint 0 Phase 0B-2: NEW client-side `{{op}}` on protected table " +
        "`{{table}}` is forbidden (audit-v6/no-direct-wallet-ledger-writes). " +
        "Route this through an approved edge function / RPC. If you must " +
        "edit a baselined site, re-baseline in a follow-up phase — do not " +
        "silently widen.",
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
        const prop = callee.property;
        if (!prop || prop.type !== "Identifier") return;
        if (!WRITE_METHODS.has(prop.name)) return;

        const table = findFromTableInChain(node);
        if (!table || !PROTECTED_TABLES.has(table)) return;

        const line = node.loc && node.loc.start && node.loc.start.line;
        if (!line) return;
        const key = `${rel}:${line}`;
        if (BASELINE.has(key)) return; // existing, allowed

        context.report({
          node,
          messageId: "newWrite",
          data: { op: prop.name, table },
        });
      },
    };
  },
};

export default rule;
