/**
 * REPRODUCTION — "click crop and upload … the tag/category screen never opens,
 * the composer just disappears." (Owner, 2026-08-17, web and app.)
 *
 * This is not a screenshot. It DRIVES the real composer on a real page with a
 * real router: open composer → add a photo → press Crop → press Crop & Upload →
 * then ask one question: IS THE COMPOSER STILL THERE?
 *
 * Written before any fix, so the fix can be proved rather than reasoned about.
 * Run:  node tools/uishot/repro-crop-upload.mjs [scene]
 */
import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Same binary resolution as capture.mjs — the container pins its own Chromium. */
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

const BASE = process.env.UI_HARNESS_BASE ?? "http://127.0.0.1:5199";
const SCENE = process.argv[2] ?? "journey-create-from-wall";

// A real 32x32 PNG. A 1x1 is not enough: the composer decode-probes the file
// and the crop editor measures it, so the probe photo has to be a photo.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAJklEQVRYhe3OMQEAAAjAoNm/9Er4CRhcSVJSUlJSUlJSUlJS8m8HkQQBASTaEjkAAAAASUVORK5CYII=";

const exe = chromePath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); if (/PROBE/.test(m.text())) console.log("[browser] " + m.text().split("\n").slice(0,6).join(" | ")); });

await page.goto(`${BASE}/uiharness.html?scene=${SCENE}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const report = {};
const historyLen = () => page.evaluate(() => history.length);
const composerOpen = () =>
  page.evaluate(() => !!document.querySelector('[role="dialog"]'));
// The crop dialog is identified by its CONFIRM BUTTON, not by the word
// "crop": the composer itself contains a Crop button, so /crop/i matched the
// composer and reported the crop dialog open when it was not.
const cropOpen = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).some((b) =>
      /Crop & Upload|Processing/.test(b.textContent || ""),
    ),
  );

// ── 1. Open the composer ──────────────────────────────────────────────────
// The composer row on the wall/feed. Fall back to any control that says it.
const opener = page
  .locator('[data-testid="composer-open"], button, div[role="button"]')
  .filter({ hasText: /what'?s on your mind|create post|share a photo|photo/i })
  .first();
if (await opener.count()) await opener.click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(600);
report.composerAfterOpen = await composerOpen();

// ── 2. Put a photo in it ──────────────────────────────────────────────────
const buf = Buffer.from(PNG.split(",")[1], "base64");
// The COMPOSER's input specifically. There are three hidden file inputs on
// this page and the first one belongs to the avatar, not the post.
const input = page.locator('input[type="file"][accept="image/*"][multiple]').first();
await input.setInputFiles({ name: "probe.png", mimeType: "image/png", buffer: buf });
await page.waitForTimeout(4000);
report.composerAfterPhoto = await composerOpen();
report.historyBeforeCrop = await historyLen();

// ── 3. Press Crop on the thumbnail ────────────────────────────────────────
// TEXT locators, not role locators, and the reason is itself a finding:
// Radix marks everything outside its dialog `aria-hidden`, and the crop modal
// is a SIBLING of the composer dialog — so while it is the only thing on
// screen, none of its buttons exist in the accessibility tree at all.
const cropBtn = page.locator('button:has-text("Crop")').first();
report.cropButtonFound = (await cropBtn.count()) > 0;
if (report.cropButtonFound) {
  await cropBtn.click({ timeout: 5000 }).catch((e) => (report.cropClickError = String(e)));
  await page.waitForTimeout(900);
}
report.cropOpen = await cropOpen();
report.historyInCrop = await historyLen();

// Instrument the browser BEFORE the action, so the cause is recorded rather
// than reasoned about afterwards.
await page.evaluate(() => {
  window.__probe = { pops: [], path0: location.pathname, state0: JSON.stringify(history.state) };
  window.addEventListener("popstate", (e) => {
    window.__probe.pops.push({
      path: location.pathname,
      search: location.search,
      state: JSON.stringify(e.state),
    });
  });
});

// ── 4. THE ACTION UNDER TEST ──────────────────────────────────────────────
const confirm = page.locator('button:has-text("Crop & Upload")').first();
report.confirmButtonFound = (await confirm.count()) > 0;
if (report.confirmButtonFound) {
  report.confirmLabel = (await confirm.textContent())?.trim();
  await confirm.click({ timeout: 5000 }).catch((e) => (report.confirmClickError = String(e)));
  await page.waitForTimeout(1800);
}

// ── 5. The only question that matters ─────────────────────────────────────
report.composerAfterCropUpload = await composerOpen();
report.cropStillOpen = await cropOpen();
report.historyAfter = await historyLen();
report.urlAfter = page.url();
report.bodyPointerEvents = await page.evaluate(() => getComputedStyle(document.body).pointerEvents);
report.nextButtonReachable = await page
  .locator('button:has-text("Next")')
  .first()
  .isVisible()
  .catch(() => false);
report.cropModalAriaHidden = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) =>
    /Crop & Upload/.test(x.textContent || ""),
  );
  if (!b) return "no crop modal mounted";
  let n = b.parentElement;
  while (n && n !== document.body) {
    if (n.getAttribute("aria-hidden") === "true") return "YES — hidden from assistive tech";
    n = n.parentElement;
  }
  return "no";
});
// ── 6. And then the step the owner says he never reaches ──────────────────
if (report.composerAfterCropUpload) {
  await page.locator('button:has-text("Next")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  // What screen 2 holds differs by surface: the APP shows "Tag people" there,
  // the WEBSITE tags people on screen 1 and screen 2 is categories + audience
  // + schedule. Categories are on BOTH, so that is the honest marker, together
  // with the Post/Share button that only exists on screen 2.
  report.reachedTagAndCategoryStep = await page.evaluate(() => {
    const t = document.querySelector('[role="dialog"]')?.textContent || "";
    return /categor/i.test(t) && /(post|share)\b/i.test(t);
  });
  report.step2Text = await page.evaluate(() =>
    (document.querySelector('[role="dialog"]')?.textContent || "").replace(/\s+/g, " ").slice(0, 220),
  );
}

report.probe = await page.evaluate(() => window.__probe);
report.consoleErrors = errors.slice(0, 3);

console.log(JSON.stringify(report, null, 2));
const passed = report.composerAfterCropUpload && report.reachedTagAndCategoryStep;
console.log(
  passed
    ? "\nPASS — composer survived Crop & Upload and the tag/category step opened."
    : "\nFAIL — the reported fault is present: " +
      (report.composerAfterCropUpload
        ? "composer survived but the tag/category step never opened."
        : "the composer disappeared."),
);
await browser.close();
