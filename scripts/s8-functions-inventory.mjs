#!/usr/bin/env node
/**
 * S8 / F-REV4-1 — live edge functions vs git, plus who in the DATABASE calls them.
 *
 * Read-only; makes no network call. The supervisor supplies the live list:
 *
 *   --live <file>   the Management API JSON (GET /v1/projects/<ref>/functions,
 *                   as saved by d1-deploy-functions.yml mode=list), OR that
 *                   job's markdown summary table, OR one slug per line.
 *   --db <file>     optional: CSV/TSV output of
 *                   supabase/migrations/PROBE_s8_functions_inventory.sql
 *                   (edge_function,source,refs,git).
 *   --lane <name>   label for the report header.
 *
 * Prints a markdown report: live-not-in-git (the "missing from git" list;
 * their source must come from the dashboard — none is invented here),
 * in-git-not-live, live verify_jwt vs supabase/config.toml, and DB-called
 * names that are not live or not in git. Exit 1 when anything is live but
 * not in git, so it can gate "every live function == git".
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.live) {
  console.error("usage: node scripts/s8-functions-inventory.mjs --live <live.json|summary.md|names.txt> [--db probe.csv] [--lane staging]");
  process.exit(2);
}

const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;

/** @returns {Map<string, {verify_jwt?: string, version?: string}>} */
export function parseLive(text) {
  const out = new Map();
  const t = text.trim();
  if (t.startsWith("[")) {
    for (const f of JSON.parse(t)) {
      if (f && SLUG.test(f.slug ?? "")) out.set(f.slug, { verify_jwt: String(f.verify_jwt), version: String(f.version ?? "") });
    }
    return out;
  }
  for (const line of t.split(/\r?\n/)) {
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells[0] && SLUG.test(cells[0]) && cells[0] !== "slug") out.set(cells[0], { version: cells[1], verify_jwt: cells[2] });
    } else if (SLUG.test(line.trim())) {
      out.set(line.trim(), {});
    }
  }
  return out;
}

export function configJwt(toml) {
  const m = new Map();
  let cur = null;
  for (const line of toml.split(/\r?\n/)) {
    const h = line.match(/^\s*\[functions\.([^\]]+)\]/);
    if (h) { cur = h[1]; continue; }
    if (/^\s*\[/.test(line)) { cur = null; continue; }
    const v = cur && line.match(/^\s*verify_jwt\s*=\s*(true|false)/);
    if (v) m.set(cur, v[1]);
  }
  return m;
}

export function parseDb(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(/[,\t|]/).map((x) => x.trim().replace(/^"|"$/g, "")).filter((x, i) => x || i > 0);
    if (c.length >= 2 && SLUG.test(c[0]) && c[0] !== "edge_function" && c[0] !== "OVERALL") rows.push({ name: c[0], source: c[1], refs: c[2] ?? "" });
  }
  return rows;
}

const live = parseLive(readFileSync(args.live, "utf8"));
const git = new Set(readdirSync("supabase/functions", { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name));
const cfg = existsSync("supabase/config.toml") ? configJwt(readFileSync("supabase/config.toml", "utf8")) : new Map();
const db = args.db ? parseDb(readFileSync(args.db, "utf8")) : [];

const liveNotGit = [...live.keys()].filter((n) => !git.has(n)).sort();
const gitNotLive = [...git].filter((n) => !live.has(n)).sort();
const jwtDrift = [...live.entries()]
  .filter(([n, v]) => v.verify_jwt && cfg.has(n) && cfg.get(n) !== v.verify_jwt)
  .map(([n, v]) => `${n} (live ${v.verify_jwt}, config.toml ${cfg.get(n)})`);
const unpinned = [...live.keys()].filter((n) => git.has(n) && !cfg.has(n)).sort();
const dbNames = [...new Set(db.map((r) => r.name))].sort();
const dbNotLive = live.size ? dbNames.filter((n) => !live.has(n)) : [];
const dbNotGit = dbNames.filter((n) => !git.has(n));

const list = (a) => (a.length ? a.map((x) => `\`${x}\``).join(", ") : "none");
console.log(`## Edge functions${args.lane ? ` on ${args.lane}` : ""}: live vs git\n`);
console.log(`Counts: live=${live.size} git=${git.size} db-called=${dbNames.length}\n`);
console.log(`| check | names |\n|---|---|`);
console.log(`| **Live, not in git** (source must come from the dashboard) | ${list(liveNotGit)} |`);
console.log(`| In git, not live | ${list(gitNotLive)} |`);
console.log(`| verify_jwt: live ≠ config.toml | ${list(jwtDrift)} |`);
console.log(`| Live and in git, no [functions.x] pin in config.toml | ${list(unpinned)} |`);
console.log(`| Called by the DB (cron / SQL), not live | ${list(dbNotLive)} |`);
console.log(`| Called by the DB (cron / SQL), not in git | ${list(dbNotGit)} |`);
process.exit(liveNotGit.length ? 1 : 0);
