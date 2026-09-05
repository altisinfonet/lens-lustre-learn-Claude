import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const PHASE = process.argv[2] || "before";
const OUT = `/tmp/f88/${PHASE}`;
mkdirSync(OUT, { recursive: true });
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://127.0.0.1:5199";
const SCENE = "screen-wall-visitor";

const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "iphone-390", width: 390, height: 844 },
  { name: "android-360", width: 360, height: 800 },
];

/** Longest fr.addFriend translations. Forced into the DOM because the button's
 *  label is HARDCODED English and cannot be reached through i18n. */
const LONG = {
  te: "స్నేహితుడిని జోడించు", bn: "বন্ধু যোগ করুন", ta: "நண்பரைச் சேர்", hi: "मित्र जोड़ें",
  // Every sibling label in this component, checked at the same widths — the
  // brief's point (1). These are the real literals from the file.
  "sib-RequestSent": "Request Sent", "sib-Accept": "Accept",
  "sib-Unfriend": "Unfriend", "sib-Following": "Following",
};

/** Wrap is measured from the TEXT NODE's own client rects: one rect = one line.
 *  Height comparisons would miss it inside a fixed h-9 box, which is the whole
 *  reason this defect is invisible to every existing check. */
const PROBE = () => {
  const rows = [...document.querySelectorAll("div")].filter(
    (d) => d.className && typeof d.className === "string" && d.className.includes("flex w-full items-center gap-2") && d.querySelector("button"),
  );
  const out = [];
  // Only VISIBLE rows. At mobile widths the desktop copy of this row is still
  // in the DOM with a zero-sized box; measuring it would report "no wrap" for a
  // row nobody can see, which is worse than no measurement.
  let ri = -1;
  rows.forEach((row) => {
    if (row.getBoundingClientRect().width === 0) return;
    ri += 1;
    [...row.querySelectorAll("button")].forEach((b) => {
      const tn = [...b.childNodes].find((n) => n.nodeType === 3 && (n.textContent || "").trim().length);
      let lines = 0, textW = 0;
      if (tn) {
        const r = document.createRange();
        r.selectNodeContents(tn);
        const rects = [...r.getClientRects()];
        lines = rects.length;
        textW = Math.round(Math.max(0, ...rects.map((x) => x.width)));
      }
      const cs = getComputedStyle(b);
      const br = b.getBoundingClientRect();
      out.push({
        row: ri,
        label: (b.textContent || "").trim(),
        lines,
        wrapped: lines > 1,
        overflowing: b.scrollWidth > b.clientWidth + 1,
        btnW: Math.round(br.width),
        btnH: Math.round(br.height),
        textW,
        whiteSpace: cs.whiteSpace,
        flexBasis: cs.flexBasis,
        flexGrow: cs.flexGrow,
        minWidth: cs.minWidth,
      });
    });
  });
  return out;
};

const browser = await chromium.launch({ executablePath: EXE });
const report = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/uiharness.html?scene=${SCENE}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator("button:visible", { hasText: "Add Friend" }).first().waitFor({ timeout: 20000 });

  const shootRow = async (tag) => {
    const rows = page.locator("div.flex.w-full.items-center.gap-2").filter({ has: page.locator("button") });
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      if (!(await r.isVisible())) continue; // one row is hidden at this width
      await r.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await r.screenshot({ path: `${OUT}/${vp.name}--${tag}--row${i}.png` });
    }
  };

  report.push({ viewport: vp.name, variant: "english", buttons: await page.evaluate(PROBE) });
  await shootRow("english");

  for (const [lang, text] of Object.entries(LONG)) {
    await page.evaluate((t) => {
      document.querySelectorAll("button").forEach((b) => {
        const tn = [...b.childNodes].find((n) => n.nodeType === 3 && (n.textContent || "").trim().length);
        if (tn && !/^\s*(Follow|Following)\s*$/.test(tn.textContent)) tn.textContent = " " + t;
      });
    }, text);
    await page.waitForTimeout(200);
    report.push({ viewport: vp.name, variant: `long-${lang}`, buttons: await page.evaluate(PROBE) });
    if (lang === "te") await shootRow("long-te");
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/measurements.json`, JSON.stringify(report, null, 1));

for (const r of report) {
  for (const b of r.buttons.filter((x) => x.row === 0)) {
    console.log(
      `${r.viewport.padEnd(13)} ${r.variant.padEnd(10)} ${JSON.stringify(b.label).padEnd(28)} lines=${b.lines} wrapped=${String(b.wrapped).padEnd(5)} overflow=${String(b.overflowing).padEnd(5)} w=${String(b.btnW).padEnd(4)} textW=${String(b.textW).padEnd(4)} ws=${b.whiteSpace} basis=${b.flexBasis}`,
    );
  }
}
