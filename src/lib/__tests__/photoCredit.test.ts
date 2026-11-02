/**
 * Photo plan U1b — the credit burned into the 2048 copy (Owner decision 4).
 *
 *   "© <post owner's name>, 50mm Retina World"
 *   full name if ≤ 26 characters; else middle names → initials;
 *   still > 26 → first name + surname initial. ", 50mm Retina World" is never cut.
 *
 * The three examples are the ones in the approved sample (50mm-photo-samples-2).
 */
import { describe, it, expect } from "vitest";
import { creditName, creditOwnerName, creditText, creditLayout, CREDIT_NAME_MAX } from "@/lib/photoCredit";

describe("creditName — the name rule", () => {
  it("keeps a name of up to 26 characters in full", () => {
    expect(CREDIT_NAME_MAX).toBe(26);
    expect(creditName("Neil Basu")).toBe("Neil Basu");
    expect(creditName("Abcdefghijkl Mnopqrstuvwxy")).toBe("Abcdefghijkl Mnopqrstuvwxy"); // exactly 26
  });

  it("longer: middle names become initials (approved sample)", () => {
    expect(creditName("Subhadeep Kumar Chattopadhyay")).toBe("Subhadeep K. Chattopadhyay");
    expect(creditName("Anna Maria Louise Katharina Smith")).toBe("Anna M. L. K. Smith");
  });

  it("still longer: first name + surname initial (approved sample)", () => {
    expect(creditName("Venkataraghavan Ramasubramaniam Chandrasekharan")).toBe("Venkataraghavan C.");
    // two words only, too long: there is no middle name to shorten
    expect(creditName("Bartholomewsky Featherstonehaugh")).toBe("Bartholomewsky F.");
  });

  it("collapses stray spaces and counts characters, not bytes", () => {
    expect(creditName("  Neil   Basu  ")).toBe("Neil Basu");
    expect(creditName("Søren Ærøskøbing")).toBe("Søren Ærøskøbing");
  });

  it("a single word that is too long is cut to 26 with an ellipsis (never longer than the rule)", () => {
    const n = creditName("A".repeat(40));
    expect(Array.from(n).length).toBeLessThanOrEqual(26);
    expect(n.endsWith("…")).toBe(true);
  });
});

describe("creditText — the line on the photo", () => {
  it("always ends with the untouched ', 50mm Retina World'", () => {
    expect(creditText("Neil Basu")).toBe("© Neil Basu, 50mm Retina World");
    expect(creditText("Venkataraghavan Ramasubramaniam Chandrasekharan")).toBe("© Venkataraghavan C., 50mm Retina World");
  });

  it("no name (or the brand itself, for admin accounts): just '© 50mm Retina World'", () => {
    expect(creditText("")).toBe("© 50mm Retina World");
    expect(creditText("   ")).toBe("© 50mm Retina World");
    expect(creditText("50mm Retina World")).toBe("© 50mm Retina World");
  });
});

describe("creditOwnerName — whose name, from the profile WallPosts already has", () => {
  it("the profile full name first", () => {
    expect(creditOwnerName({ full_name: "Neil Basu", custom_url: "neil" })).toBe("Neil Basu");
  });
  it("falls back to the member's profile handle when the name is empty or the 'Photographer' placeholder", () => {
    expect(creditOwnerName({ full_name: "", custom_url: "neilb" })).toBe("neilb");
    expect(creditOwnerName({ full_name: "Photographer", custom_url: "neilb" })).toBe("neilb");
    expect(creditOwnerName({ full_name: null, custom_url: null })).toBe("");
    expect(creditOwnerName(null)).toBe("");
  });
});

describe("creditLayout — small, bottom-right, scaled to the image width (approved sample geometry)", () => {
  it("scales with width: 13px on a 400px-wide sample → ~67px on 2048", () => {
    expect(creditLayout(400, 266).fontPx).toBe(13);
    expect(creditLayout(2048, 1365).fontPx).toBe(67);
    expect(creditLayout(1152, 2048).fontPx).toBe(37); // portrait: width decides
  });
  it("anchors bottom-right with the sample's margins (2.2% right, 2.6% bottom)", () => {
    const l = creditLayout(2048, 1365);
    expect(l.x).toBe(2048 - Math.round(2048 * 0.022));
    expect(l.y).toBe(1365 - Math.round(1365 * 0.026));
    expect(l.fill).toBe("rgba(255,255,255,0.82)");
    expect(l.shadow).toBe("rgba(0,0,0,0.65)");
  });
  it("never smaller than readable on a tiny image", () => {
    expect(creditLayout(100, 80).fontPx).toBeGreaterThanOrEqual(10);
  });
});
