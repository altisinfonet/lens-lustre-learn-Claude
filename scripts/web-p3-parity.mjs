#!/usr/bin/env node
/**
 * P3 — THE PARITY COMPARATOR. Client subscriptions vs the realtime publication.
 * FAILS IN BOTH DIRECTIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO HALVES (schemaVersion 1, frozen by the Auditor "as is", R-84 §3):
 *   client  scripts/web-subscription-scan.mjs  (D2)  producer "web-subscription-scan"
 *   db      scripts/db-publication-export.mjs  (D1)  producer "db-publication-export"
 * Both emit `{ producer, schemaVersion: 1, tables: [sorted, unique], counts, … }`.
 * `tables` is the field compared. This file never edits either producer and
 * never reads the database itself.
 *
 * THE TWO FAILURES, AND WHY EACH IS A FAILURE:
 *   1. SUBSCRIBED BUT NOT PUBLISHED — the client opens a postgres_changes
 *      channel on a table the publication does not carry. It receives nothing,
 *      ever, and nothing says so: a "live" screen that is silently static.
 *   2. PUBLISHED BUT NOT SUBSCRIBED — the publication carries a table no
 *      client listens to. Every write to it is still decoded from the WAL by
 *      the realtime server for nobody. That decode is the 47.6 % of production
 *      database time read on 2026-10-04 06:09 UTC (R-79).
 * There is no allowlist. A difference is either fixed (D2 drops the listener,
 * D1 adds or drops the table) or argued to the Auditor; it is not waved here.
 *
 * WHAT IT REFUSES: a wrong producer name, a schemaVersion other than 1, a
 * `tables` field that is not a sorted, unique list of strings, `counts.tables`
 * disagreeing with `tables`, or a client reading with unresolved table names —
 * a partial reading cannot prove parity, so it is an error, not a pass.
 *
 * C-34: `--self-test` drives `compare()` through every shape.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/web-p3-parity.mjs --db <export.json> [--client <scan.json>]   # client defaults to a fresh scan of src/
 *   node scripts/web-p3-parity.mjs --self-test
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { scan } from "./web-subscription-scan.mjs";

export const SCHEMA_VERSION = 1;
export const CLIENT_PRODUCER = "web-subscription-scan";
export const DB_PRODUCER = "db-publication-export";

export function validate(doc, producer) {
  const e = [];
  if (!doc || typeof doc !== "object") return [`${producer}: not a JSON object`];
  if (doc.producer !== producer) e.push(`${producer}: producer is ${JSON.stringify(doc.producer)}`);
  if (doc.schemaVersion !== SCHEMA_VERSION) e.push(`${producer}: schemaVersion is ${JSON.stringify(doc.schemaVersion)}, expected ${SCHEMA_VERSION}`);
  const t = doc.tables;
  if (!Array.isArray(t) || t.some((x) => typeof x !== "string" || x.length === 0)) {
    e.push(`${producer}: tables must be an array of non-empty strings`);
    return e;
  }
  const sorted = [...new Set(t)].sort();
  if (sorted.length !== t.length || sorted.some((x, i) => x !== t[i])) e.push(`${producer}: tables must be sorted and unique`);
  if (doc.counts && typeof doc.counts.tables === "number" && doc.counts.tables !== t.length) {
    e.push(`${producer}: counts.tables ${doc.counts.tables} != tables.length ${t.length}`);
  }
  if (Array.isArray(doc.unresolved) && doc.unresolved.length > 0) {
    e.push(`${producer}: ${doc.unresolved.length} unresolved entr(y/ies) — a partial reading cannot prove parity`);
  }
  return e;
}

/** Pure. Returns { errors, subscribedNotPublished, publishedNotSubscribed, ok }. */
export function compare(client, db) {
  const errors = [...validate(client, CLIENT_PRODUCER), ...validate(db, DB_PRODUCER)];
  if (errors.length) return { errors, subscribedNotPublished: [], publishedNotSubscribed: [], ok: false };
  const c = new Set(client.tables);
  const d = new Set(db.tables);
  const subscribedNotPublished = client.tables.filter((t) => !d.has(t));
  const publishedNotSubscribed = db.tables.filter((t) => !c.has(t));
  return { errors, subscribedNotPublished, publishedNotSubscribed, ok: !subscribedNotPublished.length && !publishedNotSubscribed.length };
}

