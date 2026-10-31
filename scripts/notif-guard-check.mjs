// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION CENTRE · N5 · THE STRAY-WRITER GUARD
//
// GATE (notification centre plan, N5): a CI test fails if any code inserts
// into user_notifications / admin_notifications outside the centre.
//
// The centre is being introduced step by step (N2 → N3, one group of makers at
// a time), so today there are ~40 legitimate writers. This check is a RATCHET:
// every writer that exists now is named in scripts/notif-guard-allow.json with
// a reason; a NEW writer anywhere is a red build. As N3 moves each group onto
// the centre, its entries are removed from the allow-list, and the list must
// end holding only the centre itself.
//
// WHAT IT READS
//   · supabase/migrations/*.sql in filename order (the apply order), skipping
//     UNAPPLIED_* and PROBE_*. For every CREATE [OR REPLACE] FUNCTION /
//     PROCEDURE the LAST definition per name wins (DROP FUNCTION forgets it), so
//     a function rewritten onto the centre stops counting. A body is a writer
//     when, after `--` and `/* */` comments are removed, it contains
//     INSERT INTO [public.]user_notifications | admin_notifications.
//   · supabase/functions/**/*.ts and src/**/*.{ts,tsx} (tests excluded): a file
//     is a writer when a `.from("user_notifications" | "admin_notifications")`
//     chain reaches `.insert(` or `.upsert(` before the statement ends.
//
// WHAT IT DOES NOT SEE (stated, so nobody mistakes it for more)
//   · INSERTs at the top level of a migration (one-off data fixes, not makers).
//   · SQL built at runtime (EXECUTE format('INSERT INTO %I …')).
//   · Anything applied outside git. The nightly live count (N5 part 2) reads
//     the live catalogue for that.
//
//   · Functions in any schema are read; a public one is keyed "sql:<name>",
//     any other "sql:<schema>.<name>". Overloads share one key (by name).
//   · supabase-js shapes seen: .from("t"), .from("t" as any), .from(CONST) where
//     CONST = "t" in the same file, and const q = x.from("t"); q.insert(...).
//
// ALLOW-LIST: { "sql:<function_name>": "<reason>", "file:<path>": "<reason>" }.
// An empty reason is an error; an entry that matches nothing is an error, so
// the list cannot rot and a removed writer must also leave the list.
//
// READ-ONLY: reads files, writes nothing, connects to nothing.
// Usage:  node scripts/notif-guard-check.mjs [rootDir]
// Exit:   0 = every writer allowed; 1 = a stray writer or a stale entry; 2 = error.
// Self-test: scripts/notif-guard-check.test.mjs plants strays and must see red.
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TABLES = "(?:user_notifications|admin_notifications)";
const SQL_INSERT = new RegExp(`\\binsert\\s+into\\s+(?:"?public"?\\s*\\.\\s*)?"?${TABLES}"?\\b`, "i");
const IDENT = String.raw`"?([A-Za-z_][A-Za-z0-9_]*)"?`;
const QUAL = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`;
const CREATE_FN = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(function|procedure)\s+${QUAL}\s*\(`, "gi");
const DROP_FN = new RegExp(String.raw`\bdrop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?${QUAL}`, "gi");

/** "public.x" and "x" are both keyed "x"; any other schema keeps its prefix ("private.x"). */
const fnKey = (schema, name) => {
  const sch = (schema || "public").toLowerCase();
  return sch === "public" ? name.toLowerCase() : `${sch}.${name.toLowerCase()}`;
};

/** Remove -- and /* *\/ comments that are outside single-quoted SQL strings. */
export function stripSqlComments(s) {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; } j++; }
      out += s.slice(i, j + 1); i = j + 1;
    } else if (c === "-" && s[i + 1] === "-") {
      const j = s.indexOf("\n", i); out += " "; i = j < 0 ? s.length : j;
    } else if (c === "/" && s[i + 1] === "*") {
      const j = s.indexOf("*/", i + 2); out += " "; i = j < 0 ? s.length : j + 2;
    } else { out += c; i++; }
  }
  return out;
}

