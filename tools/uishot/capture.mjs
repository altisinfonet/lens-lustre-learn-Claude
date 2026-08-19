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
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  /**
   * THE APP. Not a fourth screen size — a fourth PRODUCT.
   *
   * Added 2026-08-16 after the owner found three faults in two minutes that
   * this sweep had reported clean the same morning. Every one of them was on
   * the `isNativeCapacitorApp()` path: the composer's missing preview screen,
   * the wall grid's invisible like/comment counts, a blank gap in the feed.
   *
   * The app is NOT the website at a phone width. It takes deliberately
   * different routes — a two-screen composer instead of three, its own top
   * bar, tap where the web hovers — and none of that had ever been rendered
   * here, because nothing set `window.Capacitor`. 63 screenshots, all of them
   * the website.
   *
   * 360 is the width used, because that is the one that breaks things and the
   * app is phone-only. `native: true` appends `&native=1`, which installs the
   * Capacitor stub in the harness entry BEFORE any app module loads.
   */
  { name: "app-360", width: 360, height: 800, mobile: true, native: true },
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

/**
 * `--baseline-write` records the current run's control fingerprints as the
 * new baseline (tools/uishot/baseline.json), committed to the repo. Every
 * other run instead DIFFS against that file — see the baseline-diff block
 * after the capture loop.
 */
