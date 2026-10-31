/**
 * F-89 — is the 404's content wrapper actually VISIBLE at rest?
 *
 * The structural probes measured sidebars, links and mounts and were all green
 * while the page rendered at 57% opacity. A check that cannot fail for the
 * reason the Owner complained about is not a check. This one samples COMPUTED
 * opacity on every ancestor of the heading, repeatedly, and requires 1.
 */
import { chromium } from "playwright";
const SCENE = process.argv[2] || "screen-not-found-in-place";
const BASE = process.argv[3] || "http://127.0.0.1:5208";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto(`${BASE}/uiharness.html?scene=${SCENE}`, { waitUntil: "domcontentloaded" });

const CHAIN = () => {
  const h = [...document.querySelectorAll("h1")].find((e) => /This frame is empty/.test(e.textContent || ""));
  if (!h) return null;
  const out = [];
  let el = h;
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    const o = parseFloat(cs.opacity);
    if (o < 1 || cs.transform !== "none") {
      out.push({ tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 34),
                 opacity: o, transform: cs.transform.slice(0, 40),
                 inline: (el.getAttribute("style") || "").slice(0, 70) });
    }
    el = el.parentElement;
  }
  // effective opacity the visitor sees = product of every ancestor's opacity
  let eff = 1; let e2 = h;
  while (e2 && e2 !== document.documentElement) { eff *= parseFloat(getComputedStyle(e2).opacity); e2 = e2.parentElement; }
  return { chain: out, effective: Number(eff.toFixed(6)) };
};

let last = null;
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(700);
  const r = await p.evaluate(CHAIN);
  if (r) { last = r; console.log(`  t+${((i + 1) * 0.7).toFixed(1)}s  effective opacity = ${r.effective}`); }
  else console.log(`  t+${((i + 1) * 0.7).toFixed(1)}s  (heading not rendered yet)`);
}
console.log("\nnon-opaque / transformed ancestors at rest:");
console.log(last ? JSON.stringify(last.chain, null, 1) : "  heading never rendered");
const ok = last && last.effective === 1;
console.log(ok ? "\nOPACITY CHECK: PASS — the page is fully visible at rest."
               : `\nOPACITY CHECK: FAIL — effective opacity ${last ? last.effective : "n/a"}, expected 1.`);
await b.close();
process.exit(ok ? 0 : 1);
