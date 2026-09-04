/**
 * F-76 · C-34 on the ESCAPE HATCH ITSELF.
 *
 * A new category that lets a SECURITY DEFINER function pass is a hole unless it
 * is shown REFUSING the cases it must refuse. These fixtures are the refusals:
 * each is a migration that a careless author would expect to pass, and each
 * must fail on exactly one named condition.
 *
 * The last two tests run against the REAL
 * supabase/migrations/20260903090000_top_contributors_v3.sql, read from disk —
 * not a copy — so this cannot drift from the file it is judging.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { publicByDesignVerdict, MARKER_TAG } from "./support/publicByDesign";

/** The header slice the guard passes in: CREATE … up to the body marker. */
const headerOf = (sql: string) => sql.slice(0, sql.indexOf("$"));

const FN = "demo_public_card";

/** All three conditions satisfied — the shape a real claim must take. */
const GOOD = `
-- PUBLIC-BY-DESIGN: demo_public_card — the Home page card renders for logged-out
-- visitors, so anon must be able to call this.
CREATE OR REPLACE FUNCTION public.demo_public_card()
RETURNS TABLE (a integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$ SELECT 1 $fn$;
REVOKE ALL ON FUNCTION public.demo_public_card() FROM public;
GRANT EXECUTE ON FUNCTION public.demo_public_card() TO anon, authenticated;
`;

/** (a) granted to anon with NO marker at all. */
const NO_MARKER = GOOD.replace(
  /-- PUBLIC-BY-DESIGN:[^\n]*\n-- visitors[^\n]*\n/,
  "",
);

/** (b) marker present, but no REVOKE ... FROM public before the GRANT. */
const NO_REVOKE = GOOD.replace(
  "REVOKE ALL ON FUNCTION public.demo_public_card() FROM public;\n",
  "",
);

/** (c) marker and REVOKE present, but the function is VOLATILE. */
const VOLATILE = GOOD.replace("\nSTABLE\n", "\nVOLATILE\n");

/** (d) marker present but with no reason after it — a bare tag. */
const BARE_TAG = GOOD.replace(
  /-- PUBLIC-BY-DESIGN: demo_public_card — the Home page card renders for logged-out\n-- visitors, so anon must be able to call this\./,
  "-- PUBLIC-BY-DESIGN: demo_public_card — ok",
);

/** (e) REVOKE present but placed AFTER the GRANT, where it strips it. */
const REVOKE_AFTER = `
-- PUBLIC-BY-DESIGN: demo_public_card — the Home page card renders for logged-out
-- visitors, so anon must be able to call this.
CREATE OR REPLACE FUNCTION public.demo_public_card()
RETURNS TABLE (a integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $fn$ SELECT 1 $fn$;
GRANT EXECUTE ON FUNCTION public.demo_public_card() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_public_card() FROM public;
`;

/** (f) no volatility keyword at all — PostgreSQL's default is VOLATILE. */
const SILENT_VOLATILITY = GOOD.replace("\nSTABLE\n", "\n");

describe("F-76 · the deliberately-public category refuses what it must refuse", () => {
  it("PASSES the fixture that satisfies all three conditions", () => {
    const v = publicByDesignVerdict(GOOD, FN, headerOf(GOOD));
    expect(v.failures).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.claimed).toBe(true);
  });

  it("(a) FAILS a bare anon grant with no marker — on condition 1 only", () => {
    const v = publicByDesignVerdict(NO_MARKER, FN, headerOf(NO_MARKER));
    expect(v.ok).toBe(false);
    expect(v.claimed).toBe(false);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain("(1)");
    expect(v.failures[0]).toContain(MARKER_TAG);
  });

  it("(b) FAILS a marker with no REVOKE FROM public — the marker cannot waive F-62", () => {
    const v = publicByDesignVerdict(NO_REVOKE, FN, headerOf(NO_REVOKE));
    expect(v.ok).toBe(false);
    expect(v.claimed).toBe(true); // the claim was made — and refused anyway
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain("(2)");
    expect(v.failures[0]).toContain("no-op while PUBLIC holds the grant");
  });

  it("(c) FAILS a VOLATILE function even with marker and REVOKE — on condition 3 only", () => {
    const v = publicByDesignVerdict(VOLATILE, FN, headerOf(VOLATILE));
    expect(v.ok).toBe(false);
    expect(v.claimed).toBe(true);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain("(3)");
    expect(v.failures[0]).toContain("amplification");
  });

  it("(d) FAILS a bare marker tag with no reason prose", () => {
    const v = publicByDesignVerdict(BARE_TAG, FN, headerOf(BARE_TAG));
    expect(v.ok).toBe(false);
    expect(v.claimed).toBe(true);
    expect(v.failures[0]).toContain("(1)");
    expect(v.failures[0]).toContain("no real reason");
  });

  it("(e) FAILS when the REVOKE follows the GRANT instead of preceding it", () => {
    const v = publicByDesignVerdict(REVOKE_AFTER, FN, headerOf(REVOKE_AFTER));
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain("(2)");
    expect(v.failures[0]).toContain("must precede");
  });

  it("(f) FAILS a function that states no volatility — the default is VOLATILE", () => {
    const v = publicByDesignVerdict(SILENT_VOLATILITY, FN, headerOf(SILENT_VOLATILITY));
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain("(3)");
    expect(v.failures[0]).toContain("silence is not a claim");
  });

  it("refuses ALL THREE at once, naming each, when nothing is in place", () => {
    const nothing = `
CREATE OR REPLACE FUNCTION public.demo_public_card()
RETURNS TABLE (a integer)
LANGUAGE sql
SECURITY DEFINER
AS $fn$ SELECT 1 $fn$;
GRANT EXECUTE ON FUNCTION public.demo_public_card() TO anon;
`;
    const v = publicByDesignVerdict(nothing, FN, headerOf(nothing));
    expect(v.failures).toHaveLength(3);
    expect(v.failures.map((f) => f.slice(0, 3))).toEqual(["(1)", "(2)", "(3)"]);
  });
});

describe("F-76 · the real top_contributors_v3 migration, read from disk", () => {
  const PATH = join(
    process.cwd(),
    "supabase/migrations/20260903090000_top_contributors_v3.sql",
  );
  const sql = readFileSync(PATH, "utf8");
  const header = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.get_top_contributors_v3"),
    sql.indexOf("AS $fn$"),
  );

  it("already satisfies conditions 2 and 3 — D1 wrote the F-62-safe shape", () => {
    const v = publicByDesignVerdict(sql, "get_top_contributors_v3", header);
    // Whatever else is true, the grant shape and the volatility are not the problem.
    expect(v.failures.filter((f) => f.startsWith("(2)"))).toEqual([]);
    expect(v.failures.filter((f) => f.startsWith("(3)"))).toEqual([]);
  });

  it("passes in full once the one-line marker is added", () => {
    const withMarker =
      `-- ${MARKER_TAG}: get_top_contributors_v3 — the Home page Top Contributors ` +
      `card is public and must render for a logged-out visitor.\n` +
      sql;
    const v = publicByDesignVerdict(withMarker, "get_top_contributors_v3", header);
    expect(v.failures).toEqual([]);
    expect(v.ok).toBe(true);
  });
});
