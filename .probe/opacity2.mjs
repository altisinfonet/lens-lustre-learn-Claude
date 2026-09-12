import { chromium } from "playwright";
const URLPATH = process.argv[2] || "/no/such/page/at/all";
const BASE = "http://127.0.0.1:5208";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto(`${BASE}${URLPATH}`, { waitUntil: "domcontentloaded" });
const CHAIN = () => {
  const h = [...document.querySelectorAll("h1")].find((e) => /This frame is empty/.test(e.textContent || ""));
  if (!h) return null;
  const out = []; let el = h, eff = 1;
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el); const o = parseFloat(cs.opacity); eff *= o;
    if (o < 1 || cs.transform !== "none")
      out.push({ tag: el.tagName.toLowerCase(), opacity: o, transform: cs.transform.slice(0, 44),
                 inline: (el.getAttribute("style") || "").slice(0, 80) });
    el = el.parentElement;
  }
  return { chain: out, effective: Number(eff.toFixed(6)) };
};
let last = null;
for (let i = 0; i < 10; i++) {
  await p.waitForTimeout(600);
  const r = await p.evaluate(CHAIN);
  if (r) { last = r; console.log(`  t+${((i+1)*0.6).toFixed(1)}s  effective = ${r.effective}`); }
}
console.log("\nancestors that are non-opaque or transformed AT REST:");
console.log(last ? JSON.stringify(last.chain, null, 1) : "  heading never rendered");
console.log(last && last.effective === 1 ? "\nOPACITY CHECK: PASS" : `\nOPACITY CHECK: FAIL — ${last ? last.effective : "n/a"}`);
await b.close();
