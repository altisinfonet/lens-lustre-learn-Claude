import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { movedOne, renumberWrites, sharesSpot, spotsForNew } from "../adSpotOrder";

const r = (id: string, sort_order: number) => ({ id, sort_order });

describe("ad spots stay put (Owner 2026-10-29)", () => {
  it("a new picture takes the spot a deleted one freed, not the end", () => {
    // Library 0,1,2 — the picture in spot 1 (the 2nd ad) was deleted.
    expect(spotsForNew([r("a", 0), r("c", 2)], 1)).toEqual([1]);
  });

  it("several new pictures: freed spots first, lowest first, then after the last", () => {
    expect(spotsForNew([r("a", 0), r("d", 3)], 4)).toEqual([1, 2, 4, 5]);
  });

  it("no gap: after the last picture; empty library starts at 0", () => {
    expect(spotsForNew([r("a", 0), r("b", 1)], 2)).toEqual([2, 3]);
    expect(spotsForNew([], 2)).toEqual([0, 1]);
  });

  it("the old rule (rows.length) put the new picture after a later ad", () => {
    // Before: sort_order = rows.length = 2, which TIES with "c" (2) and sorts
    // after it (newer created_at) — "c" slid into spot 2 with its own likes.
    const rows = [r("a", 0), r("c", 2)];
    expect(rows.length).toBe(2);
    expect(spotsForNew(rows, 1)[0]).not.toBe(rows.length);
  });

  it("renumber writes only the rows that are off their place", () => {
    // "d" is already on 3, so it is not written.
    expect(renumberWrites([r("a", 0), r("b", 5), r("c", 5), r("d", 3)])).toEqual([r("b", 1), r("c", 2)]);
  });

  it("move up / down swaps neighbours and refuses to fall off either end", () => {
    const rows = [r("a", 0), r("b", 1), r("c", 2)];
    expect(movedOne(rows, 1, -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(movedOne(rows, 1, 1).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(movedOne(rows, 0, -1)).toBe(rows);
    expect(movedOne(rows, 2, 1)).toBe(rows);
  });

  it("knows when two pictures share a number", () => {
    expect(sharesSpot([r("a", 0), r("b", 1), r("c", 1)], "b")).toBe(true);
    expect(sharesSpot([r("a", 0), r("b", 1)], "b")).toBe(false);
  });
});

describe("the admin library uses these rules", () => {
  const lib = readFileSync("src/components/admin/ads/AdCreativeLibrary.tsx", "utf8");

  it("new uploads take freed spots (not rows.length)", () => {
    expect(lib).toContain("spotsForNew(");
    expect(lib).not.toMatch(/sort_order:\s*base \+ i/);
  });

  it("has Replace picture, Move up and Move down on every picture", () => {
    expect(lib).toContain('aria-label="Replace this picture"');
    expect(lib).toContain('aria-label="Move up"');
    expect(lib).toContain('aria-label="Move down"');
  });

  it("Replace inserts the new picture before removing the old (a failure never loses the spot)", () => {
    const body = lib.slice(lib.indexOf("const onReplace"), lib.indexOf("const patch"));
    expect(body.indexOf(".insert(")).toBeGreaterThan(-1);
    expect(body.indexOf(".delete()")).toBeGreaterThan(body.indexOf(".insert("));
  });
});
