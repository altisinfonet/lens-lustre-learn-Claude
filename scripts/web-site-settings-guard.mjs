#!/usr/bin/env node
/**
 * P4 GUARD — NO UNFILTERED site_settings READ FROM THE CLIENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. P4 moved the configuration read to the edge: `GET /config/site-settings`
 * (functions/config/site-settings.ts) returns the whole table once, CDN-cached
 * and versioned, and `src/lib/siteSettingsCache.ts` falls back to a KEYED
 * database query only when the edge is unavailable. Under R-82 the gate is
 * proved by design plus an enforced guard, not by a traffic reading — and this
 * file is the enforced guard. What it forbids is the shape that made
 * configuration expensive in the first place: a client read of `site_settings`
 * that fetches every row instead of the keys it needs. One such call on a
 * public page multiplies by every visitor; the edge exists so nobody does it.
 *
 * WHAT COUNTS AS A VIOLATION (in src/**, tests excluded):
 *   1. `.from("site_settings")` followed by `.select(...)` with no key filter
 *      anywhere in the same call chain. A key filter is `.eq("key", …)`,
 *      `.in("key", …)`, `.like/.ilike("key", …)`, or `.match({ key: … })`.
 *   2. `.from("site_settings")` whose chain does not start with a recognised
 *      operation (select / upsert / insert / update / delete) — e.g. the
 *      builder stored in a variable and read later. The guard cannot see what
 *      happens to it, so it refuses rather than guesses.
 *   3. A string or template literal naming the PostgREST path
 *      `/rest/v1/site_settings` without `key=` in it — the raw-fetch way round.
 *
 * WHAT IT DOES NOT CLAIM. It reads the source with the TypeScript parser, so a
 * comment or a string that merely mentions site_settings is not a read. It
 * cannot follow a table name held in a variable (`.from(tableName)`); none
 * exists in src/ today for this table, and the limit is stated here rather
 * than hidden. Writes (upsert/insert/update/delete) are out of scope: the gate
 * is about reads.
 *
 * The Pages Function that serves the edge IS an unfiltered read, by design,
 * server-side, once per cache window. It lives in functions/, which this guard
 * does not scan, and that is deliberate.
 *
 * C-34: `--self-test` plants every violating shape and every legitimate
 * neighbour, and fails unless each is classified correctly. The CI job runs it
 * first; a verdict from a scanner that cannot fail is not evidence.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/web-site-settings-guard.mjs            # report, exit 1 on any violation
 *   node scripts/web-site-settings-guard.mjs --self-test
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const TABLE = "site_settings";
const READ_OPS = new Set(["select"]);
const KNOWN_OPS = new Set(["select", "upsert", "insert", "update", "delete"]);
const KEY_FILTERS = new Set(["eq", "in", "like", "ilike", "neq"]);

function isTableLiteral(node) {
  return (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === TABLE
  );
}

function isKeyLiteral(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "key";
}

/** Walk outward from `.from(...)` collecting each chained call: [{name, args}]. */
function chainAfter(fromCall) {
  const out = [];
  let node = fromCall;
  for (;;) {
    const access = node.parent;
    if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== node) break;
    const call = access.parent;
    if (!call || !ts.isCallExpression(call) || call.expression !== access) {
      out.push({ name: access.name.text, args: [] });
      break;
    }
    out.push({ name: access.name.text, args: call.arguments });
    node = call;
  }
  return out;
}

function hasKeyFilter(chain) {
  return chain.some(({ name, args }) => {
    if (KEY_FILTERS.has(name) && isKeyLiteral(args[0])) return true;
    if (name === "match" && args[0] && ts.isObjectLiteralExpression(args[0])) {
      return args[0].properties.some(
        (p) => p.name && ((ts.isIdentifier(p.name) && p.name.text === "key") || isKeyLiteral(p.name)),
      );
    }
    return false;
  });
}

/**
 * Scan one file's text. Returns [{file, line, rule, text}].
 * Pure: no filesystem, so the tests and the self-test drive it directly.
 */
