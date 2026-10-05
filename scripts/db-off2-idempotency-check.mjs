// ═══════════════════════════════════════════════════════════════════════════
// D1 · OFF-2 · THE EXACTLY-ONCE CHECK — every outbox action table can refuse a
// repeated send (MASTER R-90 OFF-2; OFF-5 §3 R4 + R8).
//
// Reads scripts/db-off2-outbox-contract.json and the applied migrations
// (UNAPPLIED_* and PROBE_* skipped), in order:
//   K1 · every table OFF-5 marks QUEUED (OUTBOX_TABLES below) is in the contract;
//   K2 · every 'key' entry: some migration adds <table>.idempotency_key and
//        creates the named UNIQUE (CREATE UNIQUE INDEX <name> … or CONSTRAINT
//        <name> UNIQUE …), and no LATER migration drops either;
//   K3 · the live probe (PROBE_off2_idempotency.sql) names every contract table,
//        so the build list and the live list cannot drift.
// 'natural' and 'update-only' entries are judged live only (their unique
// indexes were created inline by older migrations, often unnamed).
// READ-ONLY. Usage: node scripts/db-off2-idempotency-check.mjs [root]
// Exit: 0 pass · 1 hit · 2 error. Self-test: scripts/db-off2-idempotency-check.test.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./db-p5-cron-cadence-check.mjs";

/** OFF-5 §2: the tables written by a QUEUED action. */
export const OUTBOX_TABLES = ["posts", "post_comments", "post_reactions", "follows", "friendships", "user_notifications", "reports"];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tbl = (t) => `(?:public\\.)?"?${esc(t)}"?`;

export function judge(contract, files, probeText) {
  const hits = [];
  const tables = contract?.tables || {};
  for (const t of OUTBOX_TABLES) if (!(t in tables)) hits.push(`K1 ${t}: an outbox action table is missing from the contract`);
  const sqls = files.map((f) => ({ name: f.name, sql: stripComments(f.text) }));
  for (const [t, e] of Object.entries(tables)) {
    if (!["key", "natural", "update-only"].includes(e.kind)) { hits.push(`K1 ${t}: unknown kind ${e.kind}`); continue; }
    if (e.kind !== "key") continue;
    const addCol = new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?${tbl(t)}[^;]*?add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?idempotency_key\\b`, "i");
    const dropCol = new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?${tbl(t)}[^;]*?drop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?idempotency_key\\b`, "i");
    const mkUniq = new RegExp(`create\\s+unique\\s+index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${esc(e.unique)}\\b|constraint\\s+${esc(e.unique)}\\s+unique\\b`, "i");
    const dropUniq = new RegExp(`drop\\s+(?:index|constraint)\\s+(?:concurrently\\s+)?(?:if\\s+exists\\s+)?(?:public\\.)?${esc(e.unique)}\\b`, "i");
    let col = null, uq = null;
    for (const { name, sql } of sqls) {
      if (addCol.test(sql)) col = name;
      if (col && dropCol.test(sql) && !addCol.test(sql.slice(sql.search(dropCol)))) col = null;
      if (mkUniq.test(sql)) uq = name;
      if (uq && dropUniq.test(sql) && !mkUniq.test(sql.slice(sql.search(dropUniq)))) uq = null;
    }
    if (!col) hits.push(`K2 ${t}: no applied migration adds ${t}.idempotency_key (or a later one drops it)`);
    if (!uq) hits.push(`K2 ${t}: no applied migration creates UNIQUE ${e.unique} (or a later one drops it)`);
  }
  if (typeof probeText === "string") for (const t of Object.keys(tables)) if (!new RegExp(`'${esc(t)}'`).test(probeText)) hits.push(`K3 ${t}: PROBE_off2_idempotency.sql does not judge it`);
  return hits;
}
export function loadTree(root) {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && !/^(UNAPPLIED_|PROBE_)/.test(f)).sort()
    .map((f) => ({ name: "supabase/migrations/" + f, text: readFileSync(join(dir, f), "utf8") }));
}
function main() {
  const root = process.argv[2] || join(fileURLToPath(new URL(".", import.meta.url)), "..");
  let contract, files, probe;
  try {
    contract = JSON.parse(readFileSync(join(root, "scripts", "db-off2-outbox-contract.json"), "utf8"));
    files = loadTree(root);
    try { probe = readFileSync(join(root, "supabase", "migrations", "PROBE_off2_idempotency.sql"), "utf8"); } catch { probe = ""; }
  } catch (e) { console.error("ERROR: " + e.message); process.exit(2); }
  const hits = judge(contract, files, probe);
  console.log("D1 · OFF-2 exactly-once check — every outbox action table refuses a repeated send");
  console.log(`read ${files.length} applied migration file(s); contract: ${Object.keys(contract.tables).length} table(s)`);
  for (const [t, e] of Object.entries(contract.tables)) console.log(`  ${e.kind.padEnd(11)} ${t}${e.unique ? "  [" + e.unique + "]" : e.columns ? "  (" + e.columns.join(", ") + ")" : ""}`);
  for (const h of hits) console.log("  HIT  " + h);
  if (hits.length) { console.log(`FAIL — ${hits.length} hit(s): a repeated outbox send can create a second row`); process.exit(1); }
  console.log("PASS — every outbox action table has its exactly-once key in git (natural keys: judged live by the PROBE)");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