/** Read a single-quoted SQL string starting at s[i] === "'"; returns [content, endIndex]. */
function readQuoted(s, i) {
  let j = i + 1, out = "";
  while (j < s.length) {
    if (s[j] === "'") { if (s[j + 1] === "'") { out += "'"; j += 2; continue; } return [out, j + 1]; }
    out += s[j++];
  }
  return [out, j];
}

/** Every function/procedure body in one SQL text, in order: creates {name, body, at} and drops {name, at}. */
export function sqlEvents(text) {
  const events = [];
  let m;
  CREATE_FN.lastIndex = 0;
  while ((m = CREATE_FN.exec(text))) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    if (text.slice(lineStart, m.index).trim().startsWith("--")) continue;
    const from = m.index + m[0].length;
    // The body is the first AS <dollar-quote> / AS '<string>' / BEGIN ATOMIC after the
    // header, and must start before the next CREATE (so a body never comes from the next function).
    const nextCreate = text.slice(from).search(/\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure|trigger|table|view|index|policy)\b/i);
    const header = nextCreate >= 0 ? text.slice(from, from + nextCreate) : text.slice(from);
    const as = /\bAS\s+(\$[A-Za-z0-9_]*\$|')/i.exec(header);
    const atomic = /\bBEGIN\s+ATOMIC\b/i.exec(header);
    let body = null;
    if (as && (!atomic || as.index < atomic.index)) {
      const start = from + as.index + as[0].length;
      if (as[1] === "'") body = readQuoted(text, start - 1)[0];
      else { const end = text.indexOf(as[1], start); if (end > 0) body = text.slice(start, end); }
    } else if (atomic) {
      const start = from + atomic.index;
      const end = text.slice(start).search(/\bEND\s*;/i);
      body = end > 0 ? text.slice(start, start + end) : text.slice(start);
    }
    if (body !== null) events.push({ kind: "create", name: fnKey(m[2], m[3]), body, at: m.index });
  }
  DROP_FN.lastIndex = 0;
  while ((m = DROP_FN.exec(text))) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    if (text.slice(lineStart, m.index).trim().startsWith("--")) continue;
    events.push({ kind: "drop", name: fnKey(m[1], m[2]), at: m.index });
  }
  return events.sort((a, b) => a.at - b.at);
}

/** files: [{name, text}] in apply order → Map(functionName → {file}) of writers (last definition wins). */
export function sqlWriters(files) {
  const last = new Map();
  for (const f of files) {
    for (const e of sqlEvents(f.text)) {
      if (e.kind === "drop") last.delete(e.name);
      else last.set(e.name, { file: f.name, writes: SQL_INSERT.test(stripSqlComments(e.body)) });
    }
  }
  const out = new Map();
  for (const [name, v] of last) if (v.writes) out.set(name, { file: v.file });
  return out;
}

/** Remove // and /* *\/ comments that are outside JS string / template literals. */
export function stripJsComments(s) {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) { if (s[j] === "\\") j++; else if (c !== "`" && s[j] === "\n") break; j++; }
      out += s.slice(i, j + 1); i = j + 1;
    } else if (c === "/" && s[i + 1] === "/") {
      const j = s.indexOf("\n", i); i = j < 0 ? s.length : j;
    } else if (c === "/" && s[i + 1] === "*") {
      const j = s.indexOf("*/", i + 2); out += " "; i = j < 0 ? s.length : j + 2;
    } else { out += c; i++; }
  }
  return out;
}

const TABLE_LIT = String.raw`["'\x60]${TABLES}["'\x60]`;

