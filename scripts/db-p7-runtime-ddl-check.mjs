// ═══════════════════════════════════════════════════════════════════════════
// D1 · P7 · THE RUNTIME-DDL CHECK — "no schema-cache reload outside a deployment"
//
// GATE (docs/gates/GATE_REGISTER.md, P7): "no schema-cache reload is triggered
// outside a deployment; …". R-82 replaces the traffic half with a design proof:
// an enforced guard plus a synthetic test.
//
// HOW A RELOAD HAPPENS ON SUPABASE. PostgREST reloads its whole schema cache —
// the introspection queries that were 10.3 % of production database time in the
// baseline — whenever it hears NOTIFY pgrst. Two event triggers send that
// (read on staging fpszggreishhuvdpkmdr, 2026-10-04):
//   · extensions.pgrst_ddl_watch  (ddl_command_end) on CREATE/ALTER SCHEMA,
//     CREATE TABLE, CREATE TABLE AS, SELECT INTO, ALTER TABLE, CREATE/ALTER
//     FOREIGN TABLE, CREATE/ALTER VIEW, CREATE/ALTER MATERIALIZED VIEW,
//     CREATE/ALTER FUNCTION, CREATE TRIGGER, CREATE/ALTER TYPE, CREATE RULE,
//     COMMENT — unless the object is in pg_temp;
//   · extensions.pgrst_drop_watch (sql_drop) on dropping any of those.
// A deployment is a migration: its DDL runs once, from apply-migration.yml, and
// one reload then is correct. A reload OUTSIDE a deployment is DDL that runs at
// RUNTIME — inside a function or procedure body, or inside a cron job's command
// — so it fires on every call. This check makes that a red build.
//
// WHAT IT READS. supabase/migrations/*.sql, in filename order (the apply order),
// skipping UNAPPLIED_* (never applied) and PROBE_* (read-only probes, dispatched
// by hand). For every CREATE [OR REPLACE] FUNCTION/PROCEDURE it keeps the LAST
// definition per name+arguments (DROP FUNCTION forgets it), so a function that
// was fixed in a later migration is judged on its fixed body. For every
// cron.schedule it keeps the last command per job name (cron.unschedule forgets it).
//
// WHAT IS A HIT (any one fails the check):
//   RULE A · a function/procedure body, or a cron command, runs a statement on
//            the pgrst lists above against a non-temporary object (CREATE TEMP /
//            TEMPORARY TABLE and anything qualified pg_temp. are exempt — the
//            event trigger skips them too);
//   RULE B · it runs DDL built at runtime: EXECUTE / format() whose string
//            starts with one of those statements (dynamic DDL cannot be judged
//            temp or not, so it is a hit unless allow-listed);
//   RULE C · it sends the reload itself: NOTIFY pgrst / pg_notify('pgrst', …).
//
// ALLOW-LIST. scripts/db-p7-runtime-ddl-allow.json maps a function signature or
// "cron:<jobname>" to a written reason (e.g. an admin-only one-off). An entry
// with an empty reason is an error; an entry that no longer matches anything is
// an error too, so the list cannot rot.
//
// WHAT IT DOES NOT SEE (stated, so nobody mistakes it for more):
//   · DDL issued by something outside git (the dashboard, a tool applying SQL
//     through the Management API). The PROBE in supabase/migrations/
//     PROBE_p7_no_runtime_ddl.sql reads the LIVE catalogue for that.
//   · A statement assembled from several string pieces where none of them begins
//     with a DDL verb. RULE B looks at each literal.
//
// READ-ONLY: reads files, writes nothing, connects to nothing, holds no secret.
// Usage:  node scripts/db-p7-runtime-ddl-check.mjs [rootDir]
// Exit:   0 = no runtime DDL; 1 = at least one hit; 2 = error.
// C-34: scripts/db-p7-runtime-ddl-check.test.mjs plants each shape it must catch
// and each it must not, and shows a check that is red on the bad tree.
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The pgrst_ddl_watch / pgrst_drop_watch command lists, as statement prefixes.
const DDL = [
  "CREATE SCHEMA", "ALTER SCHEMA", "DROP SCHEMA",
  "CREATE TABLE", "CREATE UNLOGGED TABLE", "ALTER TABLE", "DROP TABLE",
  "CREATE FOREIGN TABLE", "ALTER FOREIGN TABLE", "DROP FOREIGN TABLE",
  "CREATE VIEW", "CREATE OR REPLACE VIEW", "ALTER VIEW", "DROP VIEW",
  "CREATE MATERIALIZED VIEW", "ALTER MATERIALIZED VIEW", "DROP MATERIALIZED VIEW",
  "CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", "ALTER FUNCTION", "DROP FUNCTION",
  "CREATE PROCEDURE", "CREATE OR REPLACE PROCEDURE", "DROP PROCEDURE",
  "CREATE TRIGGER", "CREATE OR REPLACE TRIGGER", "DROP TRIGGER",
  "CREATE TYPE", "ALTER TYPE", "DROP TYPE",
  "CREATE RULE", "CREATE OR REPLACE RULE", "DROP RULE",
  "COMMENT ON",
];
const ddlRe = new RegExp(
  "(^|[;\\s(])(" + DDL.map((s) => s.replace(/ /g, "\\s+")).join("|") + ")\\b", "gi");

