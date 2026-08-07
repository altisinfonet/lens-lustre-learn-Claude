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
const REST = fs.readFileSync(path.resolve(root, "src/i18n/translations.rest.ts"), "utf8");
const CTX = fs.readFileSync(path.resolve(root, "src/i18n/I18nContext.tsx"), "utf8");

describe("non-English translations are lazy-loaded", () => {
  it("the boot dictionary ships English only", () => {
    expect(BASE).toMatch(/export const translations[^\n]*=\s*\{\s*en\s*\}/);
    // The heavy dicts must NOT be declared in the boot file anymore.
    for (const name of ["hi", "bn", "mr", "gu", "ta", "te"]) {
      expect(BASE).not.toMatch(new RegExp(`const ${name}: Dict = \\{`));
    }
  });

  it("the six non-English dictionaries live in the lazy chunk", () => {
    for (const name of ["hi", "bn", "mr", "gu", "ta", "te"]) {
      expect(REST).toMatch(new RegExp(`const ${name}: Dict = \\{`));
    }
    expect(REST).toMatch(/export const rest\b/);
  });

  it("I18nContext imports the rest chunk dynamically, never statically", () => {
    expect(CTX).toMatch(/import\(\s*["']\.\/translations\.rest["']\s*\)/);
    expect(CTX).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+["']\.\/translations\.rest["']/m);
  });
});
