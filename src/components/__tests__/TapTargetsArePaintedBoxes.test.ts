/**
 * A HIT REGION THE GATE CANNOT MEASURE IS NOT A HIT REGION IT CAN PASS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PR #216's UI gate failed on two controls. Both are pre-existing defects that
 * became VISIBLE — neither was introduced by the commits on this branch:
 *
 *   /discover   12 buttons at 107x29 and 71x29. The classes predate this
 *               branch; f3260d0 added the `screen-discover` scene, so the sweep
 *               photographed the page for the first time.
 *   /feed       2 birthday-strip avatar links at 36x36. c96e9c6 gave those rows
 *               a handle, so `ProfileLink` renders <a href> instead of <span> —
 *               and the gate only selects `button, a[href], [role=button],
 *               input, select, summary`. The control did not shrink; it became
 *               a control.
 *
 * ⚠ THE PART WORTH PINNING: `.tap-44` AND `.tap-44-down` ARE BOTH INVISIBLE
 * HERE. Both are `::after` pseudo-elements (index.css:794-830). The gate reads
 * `el.getBoundingClientRect()` (capture.mjs:409-412), which does not include a
 * pseudo-element. Measured rather than argued — `tap-44-down` was swapped onto
 * the birthday anchor and the sweep re-run:
 *
 *     tap-44        a.shrink-0.tap-44 36x36        FAIL
 *     tap-44-down   a.shrink-0.tap-44-down 36x36   FAIL
 *     h-11 w-11     a.shrink-0.grid 44x44          pass
 *
 * So the utilities are the right instrument for a THUMB and the wrong one for
 * this gate, and the two controls below carry real painted boxes. This file
 * exists so that swapping one back for a pseudo-element pad — which looks like
 * a tidy-up and reads as the house pattern — fails here instead of in CI.
 *
 * The pixel proof is tools/uishot/tap-target-geometry.mjs (real Chromium at
 * 390x844: floor, elementFromPoint on every edge, and rect intersection against
 * every link in the same flow) and the gate's own sweep.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), "utf8"));

const discoverCard = read("src/components/discover/DiscoverCard.tsx");
const birthdayStrip = read("src/components/feed/TodaysBirthdayStrip.tsx");
const capture = readFileSync(join(process.cwd(), "tools/uishot/capture.mjs"), "utf8");

describe("the gate's floor is read from the gate, not restated here", () => {
  it("capture.mjs still measures getBoundingClientRect against long>=44, short>=32", () => {
    // If this changes, the two assertions below are answering the wrong rule
    // and someone has to look at them again rather than trust them.
    expect(capture).toMatch(/const r = el\.getBoundingClientRect\(\);/);
    expect(capture).toMatch(/if \(long < 44 \|\| short < 32\)/);
  });
});

describe("/discover row buttons carry a painted box", () => {
  it("btnBase states a minimum height", () => {
    const btnBase = discoverCard.match(/const btnBase =\s*\n?\s*"([^"]+)"/)?.[1];
    expect(btnBase, "btnBase moved — update this test").toBeTruthy();
    expect(btnBase, `btnBase is "${btnBase}" — py-1.5 alone gives 29px, three under the floor`)
      .toMatch(/\bmin-h-9\b/);
  });

  it("and does not rely on a pseudo-element pad the gate cannot see", () => {
    const btnBase = discoverCard.match(/const btnBase =\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(btnBase).not.toMatch(/tap-44/);
  });
});

describe("the birthday-strip avatar link carries a painted box", () => {
  const anchor = birthdayStrip.match(/<ProfileLink[^>]*className="([^"]+)"/)?.[1];

  it("is a real 44x44, not tap-44 or tap-44-down", () => {
    expect(anchor, "the birthday ProfileLink moved — update this test").toBeTruthy();
    expect(anchor, `the anchor is "${anchor}"`).toMatch(/\bh-11\b/);
    expect(anchor).toMatch(/\bw-11\b/);
    expect(anchor, "a ::after pad reports 36x36 to the gate — measured, both variants")
      .not.toMatch(/tap-44/);
  });

  it("the avatar inside it is unchanged at 36px", () => {
    // The box grew; the picture did not. That is the whole point of putting the
    // 44 on the anchor rather than on the image.
    expect(birthdayStrip.match(/w-9 h-9 rounded-full/g)?.length).toBe(2);
  });
});