/** Does this TS/TSX text insert/upsert into a notification table via supabase-js? */
export function tsWrites(text) {
  const src = stripJsComments(text);
  // identifiers bound to the table name:  const TABLE = "user_notifications"
  const names = [...src.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>\[\]|" ]+)?=\s*${TABLE_LIT}`, "g"))].map((m) => m[1]);
  const ref = names.length ? `(?:${TABLE_LIT}|${names.map((n) => n.replace(/\$/g, "\\$")).join("|")})` : TABLE_LIT;
  const fromRe = new RegExp(String.raw`\.from\(\s*${ref}\s*(?:as\s+[\w<>\[\]]+\s*)?\)`, "g");
  let m;
  while ((m = fromRe.exec(src))) {
    // The chain continues while the next line starts with "." (method chaining);
    // it ends at ";", a blank line, or a line that starts with anything else.
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const stop = tail.search(/;|\n\s*\n|\n(?!\s*\.)/);
    const chain = stop >= 0 ? tail.slice(0, stop) : tail;
    if (/\.\s*(insert|upsert)\s*\(/.test(chain)) return true;
    // query builder held in a variable:  const q = sb.from("t"); … q.insert(
    const before = src.slice(Math.max(0, m.index - 200), m.index);
    const v = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[\w$.]*$/.exec(before);
    if (v && new RegExp(String.raw`\b${v[1].replace(/\$/g, "\\$")}\s*\.\s*(insert|upsert)\s*\(`).test(src.slice(m.index))) return true;
  }
  return false;
}

function walk(dir, pred, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; } // broken symlink: nothing to read
    if (st.isDirectory()) {
      if (n === "node_modules" || n === "__tests__") continue;
      walk(p, pred, acc);
    } else if (pred(p)) acc.push(p);
  }
  return acc;
}

/** Collect every writer in a tree: [{key, where}] where key is "sql:<fn>" or "file:<path>". */
export function collect(root) {
  const migDir = join(root, "supabase/migrations");
  const files = existsSync(migDir)
    ? readdirSync(migDir)
        .filter((n) => n.endsWith(".sql") && !n.startsWith("UNAPPLIED_") && !n.startsWith("PROBE_"))
        .sort()
        .map((n) => ({ name: `supabase/migrations/${n}`, text: readFileSync(join(migDir, n), "utf8") }))
    : [];
  const writers = [];
  for (const [name, v] of sqlWriters(files)) writers.push({ key: `sql:${name}`, where: v.file });
  const isCode = (p) => /\.(ts|tsx)$/.test(p) && !/\.(test|spec)\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p);
  for (const p of [...walk(join(root, "supabase/functions"), isCode), ...walk(join(root, "src"), isCode)]) {
    if (tsWrites(readFileSync(p, "utf8"))) {
      const rel = relative(root, p).split("\\").join("/");
      writers.push({ key: `file:${rel}`, where: rel });
    }
  }
  return writers.sort((a, b) => a.key.localeCompare(b.key));
}

/** → {strays, stale, empty} */
export function judge(writers, allow) {
  const keys = new Set(writers.map((w) => w.key));
  return {
    strays: writers.filter((w) => !(w.key in allow)),
    stale: Object.keys(allow).filter((k) => !keys.has(k)),
    empty: Object.entries(allow).filter(([, why]) => typeof why !== "string" || why.trim() === "").map(([k]) => k),
  };
}

function main() {
  const root = process.argv[2] || join(fileURLToPath(new URL(".", import.meta.url)), "..");
  let allow;
  try {
    allow = JSON.parse(readFileSync(join(root, "scripts/notif-guard-allow.json"), "utf8"));
  } catch (e) {
    console.error(`notif-guard: cannot read scripts/notif-guard-allow.json — ${e.message}`);
    process.exit(2);
  }
  delete allow.$comment;
  const writers = collect(root);
  const { strays, stale, empty } = judge(writers, allow);
  console.log(`notif-guard: ${writers.length} writer(s) found, ${Object.keys(allow).length} allowed.`);
  for (const s of strays)
    console.log(`::error::STRAY notification writer ${s.key} (${s.where}) — new code must go through the notification centre, not INSERT into user_notifications/admin_notifications directly.`);
  for (const k of stale) console.log(`::error::STALE allow-list entry ${k} — it no longer writes; remove it from scripts/notif-guard-allow.json.`);
  for (const k of empty) console.log(`::error::allow-list entry ${k} has no reason.`);
  if (strays.length || stale.length || empty.length) process.exit(1);
  console.log("notif-guard: OK — no writer outside the allow-list.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error(`notif-guard: error — ${e.stack || e}`); process.exit(2); }
}
