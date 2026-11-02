// @vitest-environment node
import { describe, expect, it } from "vitest";
import { creditLayout } from "@/lib/photoCredit";
import { creditLayout as svgLayout, creditSvg } from "../../../../tools/media-derivatives/credit-svg.mjs";

describe("U5 backfill credit = the uploader's credit (geometry parity)", () => {
  it("same size, place, colour and shadow as photoCredit.creditLayout at every width", () => {
    for (const [w, h] of [[2048, 1365], [1365, 2048], [1080, 719], [400, 300], [320, 213]]) {
      const a = creditLayout(w, h);
      const b = svgLayout(w, h);
      expect(b).toEqual({ fontPx: a.fontPx, x: a.x, y: a.y, fill: a.fill, shadow: a.shadow, shadowOffsetY: a.shadowOffsetY, shadowBlur: a.shadowBlur });
    }
  });

  it("escapes the name (a member's name is never markup) and anchors bottom-right", () => {
    const svg = creditSvg(2048, 1365, "© A <b>&\"x\", 50mm Retina World") as string;
    expect(svg).toContain("© A &lt;b&gt;&amp;&quot;x&quot;, 50mm Retina World");
    expect(svg).not.toContain("<b>");
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain(`x="${creditLayout(2048, 1365).x}"`);
  });

  it("a line wider than 90 % of the photo gets a smaller font instead of running off the edge", () => {
    const px = (svg: string) => Number(/font-size="(\d+)"/.exec(svg)?.[1]);
    // the longest real line (26-character name) fits at the normal size
    const longest = "© Subhadeep K. Chattopadhy, 50mm Retina World";
    expect(px(creditSvg(2048, 1365, longest))).toBe(creditLayout(2048, 1365).fontPx);
    expect(px(creditSvg(320, 480, longest))).toBe(creditLayout(320, 480).fontPx);
    // anything longer is scaled down to fit
    const tooLong = `© ${"W".repeat(60)}, 50mm Retina World`;
    expect(px(creditSvg(2048, 1365, tooLong))).toBeLessThan(creditLayout(2048, 1365).fontPx);
  });
});
