/**
 * Capture harness scenes as PNGs at real device sizes, and report anything the
 * page complained about while rendering.
 *
 * WHY THIS EXISTS: UI was shipping without anyone looking at it. `vitest` proves
 * a function returns the right value; it has nothing to say about a button
 * sitting half off the screen, a grid that collapses at 360px, or text that
 * overflows its container. This renders the real components in real Chromium at
 * real phone widths so the pixels can be inspected before a push.
 *
 *   node tools/uishot/capture.mjs                      # every scene, every size
 *   node tools/uishot/capture.mjs composer-preview     # one scene
 *
 * Assumes a dev server is already running (see BASE below). It deliberately
 * does NOT start one: a script that boots and kills a server hides the server's
 * own errors, and those are usually the interesting ones.
 *
 * ⚠ CONSOLE ERRORS ARE PART OF THE OUTPUT, not noise to be swallowed. A React
 * key warning or a failed image is a visual bug that has not shown itself yet.
 * Two are filtered, with the reason stated at IGNORED below, and nothing else.
 */

import { chromium } from "playwright";
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UI_HARNESS_BASE ?? "http://127.0.0.1:5199";
const OUT = process.env.UI_SHOT_DIR ?? "/tmp/shots";

/**
 * The two phone widths that actually matter here, and one desktop.
 * 360 is the width that breaks things — it is the common Android size and is
 * narrower than the iPhone most designs get eyeballed at.
 */
const VIEWPORTS = [
  { name: "android-360", width: 360, height: 800, mobile: true },
  { name: "iphone-390", width: 390, height: 844, mobile: true },
  { name: "desktop-1280", width: 1280, height: 900, mobile: false },
];

/**
 * Filtered, each for a stated reason. Anything not on this list is reported.
 *  • X-Frame-Options in <meta>: the app sets it deliberately for the real
 *    document; Chromium notes it cannot apply there. Not a rendering fault.
 *  • ERR_CONNECTION_RESET / ERR_TUNNEL: this container has no direct route to
 *    supabase.co. Harness scenes use literal data and never need it — but a
 *    scene that DID try to fetch would show up as an empty render, which is
 *    visible in the screenshot, which is the point.
 */
const IGNORED = [/X-Frame-Options may only be set via an HTTP header/, /ERR_CONNECTION_RESET|ERR_TUNNEL_CONNECTION_FAILED/];

/**
 * The container ships a pinned Chromium whose build number will not match what
 * playwright@latest looks for, so resolve the real binary rather than letting
 * it try to download a second copy (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set).
 */
function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

async function listScenes(page) {
  await page.goto(`${BASE}/uiharness.html`, { waitUntil: "networkidle" });
  return page.$$eval("a[href^='?scene=']", (as) =>
    as.map((a) => decodeURIComponent(a.getAttribute("href").replace("?scene=", ""))),
  );
}

const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

const exe = chromePath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const probe = await browser.newPage();
const scenes = only.length ? only : await listScenes(probe);
await probe.close();

if (scenes.length === 0) {
  console.error("No scenes found. Is the dev server running at " + BASE + " ?");
  process.exit(1);
}

let problems = 0;
const rows = [];

for (const scene of scenes) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      // Fixed so a screenshot never changes because a machine's locale did.
      locale: "en-GB",
      timezoneId: "Asia/Kolkata",
      colorScheme: "dark",
      reducedMotion: "reduce", // animations mid-flight make screenshots differ
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => {
      if (m.type() !== "error" && m.type() !== "warning") return;
      const t = m.text();
      if (IGNORED.some((re) => re.test(t))) return;
      errors.push(`${m.type()}: ${t.slice(0, 220)}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 220)}`));

    const file = join(OUT, `${scene}--${vp.name}.png`);
    await page
      .goto(`${BASE}/uiharness.html?scene=${encodeURIComponent(scene)}`, {
        waitUntil: "networkidle",
        timeout: 45000,
      })
      .catch((e) => errors.push("goto: " + e.message));
    // reducedMotion stops most of it; this covers a mount transition.
    await page.waitForTimeout(700);

    // A layout fault the eye misses in a screenshot but the DOM knows about:
    // anything wider than the viewport means a horizontal scrollbar on a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) errors.push(`layout: content overflows the viewport by ${overflow}px`);

    await page.screenshot({ path: file, fullPage: true });
    if (errors.length) problems += errors.length;
    rows.push({ scene, viewport: vp.name, file, errors });
    await ctx.close();
  }
}

await browser.close();

for (const r of rows) {
  const mark = r.errors.length ? "✗" : "✓";
  console.log(`${mark} ${r.scene.padEnd(28)} ${r.viewport.padEnd(13)} ${r.file}`);
  for (const e of r.errors) console.log(`    ${e}`);
}
console.log(`\n${rows.length} screenshots, ${problems} problem(s) reported.`);
process.exit(problems > 0 ? 1 : 0);
