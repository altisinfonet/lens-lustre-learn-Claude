// ═══════════════════════════════════════════════════════════════════════════
// FOUNDATION FIX U1 · THE DRIFT CHECK — "live == git" for database objects.
//
// Input 1: the live fingerprint printed by
//   supabase/migrations/PROBE_20261103_0202_drift_live_fingerprint.sql
//   (names + md5 of definitions, never bodies).
// Input 2: git — every applied migration (UNAPPLIED_* and PROBE_* skipped), read
//   in apply order; the LAST create of an object wins, a DROP forgets it.
//
// Findings (each has a stable key):
//   LIVE_ONLY  an object exists live but no migration creates it
//              (functions, tables, policies, triggers, cron jobs)
//   DIFFERS    a function body or a cron command/schedule live matches NO
//              version git has ever created (= edited by hand live); bodies are
//              compared whitespace-collapsed
//   PENDING    (info, never fails) live matches an OLDER git version: the newer
//              migration is merged but not yet applied on this lane
// GIT_ONLY (in git, not live) is printed for information only: dropped objects
// and lane-guarded files make it noisy, and it cannot rebuild anything wrong.
//
// A finding listed in scripts/db-drift-allow.json (key + reason ≥ 20 chars) is
// reported but does not fail; anything else fails. Allow entries that no longer
// match anything are reported as STALE so the list shrinks.
//
// READ-ONLY. Usage: node scripts/db-drift-check.mjs <fingerprint.txt> [root]
// Exit: 0 pass · 1 drift · 2 error. Self-test: scripts/db-drift-check.test.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { stripComments } from "./db-p5-cron-cadence-check.mjs";
import { scan as scanCron } from "./db-p9-cron-http-check.mjs";

export const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
export const normBody = (s) => md5(s.trim().replace(/\s+/g, " "));

const TYPE_ALIASES = new Map(Object.entries({
  int: "integer", int4: "integer", int2: "smallint", int8: "bigint", bool: "boolean",
  varchar: "character varying", "char": "character", float8: "double precision", float4: "real",
  timestamptz: "timestamp with time zone", timestamp: "timestamp without time zone",
  timetz: "time with time zone", decimal: "numeric",
}));
const MODES = new Set(["in", "out", "inout", "variadic"]);

