#!/usr/bin/env node
/**
 * N7b · HARD GATE evidence: does the bell preview look the same as "See all"
 * on the LIVE site? Signs in as the review demo account (credentials from the
 * environment only — never printed), dark mode, and:
 *
 *   desktop 1366 px — opens the bell dropdown, then /notifications; saves
 *     both, a side-by-side picture, and compares the rows' markup;
 *   390 px phone    — taps the bell (it must open /notifications, not a
 *     dropdown) and saves the page.
 *
 * Writes PNGs + result.json to OUT (default ./n7b-shots). Exit 1 when the
 * rows differ or the phone bell does not open the page.
 *
 *   BASE=https://50mmretina.com REVIEW_DEMO_EMAIL=… REVIEW_DEMO_PASSWORD=… node tools/uishot/n7b-bell-vs-page.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.BASE || "https://50mmretina.com").replace(/\/$/, "");
const OUT = process.env.OUT || "n7b-shots";
const EMAIL = process.env.REVIEW_DEMO_EMAIL;
const PASSWORD = process.env.REVIEW_DEMO_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("REVIEW_DEMO_EMAIL / REVIEW_DEMO_PASSWORD not set");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const result = { base: BASE, at: new Date().toISOString(), steps: [] };
const step = (s) => { result.steps.push(s); console.log(s); };

// Headed (under xvfb in CI) with the automation flag off: the live sign-in is
// protected by Cloudflare Turnstile, which a bare headless browser fails.
const browser = await chromium.launch({
  headless: process.env.HEADED !== "1",
  args: ["--disable-blink-features=AutomationControlled"],
});

async function signIn(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('button[type="submit"]').first().click();
  const pw = page.locator('input[type="password"]').first();
  await pw.waitFor({ timeout: 30_000 });
  await pw.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  } catch (e) {
    // Say WHY (the form's own message — e.g. the server-side Turnstile check), never the credentials.
    await page.screenshot({ path: join(OUT, "sign-in-failed.png") }).catch(() => {});
    const msg = await page.locator('[role="alert"], .text-destructive').allInnerTexts().catch(() => []);
    result.signInFailed = msg.join(" | ").slice(0, 300) || "no message on the form";
    writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
    console.error(`sign-in did not complete: ${result.signInFailed}`);
    throw e;
  }
  step(`signed in, now at ${new URL(page.url()).pathname}`);
  return page;
}

/** Each row's markup, minus things that legitimately differ per mount. */
const rowsIn = (root) =>
  root.evaluate((el) =>
    [...el.querySelectorAll('[data-notif-row-open="true"]')].map((o) =>
      o.closest("[data-notif-row]")?.outerHTML.replace(/ (id|aria-controls|aria-describedby)="[^"]*"/g, "") ?? "",
    ),
  );
const sectionsIn = (root) =>
  root.evaluate((el) => [...el.querySelectorAll("[data-notif-section]")].map((s) => s.getAttribute("data-notif-section")));

// ── desktop ──────────────────────────────────────────────────────────────
const desk = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: "dark" });
await desk.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch { /* */ } });
const page = await signIn(desk);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" }).catch(() => {});
const bell = page.locator('button[aria-label="Notifications"]:visible').first();
await bell.click();
const panel = page.locator("#notification-panel");
await panel.waitFor({ timeout: 30_000 });
await page.waitForTimeout(4000); // history + thumbnails
await panel.screenshot({ path: join(OUT, "desktop-bell.png") });
const bellRows = await rowsIn(panel);
const bellSections = await sectionsIn(panel);
const bellHasTabs = (await panel.locator('[role="group"][aria-label="Filter notifications"]').count()) > 0;
step(`desktop bell: ${bellRows.length} rows, sections ${bellSections.join(",")}, tabs ${bellHasTabs}`);

await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" }).catch(() => {});
await page.locator('[data-notif-row-open="true"]').first().waitFor({ timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(4000);
await page.screenshot({ path: join(OUT, "desktop-page.png") });
const main = page.locator("body");
const pageRows = await rowsIn(main);
const pageSections = await sectionsIn(main);
step(`desktop page: ${pageRows.length} rows, sections ${pageSections.join(",")}`);

// The bell shows the first page of the same history; compare what both show.
const n = Math.min(bellRows.length, pageRows.length);
const differing = [];
for (let i = 0; i < n; i++) if (bellRows[i] !== pageRows[i]) differing.push(i);
result.desktop = { bellRows: bellRows.length, pageRows: pageRows.length, compared: n, differing, bellSections, pageSections, bellHasTabs };
step(`desktop compare: ${n} rows compared, ${differing.length} differ`);

// side by side
const b64 = (f) => readFileSync(join(OUT, f)).toString("base64");
const sbs = await desk.newPage();
await sbs.setViewportSize({ width: 1900, height: 1000 });
await sbs.setContent(`<body style="margin:0;background:#111;display:flex;gap:24px;padding:24px;font:14px sans-serif;color:#ddd">
  <figure style="margin:0"><figcaption>Bell dropdown (live, desktop, dark)</figcaption><img src="data:image/png;base64,${b64("desktop-bell.png")}"></figure>
  <figure style="margin:0"><figcaption>See all — /notifications (live, desktop, dark)</figcaption><img style="max-width:1100px" src="data:image/png;base64,${b64("desktop-page.png")}"></figure></body>`);
await sbs.screenshot({ path: join(OUT, "side-by-side-desktop.png"), fullPage: true });

// ── 390 px phone ─────────────────────────────────────────────────────────
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark",
  storageState: await desk.storageState(),
});
await phone.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch { /* */ } });
const p2 = await phone.newPage();
await p2.goto(`${BASE}/`, { waitUntil: "networkidle" }).catch(() => {});
await p2.locator('button[aria-label="Notifications"]:visible').first().tap();
await p2.waitForURL((u) => u.pathname === "/notifications", { timeout: 15_000 }).catch(() => {});
const phoneOpensPage = new URL(p2.url()).pathname === "/notifications";
const phoneDropdown = (await p2.locator("#notification-panel").count()) > 0;
await p2.waitForTimeout(4000);
await p2.screenshot({ path: join(OUT, "phone-390-bell-opens-page.png") });
result.phone = { opensPage: phoneOpensPage, dropdownShown: phoneDropdown, rows: (await rowsIn(p2.locator("body"))).length };
step(`phone 390: bell opens /notifications ${phoneOpensPage}, dropdown ${phoneDropdown}`);

await browser.close();
const ok = n > 0 && differing.length === 0 && bellHasTabs && phoneOpensPage && !phoneDropdown;
result.ok = ok;
writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
console.log(ok ? "N7b LIVE CHECK: PASS" : "N7b LIVE CHECK: FAIL");
process.exit(ok ? 0 : 1);
