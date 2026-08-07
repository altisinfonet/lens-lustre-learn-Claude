import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PERF regression pin, 2026-08-07 — first paint must not wait on Google Fonts.
 *
 * src/index.css used to open with three `@import url("https://fonts.google…")`
 * lines. A CSS @import at the top of the main stylesheet is render-blocking: the
 * page cannot paint until that external sheet arrives, so on a slow phone link
 * the whole app stalled behind a round-trip to Google. Fonts now load from a
 * single NON-blocking <link media="print" onload> in index.html, and Lora (used
 * in zero components) was dropped. These tests fail if the render-blocking shape
 * comes back.
 */
const root = process.cwd();
const CSS = fs.readFileSync(path.resolve(root, "src/index.css"), "utf8");
const HTML = fs.readFileSync(path.resolve(root, "index.html"), "utf8");

describe("fonts do not block first paint", () => {
  it("index.css imports no external font stylesheet", () => {
    expect(CSS).not.toMatch(/@import\s+url\(["']?https?:\/\/fonts\.googleapis\.com/);
  });

  it("index.html loads the web font non-blocking (media=print swap)", () => {
    // The stylesheet link must be fetched as media="print" so it never blocks
    // rendering, then promoted to all on load.
    expect(HTML).toMatch(/fonts\.googleapis\.com\/css2[^"']*Inter/);
    expect(HTML).toMatch(/media=["']print["'][\s\S]{0,80}onload=["']this\.media=['"]all/);
  });

  it("no longer loads Lora anywhere (it was used in zero components)", () => {
    expect(CSS).not.toMatch(/family=Lora/);
    expect(HTML).not.toMatch(/family=Lora/);
  });
});
