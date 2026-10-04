import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PERF regression pin, 2026-08-07 — non-English dictionaries stay out of boot.
 *
 * translations.ts used to hold all seven languages and rode into the app's boot
 * chunk for everyone (~322 KB of Indic-script strings even English visitors
 * never see). The six non-English dictionaries now live in translations.rest.ts
 * and are pulled in with a dynamic import() only when a non-English language is
 * selected. These tests fail if the split is undone or the lazy import is
 * replaced by a static one.
 */
const root = process.cwd();
const BASE = fs.readFileSync(path.resolve(root, "src/i18n/translations.ts"), "utf8");
// P12 (2026-10-04): the six dictionaries moved from one shared chunk
// (translations.rest.ts) to one file — one chunk — per language. The
// assertions below are re-pinned to that shape; the lazy/never-static intent is
// unchanged and every check is at least as strict as before.
const LANGS6 = ["hi", "bn", "mr", "gu", "ta", "te"];
const PER_LANG = Object.fromEntries(
  LANGS6.map((l) => [l, fs.readFileSync(path.resolve(root, `src/i18n/translations.${l}.ts`), "utf8")]),
);
const CTX = fs.readFileSync(path.resolve(root, "src/i18n/I18nContext.tsx"), "utf8");

describe("non-English translations are lazy-loaded", () => {
  it("the boot dictionary ships English only", () => {
    expect(BASE).toMatch(/export const translations[^\n]*=\s*\{\s*en\s*\}/);
    // The heavy dicts must NOT be declared in the boot file anymore.
    for (const name of ["hi", "bn", "mr", "gu", "ta", "te"]) {
      expect(BASE).not.toMatch(new RegExp(`const ${name}: Dict = \\{`));
    }
  });

  it("each non-English dictionary lives in its OWN file, holding that language only", () => {
    for (const name of LANGS6) {
      const src = PER_LANG[name];
      expect(src).toMatch(new RegExp(`const ${name}: Dict = \\{`));
      expect(src).toMatch(new RegExp(`export default ${name};`));
      for (const other of LANGS6.filter((o) => o !== name)) {
        expect(src).not.toMatch(new RegExp(`const ${other}: Dict = \\{`));
      }
    }
    expect(fs.existsSync(path.resolve(root, "src/i18n/translations.rest.ts"))).toBe(false);
  });

  it("I18nContext imports each language dynamically, never statically", () => {
    for (const name of LANGS6) {
      expect(CTX).toMatch(new RegExp(`import\\(\\s*["']\\./translations\\.${name}["']\\s*\\)`));
      expect(CTX).not.toMatch(new RegExp(`^import[^\\n]*from\\s+["']\\./translations\\.${name}["']`, "m"));
    }
    expect(CTX).not.toMatch(/translations\.rest["']/);
  });
});
