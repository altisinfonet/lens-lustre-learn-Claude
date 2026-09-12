/**
 * F-88 — the assertion, as a runnable check.
 *
 * Exits 1 if ANY label in the friend/follow row wraps or overflows, at either
 * theme and either width. Run it with the defect planted and it must go red; run
 * it with the fix and it must go green. A check that cannot fail is not evidence.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PHASE = process.argv[2] || "after";
const OUT = `/tmp/f88b/${PHASE}`;
mkdirSync(OUT, { recursive: true });
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://127.0.0.1:5199";

const CASES = [
  { theme: "dark", width: 1280, name: "desktop-1280" },
  { theme: "light", width: 1280, name: "desktop-1280" },
  { theme: "dark", width: 360, name: "android-360" },
  { theme: "light", width: 360, name: "android-360" },
];
/** Telugu: the widest of the six fr.addFriend translations by RENDERED width. */
const TE = "స్నేహితుడిని జోడించు";

const PROBE = () => {
  const rows = [...document.querySelectorAll("div")].filter(
    (d) => typeof d.className === "string" && d.className.includes("flex w-full items-center gap-2") &&
      d.querySelector("button") && d.getBoundingClientRect().width > 0);
  const row = rows[0];
  if (!row) return null;
  return [...row.querySelectorAll("button")].map((b) => {
    const tn = [...b.childNodes].find((n) => n.nodeType === 3 && (n.textContent || "").trim().length);
    let lines = 0;
    if (tn) { const r = document.createRange(); r.selectNodeContents(tn); lines = r.getClientRects().length; }
    return { label: (b.textContent || "").trim(), lines, wrapped: lines > 1,
             overflowing: b.scrollWidth > b.clientWidth + 1, w: Math.round(b.getBoundingClientRect().width) };
  });
};

const browser = await chromium.launch({ executablePath: EXE });
let failures = 0;
for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: c.width, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), c.theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/uiharness.html?scene=screen-wall-visitor`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator("button:visible", { hasText: "Add Friend" }).first().waitFor({ timeout: 20000 });

  const rowLoc = page.locator("div.flex.w-full.items-center.gap-2").filter({ has: page.locator("button") });
  const n = await rowLoc.count();
  let target = null;
  for (let i = 0; i < n; i++) if (await rowLoc.nth(i).isVisible()) { target = rowLoc.nth(i); break; }

  for (const [tag, text] of [["english", null], ["telugu", TE]]) {
    if (text) await page.evaluate((t) => {
      document.querySelectorAll("button").forEach((b) => {
        const tn = [...b.childNodes].find((x) => x.nodeType === 3 && (x.textContent || "").trim().length);
        if (tn && !/^\s*(Follow|Following)\s*$/.test(tn.textContent)) tn.textContent = " " + t;
      });
    }, text);
    await page.waitForTimeout(250);
    await target.scrollIntoViewIfNeeded();
    await target.screenshot({ path: `${OUT}/${c.name}--${c.theme}--${tag}.png` });
    for (const b of await page.evaluate(PROBE)) {
      const bad = b.wrapped || b.overflowing;
      if (bad) failures++;
      console.log(`  ${bad ? "FAIL" : "ok  "} ${c.name.padEnd(13)} ${c.theme.padEnd(6)} ${tag.padEnd(8)} ${JSON.stringify(b.label).padEnd(26)} lines=${b.lines} wrapped=${String(b.wrapped).padEnd(5)} overflow=${String(b.overflowing).padEnd(5)} w=${b.w}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? "\nF-88 CHECK: PASS — nothing wrapped, nothing overflowed."
                           : `\nF-88 CHECK: FAIL — ${failures} wrapped/overflowing label(s).`);
process.exit(failures === 0 ? 0 : 1);
