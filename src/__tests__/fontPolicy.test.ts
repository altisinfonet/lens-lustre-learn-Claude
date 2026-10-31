/**
 * P21 — the font policy is enforced, not just written down.
 * Pins: every planted violation is caught (C-34), the real index.html and
 * src CSS pass, and two REAL-file mutants (the stylesheet made
 * render-blocking; display=swap removed) go red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checkStatic, selfTest, SELF_TEST, staticOnRepo } from "../../scripts/web-font-policy.mjs";

describe("P21 · font policy guard", () => {
  it("self-test: every shape classified", () => {
    expect(selfTest()).toEqual([]);
    expect(SELF_TEST.length).toBeGreaterThanOrEqual(10);
  });

  it("the repository passes", () => {
    expect(staticOnRepo()).toEqual([]);
  });

  const html = readFileSync("index.html", "utf8");
  const css = { "src/index.css": readFileSync("src/index.css", "utf8") };

  it("real index.html made render-blocking → red", () => {
    const mutated = html.replace(/\s+media="print"\s+onload="this\.media='all'"/, "");
    expect(mutated).not.toBe(html);
    expect(checkStatic(mutated, css).join()).toMatch(/render-blocking/);
  });

  it("real index.html without display=swap → red", () => {
    const mutated = html.replace(/&display=swap/g, "");
    expect(mutated).not.toBe(html);
    expect(checkStatic(mutated, css).join()).toMatch(/display=swap/);
  });

  it("real src/index.css stack stripped of its fallback → red", () => {
    const mutated = { "src/index.css": css["src/index.css"].replace("'Inter', Helvetica, Arial, sans-serif", "'Inter'") };
    expect(checkStatic(html, mutated).join()).toMatch(/generic fallback/);
  });
});