// ── SQL helpers ────────────────────────────────────────────────────────────
// Remove -- and /* */ comments, keeping string literals and dollar quotes intact.
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
function endOfQuote(s, i) { let j = i + 1; for (;;) { const k = s.indexOf("'", j); if (k < 0) return s.length; if (s[k + 1] === "'") { j = k + 2; continue; } return k + 1; } }

// Blank every '…' literal (same length) so the statement scan never reads inside one.
export function blankLiterals(code) {
  let out = "", i = 0;
  while (i < code.length) {
    if (code[i] === "'") { const j = endOfQuote(code, i); out += "'" + " ".repeat(Math.max(0, j - i - 2)) + "'"; i = j; continue; }
    out += code[i]; i++;
  }
  return out;
}
export function literals(code) {
  const res = []; let i = 0;
  while (i < code.length) { if (code[i] === "'") { const j = endOfQuote(code, i); res.push(code.slice(i + 1, j - 1).replace(/''/g, "'")); i = j; continue; } i++; }
  return res;
}

// Inside a function body, strip comments again (bodies are themselves SQL/plpgsql).
export function judgeBody(body) {
  const code = stripComments(body);
  const hits = [];
  const bare = blankLiterals(code).replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, " ");
  // RULE A — static DDL
  for (const m of bare.matchAll(ddlRe)) {
    const verb = m[2].replace(/\s+/g, " ").toUpperCase();
    const after = bare.slice(m.index + m[0].length, m.index + m[0].length + 120);
    if (isTemp(verb, bare.slice(Math.max(0, m.index - 40), m.index + m[0].length), after, bare)) continue;
    hits.push({ rule: "A", what: verb + " " + after.trim().split(/[\s(;]+/).slice(0, 4).join(" ") });
  }
  // RULE B — dynamic DDL in a literal handed to EXECUTE / format
  if (/\bexecute\b/i.test(bare)) {
    for (const lit of literals(code)) {
      const t = lit.trim();
      for (const v of DDL) {
        if (new RegExp("^" + v.replace(/ /g, "\\s+") + "\\b", "i").test(t)) {
          if (/^create\s+(temp|temporary)\s+table\b/i.test(t) || /\bpg_temp\./i.test(t.slice(0, 80))) break;
          hits.push({ rule: "B", what: "dynamic: " + t.slice(0, 60).replace(/\s+/g, " ") });
          break;
        }
      }
    }
  }
  // RULE C — the reload itself
  if (/\bnotify\s+pgrst\b/i.test(bare) || /pg_notify\s*\(\s*'pgrst'/i.test(code))
    hits.push({ rule: "C", what: "NOTIFY pgrst" });
  return hits;
}

function isTemp(verb, before, after, bare) {
  // CREATE TEMP / TEMPORARY TABLE never matches the DDL list (TEMP sits between
  // CREATE and TABLE), so only pg_temp-qualified names and drops are left to judge.
  if (/^\s*(if\s+(not\s+)?exists\s+)?pg_temp\./i.test(after)) return true;
  // DROP TABLE x, where x was created TEMP in the same body (with or without pg_temp.)
  if (/^DROP TABLE$/.test(verb)) {
    const name = /^\s*(?:if\s+exists\s+)?([A-Za-z_][A-Za-z0-9_.]*)/i.exec(after)?.[1];
    if (name) {
      const bareName = name.replace(/^pg_temp\./i, "");
      if (new RegExp("create\\s+(temp|temporary)\\s+table\\s+(if\\s+not\\s+exists\\s+)?(pg_temp\\.)?" + bareName + "\\b", "i").test(bare)) return true;
    }
  }
  return false;
}

// ── migration walk ─────────────────────────────────────────────────────────
const FN_RE = /create\s+(?:or\s+replace\s+)?(function|procedure)\s+((?:"?[A-Za-z_][\w]*"?\.)?"?[A-Za-z_][\w]*"?)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)([\s\S]*?)\bas\s+(\$([A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*?)\5/gi;
const DROP_FN_RE = /drop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?((?:"?[A-Za-z_][\w]*"?\.)?"?[A-Za-z_][\w]*"?)\s*(?:\(([^)]*)\))?/gi;
const SCHED_RE = /cron\.schedule\s*\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*(\$([A-Za-z_]\w*)?\$([\s\S]*?)\2|'((?:[^']|'')*)')\s*\)/gi;
const UNSCHED_RE = /cron\.unschedule\s*\(\s*'([^']+)'\s*\)/gi;

