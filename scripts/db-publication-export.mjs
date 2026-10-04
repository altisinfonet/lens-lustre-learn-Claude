#!/usr/bin/env node
/**
 * D1 · P3 — THE PUBLICATION EXPORTER (the database half of the parity check).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Turns a READING of the supabase_realtime publication — the one-row output of
 * scripts/db-publication-export.sql, run read-only on a lane — into the frozen
 * schemaVersion 1 document that scripts/web-p3-parity.mjs (D2) compares with the
 * client's subscriptions (R-84 §3: frozen "as is";
 * docs/evidence/d2/phase3/subscription-scan-schema.md). This file never edits
 * D2's producer or comparator and never connects to a database: CI has no
 * credential, by design. A lane is read by running the .sql, and the reading is
 * committed under docs/evidence/d1/phase3/readings/.
 *
 * THE DOCUMENT: { producer: "db-publication-export", schemaVersion: 1, tables:
 * [sorted, unique], counts, … }. `tables` holds bare names for schema public
 * (the client scan's names) and "schema.table" for any other schema — never
 * dropped, so a non-public member shows up as a mismatch instead of vanishing.
 *
 * WHAT IT REFUSES (exit 1), because each would make parity look better than it is:
 *   a reading of another publication · a FOR ALL TABLES publication (every
 *   table published: parity is meaningless) · a lane other than staging /
 *   production · no read time · a table entry without schema or name · the same
 *   table twice · an unknown replica identity.
 *
 * --check <export.json>: regenerates the export from the reading it names and
 * fails unless the committed file is byte-identical — a hand-edited or stale
 * export cannot reach the parity job. This is the CI step.
 *
 *   node scripts/db-publication-export.mjs --reading <reading.json> --out <export.json>
 *   node scripts/db-publication-export.mjs --check docs/evidence/d1/phase3/db-publication-export.json
 *   node scripts/db-publication-export.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCER = "db-publication-export";
export const SCHEMA_VERSION = 1;
export const PUBLICATION = "supabase_realtime";
const LANES = new Set(["staging", "production"]);
const IDENT = new Set(["d", "f", "i", "n"]);

export function validateReading(r) {
  const e = [];
  if (!r || typeof r !== "object" || Array.isArray(r)) return ["reading: not a JSON object"];
  if (r.reading !== "db-publication-reading") e.push(`reading: kind is ${JSON.stringify(r.reading)}, expected "db-publication-reading"`);
  if (r.publication !== PUBLICATION) e.push(`reading: publication is ${JSON.stringify(r.publication)}, expected "${PUBLICATION}"`);
  if (r.allTables !== false) e.push(`reading: allTables is ${JSON.stringify(r.allTables)} — a FOR ALL TABLES publication cannot be compared`);
  if (!LANES.has(r.lane)) e.push(`reading: lane is ${JSON.stringify(r.lane)}, expected staging or production`);
  if (typeof r.readAtUtc !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(r.readAtUtc)) e.push(`reading: readAtUtc ${JSON.stringify(r.readAtUtc)} is not YYYY-MM-DDTHH:MM:SSZ`);
  if (!Array.isArray(r.tables)) { e.push("reading: tables is not an array"); return e; }
  const seen = new Set();
  r.tables.forEach((t, i) => {
    if (!t || typeof t.schema !== "string" || !t.schema || typeof t.table !== "string" || !t.table) { e.push(`reading: tables[${i}] has no schema or table name`); return; }
    const k = `${t.schema}.${t.table}`;
    if (seen.has(k)) e.push(`reading: ${k} appears twice`);
    seen.add(k);
    if (t.replicaIdentity != null && !IDENT.has(t.replicaIdentity)) e.push(`reading: ${k} replicaIdentity ${JSON.stringify(t.replicaIdentity)} is not d/f/i/n`);
  });
  return e;
}

/** Pure. reading (+ its repo path) → the schemaVersion 1 document. Throws on a refused reading. */
export function exportFrom(reading, readingPath) {
  const errors = validateReading(reading);
  if (errors.length) { const x = new Error(errors.join("\n")); x.errors = errors; throw x; }
  const name = (t) => (t.schema === "public" ? t.table : `${t.schema}.${t.table}`);
  const detail = reading.tables
    .map((t) => ({ name: name(t), schema: t.schema, table: t.table, replicaIdentity: t.replicaIdentity ?? null, rowFilter: t.rowFilter ?? null }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const tables = detail.map((d) => d.name);
  return {
    producer: PRODUCER,
    schemaVersion: SCHEMA_VERSION,
    generatedBy: "scripts/db-publication-export.mjs",
    publication: reading.publication,
    lane: reading.lane,
    readAtUtc: reading.readAtUtc,
    reading: readingPath,
    transcribed: reading.transcribed === true,
    counts: {
      tables: tables.length,
      replicaIdentityFull: detail.filter((d) => d.replicaIdentity === "f").length,
      nonPublic: detail.filter((d) => d.schema !== "public").length,
      unresolved: 0,
    },
    tables,
    publicationTables: detail.map(({ name: _n, ...rest }) => rest),
    unresolved: [],
  };
}
export const serialise = (doc) => JSON.stringify(doc, null, 2) + "\n";

/** --check: the committed export must be exactly what the exporter makes of the reading it names. */
export function check(exportText, readText) {
  let doc;
  try { doc = JSON.parse(exportText); } catch (e) { return [`export: not JSON (${e.message})`]; }
  if (doc.producer !== PRODUCER || doc.schemaVersion !== SCHEMA_VERSION) return [`export: producer/schemaVersion is ${doc.producer}/${doc.schemaVersion}`];
  if (typeof doc.reading !== "string" || !doc.reading) return ["export: names no reading file"];
  let text;
  try { text = readText(doc.reading); } catch (e) { return [`export: its reading ${doc.reading} cannot be read (${e.message})`]; }
  let regenerated;
  try { regenerated = serialise(exportFrom(JSON.parse(text), doc.reading)); } catch (e) { return [`export: its reading ${doc.reading} is refused:\n  ${(e.errors || [e.message]).join("\n  ")}`]; }
  if (regenerated !== exportText) {
    const a = exportText.split("\n"), b = regenerated.split("\n");
    const i = a.findIndex((l, k) => l !== b[k]);
    return [`export: differs from the exporter's output of ${doc.reading} at line ${i + 1} — hand-edited or stale; re-run the exporter`,
            `  committed:   ${a[i] ?? "(end)"}`, `  regenerated: ${b[i] ?? "(end)"}`];
  }
  return [];
}

// ── self-test (C-34) ─────────────────────────────────────────────────────────
const R = (over = {}) => ({ reading: "db-publication-reading", publication: PUBLICATION, allTables: false, lane: "staging",
  readAtUtc: "2026-10-04T15:41:01Z", tables: [{ schema: "public", table: "posts", replicaIdentity: "d" }, { schema: "public", table: "follows", replicaIdentity: "d" }], ...over });
const refuses = (r) => { try { exportFrom(r, "x.json"); return false; } catch { return true; } };
export const SELF_TEST = [
  ["a good reading exports, sorted", () => JSON.stringify(exportFrom(R(), "x.json").tables) === '["follows","posts"]'],
  ["an empty publication exports zero tables (staging today)", () => exportFrom(R({ tables: [] }), "x.json").counts.tables === 0],
  ["counts.replicaIdentityFull counts f", () => exportFrom(R({ tables: [{ schema: "public", table: "a", replicaIdentity: "f" }] }), "x").counts.replicaIdentityFull === 1],
  ["a non-public member is kept as schema.table, never dropped", () => exportFrom(R({ tables: [{ schema: "realtime", table: "m", replicaIdentity: "d" }] }), "x").tables[0] === "realtime.m"],
  ["the output passes D2's own validation shape (producer, version, sorted unique)", () => { const d = exportFrom(R(), "x"); return d.producer === "db-publication-export" && d.schemaVersion === 1 && d.counts.tables === d.tables.length; }],
  ["refuses another publication", () => refuses(R({ publication: "supabase_realtime_messages_publication" }))],
  ["refuses FOR ALL TABLES", () => refuses(R({ allTables: true }))],
  ["refuses an unknown lane", () => refuses(R({ lane: "dev" }))],
  ["refuses a missing read time", () => refuses(R({ readAtUtc: undefined }))],
  ["refuses a duplicated table", () => refuses(R({ tables: [{ schema: "public", table: "a" }, { schema: "public", table: "a" }] }))],
  ["refuses a nameless entry", () => refuses(R({ tables: [{ schema: "public" }] }))],
  ["refuses an unknown replica identity", () => refuses(R({ tables: [{ schema: "public", table: "a", replicaIdentity: "x" }] }))],
  ["--check passes the exporter's own output", () => check(serialise(exportFrom(R(), "r.json")), () => JSON.stringify(R())).length === 0],
  ["--check fails a hand-added table", () => { const d = exportFrom(R(), "r.json"); d.tables.push("zz"); d.counts.tables++; return check(serialise(d), () => JSON.stringify(R())).length > 0; }],
  ["--check fails a hand-removed table", () => { const d = exportFrom(R(), "r.json"); d.tables.shift(); return check(serialise(d), () => JSON.stringify(R())).length > 0; }],
  ["--check fails a stale export (the reading changed)", () => check(serialise(exportFrom(R(), "r.json")), () => JSON.stringify(R({ tables: [] }))).length > 0],
  ["--check fails a missing reading file", () => check(serialise(exportFrom(R(), "r.json")), () => { throw new Error("ENOENT"); }).length > 0],
];
export function selfTest() { return SELF_TEST.filter(([, f]) => { try { return !f(); } catch { return true; } }).map(([n]) => n); }

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes("--self-test")) {
    const f = selfTest();
    f.forEach((n) => console.error("SELF-TEST FAIL · " + n));
    console.log(`self-test: ${SELF_TEST.length - f.length}/${SELF_TEST.length} cases`);
    process.exit(f.length ? 1 : 0);
  }
  const root = process.cwd();
  if (argv.includes("--check")) {
    const p = val("--check") || "docs/evidence/d1/phase3/db-publication-export.json";
    let text; try { text = fs.readFileSync(path.resolve(root, p), "utf8"); } catch (e) { console.error(`::error::P3 export · ${p}: ${e.message}`); process.exit(1); }
    const errs = check(text, (rp) => fs.readFileSync(path.resolve(root, rp), "utf8"));
    errs.forEach((e) => console.error(`::error::P3 export · ${e}`));
    if (!errs.length) { const d = JSON.parse(text); console.log(`P3 export: ${p} = the exporter's output of ${d.reading} (lane ${d.lane}, read ${d.readAtUtc}${d.transcribed ? ", TRANSCRIBED" : ""}) · ${d.counts.tables} table(s) — PASS`); }
    process.exit(errs.length ? 1 : 0);
  }
  const rp = val("--reading"), out = val("--out");
  if (!rp || !out) { console.error("usage: db-publication-export.mjs --reading <reading.json> --out <export.json> | --check [export.json] | --self-test"); process.exit(2); }
  try {
    const doc = exportFrom(JSON.parse(fs.readFileSync(path.resolve(root, rp), "utf8")), rp);
    fs.writeFileSync(path.resolve(root, out), serialise(doc));
    console.log(`db-publication-export: ${doc.counts.tables} table(s) in ${doc.publication} on ${doc.lane} (read ${doc.readAtUtc}) → ${out}`);
  } catch (e) { (e.errors || [e.message]).forEach((x) => console.error(`::error::P3 export · ${x}`)); process.exit(1); }
}
