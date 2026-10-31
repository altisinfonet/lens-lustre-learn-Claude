// ═══════════════════════════════════════════════════════════════════════════
// D1 · P35 · THE KEYS CHECK (build time). GATE_REGISTER P35: "every table has a
// primary key or a written reason not to; … post_hashtags.author_id indexed."
//
// For every migration named 20261003* or later (the rule starts with the first
// block after Phase 2; older tables are judged live by PROBE_p35_keys.sql):
//   RULE 1 · every CREATE TABLE declares a PRIMARY KEY (inline or as a table
//            constraint), or carries "-- P35: no PK because …" within the three
//            lines above it;
//   RULE 2 · every foreign key it declares (inline REFERENCES or FOREIGN KEY (…))
//            has an index whose LEADING columns are the FK columns, created by any
//            applied migration (the PK and UNIQUE constraints count). An unindexed
//            FK makes every delete of the parent row scan the whole child table.
// READ-ONLY. Usage: node scripts/db-p35-keys-check.mjs [root]  Exit 0/1/2.
// Self-test: scripts/db-p35-keys-check.test.mjs (C-34).
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RULE_FROM = "20261003";
const strip = (s) => s.replace(/--[^\n]*/g, (m) => (/^--\s*P35:/.test(m) ? m : "")).replace(/\/\*[\s\S]*?\*\//g, " ");
const norm = (t) => { t = t.replace(/"/g, "").toLowerCase(); return t.includes(".") ? t : "public." + t; };
const cols = (s) => s.split(",").map((c) => c.trim().replace(/"/g, "").split(/\s+/)[0].toLowerCase()).filter(Boolean);

// split a CREATE TABLE body on top-level commas
function parts(body) { const out = []; let d = 0, cur = ""; for (const ch of body) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map((p) => p.trim()); }
function body(sql, start) { let d = 0; for (let i = start; i < sql.length; i++) { if (sql[i] === "(") d++; else if (sql[i] === ")") { d--; if (d === 0) return sql.slice(start + 1, i); } } return null; }

export function tablesIn(text) {
  const sql = strip(text); const res = [];
  const re = /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi;
  for (const m of sql.matchAll(re)) {
    const b = body(sql, m.index + m[0].length - 1); if (b == null) continue;
    const before = sql.slice(0, m.index).split("\n").slice(-4).join("\n");
    const t = { name: norm(m[1]), pk: null, uniques: [], fks: [], waived: /--\s*P35:\s*no PK because\s+\S.{10,}/i.test(before) };
    for (const p of parts(b)) {
      let x;
      if ((x = /^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i.exec(p))) t.pk = cols(x[1]);
      else if ((x = /^(?:constraint\s+\S+\s+)?unique\s*\(([^)]*)\)/i.exec(p))) t.uniques.push(cols(x[1]));
      else if ((x = /^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)/i.exec(p))) t.fks.push(cols(x[1]));
      else if (!/^(constraint|check|exclude|like)\b/i.test(p)) {
        const c = p.split(/\s+/)[0].replace(/"/g, "").toLowerCase();
        if (/\bprimary\s+key\b/i.test(p)) t.pk = [c];
        if (/\bunique\b/i.test(p)) t.uniques.push([c]);
        if (/\breferences\b/i.test(p)) t.fks.push([c]);
      }
    }
    res.push(t);
  }
  return res;
}
export function indexesIn(text) {
  const sql = strip(text); const res = [];
  for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:"?\w+"?\s+)?on\s+(?:only\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*(?:using\s+\w+\s*)?\(([^)]*)\)/gi))
    res.push({ table: norm(m[1]), cols: cols(m[2]) });
  for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+add\s+(?:constraint\s+\S+\s+)?(?:primary\s+key|unique)\s*\(([^)]*)\)/gi))
    res.push({ table: norm(m[1]), cols: cols(m[2]) });
  return res;
}
const leads = (idx, fk) => fk.every((c, i) => idx[i] === c);
export function judge(files) {
  const allIdx = files.flatMap((f) => indexesIn(f.text));
  const hits = [];
  for (const f of files.filter((f) => f.name.split("/").pop().slice(0, 8) >= RULE_FROM)) {
    for (const t of tablesIn(f.text)) {
      if (!t.pk && !t.waived) hits.push({ file: f.name, rule: 1, what: `${t.name} has no PRIMARY KEY and no '-- P35: no PK because' line` });
      const own = [t.pk, ...t.uniques].filter(Boolean);
      for (const fk of t.fks) {
        if (own.some((k) => leads(k, fk))) continue;
        if (allIdx.some((i) => i.table === t.name && leads(i.cols, fk))) continue;
        hits.push({ file: f.name, rule: 2, what: `${t.name}(${fk}) is a foreign key with no index leading on it` });
      }
    }
  }
  return hits;
}
export function loadTree(root) {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && !/^(UNAPPLIED_|PROBE_)/.test(f)).sort()
    .map((f) => ({ name: "supabase/migrations/" + f, text: readFileSync(join(dir, f), "utf8") }));
}
function main() {
  const root = process.argv[2] || join(fileURLToPath(new URL(".", import.meta.url)), "..");
  let files; try { files = loadTree(root); } catch (e) { console.error("ERROR: " + e.message); process.exit(2); }
  const hits = judge(files);
  console.log("D1 · P35 keys check — GATE_REGISTER P35");
  console.log(`judged ${files.filter((f) => f.name.split("/").pop().slice(0, 8) >= RULE_FROM).length} migration file(s) dated ${RULE_FROM} or later`);
  for (const h of hits) console.log(`  HIT    rule ${h.rule}  ${h.what}  (${h.file})`);
  if (hits.length) { console.log(`FAIL — ${hits.length} hit(s)`); process.exit(1); }
  console.log("PASS — every new table has a primary key (or a written reason) and every new foreign key is indexed");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
