// ═══════════════════════════════════════════════════════════════════════════
// D1 · P6 · THE CRON-HISTORY CHECK (build time). GATE_REGISTER P6:
// "cron.job_run_details retention set to 24–48 hours; purge runs in bounded
// batches; …". Reads applied migrations (UNAPPLIED_/PROBE_ skipped) in order.
//   RULE 1 · the LAST cron.schedule of 'purge-cron-history' exists and CALLs
//            public.purge_cron_run_details;
//   RULE 2 · the LAST definition of purge_cron_run_details defaults _keep to a
//            value in 24–48 hours, deletes with LIMIT _batch, COMMITs per batch,
//            and refuses a _keep outside 24–48 h;
//   RULE 3 · nothing else (no other cron command, function or procedure body)
//            deletes from cron.job_run_details — an unbounded purge is a hit.
// READ-ONLY. Usage: node scripts/db-p6-cron-history-check.mjs [root]  Exit 0/1/2.
// Self-test: scripts/db-p6-cron-history-check.test.mjs (C-34).
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const strip = (s) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, " ");
const SCHED = /cron\.schedule\s*\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*(?:(\$(?:[A-Za-z_]\w*)?\$)([\s\S]*?)\3|'((?:[^']|'')*)')/gi;
const UNSCHED = /cron\.unschedule\s*\(\s*'([^']+)'\s*\)/gi;
const ROUTINE = /create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+((?:"?\w+"?\.)?"?(\w+)"?)\s*\(([\s\S]*?)\)\s*(?:returns[\s\S]*?)?(?:language[\s\S]*?)?\bas\s+(\$([A-Za-z_]\w*)?\$)([\s\S]*?)\4/gi;

export function scan(files) {
  const jobs = new Map(); const routines = new Map();
  for (const { name, text } of files) {
    const s = strip(text); const ev = [];
    for (const m of s.matchAll(SCHED)) ev.push({ at: m.index, k: "s", job: m[1], schedule: m[2], cmd: m[4] ?? (m[5] ?? '').replace(/''/g, "'") });
    for (const m of s.matchAll(UNSCHED)) ev.push({ at: m.index, k: "u", job: m[1] });
    for (const m of s.matchAll(ROUTINE)) ev.push({ at: m.index, k: "r", name: m[2].toLowerCase(), args: m[3], body: m[6], file: name });
    ev.sort((a, b) => a.at - b.at);
    for (const e of ev) {
      if (e.k === "s") jobs.set(e.job, { schedule: e.schedule, cmd: e.cmd, file: name });
      else if (e.k === "u") jobs.delete(e.job);
      else routines.set(e.name, e);
    }
  }
  return { jobs, routines };
}
const hours = (iv) => { const m = /(\d+)\s*hours?/i.exec(iv || ""); const d = /(\d+)\s*days?/i.exec(iv || ""); return m ? +m[1] : d ? +d[1] * 24 : null; };
export function judge({ jobs, routines }) {
  const hits = [];
  const j = jobs.get("purge-cron-history");
  if (!j) hits.push("rule 1: no cron.schedule('purge-cron-history', …) in git");
  else if (!/call\s+public\.purge_cron_run_details/i.test(j.cmd)) hits.push(`rule 1: purge-cron-history runs "${j.cmd.trim().slice(0, 80)}", not CALL public.purge_cron_run_details`);
  const p = routines.get("purge_cron_run_details");
  if (!p) hits.push("rule 2: purge_cron_run_details is not defined in git");
  else {
    const keep = hours(/_keep\s+interval\s+default\s+(?:interval\s+)?'([^']+)'/i.exec(p.args)?.[1]);
    if (keep === null || keep < 24 || keep > 48) hits.push(`rule 2: default _keep is ${keep ?? "missing"} h, not 24–48 h`);
    if (!/limit\s+_batch/i.test(p.body)) hits.push("rule 2: the DELETE is not bounded by LIMIT _batch");
    if (!/\bcommit\b/i.test(p.body)) hits.push("rule 2: no COMMIT between batches");
    if (!/'24 hours'/.test(p.body) || !/'48 hours'/.test(p.body)) hits.push("rule 2: the procedure does not refuse a _keep outside 24–48 h");
  }
  for (const [job, v] of jobs) if (job !== "purge-cron-history" && /job_run_details/i.test(v.cmd)) hits.push(`rule 3: job ${job} touches cron.job_run_details`);
  for (const [n, r] of routines) if (n !== "purge_cron_run_details" && /delete\s+from\s+cron\.job_run_details/i.test(r.body)) hits.push(`rule 3: ${n}() deletes from cron.job_run_details (${r.file})`);
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
  const hits = judge(scan(files));
  console.log("D1 · P6 cron-history check — GATE_REGISTER P6");
  console.log(`read ${files.length} applied migration file(s)`);
  for (const h of hits) console.log("  HIT    " + h);
  if (hits.length) { console.log(`FAIL — ${hits.length} hit(s)`); process.exit(1); }
  console.log("PASS — purge-cron-history calls a bounded 24–48 h purge, and nothing else purges cron history");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
