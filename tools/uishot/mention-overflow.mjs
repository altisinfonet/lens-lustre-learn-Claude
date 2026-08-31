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
    const items = [...el.querySelectorAll("li")].map(li => {
      const s = li.querySelector("span[class*=display]") || li;
      return { text: s.textContent, scrollW: s.scrollWidth, clientW: s.clientWidth };
    });
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
      zIndex:getComputedStyle(el).zIndex, items };
  }, c.vp.w);
  const off = r.found && (r.overflowRight>0 || r.overflowLeft>0 || r.overflowTop>0 || r.overflowBottom>0 || r.docScrollsSideways);
  if (!r.found || off) bad++;
  console.log(`\n--- ${c.name} (${c.vp.w}px) --- ${r.found ? (off ? "OFF-SCREEN ✗" : "fully on screen ✓") : "NOT FOUND ✗"}`);
  console.log(JSON.stringify(r));
  await page.screenshot({ path:`/tmp/shots/stress-${label}-${c.name}.png` });
  await ctx.close();
}
await b.close();
console.log(`\n==== ${bad === 0 ? "ALL CASES ON SCREEN" : bad + " CASE(S) FAILED"} ====`);
process.exit(bad === 0 ? 0 : 1);
