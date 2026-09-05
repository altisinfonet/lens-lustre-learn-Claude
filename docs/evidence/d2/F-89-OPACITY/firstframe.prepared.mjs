/**
 * F-89 — THE 404 MUST BE READABLE IN ITS FIRST PAINTED FRAME.
 *
 * The structural probes measured sidebars, links and mount counts and were all
 * green while the deployed page rendered at 57% opacity, frozen mid-reveal.
 * A check that cannot fail for the reason the Owner complained about is not a
 * check.
 *
 * This does not measure the SETTLED state — that was already 1 locally and told
 * us nothing. It installs a sampler before navigation and records the LOWEST
 * effective opacity the heading ever has, from the frame it first exists. Any
 * parked-invisible reveal shows up as a minimum below 1, whether or not the
 * animation later completes.
 */
import { chromium } from "playwright";
const URLPATH = process.argv[2] || "/no/such/page/at/all";
const BASE = process.argv[3] || "http://127.0.0.1:5208";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

await p.addInitScript(() => {
  window.__minOpacity = null;
  window.__firstSeen = null;
  const sample = () => {
    const h = [...document.querySelectorAll("h1")].find((e) => /This frame is empty/.test(e.textContent || ""));
    if (h) {
      let eff = 1, el = h;
      while (el && el !== document.documentElement) { eff *= parseFloat(getComputedStyle(el).opacity); el = el.parentElement; }
      eff = Number(eff.toFixed(4));
      if (window.__firstSeen === null) window.__firstSeen = eff;
      window.__minOpacity = window.__minOpacity === null ? eff : Math.min(window.__minOpacity, eff);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});

await p.goto(`${BASE}${URLPATH}`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(6000);
const r = await p.evaluate(() => ({ min: window.__minOpacity, first: window.__firstSeen }));
console.log(`  path                       : ${URLPATH}`);
console.log(`  opacity in the FIRST frame : ${r.first}`);
console.log(`  LOWEST opacity ever seen   : ${r.min}`);
const ok = r.min === 1 && r.first === 1;
console.log(ok ? "\nFIRST-FRAME CHECK: PASS — never parked below full opacity."
               : `\nFIRST-FRAME CHECK: FAIL — first frame ${r.first}, minimum ${r.min}; the page is revealed rather than rendered.`);
await b.close();
process.exit(ok ? 0 : 1);