const normName = (n) => { const s = n.replace(/"/g, "").toLowerCase(); return s.includes(".") ? s : "public." + s; };
const normArgs = (a) => (a || "").replace(/\bdefault\b[^,]*/gi, "").replace(/\s+/g, " ").trim().toLowerCase()
  .split(",").map((x) => x.trim().split(" ").filter((w) => !/^(in|out|inout|variadic)$/.test(w)).slice(-1)[0] || "").join(",");

export function scan(files /* [{name, text}] in apply order */) {
  const fns = new Map();   // key → {file, body}
  const jobs = new Map();  // jobname → {file, command}
  for (const { name, text } of files) {
    const sql = stripComments(text);
    const events = [];
    for (const m of sql.matchAll(FN_RE)) events.push({ at: m.index, kind: "fn", key: normName(m[2]) + "(" + normArgs(m[3]) + ")", body: m[7] });
    for (const m of sql.matchAll(DROP_FN_RE)) events.push({ at: m.index, kind: "dropfn", name: normName(m[1]), args: m[2] === undefined ? null : normArgs(m[2]) });
    for (const m of sql.matchAll(SCHED_RE)) events.push({ at: m.index, kind: "sched", job: m[1], cmd: m[4] !== undefined ? m[4] : m[5].replace(/''/g, "'") });
    for (const m of sql.matchAll(UNSCHED_RE)) events.push({ at: m.index, kind: "unsched", job: m[1] });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "fn") fns.set(e.key, { file: name, body: e.body });
      else if (e.kind === "dropfn") { for (const k of [...fns.keys()]) if (k.startsWith(e.name + "(") && (e.args === null || k === e.name + "(" + e.args + ")")) fns.delete(k); }
      else if (e.kind === "sched") jobs.set(e.job, { file: name, command: e.cmd });
      else if (e.kind === "unsched") jobs.delete(e.job);
    }
  }
  const hits = [];
  for (const [key, v] of fns) for (const h of judgeBody(v.body)) hits.push({ id: key, file: v.file, ...h });
  for (const [job, v] of jobs) for (const h of judgeBody(v.command)) hits.push({ id: "cron:" + job, file: v.file, ...h });
  return { hits, functions: fns.size, jobs: jobs.size };
}

export function loadTree(root) {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && !/^(UNAPPLIED_|PROBE_)/.test(f)).sort()
    .map((f) => ({ name: "supabase/migrations/" + f, text: readFileSync(join(dir, f), "utf8") }));
}

export function applyAllow(hits, allow) {
  const problems = [];
  for (const [k, reason] of Object.entries(allow)) {
    if (k.startsWith("_")) continue;
    if (typeof reason !== "string" || reason.trim().length < 20) problems.push(`allow-list entry ${k} has no written reason (≥ 20 chars)`);
    if (!hits.some((h) => h.id === k)) problems.push(`allow-list entry ${k} matches nothing — remove it`);
  }
  return { remaining: hits.filter((h) => !(h.id in allow)), problems };
}

function main() {
  const root = process.argv[2] || join(fileURLToPath(new URL(".", import.meta.url)), "..");
  let files;
  try { files = loadTree(root); } catch (e) { console.error("ERROR reading migrations: " + e.message); process.exit(2); }
  const allowPath = join(root, "scripts", "db-p7-runtime-ddl-allow.json");
  const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf8")) : {};
  const { hits, functions, jobs } = scan(files);
  const { remaining, problems } = applyAllow(hits, allow);
  console.log("D1 · P7 runtime-DDL check — GATE_REGISTER P7");
  console.log(`read ${files.length} applied migration file(s); ${functions} function/procedure definition(s) and ${jobs} cron job(s) as of the last file`);
  const allowed = hits.filter((h) => h.id in allow);
  for (const h of allowed) console.log(`  allowed  ${h.id}  rule ${h.rule}: ${h.what}  — ${allow[h.id]}`);
  for (const p of problems) console.log("  ERROR    " + p);
  for (const h of remaining) console.log(`  HIT      ${h.id}  rule ${h.rule}: ${h.what}  (last defined in ${h.file})`);
  if (remaining.length || problems.length) { console.log(`FAIL — ${remaining.length} runtime-DDL hit(s), ${problems.length} allow-list problem(s)`); process.exit(1); }
  console.log("PASS — no function, procedure or cron job runs reload-triggering DDL at runtime");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
