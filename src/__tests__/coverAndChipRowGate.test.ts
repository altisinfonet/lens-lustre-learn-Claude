/**
 * Central control (Owner 2026-11-04) for the 2026-11-10 page fixes:
 *  - covers on Courses / Journal / Competitions / CompetitionDetail are drawn by
 *    the ONE CoverImage (placeholder, right-sized copy, fallback, priority);
 *  - the filter chip rows on Courses / Journal / Competitions are the ONE
 *    FilterChipRow (edge fade = "swipe for more");
 *  - the journal list reads names from the public view, never the RLS-locked
 *    `profiles` table (signed out it returned nothing → "Unknown").
 * A page that goes back to its own copy fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", "..", p), "utf8");

const COVER_PAGES = ["src/pages/Courses.tsx", "src/pages/Journal.tsx", "src/pages/Competitions.tsx", "src/pages/CompetitionDetail.tsx"];
const CHIP_PAGES = ["src/pages/Courses.tsx", "src/pages/Journal.tsx", "src/pages/Competitions.tsx"];

describe("covers and filter chips have one owner each", () => {
  it.each(COVER_PAGES)("%s draws no cover with a raw <img>", (f) => {
    const src = read(f);
    expect(src).toMatch(/import CoverImage from "@\/components\/CoverImage"/);
    expect(src).not.toMatch(/<(?:img|motion\.img)\b[^>]*\bsrc=\{[\w.?]*cover_image_url\}/);
  });

  it.each(CHIP_PAGES)("%s has no hand-made sideways chip row", (f) => {
    const src = read(f);
    expect(src).toMatch(/<FilterChipRow\b/);
    expect(src).not.toMatch(/overflow-x-auto scrollbar-hide/);
  });

  it("the journal list never reads the locked profiles table", () => {
    const src = read("src/hooks/content/useJournal.ts");
    expect(src).not.toMatch(/from\("profiles"\)/);
    expect(src).toMatch(/fetchProfilesDetailByIds/);
  });
});
