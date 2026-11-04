/**
 * ONE AGE RULE (Owner, 4 Nov 2026: the 18+ rule goes everywhere). Every screen
 * that takes a date of birth uses src/lib/ageRule.ts and the one notice, so the
 * rule and its words cannot differ between sign-up and Edit Profile.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AGE_RULE_LINE, UNDER_18_MESSAGE, isOldEnough } from "@/lib/ageRule";

const NOW = new Date(2026, 10, 4);
const ROOT = join(__dirname, "..", "..", "..");

describe("the rule", () => {
  it("turns 18 on the birthday, not before", () => {
    expect(isOldEnough(new Date(2008, 10, 4), NOW)).toBe(true);
    expect(isOldEnough(new Date(2008, 10, 5), NOW)).toBe(false);
    expect(isOldEnough(new Date(1980, 0, 1), NOW)).toBe(true);
  });
  it("says it in the approved words", () => {
    expect(AGE_RULE_LINE).toBe("18+ only. Under 18 not accepted.");
    expect(UNDER_18_MESSAGE).toBe("Under 18 is not eligible to register.");
  });
});

describe("ratchet: every date-of-birth screen uses the one rule", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === "__tests__" || name === "uiharness") return [];
      return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(name) ? [p] : [];
    });

  it("a screen that saves date_of_birth or says Date of Birth shows AgeRuleNotice", () => {
    const missing = walk(join(ROOT, "src"))
      .map((f) => ({ rel: relative(ROOT, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }))
      .filter((f) => /Date of Birth/.test(f.text) && !f.rel.endsWith("AgeRuleNotice.tsx"))
      .filter((f) => !f.text.includes("<AgeRuleNotice"))
      .map((f) => f.rel);
    expect(missing).toEqual([]);
  });

  it("no screen keeps its own 18 check", () => {
    const own = walk(join(ROOT, "src"))
      .map((f) => ({ rel: relative(ROOT, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }))
      .filter((f) => /differenceInYears\([^)]*\)\s*(<|>=)\s*18/.test(f.text))
      .map((f) => f.rel);
    expect(own).toEqual([]);
  });
});