const rawArgs = process.argv.slice(2);
const BASELINE_WRITE = rawArgs.includes("--baseline-write");
const only = rawArgs.filter((a) => !a.startsWith("--"));
const BASELINE_PATH = join(process.cwd(), "tools/uishot/baseline.json");
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
    // `&native=1` makes the harness install the Capacitor stub, so the page
    // renders the APP's code path rather than the website's. See VIEWPORTS.
    const nativeParam = vp.native ? "&native=1" : "";
    await page
      .goto(`${BASE}/uiharness.html?scene=${encodeURIComponent(scene)}${nativeParam}`, {
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

    /**
     * ── WAIT FOR EVERY ANIMATION TO FINISH BEFORE MEASURING ANYTHING ────────
     *
     * ⚠ THIS IS WHAT MAKES THE BASELINE DIFFABLE. Measured 2026-08-19, and it
     * cost a false failure on the very first run after the baseline was
     * recorded: `journey-create-from-feed`'s back-to-top button was captured at
     * 35x35 — which is 44 x 0.8, its entry animation caught partway — and the
     * next run reported "button.fixed.bottom-20 is gone", because by then it
     * had finished leaving. Three probes afterwards found it absent every time.
     * A baseline diff that raises false alarms is worse than no baseline: it is
     * a red gate with nothing behind it, which is how a checker teaches people
     * to re-run rather than read.
     *
     * THE FIRST FIX WAS WRONG AND IS WORTH RECORDING. Skipping any control
     * under `opacity: 0.9` looked like the same rule the tap-target check uses,
     * and it did remove the flap — along with 143 other controls, because
     * Radix's dialog Close button is `opacity-70` BY DESIGN, permanently. That
     * would have made both gates blind to a real, permanently visible control
     * on every dialog in the app: a checker quietly narrowed to make itself
     * agree with itself, which is the exact failure this whole gate exists to
     * prevent.
     *
     * So the cause is fixed instead of the symptom. `reducedMotion: "reduce"`
     * above stops CSS transitions but NOT JS-driven ones, and this waits for
     * the Web Animations API to report nothing still running. Bounded: a
     * genuinely infinite animation (a spinner) must not hang the sweep — it
     * carries on and measures, exactly as before. 800ms: an entry animation runs
     * 200-400ms, so this clears real ones and costs little on the scenes that
     * animate for ever. Measured: 4000ms put the full sweep over 12 minutes.
     */
    await page
      .waitForFunction(
        () => document.getAnimations().every((a) => a.playState !== "running"),
        null,
        { timeout: 800 },
      )
      .catch(() => { /* something animates for ever; measure anyway */ });
    await page.waitForTimeout(200);

    // ── The visual-defect sweep ───────────────────────────────────────────
    // These are the faults a screenshot contains but the eye slides over, and
    // they are the ones that accumulate into "the build has 3000 visual bugs".
    // Each is measured from the live DOM, not guessed from the code.
    const { faults, controls } = await page.evaluate((isMobile) => {
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
      //
      //    A LINK INSIDE A SENTENCE IS NOT A BUTTON, and judging it as one was
      //    the single biggest source of noise in this check. Measured
      //    2026-08-15: most of what survived the rule above was a member's
      //    name in a caption, "See more", "Cookie Policy" — text, 15 to 20px
      //    tall, sitting in running prose. Making those 44px would wreck the
      //    typography, so the report could only ever be ignored, and a report
      //    that is always ignored hides the real ones underneath it.
      //
      //    The test is the element's own COMPUTED DISPLAY. An anchor that is
      //    `inline` IS text — the browser flows it with the words around it.
      //    Anything a designer built as a control is `inline-flex`, `block`,
      //    `flex` or `grid`, and those are all still judged. So the avatar link
      //    (`display: flex`, 32x37) is still reported and the name beside it is
      //    not, which is exactly the distinction a thumb makes.
      //
      //    Buttons are NEVER skipped, whatever their display: a <button> is a
      //    control by definition.
      if (isMobile) {
        const small = [];
        /**
         * Is this anchor a LINE OF TEXT rather than a control?
         *
         * First attempt tested `display: inline` and barely helped: a member's
         * name is styled `block` so it can truncate, and it is still text.
         * The honest test is the shape — an anchor that holds only words, and
         * whose box is exactly one line high, has no padding around it. It IS
         * the text. Give it 44px and the sentence it sits in falls apart.
         *
         * An anchor holding an image or an icon (the avatar, 32x37) has a box
         * taller than its line box and is still judged, which is right: that is
         * a thing you aim at, not a word you read.
         */
        const isFlowedText = (el) => {
          if (el.tagName !== "A") return false;
          if (el.querySelector("svg,img,video")) return false;
          const cs = getComputedStyle(el);
          /**
           * `display: inline` IS the answer on its own, and the line-height
           * test below CANNOT reach it.
           *
           * MEASURED 2026-08-16 on the author name inside a caption
           * ("Avijit Sheel  Morning fog over the river…"): box 70x15,
           * line-height 21.125px. The shape test asks for |15 - 21.125| <= 4
           * and gets 6.1, so it reported a link that is four words into a
           * sentence.
           *
           * The reason is not a bad threshold. For an INLINE box,
           * getBoundingClientRect().height is the font's em box, not the line
           * box — the two are different numbers by definition, and no
           * threshold reconciles them without also swallowing real controls.
           *
           * An inline anchor cannot be given a 44px box at all: `height` does
           * not apply to it. Making it obey would mean changing its display,
           * which is exactly the "wreck the typography" outcome this whole
           * rule exists to avoid. So inline is decided here, and the
           * line-height test below continues to handle the `block` names that
           * are styled that way only so they can truncate.
           */
          if (cs.display === "inline") return true;
          const line = parseFloat(cs.lineHeight);
          if (!Number.isFinite(line)) return false;
          return Math.abs(el.getBoundingClientRect().height - line) <= 4;
        };
        /**
         * Is the real target a LABEL wrapping this control?
         *
         * A settings row is the standard case: the switch itself is 44x24, but
         * the whole row is a <label>, so the icon, the title and the
         * description all toggle it. What the thumb aims at is the row, and
         * the row is ~300x64. Measuring the switch reports a defect that does
         * not exist and hides the ones that do.
         *
         * Kept DELIBERATELY NARROW, because this is the kind of exception that
         * quietly turns a checker into decoration:
         *   • only for form controls a label can actually drive — a switch, a
         *     checkbox, a radio, an <input>. NOT for links or plain buttons; a
         *     32px avatar link inside a big card is still a real finding.
         *   • the ancestor must be a real <label>, not any large box.
         *   • that label must itself clear 44px in BOTH directions. A label
         *     that is also too small proves nothing and is still reported.
         * This is not moving the target. The 44px is genuinely there — it is
         * on a different element than the one being measured.
         */
        const coveredByLabel = (el) => {
          const role = el.getAttribute("role");
          const isFormControl =
            el.tagName === "INPUT" ||
            role === "switch" ||
            role === "checkbox" ||
            role === "radio";
          if (!isFormControl) return false;
          const label = el.closest("label");
          if (!label) return false;
          const lr = label.getBoundingClientRect();
          return Math.min(lr.width, lr.height) >= 44;
        };
        for (const el of document.querySelectorAll('button,a[href],[role="button"],input,select,summary')) {
          if (!visible(el)) continue;
          if (isFlowedText(el)) continue;
          if (coveredByLabel(el)) continue;
          /**
           * A CONTROL STILL FADING IN IS NOT A SMALL CONTROL.
           *
           * MEASURED 2026-08-16 on `screen-feed` in app mode. The back-to-top
           * button was reported at 35x35 against a source that plainly says
           * `h-11 w-11`. Both were true at the instant of measurement:
           *
           *   ~120ms in   rect 40x40   layout 44x44   scale(0.908)  opacity 0.016
           *   settled     rect 44x44   layout 44x44   none          opacity 1
           *
           * It has a framer-motion entry that scales 0.8 -> 1, and the sweep
           * caught it partway — at 1.6% opacity, when it was barely on screen
           * at all. 44 x 0.8 = 35.2, which is exactly the number reported.
           *
           * Skipping anything not yet opaque is the narrow fix. It does NOT
           * excuse a permanently undersized control: a button with a CSS
           * `scale(0.5)` sits at opacity 1 and is still measured by its real
           * on-screen rectangle, which is what a thumb has to hit. The only
           * thing excused is a transient state that will be gone before any
           * member could tap it.
           *
           * Left as a rect measurement rather than switching to offsetWidth,
           * deliberately: `offsetWidth` ignores transforms entirely and would
           * quietly stop reporting genuinely shrunken controls. The floor does
           * not move to make a screen pass.
           */
          const cs = getComputedStyle(el);
          if (parseFloat(cs.opacity) < 0.9) continue;

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

      /**
       * 4b. DOES A FIXED BAR ACTUALLY COVER CONTENT?
       *
       * WHY THIS EXISTS, 2026-08-16. The owner looked at an app-mode
       * screenshot and said the footer was overlapping the page. He was
       * reading the image correctly — and the image was lying. A `position:
       * fixed` bar is painted ONCE in a full-page capture, at wherever the
       * screen fold happened to be, so it appears to sit on top of content
       * halfway down every tall screenshot. Measured: at the true bottom of
       * that page the bar covered nothing at all.
       *
       * So the picture cannot answer the question and never could. This
       * measures it instead: scroll to the bottom, where a fixed bar really
       * would cover something if the page lacked the padding to clear it, and
       * ask what is underneath its rectangle.
       *
       * `Layout.tsx` reserves `pb-12` (48px) for a 49px bar, so this is a real
       * risk, not a hypothetical — and it is invisible to every other check.
       */
      /**
       * SCROLLED TO THE BOTTOM, DELIBERATELY, AND RESTORED AFTERWARDS.
       *
       * The checks around this one run with the page at the TOP, because the
       * screenshot is taken from there. Measuring a bottom-anchored bar at the
       * top of a long page reports every element near the fold as "buried" —
       * the check would fire on every screen in the app and mean nothing.
       * Reserved space only runs out at the END of the page, so that is the
       * one place worth measuring. Scroll position is restored so the
       * screenshot is still taken from the same place every run.
       */
      const scrollBefore = window.scrollY;
      window.scrollTo(0, document.documentElement.scrollHeight);
      void document.body.offsetHeight; // force layout so the rects are current

      const fixedBars = [...document.querySelectorAll("*")].filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        /**
         * A BAR IS A BAR. A SCRIM IS NOT.
         *
         * The height ceiling was added 2026-08-16. Without it, `fixed inset-0`
         * matches every condition here — bottom-anchored, full-width, on
         * screen — so an open modal's backdrop was classified as a bottom bar
         * covering the entire viewport, and the check duly reported every
         * element on the page as buried underneath it. Which is true, and is
         * the backdrop doing its job.
         *
         * 40% of the screen is far above any real navigation or action bar
         * (the app's own is 49px, 6%) and far below any sheet or scrim worth
         * mistaking for one.
         */
        if (r.height > window.innerHeight * 0.4) return false;
        // bottom-anchored, full-width, and actually on screen
        return r.height > 8 && r.width > vw * 0.6 && Math.abs(r.bottom - window.innerHeight) < 4;
      });
      const buried = [];
      for (const bar of fixedBars) {
        const nb = bar.getBoundingClientRect();

        /**
         * A MODAL IS SUPPOSED TO COVER THE PAGE.
         *
         * If this "bar" turns out to be part of an open dialog — the account
         * drawer, the crop lightbox — then everything outside that dialog is
         * deliberately unreachable, not accidentally buried. Reporting the
         * page's own navigation as hidden underneath an open modal describes
         * the modal working.
         *
         * So when the bar sits inside a dialog, the check narrows to that
         * dialog's own contents, where a footer really can be pushed under a
         * bar and really does matter. When it does not, nothing changes and
         * the whole page is measured exactly as before.
         */
        const modal = bar.closest('[role="dialog"],[aria-modal="true"],[data-vaul-drawer]');
        const scope = modal || document;

        for (const el of scope.querySelectorAll("p,span,h1,h2,h3,button,a,img,input,textarea")) {
          if (bar.contains(el) || !visible(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          const oy = Math.min(r.bottom, nb.bottom) - Math.max(r.top, nb.top);
          const ox = Math.min(r.right, nb.right) - Math.max(r.left, nb.left);
          // >6px of genuine two-axis overlap; a 1px kiss is not a defect.
          if (oy <= 6 || ox <= 6) continue;

          /**
           * OVERLAPPING IS NOT THE SAME AS BEING COVERED.
           *
           * ADDED 2026-08-16, and it was this check's own false alarm that
           * exposed the gap. `screen-account-sheet` opens the account drawer,
           * which is `position: fixed` and correctly paints OVER the page's
           * bottom navigation. Geometry alone reported 74 elements "hidden
           * behind a fixed bar" — including the drawer's own Logout button,
           * which a hit test showed was the topmost thing at its own centre.
           *
           * A rectangle test cannot see z-order, and z-order is the entire
           * question. So ask the browser what is actually painted at the
           * middle of the overlap. If the answer is inside the bar, the
           * content really is buried. If it is the element itself — or
           * anything in its own subtree, since a hit lands on the innermost
           * child — the bar is behind it and there is nothing to report.
           *
           * This matters beyond one scene: a check that cries wolf on every
           * modal is a check people learn to scroll past, and that is how the
           * app-mode gap survived 63 screenshots.
           */
          const px = Math.max(r.left, nb.left) + ox / 2;
          const py = Math.max(r.top, nb.top) + oy / 2;
          const hit = document.elementFromPoint(px, py);
          if (!hit || !bar.contains(hit)) continue;

          buried.push(`${path(el)} under the fixed bar by ${Math.round(oy)}px`);
        }
      }
      window.scrollTo(0, scrollBefore);
      if (buried.length) {
        out.push(`content hidden behind a fixed bar (${buried.length}): ${buried.slice(0, 4).join(", ")}`);
      }

      // 5. Images that did not load. A broken photograph on a photography
      //    platform is the worst possible visual bug.
      const broken = [];
      for (const img of document.querySelectorAll("img")) {
        /**
         * AN IMAGE THAT IS NOT DISPLAYED HAS NOTHING TO RENDER.
         *
         * MEASURED 2026-08-16 on the profile screen at 360 and 390: the QR
         * code in the desktop-only left sidebar reported `naturalWidth: 0`
         * and `complete: false` — at 700ms, at 2s and still at 5s. It is not
         * broken and it never loads, because a browser does not fetch or
         * decode an image inside a `display:none` subtree. It is correctly
         * hidden on a phone; that is the sidebar working.
         *
         * Reported on both phone widths and on neither desktop width, which
         * is the signature of exactly this and the opposite of a real broken
         * photograph. `offsetParent === null` is the cheap, reliable test for
         * "not laid out at all" — a genuinely broken <img> in the page IS
         * laid out (it gets its alt box) and is still reported, which is the
         * case this check exists for.
         */
        if (!img.offsetParent && getComputedStyle(img).position !== "fixed") continue;
        if (!img.complete || img.naturalWidth === 0) broken.push((img.getAttribute("src") || "(no src)").slice(0, 80));
      }
      if (broken.length) out.push(`images not rendered (${broken.length}): ${broken.slice(0, 4).join(", ")}`);

      // 6. UNIVERSAL REACHABILITY — every interactive control must be the
      //    thing actually painted at its own centre, on every screen, not
      //    only the ones somebody thought to check.
      //
      //    ─────────────────────────────────────────────────────────────────
      //    WHY THIS EXISTS. 2026-08-18, the registration date-of-birth year
      //    and month dropdowns went to production invisible-but-present: both
      //    `<select>` elements rendered at their correct size, in the DOM,
      //    on screen — and neither could be tapped, because
      //    `calendar.tsx`'s `nav` class is `absolute inset-x-0 top-0 z-10`,
      //    a full-width bar sitting on top of the caption row where the
      //    dropdowns live. Proved with a standalone Playwright probe against
      //    the real component: `document.elementFromPoint()` at the centre
      //    of each select returned the NAV element, not the select, for
      //    both (12-option month, 69-option year).
      //
      //    Check 4b above already does exactly this hit-test — but only for
      //    elements sitting under a bottom-anchored `position: fixed` bar
      //    taller than 8px. The DOB nav is `position: absolute`, anchored to
      //    the TOP, and lives inside a popover, not the page shell — none of
      //    check 4b's preconditions match it, so it sailed through 63
      //    screenshots unreported. The gap was not the technique — the
      //    technique (`elementFromPoint`) is proven — it was that the
      //    technique was only ever pointed at one specific shape of overlay.
      //
      //    This check drops every precondition except "is it an interactive
      //    control, is it visible, is it on screen" and asks the one
      //    question that actually matters: what does the browser hit when a
      //    thumb lands on its centre? That is the same standard a real tap
      //    is held to, so it cannot be fooled by a control that LOOKS right
      //    in a screenshot while something else silently eats the touch.
      //
      //    ─────────────────────────────────────────────────────────────────
      //    FOUR EXCEPTIONS, EACH MEASURED RATHER THAN ASSUMED. The first full
      //    sweep after this check was written reported 33 scene/viewport hits.
      //    Every one was diagnosed individually against the live DOM before
      //    anything was excused, because an exception added to make a sweep go
      //    green is how a checker turns into decoration. The DOB fault stays
      //    red under all four.
      //
      //    1. A DISABLED CONTROL IS *MEANT* TO BE UNTAPPABLE. 19 of the 33
      //       were `calendar-plain`'s out-of-range days: `disabled: true`,
      //       `opacity: 0.5`, `pointer-events: none`, hit-test landing on the
      //       <td> behind them. That is `disabled` working. Keyed on the
      //       DISABLED STATE, deliberately — NOT on `pointer-events: none`,
      //       because that property on an ENABLED control is the very shape of
      //       bug this check exists to catch.
      //
      //    2. JUDGE THE VISIBLE PORTION, NOT THE GEOMETRIC CENTRE. 4 more were
      //       controls inside a horizontally scrollable strip — the composer's
      //       photo thumbnails (80x80, only 36px of it past the clip) and the
      //       feed's category chips (88x62, 16px showing). Their geometric
      //       centre lies beyond the clip, so it was never painted by them and
      //       could not have been. A thumb aims at the part it can SEE, so the
      //       hit-test now uses the centre of the element's rectangle
      //       intersected with the viewport and every clipping ancestor. This
      //       is stricter, not looser: it also stops the old code's clamping of
      //       an off-screen centre to the viewport edge, which tested a point
      //       that was not on the control at all.
      //
      //    2b. CLIPPED IS NOT COVERED, AND ONLY CLIPPING IS EXCUSED. The feed's
      //       category strip peeks the next chip by 16px of its 88px. Its
      //       visible sliver is below the tap floor this file already enforces
      //       (44 long / 32 short), because it is a HINT that there is more to
      //       swipe, not a control anyone aims at yet. So a control whose
      //       CLIP-derived visible portion is below that floor is not judged.
      //       ⚠ Measured from CLIPPING ancestors ONLY, never from what is
      //       painted on top. A button that something else covers keeps its
      //       full visible rectangle and is still judged — otherwise an overlay
      //       could earn its own exemption by covering enough of the control,
      //       which is precisely backwards.
      //
      //    3. A CONTROL BEHIND A *DIFFERENT* MODAL IS DELIBERATE — decided by
      //       what is painted, not by DOM order. The first version called the
      //       LAST dialog in DOM order the top one and got
      //       `crop-modal-behind-dialog` wrong: the crop lightbox mounts FIRST
      //       and paints ON TOP, so the composer's Close button was reported
      //       as a defect for being under it, which is the lightbox working.
      //       Radix portals to <body> in mount order and stacking decides the
      //       rest, so DOM order never answered this question. Now: if the
      //       thing painted at the control's centre belongs to a different
      //       dialog/drawer subtree than the control itself, that is one modal
      //       over another and it is deliberate.
      //
      //    4. A CONTROL UNDER A `position: fixed` BAR IS CHECK 4b's JOB, NOT
      //       THIS ONE'S. The notification screen's last switch sits under the
      //       bottom navigation at scroll-top and is reached by scrolling —
      //       which is why 4b deliberately measures this at the END of the
      //       page, where reserved space actually runs out. Judging it here as
      //       well produces a false alarm AND double-reports the true ones.
      //       ⚠ This is a HANDOFF, not a silencing, and it is the one real
      //       hole in this check: 4b only recognises a BOTTOM-ANCHORED,
      //       full-width, under-40%-height fixed bar. A fixed overlay of some
      //       other shape covering a control is caught by NEITHER check. Named
      //       here so the next person finds it written down instead of
      //       discovering it the way the DOB fault was discovered.
      //    ─────────────────────────────────────────────────────────────────
      const controls = [];
      const unreachable = [];
      {
        const DIALOG_SEL = '[role="dialog"],[aria-modal="true"],[data-vaul-drawer]';
        const dialogOf = (node) => (node && node.closest ? node.closest(DIALOG_SEL) : null);
        const openDialogs = [...document.querySelectorAll(DIALOG_SEL)].filter((d) => visible(d));
        const pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 1;
        const selector =
          'button,a[href],[role="button"],input,select,summary,textarea,' +
          '[role="switch"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"]';
        for (const el of document.querySelectorAll(selector)) {
          if (!visible(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;

          // Exception 1 — a disabled control is meant not to respond.
          const isDisabled = el.disabled === true || el.getAttribute("aria-disabled") === "true";

          // Exception 2 — what a thumb can actually see and aim at: this
          // element's box narrowed by the viewport and by every clipping
          // ancestor. Empty means it is scrolled or clipped entirely out of
          // sight right now, which check 4 (off-screen) reports in its own,
          // clearer words.
          let cl = 0, ct = 0, cr = vw, cb = window.innerHeight;
          for (let n = el.parentElement; n; n = n.parentElement) {
            const ns = getComputedStyle(n);
            if (!/(hidden|auto|scroll|clip)/.test(ns.overflow + ns.overflowX + ns.overflowY)) continue;
            const nr = n.getBoundingClientRect();
            cl = Math.max(cl, nr.left); ct = Math.max(ct, nr.top);
            cr = Math.min(cr, nr.right); cb = Math.min(cb, nr.bottom);
          }
          const vl = Math.max(r.left, cl), vt = Math.max(r.top, ct);
          const vr = Math.min(r.right, cr), vb = Math.min(r.bottom, cb);
          // Exception 2b — a sliver peeking out of a scroll strip is a hint,
          // not a target. Same floor the tap-target check above enforces.
          const visW = vr - vl, visH = vb - vt;
          const clippedToASliver = Math.max(visW, visH) < 44 || Math.min(visW, visH) < 32;

          let reachable = null; // null = deliberately not judged
          if (!isDisabled && !clippedToASliver) {
            const hit = document.elementFromPoint((vl + vr) / 2, (vt + vb) / 2);
            /**
             * Exception 3 — anything a modal deliberately covers, in BOTH of
             * the two shapes that actually occur:
             *
             *   a) THE PAGE BEHIND AN OPEN MODAL. `screen-account-sheet` opens
             *      a drawer whose scrim is `fixed inset-0 z-50 bg-black/80` —
             *      a SIBLING of the drawer, not a child, so asking whether the
             *      thing on top belongs to a dialog answers "no" and every
             *      control on the page behind it got reported. Blocking the
             *      page is the scrim's entire job.
             *   b) ONE MODAL OVER ANOTHER. The composer's Close under the crop
             *      lightbox — the control IS in a dialog, but a DIFFERENT one
             *      is painted over it.
             *
             * Controls inside the open modal are still judged, which is where
             * a real fault would be.
             */
            const elDialog = dialogOf(el), hitDialog = dialogOf(hit);
            const behindAnotherModal =
              (openDialogs.length > 0 && elDialog === null) ||
              (hitDialog !== null && hitDialog !== elDialog);
            // Exception 4 — a fixed bar over a scrollable page is check 4b's.
            let hitIsFixed = false;
            for (let n = hit; n; n = n.parentElement) {
              if (getComputedStyle(n).position === "fixed") { hitIsFixed = true; break; }
            }
            if (!behindAnotherModal && !(hitIsFixed && pageScrolls)) {
              reachable = !!hit && (hit === el || el.contains(hit));
              if (!reachable) {
                unreachable.push(`${path(el)} centre is painted by ${hit ? path(hit) : "nothing"}, not itself`);
              }
            }
          }

          // Fingerprint for the baseline diff (Gate 2) — recorded regardless
          // of pass/fail here, so a later run can notice this control
          // silently losing its reachability, its size, or its options.
          controls.push({
            path: path(el),
            w: Math.round(r.width),
            h: Math.round(r.height),
            reachable,
            options: el.tagName === "SELECT" ? el.options.length : null,
          });
        }
      }
      if (unreachable.length) {
        out.push(`controls not reachable at their own centre (${unreachable.length}): ${unreachable.slice(0, 6).join(", ")}`);
      }

      return { faults: out, controls };
    }, vp.mobile);
    errors.push(...faults.map((f) => `layout: ${f}`));

    /**
     * PIN BOTTOM-FIXED BARS TO THE END OF THE PAGE BEFORE PHOTOGRAPHING IT.
     *
     * WHY, 2026-08-16, and this one cost the owner's trust twice. A
     * `position: fixed` bar is painted ONCE in a full-page capture, at
     * whatever height the screen fold happened to be. On a tall screen that
     * lands it in the MIDDLE of the image, sitting on top of content — so
     * every screenshot of a screen with a bottom nav looks like the footer is
     * eating the page. The owner read exactly that, twice, and said so. He was
     * reading the image correctly; the image was wrong.
     *
     * Measuring proved the layout was fine (see the fixed-bar check above,
     * which scrolls to the bottom where reserved space actually runs out).
     * But a checker whose PICTURES lie is worthless even when its numbers are
     * right, because the picture is the thing a human looks at.
     *
     * `absolute` + `bottom: 0` puts the bar where it truly ends up once the
     * page is scrolled to the end — the honest single position for it in a
     * one-shot image of the whole document. Only bottom-anchored, full-width
     * bars are touched; a fixed side rail or modal is left exactly as it is.
     * This runs immediately before the capture and the page is discarded
     * afterwards, so nothing else can be affected by it.
     */
    await page.evaluate(() => {
      const vw = window.innerWidth;
      const bars = [];
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed") continue;
        const r = el.getBoundingClientRect();
        const bottomAnchored = Math.abs(r.bottom - window.innerHeight) < 4;
        if (!bottomAnchored || r.width < vw * 0.6 || r.height < 8) continue;
        bars.push({ el, h: r.height });
      }
      /**
       * REPARENTED TO <body>, AND POSITIONED IN PAGE COORDINATES.
       *
       * The first attempt at this just set `position: absolute; bottom: 0` and
       * it did NOT work — the bar landed in the middle of the document again,
       * and the owner saw the same false overlap a second time. `absolute`
       * resolves against the nearest POSITIONED ANCESTOR, not the page, and
       * the nav sits inside a wrapper that ends well above the document
       * bottom. So "bottom: 0" meant the bottom of that wrapper.
       *
       * Appending to <body> first guarantees the containing block is the page,
       * and `top` is then set explicitly from the document height rather than
       * trusting `bottom` to mean what it looks like it means. The height is
       * measured BEFORE the move, because moving it changes the layout.
       */
      const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      for (const { el, h } of bars) {
        const s = /** @type {HTMLElement} */ (el).style;
        document.body.appendChild(el);
        s.position = "absolute";
        s.bottom = "auto";
        s.top = `${Math.max(0, docH - h)}px`;
        s.left = "0";
        s.right = "0";
        s.width = "100%";
      }
    });
    await page.screenshot({ path: file, fullPage: true });
    if (errors.length) problems += errors.length;
    rows.push({ scene, viewport: vp.name, file, errors, controls });
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

/**
 * ── GATE 2 — BASELINE DIFF ───────────────────────────────────────────────
 *
 * WHY THIS EXISTS, 2026-08-18. Everything above only ever catches what
 * somebody thought to write a rule for. The owner's objection, put plainly:
 * "we will build one gate you will break another gate which is working" —
 * a fault on a screen nobody was looking at that day.
 *
 * This does not depend on anyone predicting the failure. Every run above
 * already recorded, for every interactive control on every scene, its size,
 * whether it is reachable at its own centre, and (for a <select>) how many
 * options it has. This block compares THAT against the last known-good
 * recording and fails on any control that got WORSE — disappeared, shrank
 * below the tap-target floor, lost an option, or stopped being reachable —
 * even on a scene this change never touched and nobody re-checked by hand.
 * New controls, growth, or more options are not failures; only regressions.
 *
 * `--baseline-write` records the current run as the new known-good state.
 * That is a deliberate act, not a side effect of a normal run — it should
 * happen once, reviewed, after a change is confirmed correct, the same way
 * an approved migration hash is a deliberate act elsewhere in this repo.
 */
const fingerprint = {};
for (const r of rows) fingerprint[`${r.scene}--${r.viewport}`] = r.controls;

if (BASELINE_WRITE) {
  const merged = existsSync(BASELINE_PATH)
    ? { ...JSON.parse(readFileSync(BASELINE_PATH, "utf8")), ...fingerprint }
    : fingerprint;
  writeFileSync(BASELINE_PATH, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nbaseline written: ${join("tools/uishot/baseline.json")} (${Object.keys(fingerprint).length} scene/viewport keys from this run)`);
} else if (existsSync(BASELINE_PATH)) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const regressions = [];

  // A key that used to exist and produced nothing this run, on a FULL sweep
  // (no scene filter), means the scene itself is gone.
  if (only.length === 0) {
    for (const key of Object.keys(baseline)) {
      if (!(key in fingerprint)) regressions.push(`${key}: this scene/viewport no longer runs at all (existed in the baseline)`);
    }
  }

  for (const [key, current] of Object.entries(fingerprint)) {
    const base = baseline[key];
    if (!base) continue; // new scene/viewport — nothing to regress against yet
    const seenB = new Map(), seenC = new Map();
    const occurrenceKey = (c, seen) => {
      const n = seen.get(c.path) || 0;
      seen.set(c.path, n + 1);
      return `${c.path}#${n}`;
    };
    const bmap = new Map(base.map((c) => [occurrenceKey(c, seenB), c]));
    const cmap = new Map(current.map((c) => [occurrenceKey(c, seenC), c]));
    for (const [ck, b] of bmap) {
      const c = cmap.get(ck);
      if (!c) { regressions.push(`${key}: "${b.path}" is gone (was present in the baseline)`); continue; }
      if (b.reachable === true && c.reachable === false) {
        regressions.push(`${key}: "${b.path}" is no longer reachable at its own centre`);
      }
      if (typeof b.options === "number" && typeof c.options === "number" && c.options < b.options) {
        regressions.push(`${key}: "${b.path}" has ${c.options} options now, had ${b.options}`);
      }
      const bOk = Math.max(b.w, b.h) >= 44 && Math.min(b.w, b.h) >= 32;
      const cOk = Math.max(c.w, c.h) >= 44 && Math.min(c.w, c.h) >= 32;
      if (bOk && !cOk) {
        regressions.push(`${key}: "${b.path}" shrank to ${c.w}x${c.h} (was ${b.w}x${b.h}, a tappable size)`);
      }
    }
  }

  if (regressions.length) {
    problems += regressions.length;
    console.log(`\nBASELINE REGRESSIONS (${regressions.length}) — a control got worse since the last approved run:`);
    for (const reg of regressions) console.log(`    ✗ ${reg}`);
  } else {
    console.log(`\nbaseline diff: clean against ${Object.keys(baseline).length} recorded scene/viewport keys.`);
  }
} else {
  console.log(`\nno baseline recorded yet at tools/uishot/baseline.json — run with --baseline-write once this run is confirmed correct.`);
}

process.exit(problems > 0 ? 1 : 0);
