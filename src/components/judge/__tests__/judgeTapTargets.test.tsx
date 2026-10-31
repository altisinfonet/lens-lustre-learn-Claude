import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

/**
 * S11 — a judge on a phone must be able to hit the decision they mean.
 * The award / decision buttons were px-2.5 py-1.5 text-[10px] (≈ 31 px tall,
 * compact) and px-3 py-2.5 text-[11px] (≈ 40 px); the slider thumb was 20 px.
 * jsdom cannot lay out, so the rule is pinned on the classes that set the size.
 */
describe("S11 judging — decision controls are at least 44 px", () => {
  for (const f of ["src/components/judge/TagDecisionPanel.tsx", "src/components/judge/RoundDecisionButtons.tsx"]) {
    it(`${f}: both the compact and the full button carry min-h-[44px]`, () => {
      const src = read(f);
      // The button's size classes: the compact/full pair that sets its padding.
      const pairs = [...src.matchAll(/compact \? "([^"]+)" : "([^"]+)"/g)].filter((m) => /\bpy-/.test(m[1]) && /\bpy-/.test(m[2]));
      expect(pairs.length, "the compact/full size classes of the decision button").toBe(1);
      for (const cls of [pairs[0][1], pairs[0][2]]) expect(cls).toMatch(/(^| )min-h-\[44px\]( |$)/);
    });
  }

  it("the shared slider thumb has a 44 px hit area around its 20 px dot", () => {
    const src = read("src/components/ui/slider.tsx");
    const thumb = src.match(/<SliderPrimitive\.Thumb className="([^"]+)"/)![1];
    expect(thumb).toMatch(/(^| )relative( |$)/);
    expect(thumb).toMatch(/after:h-11/);
    expect(thumb).toMatch(/after:w-11/);
    expect(thumb).toMatch(/after:content-\[''\]/);
  });
});
