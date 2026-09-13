/**
 * THE SELECTION RULE ITSELF — ordering and filtering, with no filesystem.
 *
 * `readdirSync` returns sorted entries on the filesystems this suite runs on,
 * so a fixture built from real files cannot tell a working `.sort()` from a
 * deleted one: an earlier draft asserted sortedness against both the repository
 * and a temp directory, and survived deleting the sort outright. POSIX
 * guarantees no order at all, so the sort is load-bearing on any machine whose
 * filesystem disagrees — which is exactly the machine CI is not.
 *
 * `selectInSequence` exists so that machine can be simulated by passing a list.
 */

import { describe, it, expect } from "vitest";
import { selectInSequence } from "../migrations";

const OUT_OF_ORDER = [
  "30_c.sql",
  "10_a.sql",
  "PROBE_z.sql",
  "20_b.sql",
  "UNAPPLIED_y.sql",
  "notes.md",
];

describe("selectInSequence", () => {
  it("the fixture really is out of order, so the assertions below have work to do", () => {
    // Without this, a fixture that happened to be sorted would make the sort
    // assertion pass for no reason — the trap that made this file necessary.
    const sql = OUT_OF_ORDER.filter((f) => f.endsWith(".sql"));
    expect(sql).not.toEqual([...sql].sort());
  });

  it("sorts, whatever order the listing arrived in", () => {
    expect(selectInSequence(OUT_OF_ORDER)).toEqual(["10_a.sql", "20_b.sql", "30_c.sql"]);
  });

  it("drops both out-of-sequence prefixes", () => {
    expect(selectInSequence(OUT_OF_ORDER)).not.toContain("PROBE_z.sql");
    expect(selectInSequence(OUT_OF_ORDER)).not.toContain("UNAPPLIED_y.sql");
  });

  it("drops non-.sql files", () => {
    expect(selectInSequence(OUT_OF_ORDER)).not.toContain("notes.md");
  });

  it("is a no-op on an empty listing rather than throwing", () => {
    expect(selectInSequence([])).toEqual([]);
  });
});
