// ═══════════════════════════════════════════════════════════════════════════
// D1 · P1-H · THE PROFILES-AUTOVACUUM CHECK (build time). R-82 design proof for
// P1's "profiles dead-row ratio below 10 %": the applied migrations, read in
// order (UNAPPLIED_/PROBE_ skipped), must leave public.profiles with per-table
// autovacuum settings under which the worst dead-row ratio before a vacuum,
//     (threshold + scale × N) / (N + threshold + scale × N),
// stays below 10 % at every reference size N: 50 (staging), 131 (production,
// 2026-10-04), 100,000 (launch). ALTER TABLE … SET (…) sets, … RESET (…) clears
// (back to the cluster defaults 50 / 0.2), a later file wins; autovacuum_enabled
// = false anywhere at the end is a hit.
// READ-ONLY. Usage: node scripts/db-p1-autovacuum-check.mjs [root]  Exit 0/1/2.
// Self-test: scripts/db-p1-autovacuum-check.test.mjs (C-34).
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = { threshold: 50, scale: 0.2 };
export const SIZES = [50, 131, 100000];
export const LIMIT = 0.10;
const strip = (s) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, " ");
const RE = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?public"?\.)?"?profiles"?\s+(set|reset)\s*\(([^)]*)\)/gi;

export function settings(files) {
  const s = { threshold: null, scale: null, enabled: true };
  for (const { text } of files) for (const m of strip(text).matchAll(RE)) {
    for (const part of m[2].split(",")) {
      const [k, v] = part.split("=").map((x) => x && x.trim().toLowerCase());
      if (m[1].toLowerCase() === "reset") {
        if (k === "autovacuum_vacuum_threshold") s.threshold = null;
        if (k === "autovacuum_vacuum_scale_factor") s.scale = null;
        if (k === "autovacuum_enabled") s.enabled = true;
      } else {
        if (k === "autovacuum_vacuum_threshold") s.threshold = Number(v);
        if (k === "autovacuum_vacuum_scale_factor") s.scale = Number(v);
        if (k === "autovacuum_enabled") s.enabled = !/^(false|off|0)$/.test(v);
      }
    }
  }
  return s;
}
export const worst = (th, sf, n) => (th + sf * n) / (n + th + sf * n);
export function judge(s) {
  const th = s.threshold ?? DEFAULTS.threshold, sf = s.scale ?? DEFAULTS.scale;
  const rows = SIZES.map((n) => ({ n, worst: worst(th, sf, n) }));
  const hits = rows.filter((r) => r.worst >= LIMIT).map((r) => `N=${r.n}: worst ratio ${(100 * r.worst).toFixed(1)} % ≥ 10 % (threshold ${th}, scale ${sf})`);
  if (!s.enabled) hits.push("autovacuum_enabled = false on profiles");
  return { th, sf, rows, hits };
}
export function loadTree(root) {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && !/^(UNAPPLIED_|PROBE_)/.test(f)).sort()
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), "utf8") }));
}
function main() {
  const root = process.argv[2] || join(fileURLToPath(new URL(".", import.meta.url)), "..");
  let files; try { files = loadTree(root); } catch (e) { console.error("ERROR: " + e.message); process.exit(2); }
  const r = judge(settings(files));
  console.log("D1 · P1-H profiles-autovacuum check (R-82)");
  console.log(`profiles after ${files.length} applied migration(s): threshold ${r.th}, scale ${r.sf}`);
  for (const x of r.rows) console.log(`  N=${String(x.n).padStart(6)}  worst dead-row ratio before a vacuum ${(100 * x.worst).toFixed(1)} %`);
  for (const h of r.hits) console.log("  HIT    " + h);
  if (r.hits.length) { console.log(`FAIL — ${r.hits.length} hit(s)`); process.exit(1); }
  console.log("PASS — profiles is vacuumed before its dead-row ratio can reach 10 % at any reference size");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
