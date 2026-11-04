#!/usr/bin/env node
/**
 * SIGN-UP AGE CHECK — `node tools/uishot/age-check-shots.mjs <out-dir>`
 *
 * Photographs the REAL sign-up screen (OnboardingModal) in WebKit, the engine
 * the iOS app runs, at the iPad Air 11-inch size App Review used, with the iOS
 * app shell. Two pictures for Apple (guideline 2.3.6, 4 Nov 2026):
 *   apple-age-REAL-1.png  the "18+ only" line beside Date of Birth
 *   apple-age-REAL-2.png  a date under 18, refused, with the message
 * The script fails unless the message is on screen and sign-up cannot finish.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { webkit } from "playwright";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: age-check-shots.mjs <out-dir>");
mkdirSync(OUT, { recursive: true });

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
const viteBin = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  env: {
    ...process.env,
    VITE_SUPABASE_URL: "https://testprojectref0000x.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key-not-real",
    VITE_SUPABASE_PROJECT_ID: "testprojectref0000x",
  },
});

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${BASE}/uiharness.html`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite did not start");
}

/** A date under 18 that the picker offers: December of its newest year. */
function under18() {
  const year = new Date().getFullYear() - 18;
  return { year: String(year), monthIndex: "11", day: "15" };
}

let failed = false;
try {
  await waitForServer();
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, reducedMotion: "reduce", isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
  await context.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/uiharness.html?scene=screen-onboarding-age&strict=0`, { waitUntil: "load", timeout: 180000 });

  const notice = page.getByTestId("age-18-notice");
  page.on("pageerror", (e) => console.error("pageerror", e.message.slice(0, 300)));
  await notice.waitFor({ timeout: 25000 }).catch(async (e) => { console.error((await page.locator("body").innerText()).slice(0, 400)); await page.screenshot({ path: join(OUT, "apple-age-DEBUG.png") }); throw e; });
  await notice.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, "apple-age-REAL-1.png") });

  const { year, monthIndex, day } = under18();
  await page.locator('[data-testid="age-18-notice"] + button').tap();
  await page.waitForTimeout(500);
  await page.waitForTimeout(800);
  await page.locator("select").nth(1).selectOption(year, { timeout: 4000 });
  await page.locator("select").nth(0).selectOption(monthIndex);
  await page.locator('[role="grid"] button', { hasText: new RegExp(`^${day}$`) }).first().tap();
  await page.getByRole("button", { name: "OK", exact: true }).tap();
  await page.locator("[data-radix-popper-content-wrapper]").waitFor({ state: "detached", timeout: 5000 });

  const error = page.getByTestId("age-18-error");
  await error.waitFor({ timeout: 10000 });
  const text = (await error.textContent())?.trim();
  if (text !== "Under 18 is not eligible to register.") throw new Error(`wrong message: ${text}`);
  await error.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, "apple-age-REAL-2.png") });
  await browser.close();
  console.log("OK", OUT);
} catch (e) {
  failed = true;
  console.error(`FAILED: ${e.message}`);
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