/** Where each client-only table is subscribed, so a failure names a line. */
export function locate(client, table) {
  return (client.subscriptions || []).filter((s) => s.table === table).map((s) => `${s.file}:${s.line}`);
}

const doc = (producer, tables, extra = {}) => ({ producer, schemaVersion: 1, tables, counts: { tables: tables.length }, ...extra });
export const SELF_TEST = [
  ["parity", doc(CLIENT_PRODUCER, ["a", "b"]), doc(DB_PRODUCER, ["a", "b"]), true],
  ["subscribed, not published", doc(CLIENT_PRODUCER, ["a", "b", "c"]), doc(DB_PRODUCER, ["a", "b"]), false],
  ["published, not subscribed", doc(CLIENT_PRODUCER, ["a"]), doc(DB_PRODUCER, ["a", "b"]), false],
  ["both directions", doc(CLIENT_PRODUCER, ["a", "c"]), doc(DB_PRODUCER, ["a", "b"]), false],
  ["schemaVersion 2 refused", doc(CLIENT_PRODUCER, ["a"]), { ...doc(DB_PRODUCER, ["a"]), schemaVersion: 2 }, false],
  ["wrong producer refused", doc(CLIENT_PRODUCER, ["a"]), doc("something-else", ["a"]), false],
  ["unsorted refused", doc(CLIENT_PRODUCER, ["b", "a"]), doc(DB_PRODUCER, ["a", "b"]), false],
  ["duplicates refused", doc(CLIENT_PRODUCER, ["a", "a"]), doc(DB_PRODUCER, ["a"]), false],
  ["counts disagree refused", { ...doc(CLIENT_PRODUCER, ["a"]), counts: { tables: 2 } }, doc(DB_PRODUCER, ["a"]), false],
  ["unresolved client reading refused", doc(CLIENT_PRODUCER, ["a"], { unresolved: [{ file: "x", line: 1, raw: "table: t" }] }), doc(DB_PRODUCER, ["a"]), false],
  ["empty both = parity of nothing", doc(CLIENT_PRODUCER, []), doc(DB_PRODUCER, []), true],
];

export function selfTest() {
  return SELF_TEST.filter(([, c, d, want]) => compare(c, d).ok !== want).map(([n, , , want]) => `${n}: expected ${want ? "PASS" : "FAIL"}`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes("--self-test")) {
    const f = selfTest();
    f.forEach((x) => console.error("SELF-TEST FAIL · " + x));
    console.log(`self-test: ${SELF_TEST.length - f.length}/${SELF_TEST.length} shapes judged correctly`);
    process.exit(f.length ? 1 : 0);
  }
  const dbPath = val("--db");
  if (!dbPath) { console.error("usage: web-p3-parity.mjs --db <db-publication-export.json> [--client <scan.json>] | --self-test"); process.exit(2); }
  let db, client;
  try { db = JSON.parse(fs.readFileSync(dbPath, "utf8")); } catch (e) { console.error(`::error::P3 parity · cannot read ${dbPath}: ${e.message}`); process.exit(1); }
  const cp = val("--client");
  try { client = cp ? JSON.parse(fs.readFileSync(cp, "utf8")) : scan("src"); } catch (e) { console.error(`::error::P3 parity · client reading: ${e.message}`); process.exit(1); }
  const r = compare(client, db);
  for (const e of r.errors) console.error(`::error::P3 parity · ${e}`);
  for (const t of r.subscribedNotPublished) console.error(`::error::P3 parity · SUBSCRIBED BUT NOT PUBLISHED · ${t} · ${locate(client, t).join(", ")}`);
  for (const t of r.publishedNotSubscribed) console.error(`::error::P3 parity · PUBLISHED BUT NOT SUBSCRIBED · ${t} · decoded from the WAL for nobody`);
  console.log(`P3 parity: client ${client.tables?.length ?? "?"} tables, publication ${db.tables?.length ?? "?"} tables · ` +
    `${r.subscribedNotPublished.length} subscribed-not-published · ${r.publishedNotSubscribed.length} published-not-subscribed · ` +
    `${r.errors.length} schema error(s) — ${r.ok ? "PASS" : "FAIL"}`);
  process.exit(r.ok ? 0 : 1);
}
