// ═══════════════════════════════════════════════════════════════════════════
// D1 · P5 · THE CRON-CADENCE CHECK — "no scheduled job runs more often than once
// a minute unless it is demonstrably saturated" (GATE_REGISTER P5, clause 1).
//
// pg_cron takes two schedule forms: five-field cron (at most once a minute) and
// '<n> seconds'. Every cron.schedule(...) in an applied migration is read in
// apply order (UNAPPLIED_* and PROBE_* skipped); the LAST schedule per job name
// counts (cron.unschedule forgets it). A '<n> seconds' schedule is a HIT unless
// scripts/db-p5-cron-cadence-allow.json names the job with the path of its
// saturation evidence (an entry whose path does not exist is an error).
//
// WHAT IT DOES NOT SEE: jobs created outside git (process-post-jobs and the
// production-only process-email-queue were). PROBE_p5_cron_cadence.sql reads
// the live cron.job for those.
// READ-ONLY. Usage: node scripts/db-p5-cron-cadence-check.mjs [root]
// Exit: 0 pass · 1 hit · 2 error. Self-test: scripts/db-p5-cron-cadence-check.test.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function endOfQuote(s, i) { let j = i + 1; for (;;) { const k = s.indexOf("'", j); if (k < 0) return s.length; if (s[k + 1] === "'") { j = k + 2; continue; } return k + 1; } }
export function stripComments(sql) {
  let out = "", i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === "-" && n === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? sql.length : e + 2; out += " "; continue; }
    if (c === "'") { const j = endOfQuote(sql, i); out += sql.slice(i, j); i = j; continue; }
    if (c === "$") { const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i)); if (m) { const e = sql.indexOf(m[0], i + m[0].length); const j = e < 0 ? sql.length : e + m[0].length; out += sql.slice(i, j); i = j; continue; } }
    out += c; i++;
  }
  return out;
}
const SCHED_RE = /cron\.schedule\s*\(\s*'([^']+)'\s*,\s*'([^']*)'/gi;
const UNSCHED_RE = /cron\.unschedule\s*\(\s*'([^']+)'\s*\)/gi;
export const isSubMinute = (s) => /^\s*\d+\s+seconds?\s*$/i.test(s);

export function scan(files) {
  const jobs = new Map();
  for (const { name, text } of files) {
    const sql = stripComments(text);
    const ev = [];
    for (const m of sql.matchAll(SCHED_RE)) ev.push({ at: m.index, job: m[1], schedule: m[2] });
    for (const m of sql.matchAll(UNSCHED_RE)) ev.push({ at: m.index, job: m[1], drop: true });
    ev.sort((a, b) => a.at - b.at);
    for (const e of ev) e.drop ? jobs.delete(e.job) : jobs.set(e.job, { file: name, schedule: e.schedule });
  }
  return jobs;
}
export function judge(jobs, allow, exists = () => true) {
  const hits = [], problems = [];
  for (const [job, v] of jobs) if (isSubMinute(v.schedule) && !(job in allow)) hits.push({ job, ...v });
  for (const [job, path] of Object.entries(allow)) {
    if (job.startsWith("_")) continue;
    if (!jobs.has(job) || !isSubMinute(jobs.get(job).schedule)) problems.push(`allow-list entry ${job} matches no sub-minute job — remove it`);
    else if (typeof path !== "string" || !exists(path)) problems.push(`allow-list entry ${job} names no saturation evidence file (${path})`);
  }
  return { hits, problems };
}
export function loadTree(root) {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && !/^(UNAPPLIED_|PROBE_)/.test(f)).sort()
    .map((f) => ({ name: "supabase/migrations/" + f, text: readFileSync(join(dir, f), "utf8") }));
}
function main() {
  const root = process.argv[2] || join(fileURLToPath(new URL(".", import.meta.url)), "..");
  let files; try { files = loadTree(root); } catch (e) { console.error("ERROR: " + e.message); process.exit(2); }
  const ap = join(root, "scripts", "db-p5-cron-cadence-allow.json");
  const allow = existsSync(ap) ? JSON.parse(readFileSync(ap, "utf8")) : {};
  const jobs = scan(files);
  const { hits, problems } = judge(jobs, allow, (p) => existsSync(join(root, p)));
  console.log("D1 · P5 cron-cadence check — GATE_REGISTER P5 clause 1");
  console.log(`read ${files.length} applied migration file(s); ${jobs.size} cron job(s) as of the last file`);
  for (const [job, v] of jobs) console.log(`  ${isSubMinute(v.schedule) ? (job in allow ? "allowed" : "HIT    ") : "ok     "}  ${job}  [${v.schedule}]  (${v.file})`);
  for (const p of problems) console.log("  ERROR    " + p);
  if (hits.length || problems.length) { console.log(`FAIL — ${hits.length} job(s) more often than once a minute, ${problems.length} allow-list problem(s)`); process.exit(1); }
  console.log("PASS — no job in git runs more often than once a minute");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
