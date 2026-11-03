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
import { creditGeometryFor } from "@/lib/creditGeometry.mjs";

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
  it("v4 'middle size' (Owner, 3 Nov 16:05Z): HALF of v2 — 22 px → 11 px on 2048, 12 px → 6 px on 1080 (portrait: width decides)", () => {
    expect(creditLayout(2048, 1365).fontPx).toBe(11);
    expect(creditLayout(1152, 2048).fontPx).toBe(6);
    expect(creditLayout(1080, 720).fontPx).toBe(6);
  });
  it("anchors bottom-right with the sample's margins; slightly fainter than v2 (white 0.41 → 0.32, shadow 0.325 → 0.25)", () => {
    const l = creditLayout(2048, 1365);
    expect(l.x).toBe(2048 - Math.round(2048 * 0.022));
    expect(l.y).toBe(1365 - Math.round(1365 * 0.026));
    expect(l.fill).toBe("rgba(255,255,255,0.32)");
    expect(l.shadow).toBe("rgba(0,0,0,0.25)");
    expect(l.shadowOffsetY).toBe(1);
    expect(l.shadowBlur).toBe(2);
  });
  it("no floor that undoes the Owner's size: 3 px is the smallest drawn", () => {
    expect(creditLayout(100, 80).fontPx).toBe(3);
    expect(creditLayout(300, 200).fontPx).toBe(3);
  });
  it("ONE geometry for both renderers (audit M3): the canvas and the worker svg read the same module", async () => {
    const svg = await import("../../../tools/media-derivatives/credit-svg.mjs");
    for (const [w, h] of [[2048, 1365], [1080, 720], [810, 1080], [320, 213]]) expect(svg.creditLayout(w, h)).toEqual(creditGeometryFor(w, h));
    const { font: _f, ...canvas } = creditLayout(2048, 1365);
    expect(canvas).toEqual(creditGeometryFor(2048, 1365));
  });
});
