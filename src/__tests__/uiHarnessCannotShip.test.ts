/**
 * THE SCREENSHOT HARNESS MUST NEVER REACH A MEMBER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `uiharness.html` mounts internal UI with mock data and no auth. It exists so
 * the pixels can be looked at before a push — see src/uiharness/main.tsx.
 *
 * It is kept out of production by TWO independent things, and this file asserts
 * both, because either alone is one edit away from being untrue:
 *
 *   1. Vite's default build input is `index.html` ALONE. vite.config.ts
 *      overrides rollupOptions.OUTPUT (manualChunks) and never .input. Add an
 *      `input` map for a second entry — a perfectly ordinary thing to do — and
 *      every extra HTML file at the root starts shipping.
 *   2. A runtime guard in the harness entry that throws unless import.meta.env.DEV.
 *
 * VERIFIED at the time of writing by a real `npm run build`: dist/ contained
 * exactly one HTML file (index.html) and zero occurrences of the string
 * "harness" anywhere in the output.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const config = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
const entry = readFileSync(join(ROOT, "src/uiharness/main.tsx"), "utf8");

describe("the dev-only UI harness cannot be built into a release", () => {
  it("the harness page and entry both exist (guards against a vacuous pass)", () => {
    // Without this, deleting the harness would make every assertion below pass
    // while proving nothing about the protection.
    expect(existsSync(join(ROOT, "uiharness.html"))).toBe(true);
    expect(entry.length).toBeGreaterThan(200);
  });

  it("vite.config.ts does not declare a rollup INPUT, so only index.html is built", () => {
    // Deliberately narrow: `output` is configured and must stay allowed. It is
    // `input` that would sweep uiharness.html into the bundle.
    const rollup = config.slice(config.indexOf("rollupOptions"));
    expect(
      /\binput\s*:/.test(rollup),
      "vite.config.ts now sets rollupOptions.input — every root .html file, including the " +
        "harness, may now be built into the release. Either exclude it explicitly or delete the harness.",
    ).toBe(false);
  });

  it("the harness entry refuses to run outside development", () => {
    expect(
      /if\s*\(\s*!\s*import\.meta\.env\.DEV\s*\)\s*\{\s*throw/.test(entry),
      "the DEV guard is gone from src/uiharness/main.tsx — the build-input rule is now the only " +
        "thing standing between internal mock screens and a member",
    ).toBe(true);
  });

  it("the harness is never imported by application code", () => {
    // A stray `import ... from "@/uiharness/..."` anywhere in the app would
    // pull the scenes and their mock data into the real bundle.
    const appFiles: string[] = [];
    const walk = (dir: string) => {
      for (const name of require("node:fs").readdirSync(dir)) {
        if (name === "node_modules" || name === "uiharness") continue;
        const p = join(dir, name);
        if (require("node:fs").statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !name.includes(".test.")) appFiles.push(p);
      }
    };
    walk(join(ROOT, "src"));
    const offenders = appFiles.filter((p) => /from\s+["'][^"']*uiharness/.test(readFileSync(p, "utf8")));
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });
});
