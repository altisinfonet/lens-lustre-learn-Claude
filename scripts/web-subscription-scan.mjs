#!/usr/bin/env node
/**
 * WHAT THIS CLIENT SUBSCRIBES TO, MEASURED RATHER THAN REMEMBERED. P3, D2 half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUESTION IT ANSWERS
 *
 * P3's gate turns on two lists agreeing: the tables this client opens realtime
 * subscriptions on, and the tables the database actually publishes. Today
 * neither list exists as a file. The execution plan says "56 subscriptions
 * across 26 files"; this scan, run on staging 1677dc2, finds 56 across **24**.
 * The count is right and the file count is not, which is exactly why the gate
 * asks for a produced artefact instead of a sentence.
 *
 * This is the CLIENT producer only. `scripts/db-publication-export.mjs` is D1's,
 * and a third script compares the two and fails the build in both directions.
 * Neither developer edits the other's producer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THE OUTPUT SHAPE BELOW IS A PROPOSAL, NOT A FROZEN INTERFACE
 *
 * `docs/gates/**` is the Auditor's lane and holds no P3 interface today — the
 * same test P1 had to pass before its client half could be written
 * (`docs/gates/P1-interface.md` exists or P1 has not started). So this ships the
 * producer and the reading, and it does NOT ship the comparator or wire anything
 * into the build. Writing a comparator against a shape nobody froze is how the
 * two halves drift.
 *
 * The shape is documented at `docs/evidence/d2/phase3/subscription-scan-schema.md`
 * for the Auditor to freeze, amend or reject.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REFUSES TO GUESS
 *
 * A `table:` whose value is not a string literal is reported in `unresolved`,
 * never dropped and never inferred. A scan that silently skips what it cannot
 * read reports fewer subscriptions than exist and looks like good news — the
 * same failure the P10 inventory had to close by failing on an unresolvable
 * delay rather than assuming it was fine. `--strict` exits 1 when `unresolved`
 * is non-empty.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 *   node scripts/web-subscription-scan.mjs [--out <file>] [--strict] [--root <dir>]
 *   node scripts/web-subscription-scan.mjs --self-test
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_VERSION = 1;

const SKIP_DIRS = new Set(["__tests__", "test-utils", "uiharness", "node_modules"]);
const SOURCE = /\.tsx?$/;
const IS_TEST = /\.(test|spec)\.tsx?$/;

/** `.on("postgres_changes", { … }` — the option object, up to its closing brace. */
const ON_POSTGRES_CHANGES =
  /\.on\(\s*["'`]postgres_changes["'`]\s*,\s*\{([\s\S]*?)\}\s*,/g;

/** `supabase.channel("name"` / `.channel(`tpl-${x}`` — literal or not. */
const CHANNEL = /\.channel\(\s*(["'`])([\s\S]*?)\1/g;

const field = (body, name) => {
  const literal = new RegExp(`\\b${name}\\s*:\\s*(["'\`])([^"'\`]*)\\1`).exec(body);
  if (literal) return { value: literal[2], resolved: true };
  const any = new RegExp(`\\b${name}\\s*:\\s*([^,}\\n]+)`).exec(body);
  return any ? { value: any[1].trim(), resolved: false } : null;
};

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) sources(full, out);
    } else if (SOURCE.test(name) && !IS_TEST.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Line number of a character offset, 1-based. */
const lineAt = (text, index) => text.slice(0, index).split("\n").length;

/**
 * The nearest `.channel(` BEFORE this offset. A file may open several channels,
 * so "the last one opened above this call" is the only honest association a
 * regex scan can make — and it is recorded as such rather than asserted.
 */
function channelAbove(text, index) {
  CHANNEL.lastIndex = 0;
  let found = null;
  for (const m of text.matchAll(CHANNEL)) {
    if (m.index > index) break;
    found = { name: m[2], resolved: !m[2].includes("${") };
  }
  return found;
}

export function scanText(text, path) {
  const subscriptions = [];
  const unresolved = [];
  for (const m of text.matchAll(ON_POSTGRES_CHANGES)) {
    const body = m[1];
    const line = lineAt(text, m.index);
    const table = field(body, "table");
    const ch = channelAbove(text, m.index);
    const entry = {
      file: path,
      line,
      channel: ch && ch.resolved ? ch.name : null,
      schema: field(body, "schema")?.value ?? null,
      table: table && table.resolved ? table.value : null,
      event: field(body, "event")?.value ?? null,
      filter: field(body, "filter")?.value ?? null,
    };
    subscriptions.push(entry);
    if (!table || !table.resolved) {
      unresolved.push({ file: path, line, raw: table ? table.value : "<no table: key>" });
    }
  }
  return { subscriptions, unresolved };
}

export function scan(root = "src") {
  const abs = join(process.cwd(), root);
  const subscriptions = [];
  const unresolved = [];
  for (const f of sources(abs).sort()) {
    const rel = relative(process.cwd(), f).split(sep).join("/");
    const r = scanText(readFileSync(f, "utf8"), rel);
    subscriptions.push(...r.subscriptions);
    unresolved.push(...r.unresolved);
  }
  const tables = [...new Set(subscriptions.map((s) => s.table).filter(Boolean))].sort();
  return {
    producer: "web-subscription-scan",
    schemaVersion: SCHEMA_VERSION,
    generatedBy: "scripts/web-subscription-scan.mjs",
    root,
    counts: {
      subscriptions: subscriptions.length,
      files: new Set(subscriptions.map((s) => s.file)).size,
      tables: tables.length,
      unresolved: unresolved.length,
    },
    tables,
    subscriptions,
    unresolved,
  };
}

/* ── self-test ───────────────────────────────────────────────────────────────
 * A scan that matches nothing is indistinguishable from a clean repository, so
 * the instrument is exercised against inputs whose answers are known, including
 * the one it must REFUSE. */
function selfTest() {
  const cases = [
    {
      name: "a literal table is read, with its channel, event and filter",
      src: `const c = supabase.channel("profile-guard-1")\n  .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: "id=eq.7" }, cb)`,
      check: (r) =>
        r.subscriptions.length === 1 &&
        r.subscriptions[0].table === "profiles" &&
        r.subscriptions[0].channel === "profile-guard-1" &&
        r.subscriptions[0].event === "*" &&
        r.subscriptions[0].filter === "id=eq.7" &&
        r.unresolved.length === 0,
    },
    {
      name: "a NON-literal table is reported, never dropped and never guessed",
      src: `supabase.channel("x").on("postgres_changes", { event: "INSERT", schema: "public", table: tableName }, cb)`,
      check: (r) => r.subscriptions.length === 1 && r.subscriptions[0].table === null && r.unresolved.length === 1,
    },
    {
      name: "a template-literal channel name is not reported as a literal",
      src: 'supabase.channel(`votes-${id}`).on("postgres_changes", { schema: "public", table: "competition_votes" }, cb)',
      check: (r) => r.subscriptions[0].channel === null && r.subscriptions[0].table === "competition_votes",
    },
    {
      name: "two subscriptions on one channel are two entries",
      src: `supabase.channel("a")\n .on("postgres_changes", { schema: "public", table: "posts" }, cb)\n .on("postgres_changes", { schema: "public", table: "comments" }, cb)`,
      check: (r) => r.subscriptions.length === 2 && r.subscriptions[1].table === "comments",
    },
    {
      name: "a file with no realtime at all yields nothing",
      src: `export const x = 1;`,
      check: (r) => r.subscriptions.length === 0 && r.unresolved.length === 0,
    },
    {
      name: "line numbers are the call's own, not the file's first line",
      src: `\n\n\nsupabase.channel("a").on("postgres_changes", { schema: "public", table: "posts" }, cb)`,
      check: (r) => r.subscriptions[0].line === 4,
    },
  ];
  let bad = 0;
  for (const c of cases) {
    const ok = c.check(scanText(c.src, "fixture.ts"));
    if (!ok) bad += 1;
    console.log(`${ok ? "pass" : "FAIL"}  ${c.name}`);
  }
  console.log(bad === 0 ? "\nSELF-TEST: ALL CASES PASS" : `\nSELF-TEST: ${bad} case(s) failed`);
  return bad === 0 ? 0 : 1;
}

/* ── CLI ─────────────────────────────────────────────────────────────────────
 * Guarded, because this module is ALSO imported — by
 * `src/__tests__/subscriptionScan.test.ts`, and by whatever comparator the
 * Auditor's frozen schema ends up calling for. An unguarded top-level body
 * would print the whole inventory to stdout on import, and a producer that
 * writes to stdout when nobody asked is a producer no consumer can use. */
function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };

  if (argv.includes("--self-test")) {
    process.exit(selfTest());
  }

  const result = scan(arg("--root", "src"));
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const out = arg("--out");
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);

  console.error(
    `web-subscription-scan: ${result.counts.subscriptions} subscription(s) in ` +
      `${result.counts.files} file(s), ${result.counts.tables} table(s), ` +
      `${result.counts.unresolved} unresolved`,
  );

  if (argv.includes("--strict") && result.counts.unresolved > 0) {
    console.error(
      "FAIL --strict: a table this scan cannot resolve is not a table it may ignore.\n" +
        result.unresolved.map((u) => `  ${u.file}:${u.line}  ${u.raw}`).join("\n"),
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
