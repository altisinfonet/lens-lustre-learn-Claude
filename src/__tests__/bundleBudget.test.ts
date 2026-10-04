/**
 * P13 — the byte ceiling is binding.
 *
 * `scripts/web-bundle-budget.mjs` runs in web-build.yml after `npm run build`
 * on both lanes and exits 1 over budget. These tests pin that it FAILS on each
 * over-budget shape (C-34), that it refuses to pass an unbuilt dist/, that a
 * stale named ceiling is an error, and that web-build.yml really runs it with
 * no escape hatch — the gate's sentence is "fails, it does not warn".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, selfTest, chunkName, validateBudget } from "../../scripts/web-bundle-budget.mjs";

const refs = {
  entry: "assets/index-AAAAAAAA.js",
  modulepreload: ["assets/vendor-BBBBBBBB.js"],
  stylesheets: ["css2", "assets/index-CCCCCCCC.css"],
};
const budget = { entryBytes: 1000, initialBytes: 1500, defaultChunkBytes: 300, namedChunks: { "big.js": 900 } };
const files = (over: Record<string, number> = {}) =>
  Object.entries({
    "index.html": 10,
    "assets/index-AAAAAAAA.js": 900,
    "assets/vendor-BBBBBBBB.js": 300,
    "assets/index-CCCCCCCC.css": 200,
    "assets/big-DDDDDDDD.js": 800,
    "assets/Route-EEEEEEEE.js": 250,
    ...over,
  }).map(([rel, bytes]) => ({ rel, bytes }));

describe("P13 · evaluate", () => {
  it("passes a build inside every ceiling", () => {
    expect(evaluate(files(), refs, budget).failures).toEqual([]);
  });
  it.each([
    ["entry one byte over", { "assets/index-AAAAAAAA.js": 1001 }],
    ["route chunk over the default", { "assets/Route-EEEEEEEE.js": 301 }],
    ["named chunk over its own ceiling", { "assets/big-DDDDDDDD.js": 901 }],
    ["a new CSS chunk over the default", { "assets/Page-FFFFFFFF.css": 301 }],
    ["initial over while each part is under", { "assets/index-AAAAAAAA.js": 999, "assets/vendor-BBBBBBBB.js": 299, "assets/index-CCCCCCCC.css": 299 }],
  ])("FAILS: %s", (_n, over) => {
    expect(evaluate(files(over), refs, budget).failures.length).toBeGreaterThan(0);
  });
  it("a ceiling that matches no chunk is an error, not a silent pass", () => {
    const f = files().filter((x) => x.rel !== "assets/big-DDDDDDDD.js");
    expect(evaluate(f, refs, budget).failures.join()).toMatch(/matches no chunk/);
  });
  it("an entry index.html names but dist/ lacks is an error", () => {
    const f = files().filter((x) => x.rel !== "assets/index-AAAAAAAA.js");
    expect(evaluate(f, refs, budget).failures.join()).toMatch(/not in dist/);
  });
  it("chunkName strips Vite's 8-character hash", () => {
    expect(chunkName("assets/AdminAnalytics-I0YmyXD4.js")).toBe("AdminAnalytics.js");
    expect(chunkName("assets/jspdf.es.min-B0bnVnOg.js")).toBe("jspdf.es.min.js");
    expect(chunkName("assets/index-B_VetDRI.css")).toBe("index.css");
  });
  it("the CLI self-test passes (it builds real temp dist/ trees)", () => {
    expect(selfTest()).toEqual([]);
  });
});

describe("P13 · the committed budget and its wiring", () => {
  it("scripts/web-bundle-budget.json is well-formed", () => {
    expect(validateBudget(JSON.parse(readFileSync("scripts/web-bundle-budget.json", "utf8")))).toEqual([]);
  });
  it("web-build.yml runs the ceiling after the build in BOTH lane jobs, with no escape hatch", () => {
    const wf = readFileSync(".github/workflows/web-build.yml", "utf8");
    const runs = wf.match(/run: node scripts\/web-bundle-budget\.mjs\s*$/gm) || [];
    expect(runs.length).toBe(2);
    expect(wf).not.toMatch(/web-bundle-budget[^\n]*\|\|/);
    const step = wf.split("\n").findIndex((l) => l.includes("Bundle byte ceiling (P13) —"));
    expect(wf.split("\n").slice(step, step + 3).join("\n")).not.toMatch(/continue-on-error/);
  });
});
