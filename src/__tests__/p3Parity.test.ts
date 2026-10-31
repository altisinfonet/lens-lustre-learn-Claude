/**
 * P3 — the comparator fails in both directions (C-34), and it does so on REAL
 * data: the client scan of today's src/ against the production supabase_realtime
 * reading of 2026-09-26 (transcribed from D1's replica-identity evidence; not
 * D1's exporter output, which does not exist yet).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { compare, selfTest, SELF_TEST, validate, CLIENT_PRODUCER, DB_PRODUCER } from "../../scripts/web-p3-parity.mjs";
import { scan } from "../../scripts/web-subscription-scan.mjs";

const PROD = JSON.parse(
  readFileSync("docs/evidence/d2/phase3/p3-parity/publication-production-20260926.TRANSCRIBED.json", "utf8"),
);

describe("P3 · comparator shapes", () => {
  it("self-test", () => expect(selfTest()).toEqual([]));
  it.each(SELF_TEST.map((c: unknown[]) => [c[0], c]))("%s", (_n, c) => {
    const [, client, db, want] = c as [string, object, object, boolean];
    expect(compare(client, db).ok).toBe(want);
  });
});

describe("P3 · on real data", () => {
  const client = scan("src");

  it("today's client reading is a valid, complete schemaVersion 1 document", () => {
    expect(validate(client, CLIENT_PRODUCER)).toEqual([]);
    expect(client.tables.length).toBeGreaterThan(20);
  });

  it("the transcribed production publication is a valid schemaVersion 1 document", () => {
    expect(validate(PROD, DB_PRODUCER)).toEqual([]);
    expect(PROD.tables).toHaveLength(29);
  });

  it("FAILS against production, in BOTH directions", () => {
    const r = compare(client, PROD);
    expect(r.ok).toBe(false);
    expect(r.subscribedNotPublished).toContain("site_settings");
    expect(r.publishedNotSubscribed).toContain("post_comments");
    expect(r.subscribedNotPublished.length).toBeGreaterThan(0);
    expect(r.publishedNotSubscribed.length).toBeGreaterThan(0);
  });

  it("passes only when the two lists agree exactly", () => {
    const db = { ...PROD, tables: [...client.tables], counts: { tables: client.tables.length } };
    expect(compare(client, db).ok).toBe(true);
    const oneShort = { ...db, tables: db.tables.slice(1), counts: { tables: db.tables.length - 1 } };
    expect(compare(client, oneShort).ok).toBe(false);
  });
});
