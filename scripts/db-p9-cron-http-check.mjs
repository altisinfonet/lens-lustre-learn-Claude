// ═══════════════════════════════════════════════════════════════════════════
// D1 · P9 · THE CRON-HTTP CHECK — no scheduled job calls HTTP or reads the vault
// in its own command (GATE_REGISTER P9; A-P9-1/2; F-P6-1).
//
// Every cron.schedule('name', 'schedule', <command>) in an applied migration is
// read in apply order (UNAPPLIED_* and PROBE_* skipped); the LAST command per
// job name counts (cron.unschedule forgets it). The command is a HIT when:
//   H1 · it calls net.http_post / net.http_get directly — an HTTP call on every
//        run whether or not there is work, with its target in the command;
//   H2 · it reads vault.decrypted_secrets inline — a decrypt on every run (the
//        P9 gate statement);
//   H3 · it carries a credential-shaped literal ('Bearer …', a JWT 'eyJ…', or a
//        header named *secret*) — copied into cron.job_run_details on every run.
// The shape that passes: the command calls one public function, which decides
// whether there is work and only then reads the vault and calls HTTP
// (20261004_0006 email_queue_tick, 20261004_0007 publish_scheduled_posts_tick).
//
// WHAT IT DOES NOT SEE: jobs created outside git. The live halves are
// PROBE_p9_email_queue_wake.sql and PROBE_p5b_scheduled_posts_tick.sql.
// READ-ONLY. Usage: node scripts/db-p9-cron-http-check.mjs [root]
// Exit: 0 pass · 1 hit · 2 error. Self-test: scripts/db-p9-cron-http-check.test.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./db-p5-cron-cadence-check.mjs";

// cron.schedule( 'name' , 'schedule' , <'…' | $tag$…$tag$> )
const SCHED_RE = /cron\.schedule\s*\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*('(?:[^']|'')*'|\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\4\$)/gi;
const UNSCHED_RE = /cron\.unschedule\s*\(\s*'([^']+)'\s*\)/gi;

export function unquote(lit) {
  if (lit.startsWith("'")) return lit.slice(1, -1).replace(/''/g, "'");
  const tag = /^\$([A-Za-z0-9_]*)\$/.exec(lit)[0];
  return lit.slice(tag.length, lit.length - tag.length);
}
export const RULES = [
  ["H1", "calls net.http_* from the cron command", /\bnet\s*\.\s*http_(post|get)\s*\(/i],
  ["H2", "reads vault.decrypted_secrets inline", /\bvault\s*\.\s*decrypted_secrets\b/i],
  ["H3", "carries a credential-shaped literal", /Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]{10,}|'[^']*secret[^']*'\s*,\s*'[^']{8,}'/i],
];
export function scan(files) {
  const jobs = new Map();
  for (const { name, text } of files) {
    const sql = stripComments(text);
    const ev = [];
    for (const m of sql.matchAll(SCHED_RE)) ev.push({ at: m.index, job: m[1], schedule: m[2], command: unquote(m[3]) });
    for (const m of sql.matchAll(UNSCHED_RE)) ev.push({ at: m.index, job: m[1], drop: true });
    ev.sort((a, b) => a.at - b.at);
    for (const e of ev) e.drop ? jobs.delete(e.job) : jobs.set(e.job, { file: name, schedule: e.schedule, command: e.command });
  }
  return jobs;
}
export function judge(jobs) {
  const hits = [];
  for (const [job, v] of jobs) for (const [id, what, re] of RULES) if (re.test(v.command)) hits.push({ job, id, what, file: v.file });
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
  const jobs = scan(files);
  const hits = judge(jobs);
  console.log("D1 · P9 cron-HTTP check — no HTTP, vault read or credential in a cron command");
  console.log(`read ${files.length} applied migration file(s); ${jobs.size} cron job(s) as of the last file`);
  for (const [job, v] of jobs) {
    const h = hits.filter((x) => x.job === job).map((x) => x.id);
    console.log(`  ${h.length ? "HIT " + h.join("+").padEnd(4) : "ok      "}  ${job}  [${v.schedule}]  (${v.file})`);
  }
  for (const h of hits) console.log(`  ${h.id}  ${h.job}: ${h.what}`);
  if (hits.length) { console.log(`FAIL — ${hits.length} hit(s). Call one public function that checks for work, then reads the vault and calls HTTP.`); process.exit(1); }
  console.log("PASS — no cron command in git calls HTTP, reads the vault or carries a credential");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
