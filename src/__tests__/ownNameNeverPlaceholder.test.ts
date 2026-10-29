/**
 * S7b-5 (S7b-2's rule, everywhere): the member's OWN name never falls back to
 * "Photographer" on their own screens — profile, dashboard, sidebar,
 * certificates use ownDisplayName (profile, then sign-in name, then email).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const OWN_SCREENS = [
  "src/pages/Profile.tsx",
  "src/pages/Dashboard.tsx",
  "src/components/profile/ProfileLeftSidebar.tsx",
  "src/pages/Certificates.tsx",
];

describe("own name", () => {
  it.each(OWN_SCREENS)("%s never shows the placeholder for the member's own name", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/profile(Core)?\?\.full_name \|\| "Photographer"/);
    expect(src).toContain("ownDisplayName(");
  });
});