export function scanText(text, file = "inline.ts") {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const snippet = (node) => node.getText(sf).replace(/\s+/g, " ").slice(0, 160);

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from" &&
      isTableLiteral(node.arguments[0])
    ) {
      const chain = chainAfter(node);
      const op = chain[0]?.name;
      let top = node;
      while (top.parent && (ts.isPropertyAccessExpression(top.parent) || (ts.isCallExpression(top.parent) && top.parent.expression === top))) top = top.parent;
      if (!op || !KNOWN_OPS.has(op)) {
        found.push({ file, line: at(node), rule: "unknown-operation", text: snippet(top) });
      } else if (READ_OPS.has(op) && !hasKeyFilter(chain)) {
        found.push({ file, line: at(node), rule: "unfiltered-read", text: snippet(top) });
      }
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
      /\/rest\/v1\/site_settings(?![\w])/.test(node.getText(sf)) &&
      !/[?&]key=/.test(node.getText(sf))
    ) {
      found.push({ file, line: at(node), rule: "unfiltered-rest-path", text: snippet(node) });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

const SKIP_DIRS = new Set(["node_modules", "__tests__", "test-utils"]);
function isTestFile(p) {
  return /\.(test|spec)\.(ts|tsx)$/.test(p);
}

export function listSourceFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") && !isTestFile(name)) {
        out.push(p);
      }
    }
  })(root);
  return out.sort();
}

export function scan(root = "src") {
  const files = listSourceFiles(root);
  const violations = [];
  let reads = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (!text.includes(TABLE)) continue;
    const rel = relative(process.cwd(), f).split(sep).join("/");
    violations.push(...scanText(text, rel));
    reads += (text.match(/\.from\(\s*["'`]site_settings["'`]\s*\)/g) || []).length;
  }
  return { files: files.length, fromCalls: reads, violations };
}

/** Each shape the guard must catch, and each neighbour it must leave alone. */
export const SELF_TEST = [
  { name: "unfiltered select", must: "unfiltered-read", src: `supabase.from("site_settings").select("key, value");` },
  { name: "unfiltered select, awaited", must: "unfiltered-read", src: `const { data } = await supabase.from("site_settings").select("*").order("key");` },
  { name: "filter on another column is not a key filter", must: "unfiltered-read", src: `supabase.from("site_settings").select("value").eq("updated_by", uid);` },
  { name: "single quotes", must: "unfiltered-read", src: `supabase.from('site_settings').select('value').limit(100);` },
  { name: "builder escapes into a variable", must: "unknown-operation", src: `const q = supabase.from("site_settings"); q.select("*");` },
  { name: "raw REST path", must: "unfiltered-rest-path", src: "fetch(`${url}/rest/v1/site_settings?select=key,value`);" },
  { name: "eq key", must: null, src: `supabase.from("site_settings").select("value").eq("key", "seo_global").maybeSingle();` },
  { name: "in key", must: null, src: `supabase.from("site_settings").select("key, value").in("key", keys);` },
  { name: "match key", must: null, src: `supabase.from("site_settings").select("value").match({ key: "x" });` },
  { name: "upsert is a write", must: null, src: `supabase.from("site_settings").upsert({ key: "k", value: 1 }, { onConflict: "key" });` },
  { name: "comment mention", must: null, src: `// supabase.from("site_settings").select("*")\nconst a = 1;` },
  { name: "REST path with key", must: null, src: "fetch(`${url}/rest/v1/site_settings?key=eq.x&select=value`);" },
  { name: "other table", must: null, src: `supabase.from("site_settings_audit").select("*");` },
];

export function selfTest() {
  const failures = [];
  for (const c of SELF_TEST) {
    const got = scanText(c.src, "self-test.ts").map((v) => v.rule);
    const ok = c.must === null ? got.length === 0 : got.length === 1 && got[0] === c.must;
    if (!ok) failures.push(`${c.name}: expected ${c.must ?? "no violation"}, got [${got.join(", ")}]`);
  }
  return failures;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  if (process.argv.includes("--self-test")) {
    const failures = selfTest();
    for (const f of failures) console.error(`SELF-TEST FAIL · ${f}`);
    console.log(`self-test: ${SELF_TEST.length - failures.length}/${SELF_TEST.length} shapes classified correctly`);
    process.exit(failures.length ? 1 : 0);
  }
  const r = scan("src");
  for (const v of r.violations) console.error(`::error file=${v.file},line=${v.line}::${v.rule} · ${v.text}`);
  console.log(
    `site_settings guard: ${r.files} source files, ${r.fromCalls} .from("site_settings") calls, ${r.violations.length} violation(s)`,
  );
  process.exit(r.violations.length ? 1 : 0);
}
