/**
 * APPLE 2.3.6 (review of 4 Nov 2026): the age rating says the app has an age
 * check and App Review could not find one. Owner, 4 Nov: the check is the date
 * of birth at sign-up, with one clear line saying 18+ only.
 * Pinned: the line is on the screen, and the rule behind it still stops anyone
 * under 18 from finishing sign-up.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "..", "OnboardingModal.tsx"), "utf8");

describe("the 18+ check at sign-up", () => {
  it("says so in one clear line beside the date of birth", () => {
    const label = source.indexOf("Date of Birth <span");
    const picker = source.indexOf("<Popover>", label);
    expect(source.slice(label, picker)).toContain("18+ only. Under 18 not accepted.");
  });

  it("still stops anyone under 18 from finishing", () => {
    expect(source).toContain("const ageOk = !!dateOfBirth && differenceInYears(new Date(), dateOfBirth) >= 18;");
    expect(source).toMatch(/const canProceed =\s+ageOk &&/);
    expect(source).toContain('const UNDER_18_MESSAGE = "Under 18 is not eligible to register.";');
  });

  it("the date picker stays open in WebKit: the popover inside the sign-up dialog is modal", () => {
    expect(source).toContain("<Popover modal>");
  });
});
