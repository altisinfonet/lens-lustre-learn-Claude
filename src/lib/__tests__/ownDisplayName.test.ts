import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ownDisplayName, OWN_NAME_PLACEHOLDER } from "@/lib/ownDisplayName";

describe("the member's own name (Owner 2026-10-29: 'Photographer' shown offline)", () => {
  it("uses the profile name exactly as saved", () => {
    expect(ownDisplayName("  Emily Johnson ", { email: "e@x.com" })).toBe("Emily Johnson");
    expect(ownDisplayName("dr. Rao", null)).toBe("dr. Rao");
  });

  it("no profile yet (first open with no network): the name from sign-in", () => {
    expect(ownDisplayName(null, { user_metadata: { full_name: "emily johnson" } })).toBe("Emily Johnson");
    expect(ownDisplayName(undefined, { user_metadata: { name: "Emily J" } })).toBe("Emily J");
  });

  it("then the part of the email before @", () => {
    expect(ownDisplayName(null, { email: "emilyjohnsonusaa@gmail.com", user_metadata: {} })).toBe("emilyjohnsonusaa");
  });

  it("the placeholder only when there is nothing at all", () => {
    expect(ownDisplayName(null, null)).toBe(OWN_NAME_PLACEHOLDER);
  });

  it("the app sheet and the web menu both use it (no second rule)", () => {
    for (const f of ["src/components/MobileProfileSheet.tsx", "src/components/UserMenu.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("ownDisplayName(profileCore?.full_name, user)");
      expect(src, f).not.toMatch(/profileCore\?\.full_name \|\| "Photographer"/);
    }
  });
});
