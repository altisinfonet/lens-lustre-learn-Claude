// ═══════════════════════════════════════════════════════════════════════════
// D1 · P28 · THE INDEX-REVIEW CHECK — "the ratio checked at review" (GATE P28).
// Rule: docs/evidence/d1/P28/index-ratio-rule.md.
//   1 · every CREATE INDEX in a migration named 20261004* or later carries a
//       "-- P28:" line within the three lines above it (table · rows at launch ·
//       why it pays). Older migrations predate the rule and are not re-judged.
//   2 · scripts/db-p28-index-ratio-reasons.json: every reason is ≥ 40 chars, and
//       its table list equals the list in supabase/migrations/PROBE_p28_index_ratio.sql.
// READ-ONLY. Usage: node scripts/db-p28-index-review-check.mjs [root]   Exit 0/1/2.
// Self-test: scripts/db-p28-index-review-check.test.mjs (C-34).
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RULE_FROM = "20261004";
export function unannotated(text) {
  const lines = text.split("\n"); const hits = [];
  let inBlock = false;
  lines.forEach((l, i) => {
    const code = l.replace(/--.*$/, "");
    if (/\/\*/.test(code)) inBlock = true;
    if (!inBlock && /\bcreate\s+(unique\s+)?index\b/i.test(code)) {
      const above = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      if (!/--[ \t]*P28:[ \t]*\S[^\n]{10,}/.test(above)) hits.push({ line: i + 1, text: l.trim().slice(0, 100) });
    }
    if (/\*\//.test(code)) inBlock = false;
  });
  return hits;
}
export function probeTables(probeSql) {
  const m = /ARRAY\s*\[([^\]]*)\]::text\[\]\s*;\s*--\s*P28-REASONED/i.exec(probeSql);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}
export function checkReasons(reasons, probeSql) {
  const problems = [];
  const keys = Object.keys(reasons).filter((k) => !k.startsWith("_")).sort();
  for (const k of keys) if (typeof reasons[k] !== "string" || reasons[k].trim().length < 40) problems.push(`reason for ${k} is shorter than 40 characters`);
  const pt = probeTables(probeSql);
  if (!pt) problems.push("PROBE_p28_index_ratio.sql has no '-- P28-REASONED' list");
  else if (JSON.stringify(pt) !== JSON.stringify(keys)) problems.push(`PROBE list [${pt}] ≠ reasons file [${keys}]`);
  return problems;
}
function main() {
  const root = process.argv[2] || join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const dir = join(root, "supabase", "migrations");
  let hits = [], problems = [], judged = 0;
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && !/^(UNAPPLIED_|PROBE_)/.test(f) && f.slice(0, 8) >= RULE_FROM).sort()) {
      judged++; for (const h of unannotated(readFileSync(join(dir, f), "utf8"))) hits.push({ file: f, ...h });
    }
    problems = checkReasons(JSON.parse(readFileSync(join(root, "scripts", "db-p28-index-ratio-reasons.json"), "utf8")),
                            readFileSync(join(dir, "PROBE_p28_index_ratio.sql"), "utf8"));
  } catch (e) { console.error("ERROR: " + e.message); process.exit(2); }
  console.log("D1 · P28 index-review check — docs/evidence/d1/P28/index-ratio-rule.md");
  console.log(`judged ${judged} migration file(s) dated ${RULE_FROM} or later`);
  for (const h of hits) console.log(`  HIT    ${h.file}:${h.line}  CREATE INDEX without a '-- P28:' line: ${h.text}`);
  for (const p of problems) console.log("  ERROR  " + p);
  if (hits.length || problems.length) { console.log(`FAIL — ${hits.length} unreviewed index(es), ${problems.length} reasons problem(s)`); process.exit(1); }
  console.log("PASS — every new index carries its review line; reasons file = PROBE list");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
