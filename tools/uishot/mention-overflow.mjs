/**
 * DOES THE @NAME LIST FIT ON A 360px PHONE? RENDER IT AND MEASURE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The owner reported on 2026-08-31, with a screenshot: "during tagging in a
 * coments, options are hiding not coming in fornt". It had never been rendered
 * anywhere — the hashtag list got harness scenes on 2026-08-16 after the same
 * class of fault, the @mention list did not, so nobody had looked at it.
 *
 * This drives the real component in real Chromium at the widths that matter,
 * types "@a", waits for the fake backend's rows, and measures where the list
 * actually lands. Run against the pre-fix code it fails three of four cases:
 *
 *     caret-at-start     right edge 369.3 on a 360px screen   (9.3px off)
 *     caret-far-along    right edge 369.3                     (9.3px off)
 *     box-grown-5-lines  right edge 369.3                     (9.3px off)
 *     desktop            fine — which is why it survived review
 *
 *   npm run ui:harness          # in one shell (needs the VITE_* vars set)
 *   node tools/uishot/mention-overflow.mjs
 *
 * ⚠ TWO MEASUREMENT TRAPS, both of which this script fell into first.
 *
 *  1. IT MEASURED THE OVERLAY. `.mention-input__suggestions` was 100px wide
 *     while a 277px <ul> hung out of it and off the screen, so the probe
 *     reported "fits" on the broken build — the identical mistake the library's
 *     own guard makes. It now takes the union of every painted box.
 *
 *  2. IT MEASURED AGAINST innerWidth. On a mobile context Chromium WIDENS the
 *     layout viewport when content overflows sideways, so the broken build
 *     reported innerWidth 369 on a 360px phone and a 9.3px overflow looked like
 *     0.3px against its own inflated ruler. The device width is the ruler.
 *
 * Exits non-zero if any case puts a pixel off the screen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium } from "playwright";
import { readdirSync, existsSync } from "node:fs"; import { join } from "node:path";
function chromePath(){const root=process.env.PLAYWRIGHT_BROWSERS_PATH||"/opt/pw-browsers";if(!existsSync(root))return;for(const d of readdirSync(root))for(const rel of ["chrome-linux/chrome","chrome-linux/headless_shell"]){const p=join(root,d,rel);if(existsSync(p))return p;}}
const label = process.argv[2] ?? "run";
const b = await chromium.launch({ executablePath: chromePath() });
const CASES = [
  { name: "caret-at-start",     prefix: "",                                            vp:{w:360,h:800} },
  { name: "caret-far-along",    prefix: "thanks so much for this one really ",         vp:{w:360,h:800} },
  { name: "box-grown-5-lines",  prefix: "one\ntwo\nthree\nfour\n",                     vp:{w:360,h:800} },
  { name: "desktop",            prefix: "thanks so much for this one really ",         vp:{w:1280,h:900} },
];
let bad = 0;
for (const c of CASES) {
  const ctx = await b.newContext({ viewport:{width:c.vp.w,height:c.vp.h}, deviceScaleFactor:2,
    isMobile:c.vp.w<500, hasTouch:c.vp.w<500, colorScheme:"dark", reducedMotion:"reduce", locale:"en-GB" });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:5199/uiharness.html?scene=mention-list-over-comment-box",{waitUntil:"networkidle"});
  const box = page.locator("textarea").first();
  await box.click();
  if (c.prefix) await page.keyboard.insertText(c.prefix);
  await page.keyboard.type("@a", { delay: 50 });
  await page.waitForTimeout(1100);
  const r = await page.evaluate((deviceWidth) => {
    const el = document.querySelector(".mention-input__suggestions");
    if (!el) return { found:false };
    /**
     * ⚠ MEASURE WHAT IS PAINTED, NOT THE WRAPPER.
     *
     * The first version of this probe read the overlay's own rect — and it
     * PASSED on the broken build, because the overlay was 100px wide while a
     * 277px <ul> hung out of it and off the screen. That is the identical
     * mistake the library's guard makes, reproduced in the test written to
     * catch it. The union of every painted box is the only honest extent.
     */
    const parts = [el, el.querySelector("ul"), ...el.querySelectorAll("li")].filter(Boolean);
    const rects = parts.map(n => n.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    const b = {
      left:   Math.min(...rects.map(r => r.left)),
      right:  Math.max(...rects.map(r => r.right)),
      top:    Math.min(...rects.map(r => r.top)),
      bottom: Math.max(...rects.map(r => r.bottom)),
    };
    b.width = b.right - b.left; b.height = b.bottom - b.top;
    /*
     * ⚠ THIS MEASUREMENT WAS DEAD AND REPORTED ZEROS FOR EVERY ROW.
     *
     * It read `scrollWidth`/`clientWidth` off `span[class*=display]`, and a
     * non-replaced INLINE element has clientWidth 0 by definition — so both
     * numbers were structurally incapable of being anything but 0, in real
     * Chromium, for a span that is plainly painted. Nobody noticed because the
     * pass/fail verdict only read the overflow figures: a dead measurement
     * sitting inside a live instrument, found by the Auditor by accident.
     *
     * getBoundingClientRect() is what a painted inline box actually reports.
     * Truncation is then the rendered width being narrower than the content.
     */
    const ul = el.querySelector("ul");
    /*
     * THE VISIBLE BAND IS THE CONTENT BOX, NOT THE BORDER BOX.
     *
     * getBoundingClientRect() includes the list's 1px border, and Tailwind's
     * preflight makes everything border-box, so the band a row can actually
     * occupy is 2px shorter than the rect. Measuring against the rect said
     * "4 whole rows fit" while the fourth was cut by 1px — the probe would have
     * blessed a list that still slices, which is the whole failure mode this
     * file exists to stop. clientTop/clientHeight are the content band.
     */
    const listBox = ul
      ? (() => {
          const r = ul.getBoundingClientRect();
          return {
            top: r.top + ul.clientTop,
            bottom: r.top + ul.clientTop + ul.clientHeight,
            height: ul.clientHeight,
          };
        })()
      : null;
    const items = [...el.querySelectorAll("li")].map((li) => {
      const span = li.querySelector("span[class*=display]") || li;
      const sr = span.getBoundingClientRect();
      const lr = li.getBoundingClientRect();
      return {
        text: (span.textContent || "").trim(),
        // Rendered vs intrinsic. `range` gives the unclipped text width even
        // for an inline box, which scrollWidth refused to.
        renderedW: +sr.width.toFixed(1),
        rowH: +lr.height.toFixed(1),
        /*
         * IS THIS WHOLE ROW INSIDE THE LIST BOX?
         *
         * This is the Owner's actual complaint and no instrument asked it. The
         * old probe only asked whether the box left the SCREEN, so it was
         * GREEN on the exact build he is complaining about — correctly, and
         * uselessly. A row half-inside a scrolling box is on screen.
         *
         * A row scrolled out of view is not sliced, so only rows that OVERLAP
         * the visible band are judged: a row is whole if the part of it inside
         * the band is the whole of it.
         */
        slicedBy: listBox
          ? +Math.max(
              0,
              Math.max(0, listBox.top - lr.top) + Math.max(0, lr.bottom - listBox.bottom),
            ).toFixed(1)
          : 0,
        overlapsBand: listBox ? lr.bottom > listBox.top && lr.top < listBox.bottom : false,
      };
    });
    /*
     * A row is SLICED when it overlaps the visible band and part of it is
     * outside. 0.5px of tolerance for sub-pixel layout, nothing more — the
     * defect is 55% of a row, not a rounding error.
     */
    const sliced = items.filter((i) => i.overlapsBand && i.slicedBy > 0.5);
    const rowH = items.length ? items[0].rowH : 0;
    const bandH = listBox ? +listBox.height.toFixed(1) : 0;
    return { found:true,
      left:+b.left.toFixed(1), right:+b.right.toFixed(1), top:+b.top.toFixed(1), bottom:+b.bottom.toFixed(1),
      w:+b.width.toFixed(1), deviceWidth, innerWidth, vh:innerHeight,
      /**
       * ⚠ MEASURED AGAINST THE DEVICE WIDTH, NOT innerWidth.
       *
       * innerWidth is the LAYOUT viewport, and on a mobile context Chromium
       * widens it when content overflows horizontally — so the broken build
       * reported innerWidth 369 on a 360px phone and every overflow looked
       * like 0.3px against its own inflated ruler. The screen is 360px wide;
       * that is the number a member's phone has.
       */
      overflowRight:+(b.right-deviceWidth).toFixed(1), overflowLeft:+(0-b.left).toFixed(1),
      overflowTop:+(0-b.top).toFixed(1), overflowBottom:+(b.bottom-innerHeight).toFixed(1),
      /** The page must not scroll sideways at all. */
      docScrollWidth: document.documentElement.scrollWidth,
      docScrollsSideways: document.documentElement.scrollWidth > deviceWidth,
      zIndex:getComputedStyle(el).zIndex,
      /*
       * THE CAP MUST BE A WHOLE NUMBER OF ROWS. This is the arithmetic the
       * Owner's screenshot is: 200 / 44 = 4.55 rows, so the fifth was always
       * cut through the middle. Reported whether or not the list scrolls, so
       * the number is visible even in a scene too small to overflow — which is
       * how it stayed invisible for so long.
       */
      rowH, bandH,
      wholeRowsInBand: rowH > 0 ? +(bandH / rowH).toFixed(2) : null,
      capIsWholeRows: rowH > 0 ? Math.abs((bandH / rowH) - Math.round(bandH / rowH)) < 0.02 : null,
      scrollable: ul ? ul.scrollHeight > ul.clientHeight + 1 : false,
      slicedCount: sliced.length,
      slicedRows: sliced.map((i) => `${i.text} (${i.slicedBy}px outside)`),
      items };
  }, c.vp.w);
  const off = r.found && (r.overflowRight>0 || r.overflowLeft>0 || r.overflowTop>0 || r.overflowBottom>0 || r.docScrollsSideways);
  /*
   * TWO INDEPENDENT VERDICTS, because this probe was GREEN on the build the
   * Owner is complaining about. "Does the box leave the screen" and "can a
   * member read a whole option" are different questions, and only the first
   * was ever asked. A sliced row is on screen.
   */
  const sliced = r.found && (r.slicedCount > 0 || r.capIsWholeRows === false);
  if (!r.found || off || sliced) bad++;
  const verdict = !r.found ? "NOT FOUND ✗"
    : off ? "OFF-SCREEN ✗"
    : sliced ? `ROWS CUT ✗ (${r.wholeRowsInBand} rows fit in the box)`
    : "on screen, whole rows ✓";
  console.log(`\n--- ${c.name} (${c.vp.w}px) --- ${verdict}`);
  if (r.found && r.slicedRows && r.slicedRows.length) {
    for (const row of r.slicedRows) console.log(`      SLICED  ${row}`);
  }
  console.log(JSON.stringify(r));
  await page.screenshot({ path:`/tmp/shots/stress-${label}-${c.name}.png` });
  await ctx.close();
}
await b.close();
console.log(`\n==== ${bad === 0 ? "ALL CASES ON SCREEN AND EVERY ROW WHOLE" : bad + " CASE(S) FAILED"} ====`);
process.exit(bad === 0 ? 0 : 1);