/** Normalise one parameter declaration to its type, or null for OUT params. */
export function paramType(decl) {
  let d = decl.replace(/\s+(default\s+[\s\S]*|=[\s\S]*)$/i, "").trim();
  let words = d.split(/\s+/);
  let mode = "in";
  if (MODES.has(words[0].toLowerCase())) { mode = words.shift().toLowerCase(); }
  if (mode === "out") return null;
  // name type… | type…  — the first word is a name unless what follows is a type modifier
  const joined = words.join(" ");
  const typeWords = words.length > 1 && !/^(precision|varying|with|without|zone|\[\]|\()/i.test(words[1]) ? words.slice(1) : words;
  let t = (typeWords.length ? typeWords : [joined]).join(" ").toLowerCase().replace(/"/g, "").replace(/^public\./, "");
  t = t.replace(/\s*\(\s*[\d\s,]+\)/g, "").replace(/\s+\[\]/g, "[]").trim();
  const arr = t.endsWith("[]") ? "[]" : "";
  const base = arr ? t.slice(0, -2) : t;
  return (TYPE_ALIASES.get(base) ?? base) + arr + (mode === "variadic" ? "" : "");
}

/** Split a parameter list on top-level commas. */
export function splitParams(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
export const argKey = (params) => splitParams(params).map(paramType).filter((x) => x !== null).join(", ");

/** Live identity types from oidvectortypes(): normalise the same way. */
export const liveArgKey = (s) => (s ? s.split(", ").map((t) => paramType("x " + t)).join(", ") : "");

const ID = String.raw`(?:"?(\w+)"?\.)?"?(\w+)"?`;
const FN_RE = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${ID}\s*\(`, "gi");
const DROPFN_RE = new RegExp(String.raw`drop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?([^;]+);`, "gi");
const TBL_RE = new RegExp(String.raw`create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${ID}`, "gi");
const DROPTBL_RE = new RegExp(String.raw`drop\s+table\s+(?:if\s+exists\s+)?([^;]+);`, "gi");
const RENTBL_RE = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${ID}\s+rename\s+to\s+"?(\w+)"?`, "gi");
const POL_RE = new RegExp(String.raw`create\s+policy\s+(?:"([^"]+)"|(\w+))\s+on\s+${ID}`, "gi");
const DROPPOL_RE = new RegExp(String.raw`drop\s+policy\s+(?:if\s+exists\s+)?(?:"([^"]+)"|(\w+))\s+on\s+${ID}`, "gi");
const RENPOL_RE = new RegExp(String.raw`alter\s+policy\s+(?:"([^"]+)"|(\w+))\s+on\s+${ID}\s+rename\s+to\s+(?:"([^"]+)"|(\w+))`, "gi");
const TRG_RE = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?[\s\S]*?\son\s+${ID}[\s\S]*?execute\s+(?:function|procedure)\s+${ID}\s*\(`, "gi");
const DROPTRG_RE = new RegExp(String.raw`drop\s+trigger\s+(?:if\s+exists\s+)?"?(\w+)"?\s+on\s+${ID}`, "gi");

const isPublic = (schema) => !schema || schema.toLowerCase() === "public";

/** Find the body of a function whose header starts at `from` (just after its "("). */
export function functionAt(sql, from) {
  // parameter list: up to the matching ")"
  let depth = 1, i = from;
  for (; i < sql.length && depth > 0; i++) { if (sql[i] === "(") depth++; else if (sql[i] === ")") depth--; }
  const params = sql.slice(from, i - 1);
  const rest = sql.slice(i, i + 200000);
  const m = /\bas\s+(\$([A-Za-z_][A-Za-z0-9_]*)?\$)/i.exec(rest);
  const stop = rest.search(/;\s*(?:$|\n)/);
  if (m && (stop < 0 || m.index < stop || rest.slice(0, m.index).indexOf(";") < 0)) {
    const tag = m[1];
    const start = m.index + m[0].length;
    const end = rest.indexOf(tag, start);
    if (end > 0) return { params, body: rest.slice(start, end) };
  }
  const q = /\bas\s+'((?:[^']|'')*)'/i.exec(rest);
  if (q) return { params, body: q[1].replace(/''/g, "'") };
  const atomic = /\bbegin\s+atomic\b/i.exec(rest);
  return { params, body: null, atomic: !!atomic };
}

export function scanGit(files) {
  const fns = new Map(); // name -> Map(argKey -> {hash, file})
  const tables = new Set(), policies = new Set(), triggers = new Set();
  for (const { name: file, text } of files) {
    const sql = stripComments(text);
    const ev = [];
    for (const m of sql.matchAll(FN_RE)) if (isPublic(m[1])) ev.push({ at: m.index, k: "fn", name: m[2].toLowerCase(), from: m.index + m[0].length });
    for (const m of sql.matchAll(DROPFN_RE)) ev.push({ at: m.index, k: "dropfn", list: m[1] });
    for (const m of sql.matchAll(TBL_RE)) if (isPublic(m[1])) ev.push({ at: m.index, k: "tbl", name: m[2].toLowerCase() });
    for (const m of sql.matchAll(DROPTBL_RE)) ev.push({ at: m.index, k: "droptbl", list: m[1] });
    for (const m of sql.matchAll(RENTBL_RE)) if (isPublic(m[1])) ev.push({ at: m.index, k: "rentbl", from: m[2].toLowerCase(), to: m[3].toLowerCase() });
    for (const m of sql.matchAll(POL_RE)) if (isPublic(m[3])) ev.push({ at: m.index, k: "pol", key: `${m[4].toLowerCase()}.${m[1] ?? m[2]}` });
    for (const m of sql.matchAll(DROPPOL_RE)) if (isPublic(m[3])) ev.push({ at: m.index, k: "droppol", key: `${m[4].toLowerCase()}.${m[1] ?? m[2]}` });
    for (const m of sql.matchAll(RENPOL_RE)) if (isPublic(m[3])) ev.push({ at: m.index, k: "renpol", from: `${m[4].toLowerCase()}.${m[1] ?? m[2]}`, to: `${m[4].toLowerCase()}.${m[5] ?? m[6]}` });
    for (const m of sql.matchAll(TRG_RE)) ev.push({ at: m.index, k: "trg", key: `${m[3].toLowerCase()}.${m[1].toLowerCase()}` });
    for (const m of sql.matchAll(DROPTRG_RE)) ev.push({ at: m.index, k: "droptrg", key: `${m[3].toLowerCase()}.${m[1].toLowerCase()}` });
    ev.sort((a, b) => a.at - b.at);
    for (const e of ev) {
      if (e.k === "fn") {
        const f = functionAt(sql, e.from);
        if (!fns.has(e.name)) fns.set(e.name, new Map());
        const ak = argKey(f.params);
        const prev = fns.get(e.name).get(ak);
        const hash = f.body == null ? null : normBody(f.body);
        const history = new Set(prev?.history ?? []);
        if (hash) history.add(hash);
        fns.get(e.name).set(ak, { hash, file, history });
      } else if (e.k === "dropfn") {
        for (const item of splitParams(e.list.replace(/\s+(cascade|restrict)\s*$/i, ""))) {
          const m = new RegExp(String.raw`^\s*${ID}\s*(?:\(([\s\S]*)\))?\s*$`).exec(item);
          if (!m || !isPublic(m[1])) continue;
          const n = m[2].toLowerCase();
          if (m[3] === undefined) fns.delete(n); else fns.get(n)?.delete(argKey(m[3]));
        }
      } else if (e.k === "tbl") tables.add(e.name);
      else if (e.k === "droptbl") {
        for (const item of e.list.replace(/\s+(cascade|restrict)\s*$/i, "").split(",")) {
          const m = new RegExp(String.raw`^\s*${ID}\s*$`).exec(item);
          if (m && isPublic(m[1])) tables.delete(m[2].toLowerCase());
        }
      } else if (e.k === "rentbl") { if (tables.delete(e.from)) tables.add(e.to); }
      else if (e.k === "pol") policies.add(e.key);
      else if (e.k === "droppol") policies.delete(e.key);
      else if (e.k === "renpol") { if (policies.delete(e.from)) policies.add(e.to); }
      else if (e.k === "trg") triggers.add(e.key);
      else if (e.k === "droptrg") triggers.delete(e.key);
    }
  }
  const cron = scanCron(files);
  const cronHistory = new Map();
  for (const f of files) for (const [job, v] of scanCron([f])) {
    if (!cronHistory.has(job)) cronHistory.set(job, new Set());
    cronHistory.get(job).add(v.schedule + "|" + normBody(v.command));
  }
  return { fns, tables, policies, triggers, cron, cronHistory };
}

export function parseLive(text) {
  const live = { lane: null, fns: [], tables: [], policies: [], triggers: [], cron: [] };
  for (const raw of text.split("\n")) {
    // tolerate GitHub log prefixes ("2026-…Z ") and psql notices
    const line = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s/, "").trim();
    const f = line.split("|");
    switch (f[0]) {
      case "DRIFT_LANE": live.lane = f[1]; break;
      case "FN": live.fns.push({ name: f[1], args: liveArgKey(f[2]), secdef: f[3], hash: f[4] }); break;
      case "TBL": live.tables.push(f[1]); break;
      case "POL": live.policies.push(`${f[1]}.${f[2]}`); break;
      case "TRG": live.triggers.push({ key: `${f[1]}.${f[2]}`, fn: f[3] }); break;
      case "CRON": live.cron.push({ name: f[1], schedule: f[2], hash: f[3] }); break;
    }
  }
  return live;
}

export function compare(live, git) {
  const findings = [];
  for (const fn of live.fns) {
    const key = `FN:${fn.name}(${fn.args})`;
    const g = git.fns.get(fn.name.toLowerCase());
    if (!g || !g.has(fn.args)) { findings.push({ kind: "LIVE_ONLY", key }); continue; }
    const d = g.get(fn.args);
    if (d.hash === null || d.hash === fn.hash) continue;
    if (d.history.has(fn.hash)) findings.push({ kind: "PENDING", key, file: d.file, info: true });
    else findings.push({ kind: "DIFFERS", key, file: d.file });
  }
  for (const t of live.tables) if (!git.tables.has(t.toLowerCase())) findings.push({ kind: "LIVE_ONLY", key: `TBL:${t}` });
  for (const p of live.policies) if (!git.policies.has(p.replace(/^([^.]+)/, (s) => s.toLowerCase()))) findings.push({ kind: "LIVE_ONLY", key: `POL:${p}` });
  for (const t of live.triggers) if (!git.triggers.has(t.key.toLowerCase())) findings.push({ kind: "LIVE_ONLY", key: `TRG:${t.key}` });
  for (const c of live.cron) {
    const g = git.cron.get(c.name);
    if (!g) { findings.push({ kind: "LIVE_ONLY", key: `CRON:${c.name}` }); continue; }
    if (g.schedule === c.schedule && normBody(g.command) === c.hash) continue;
    if (git.cronHistory?.get(c.name)?.has(c.schedule + "|" + c.hash)) findings.push({ kind: "PENDING", key: `CRON:${c.name}`, file: g.file, info: true });
    else findings.push({ kind: "DIFFERS", key: `CRON:${c.name}`, file: g.file });
  }
  const liveFnNames = new Set(live.fns.map((f) => f.name.toLowerCase()));
  const gitOnly = [...git.fns.keys()].filter((n) => !liveFnNames.has(n)).length;
  return { findings, gitOnly };
}

export function judge(findings, allow) {
  const allowed = new Map((allow.entries ?? []).map((e) => [e.key, e]));
  const errors = [];
  for (const e of allow.entries ?? []) if (!e.reason || e.reason.length < 20) errors.push(`allow entry ${e.key} needs a reason of at least 20 characters`);
  const failing = findings.filter((f) => !f.info && !allowed.has(f.key));
  const hit = new Set(findings.filter((f) => !f.info).map((f) => f.key));
  const stale = (allow.entries ?? []).filter((e) => !hit.has(e.key)).map((e) => e.key);
  return { failing, stale, errors };
}

export function loadTree(root) {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && !/^(UNAPPLIED_|PROBE_)/.test(f)).sort()
    .map((f) => ({ name: "supabase/migrations/" + f, text: readFileSync(join(dir, f), "utf8") }));
}

function main() {
  const fp = process.argv[2];
  const root = process.argv[3] || join(fileURLToPath(new URL(".", import.meta.url)), "..");
  if (!fp || !existsSync(fp)) { console.error("usage: node scripts/db-drift-check.mjs <fingerprint.txt> [root]"); process.exit(2); }
  let live, git, allow;
  try {
    live = parseLive(readFileSync(fp, "utf8"));
    git = scanGit(loadTree(root));
    const ap = join(root, "scripts", "db-drift-allow.json");
    allow = existsSync(ap) ? JSON.parse(readFileSync(ap, "utf8")) : { entries: [] };
  } catch (e) { console.error("ERROR: " + e.message); process.exit(2); }
  if (!live.lane || live.fns.length === 0) { console.error("ERROR: fingerprint has no lane or no functions — the live read did not complete"); process.exit(2); }
  const { findings, gitOnly } = compare(live, git);
  const { failing, stale, errors } = judge(findings, allow);
  console.log(`Drift check — live (${live.lane}) vs git`);
  console.log(`live: ${live.fns.length} functions, ${live.tables.length} tables, ${live.policies.length} policies, ${live.triggers.length} triggers, ${live.cron.length} cron jobs`);
  const info = findings.filter((f) => f.info).length;
  console.log(`findings: ${findings.length - info} (allowed ${findings.length - info - failing.length}); pending apply (info): ${info}; git-only functions (info): ${gitOnly}`);
  for (const f of findings) console.log(`  ${failing.includes(f) ? "DRIFT  " : f.info ? "info   " : "allowed"}  ${f.kind.padEnd(9)} ${f.key}${f.file ? "  (git: " + f.file + ")" : ""}`);
  for (const s of stale) console.log(`  STALE allow entry (no longer drifting — remove it): ${s}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  if (errors.length) process.exit(2);
  if (failing.length) { console.log(`FAIL — ${failing.length} object(s) differ between live and git. Capture them in a migration, or (with a reason) in scripts/db-drift-allow.json.`); process.exit(1); }
  console.log("PASS — every live object checked is created by git, and every compared definition matches");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
