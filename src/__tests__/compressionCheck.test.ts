/**
 * P15 — the compression check's verdict and its asset walk.
 *
 * `scripts/web-compression-check.mjs` is the instrument behind
 * docs/evidence/d2/P15/compression.md. A checker that passes everything is not
 * evidence (C-34), so this pins: identity-encoded text FAILS, deflate is not
 * accepted, a 404 on a referenced chunk FAILS, the tiny-body exemption is
 * bounded, non-text is skipped — and the asset walk finds lazy chunks named
 * inside JS, which is how "every text response" reaches beyond the first page.
 */
import { describe, it, expect } from "vitest";
import { classify, selfTest, SELF_TEST, MIN_BYTES, assetRefs } from "../../scripts/web-compression-check.mjs";

describe("P15 · classify", () => {
  it("the CLI self-test table classifies every shape correctly", () => {
    expect(selfTest()).toEqual([]);
  });

  it.each(SELF_TEST.map((c: { name: string; in: object; want: string }) => [c.name, c]))("%s", (_n, c) => {
    expect(classify(c.in).verdict).toBe(c.want);
  });

  it("the tiny exemption ends exactly at MIN_BYTES", () => {
    const at = (n: number) =>
      classify({ status: 200, contentType: "text/plain", contentEncoding: "", decodedBytes: n }).verdict;
    expect(at(MIN_BYTES - 1)).toBe("TINY");
    expect(at(MIN_BYTES)).toBe("FAIL");
  });

  it("charset and case in the headers do not change the verdict", () => {
    expect(
      classify({ status: 200, contentType: "Application/JavaScript; charset=UTF-8", contentEncoding: "BR", decodedBytes: 5000 })
        .verdict,
    ).toBe("PASS");
  });
});

describe("P15 · assetRefs (the walk that reaches lazy chunks)", () => {
  it("finds entry, preload and lazily-imported chunk names", () => {
    const html = `<script type="module" src="/assets/index-D0t7eOh3.js"></script><link rel="stylesheet" href="/assets/index-B_VetDRI.css">`;
    const js = `const a=()=>import("./Feed-Ab12_cd.js");m.f=["assets/Profile-Zz9.js","assets/Profile-Qq1.css"]`;
    expect(assetRefs(html)).toEqual(["/assets/index-D0t7eOh3.js", "/assets/index-B_VetDRI.css"]);
    expect(assetRefs(js)).toEqual(["/assets/Profile-Zz9.js", "/assets/Profile-Qq1.css"]);
  });

  it("ignores images and other origins' assets", () => {
    expect(assetRefs(`"assets/hero.webp" "https://cdn.example.com/x.png"`)).toEqual([]);
  });
});
