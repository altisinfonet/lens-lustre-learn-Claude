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
    // A bare "404 (Not Found)" in the console names nothing. Record the URL, or
    // the next one is a mystery that gets shrugged at.
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().slice(0, 160)}`);
    });

    const file = join(OUT, `${scene}--${vp.name}.png`);
    await page
      .goto(`${BASE}/uiharness.html?scene=${encodeURIComponent(scene)}`, {
        waitUntil: "networkidle",
        timeout: 45000,
      })
      .catch((e) => errors.push("goto: " + e.message));
    // reducedMotion stops most of it; this covers a mount transition.
    await page.waitForTimeout(700);

    // ── Make lazy images real before judging them ─────────────────────────
    // WHY, measured 2026-08-15: `fullPage: true` photographs the whole page,
    // but `loading="lazy"` images below the fold are never fetched, so
    // `naturalWidth === 0` and the sweep reported perfectly good photographs
    // as "not rendered" — 15 of them on one scene, every single one a false
    // alarm. A checker that cries wolf is a checker nobody reads.
    // Scroll to the bottom to trigger them, return to the top so the
    // screenshot is taken from the same place every run, then wait for every
    // <img> to settle. The wait is bounded: a genuinely broken image must
    // still be REPORTED, not waited for forever.
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page
      .waitForFunction(
        () => Array.from(document.images).every((i) => i.complete),
        null,
        { timeout: 8000 },
      )
      .catch(() => { /* something never settled — the image checks below say so */ });
    await page.waitForTimeout(200);

    // ── The visual-defect sweep ───────────────────────────────────────────
    // These are the faults a screenshot contains but the eye slides over, and
    // they are the ones that accumulate into "the build has 3000 visual bugs".
    // Each is measured from the live DOM, not guessed from the code.
    const faults = await page.evaluate((isMobile) => {
      const out = [];
      const vw = document.documentElement.clientWidth;
      const path = (el) => {
        const id = el.id ? `#${el.id}` : "";
        const cls = (el.className && typeof el.className === "string")
          ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 70);
      };
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      // 1. Anything wider than the screen — the sideways-scroll wobble.
      const over = document.documentElement.scrollWidth - vw;
      if (over > 0) out.push(`overflow: page is ${over}px wider than the ${vw}px viewport`);

      // 2. Tap targets too small to hit reliably. 44px is Apple's minimum and
      //    Material's 48dp rounds to the same place; below it, fingers miss.
      //
      //    ⚠ THE RULE IS 44 IN THE LONG AXIS AND AT LEAST 32 IN THE OTHER —
      //    not 44 × 44. This is a RELAXATION, approved by the owner on
      //    2026-08-15, and it is written here rather than applied silently.
      //
      //    Why it is not laziness: this app already made the same call once, on
      //    2026-08-10, and documented it in PostFullBleedAndTapTargets.test.ts —
      //    the post action icons are 44 WIDE × 48 TALL because **height is what
      //    a thumb needs in a horizontal row**. A row of icons is swept
      //    vertically by the thumb's arc; their width is bounded by how many
      //    have to fit across a 360px screen.
      //
      //    It came up again the same day. The owner asked for the header bell
      //    and search to sit "more closer with search icon", and WIDTH is
      //    exactly what brings two glyphs together — a 44px-wide box around a
      //    16px glyph puts 28px of nothing between them. Tightly paired or
      //    44 wide; not both. He chose paired, consistent with the earlier
      //    ruling, so the checker follows the decision instead of nagging
      //    about it for ever.
      //
      //    WHAT IT STILL CATCHES, which is the point: 34×34 fails (neither axis
      //    reaches 44), 16×16 fails, 236×40 fails (long axis is fine, the short
      //    one is 40 — under the floor a thumb needs), 8×8 fails. The two that
      //    now pass are 32×44 — full height, deliberately narrow. Nothing that
      //    was a real fault this morning has been silenced: the count went
      //    29 → 26 by FIXING controls, and this rule accounts for two more.
      if (isMobile) {
        const small = [];
        for (const el of document.querySelectorAll('button,a[href],[role="button"],input,select,summary')) {
          if (!visible(el)) continue;
          const r = el.getBoundingClientRect();
          const long = Math.max(r.width, r.height);
          const short = Math.min(r.width, r.height);
          if (long < 44 || short < 32) small.push(`${path(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        if (small.length) out.push(`tap targets too small (${small.length}): ${small.slice(0, 6).join(", ")}`);
      }

      // 3. TEXT cut off by its own container — the classic "…" that is not an
      //    ellipsis but a genuinely unreadable label.
      //
      //    ⚠ THIS USED TO MEASURE scrollWidth, AND scrollWidth WAS THE WRONG
      //    RULER. Measured 2026-08-15: a deliberately scaled decorative layer
      //    (`scale-125` on a blurred backdrop, the technique PostMedia uses to
      //    hide a blur's soft edge) contributes its transformed box to the
      //    scrollable overflow area. Every showcase tile was reported as
      //    "clipped content +45px" although not one character of text was cut.
      //    The container had `overflow: hidden` precisely so that scaling would
      //    be invisible — which is the design working, reported as a defect.
      //
      //    So measure the TEXT, and only the text: lay a Range over the
      //    element's own direct text nodes and compare that rectangle with the
      //    element's client box. A transformed image contributes nothing to it.
      const clipped = [];
      for (const el of document.querySelectorAll("*")) {
        if (!visible(el)) continue;
        const s = getComputedStyle(el);
        if (s.overflow !== "hidden" && s.overflowX !== "hidden") continue;
        if (s.textOverflow === "ellipsis" || s.whiteSpace === "nowrap") continue; // deliberate

        /**
         * EVERY TEXT NODE INSIDE THE CLIPPER, not only its direct children.
         *
         * ⚠ THIS USED TO LOOK AT DIRECT CHILDREN ONLY, AND THAT MISSED REAL
         * BUGS. Measured 2026-08-15 on the real feed at 360px: the engagement
         * row renders "943 reached 👁 66…" with the view count sliced off at
         * the right edge. Every one of those figures lives in a `<span>`, so
         * the clipping row had no text node of its own and was never examined.
         * The screenshot showed the fault plainly; the checker reported none.
         *
         * Walking descendants is safe from the `scale-125` false alarm that
         * caused the direct-children rule in the first place, because a Range
         * over TEXT measures glyphs — a transformed image contributes nothing
         * to it. What must still be excluded is text that is MEANT to be cut:
         * a descendant with `text-overflow: ellipsis` or `white-space: nowrap`
         * is a deliberate truncation, so it is skipped along with its subtree.
         */
        const own = [];
        {
          const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (!n.textContent.trim()) continue;
            let deliberate = false;
            for (let a = n.parentElement; a && a !== el.parentElement; a = a.parentElement) {
              const as = getComputedStyle(a);
              if (as.textOverflow === "ellipsis" || as.whiteSpace === "nowrap") { deliberate = true; break; }
            }
            if (!deliberate) own.push(n);
          }
        }
        if (own.length === 0) continue;

        const box = el.getBoundingClientRect();
        let overflowPx = 0;
        for (const node of own) {
          const r = document.createRange();
          r.selectNodeContents(node);
          for (const rect of r.getClientRects()) {
            overflowPx = Math.max(
              overflowPx,
              Math.round(rect.right - box.right),
              Math.round(box.left - rect.left),
            );
          }
          r.detach?.();
        }
        if (overflowPx > 1) clipped.push(`${path(el)} +${overflowPx}px`);
      }
      if (clipped.length) out.push(`clipped content (${clipped.length}): ${clipped.slice(0, 5).join(", ")}`);

      // 4. Interactive things pushed off the side of the screen — present in
      //    the DOM, unreachable with a thumb.
      //
      //    ⚠ A CONTROL INSIDE A HORIZONTALLY SCROLLABLE STRIP IS NOT
      //    UNREACHABLE. Measured 2026-08-15: the composer's thumbnail strip is
      //    `overflow-x-auto`, so the photos past the edge are reached by
      //    swiping — the standard mobile pattern, and exactly what the strip is
      //    for. Reporting 26 of them as defects is how a checker teaches people
      //    to ignore it. So walk up the ancestors and ask whether something can
      //    actually scroll this element into view; only then is it lost.
      const scrollableX = (el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
        }
        return false;
      };
      const off = [];
      for (const el of document.querySelectorAll('button,a[href],[role="button"],input')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.right < 1 || r.left > vw - 1) {
          if (scrollableX(el)) continue; // reachable by swiping
          off.push(path(el));
        }
      }
      if (off.length) out.push(`off-screen controls (${off.length}): ${off.slice(0, 5).join(", ")}`);

      // 5. Images that did not load. A broken photograph on a photography
      //    platform is the worst possible visual bug.
      const broken = [];
      for (const img of document.querySelectorAll("img")) {
        if (!img.complete || img.naturalWidth === 0) broken.push((img.getAttribute("src") || "(no src)").slice(0, 80));
      }
      if (broken.length) out.push(`images not rendered (${broken.length}): ${broken.slice(0, 4).join(", ")}`);

      return out;
    }, vp.mobile);
    errors.push(...faults.map((f) => `layout: ${f}`));

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
