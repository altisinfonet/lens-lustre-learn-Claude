/**
 * P14 — one Cache-Control per asset class, never a contradiction.
 *
 * Pins (C-34: each assertion is shown failing on the shape it guards):
 *   1. the merge simulator reproduces the header MEASURED on both lanes on
 *      2026-10-04 for /images/logo-fallback.webp, byte for byte, from the old
 *      template — so the simulator is a model of Pages, not of my intent;
 *   2. the shipped public/_headers resolves every sample path without a
 *      contradiction, and the old template does not (6 contradictory);
 *   3. each Function that SETS Cache-Control sets the stated policy value;
 *   4. functions/images/[[path]].ts passes a real image through with exactly
 *      that one value, and turns the SPA-fallback HTML into an uncached 404.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseHeadersFile, resolveHeaders, staticCheck, contradictions, selfTest,
  functionCacheControl, SOURCE_POLICY, readFunctionSources,
} from "../../scripts/web-cache-headers-check.mjs";
import { onRequest as imagesFn } from "../../functions/images/[[path]]";

const OLD_TEMPLATE = `/*
  Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/images/*
  Cache-Control: public, max-age=2592000, immutable
  Vary: Accept
/*.webp
  Cache-Control: public, max-age=31536000, immutable
/*.woff2
  Cache-Control: public, max-age=31536000, immutable
/competitions
  Cache-Control: public, max-age=300, s-maxage=600, stale-while-revalidate=86400
`;
const MEASURED_2026_10_04 =
  "no-store, no-cache, must-revalidate, proxy-revalidate, public, max-age=2592000, immutable, public, max-age=31536000, immutable";

describe("P14 · the Pages merge model", () => {
  it("reproduces the measured /images/* header exactly from the old template", () => {
    const h = resolveHeaders(parseHeadersFile(OLD_TEMPLATE), "/images/logo-fallback.webp");
    expect(h["cache-control"]).toBe(MEASURED_2026_10_04);
    expect(contradictions(h["cache-control"]).length).toBeGreaterThan(0);
  });

  it("self-test passes", () => {
    expect(selfTest()).toEqual([]);
  });
});

describe("P14 · the shipped rules", () => {
  it("public/_headers + the Functions: every sample path has one, consistent Cache-Control", () => {
    const rows = staticCheck(readFileSync("public/_headers", "utf8"), readFunctionSources());
    expect(rows.filter((r: { problems: string[] }) => r.problems.length)).toEqual([]);
  });

  it("the old template is red on the same check (fail-first)", () => {
    const rows = staticCheck(OLD_TEMPLATE, readFunctionSources());
    const bad = rows.filter((r: { path: string; problems: string[] }) => r.problems.length).map((r: { path: string }) => r.path);
    expect(bad).toEqual(expect.arrayContaining(["/competitions", "/x.webp", "/font.woff2"]));
  });

  it.each(SOURCE_POLICY.map((s: { file: string; value: string }) => [s.file, s.value]))(
    "%s sets exactly the stated policy",
    (file, value) => {
      expect(functionCacheControl(readFileSync(file as string, "utf8"))).toBe(value);
    },
  );
});

describe("P14 · functions/images/[[path]].ts", () => {
  const ctx = (res: Response) => ({ next: async () => res });

  it("a real image leaves with ONE Cache-Control, body and ETag untouched", async () => {
    const upstream = new Response("IMG", {
      headers: { "content-type": "image/webp", etag: '"abc"', "cache-control": MEASURED_2026_10_04 },
    });
    const out = await imagesFn(ctx(upstream));
    expect(out.headers.get("cache-control")).toBe("public, max-age=86400, stale-while-revalidate=604800");
    expect(out.headers.get("etag")).toBe('"abc"');
    expect(await out.text()).toBe("IMG");
  });

  it("the SPA fallback under /images/ becomes a 404 that is never cached", async () => {
    const out = await imagesFn(ctx(new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } })));
    expect(out.status).toBe(404);
    expect(out.headers.get("cache-control")).toContain("no-store");
  });
});
