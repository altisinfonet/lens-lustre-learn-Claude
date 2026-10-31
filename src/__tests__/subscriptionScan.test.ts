/**
 * THE SUBSCRIPTION SCAN MUST NOT MISS ANYTHING QUIETLY. P3, D2 half.
 *
 * `scripts/web-subscription-scan.mjs` produces one half of P3's parity check.
 * Its whole value is that the list is complete: a scan that silently skips a
 * call site it cannot parse reports FEWER subscriptions than exist, and a short
 * list reads as good news. That is the same shape as the P10 inventory's
 * unresolvable-delay hole, closed there by failing rather than assuming.
 *
 * So this file does not re-test the parser — the script self-tests that with
 * `--self-test`, including the case it must refuse. It tests the one thing a
 * unit test can add: that the scanner's count agrees with a crude, independent
 * instrument over the same files.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
// The producer stays `.mjs`, deliberately: it must run from a plain `node`
// invocation in CI with no build step, the way D1's exporter will.
import { scan, scanText, SCHEMA_VERSION } from "../../scripts/web-subscription-scan.mjs";

const ROOT = process.cwd();
const SKIP = new Set(["__tests__", "test-utils", "uiharness", "node_modules"]);

/** The crude instrument: count the string, over the same exclusion set. */
function rawOccurrences(dir: string): { total: number; files: Set<string> } {
  let total = 0;
  const files = new Set<string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        if (!SKIP.has(name)) walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
        const n = (readFileSync(full, "utf8").match(/postgres_changes/g) ?? []).length;
        if (n > 0) {
          total += n;
          files.add(relative(ROOT, full).split(sep).join("/"));
        }
      }
    }
  };
  walk(join(ROOT, dir));
  return { total, files };
}

describe("P3 · the client subscription scan", () => {
  const result = scan("src");
  const raw = rawOccurrences("src");

  it("is not vacuous — this client really does open realtime subscriptions", () => {
    // Without this, every assertion below would pass on an empty result.
    expect(result.counts.subscriptions).toBeGreaterThan(20);
  });

  it("finds every postgres_changes call site a plain string count finds", () => {
    expect(
      result.counts.subscriptions,
      "the scan and a raw count of the string disagree over the same files. " +
        "Either the option-object regex cannot parse a call site, or the file " +
        "walk is skipping one. A short list is the dangerous direction.",
    ).toBe(raw.total);
    expect(result.counts.files).toBe(raw.files.size);
  });

  it("resolves every table, or says which it could not", () => {
    // Not "unresolved is empty" as a wish: if one ever appears, it must appear
    // HERE with its file and line, not vanish from the inventory.
    for (const u of result.unresolved) {
      expect(u.file).toBeTruthy();
      expect(u.line).toBeGreaterThan(0);
    }
    expect(
      result.unresolved,
      "a table this scan cannot resolve is not a table it may ignore — " +
        "`--strict` exits 1 on exactly this list.",
    ).toEqual([]);
  });

  it("never emits a guessed table name", () => {
    // `table: null` is the only honest value for an unresolved site, and every
    // null must be accounted for in `unresolved`.
    const nulls = result.subscriptions.filter((s: { table: string | null }) => s.table === null);
    expect(nulls.length).toBe(result.unresolved.length);
    for (const s of result.subscriptions) {
      if (s.table !== null) expect(s.table).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });

  it("reports the shape the schema proposal documents", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(result.producer).toBe("web-subscription-scan");
    expect(Object.keys(result).sort()).toEqual(
      ["counts", "generatedBy", "producer", "root", "schemaVersion", "subscriptions", "tables", "unresolved"],
    );
    expect(result.tables).toEqual([...result.tables].sort());
  });

  it("GUARD the parser can still refuse a non-literal table", () => {
    // The script's own --self-test covers this; repeated here because this file
    // is what CI runs, and a refusal that stops working would otherwise turn
    // every unresolved site into a silent omission.
    const r = scanText(
      'supabase.channel("x").on("postgres_changes", { schema: "public", table: t }, cb)',
      "fixture.ts",
    );
    expect(r.subscriptions[0].table).toBeNull();
    expect(r.unresolved).toHaveLength(1);
  });
});
