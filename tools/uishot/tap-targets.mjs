/**
 * IS EVERY INTERACTIVE ELEMENT AT LEAST 44px TO A FINGER? EVERY SCENE. NO LIST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. The UI gate reported ONE tap-target problem on
 * screen-notifications. A full scan of the same page found ELEVEN at 360px, and
 * the Auditor's scan of the deployed page found THIRTY-TWO. The gate was not
 * wrong about the one; it simply was not asking about the rest.
 *
 * Eight times today an instrument that ENUMERATED WHAT TO CHECK failed to see
 * what nobody enumerated — the SURFACES list that missed the sidebar and then
 * missed /notifications, the fixture too small to contain the defect, the probe
 * that skipped a scene rendering nobody. So this enumerates nothing. It takes
 * every element matching the interactive selector, on every scene the harness
 * offers, and measures it.
 *
 * ⚠ IT MEASURES THE HIT AREA, NOT THE PAINTED BOX. The fix for a 28px icon is
 * NOT to make the icon bigger — 28px is the design — it is to extend the
 * touchable region around it, which `.tap-44` does with an ::after that paints
 * nothing and moves no layout. getBoundingClientRect() cannot see a
 * pseudo-element, so a probe reading only the element's own rect would report
 * a correctly-fixed control as still broken, and somebody would then "fix" it
 * by making the icon bigger. The union of the element's rect and its ::after
 * box is the honest number.
 *
 * A control is EXEMPT only if it is invisible to a finger anyway: zero-sized,
 * display:none, visibility:hidden, or pointer-events:none.
 *
 *   npm run ui:harness    # in one shell, with the VITE_* vars set
 *   node tools/uishot/tap-targets.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return;
  for (const d of readdirSync(root))
    for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
}

const BASE = process.env.UI_HARNESS_BASE ?? "http://127.0.0.1:5199";
const FLOOR = 44;
/* The phone the Owner actually holds. A desktop reading is not the phone's:
   fixed icon buttons hold their size, but anything fluid does not, and the
   mobile bottom navigation does not exist at desktop width at all. */
const VIEWPORT = { width: 360, height: 800 };

const browser = await chromium.launch({ executablePath: chromePath() });
const probe = await browser.newPage();
await probe.goto(`${BASE}/uiharness.html`, { waitUntil: "networkidle" });
const scenes = await probe.$$eval("a[href^='?scene=']", (as) =>
  as.map((a) => new URL(a.href).searchParams.get("scene")).filter(Boolean),
);
await probe.close();

if (scenes.length === 0) {
  console.error("no scenes found — the harness is not serving; refusing to pass vacuously");
  process.exit(2);
}

let checked = 0;
const failures = [];

for (const scene of scenes) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/uiharness.html?scene=${scene}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => {
      const n = document.querySelectorAll('button, a, [role="button"], input, select, textarea').length;
      const prev = window.__tapCount;
      window.__tapCount = n;
      return prev !== undefined && prev === n;
    },
    undefined,
    { timeout: 10000, polling: 250 },
  ).catch(() => {});

  const found = await page.evaluate((floor) => {
    const SEL = 'button, a, [role="button"], input, select, textarea';
    const out = [];
    for (const el of document.querySelectorAll(SEL)) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      // The ::after hit region, which the rect cannot see.
      const after = getComputedStyle(el, "::after");
      let hitW = r.width, hitH = r.height;
      if (after && after.content && after.content !== "none") {
        const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
        hitW = Math.max(hitW, px(after.minWidth), px(after.width));
        hitH = Math.max(hitH, px(after.minHeight), px(after.height));
      }
      if (hitW >= floor && hitH >= floor) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === "string"
          ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "",
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        hitW: +hitW.toFixed(1), hitH: +hitH.toFixed(1),
      });
    }
    return { total: document.querySelectorAll(SEL).length, small: out };
  }, FLOOR);

  checked += found.total;
  if (found.small.length) {
    console.log(`FAIL ${scene.padEnd(36)} ${found.small.length} under ${FLOOR}px of ${found.total} controls`);
    for (const f of found.small) {
      console.log(`       ${String(f.hitW).padStart(6)} x ${String(f.hitH).padEnd(6)}  ${f.tag}.${f.cls.padEnd(30)} ${f.label}`);
      failures.push(`${scene}: ${f.tag}.${f.cls} ${f.hitW}x${f.hitH} — ${f.label}`);
    }
  } else {
    console.log(`ok   ${scene.padEnd(36)} ${found.total} controls, all >= ${FLOOR}px`);
  }
  await ctx.close();
}
await browser.close();

console.log(`\n${checked} interactive elements measured across ${scenes.length} scenes at ${VIEWPORT.width}px.`);
console.log(failures.length === 0
  ? `Every one is at least ${FLOOR}px to a finger.`
  : `${failures.length} UNDER ${FLOOR}px.`);
process.exit(failures.length === 0 ? 0 : 1);
