#!/usr/bin/env node
/**
 * STORY AUTHOR TAP (Owner 21 Nov 2026) — `node tools/uishot/story-author-tap.mjs <out-dir>`
 *
 * Opens the REAL StoryViewer (app mode, phone 390, Chromium), taps the author's NAME in the story header and
 * checks the app left the feed for that member's profile address (/<handle>). Also taps the picture. Saves a PNG
 * of the viewer with the name. Fails if the profile did not open.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: story-author-tap.mjs <out-dir>");
mkdirSync(OUT, { recursive: true });

const PORT = Number(process.env.SHOT_PORT ?? 5296);
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
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/uiharness.html`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite did not start");
}

let failed = false;
const fail = (m) => { console.error(m); failed = true; };
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const how of ["name", "picture"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce", isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on("console", (m) => { if (/NO FIXTURE|STORY|profile/i.test(m.text())) console.log("  console:", m.text().slice(0, 200)); });
    await page.goto(`${BASE}/uiharness.html?scene=screen-feed&strict=0&native=1&stories=1`, { waitUntil: "load", timeout: 180000 });
    await page.getByText("Dipannita Sen").first().click({ timeout: 60000 });
    await page.waitForSelector("[data-testid='story-author']", { timeout: 30000 });
    await page.waitForTimeout(800);
    if (how === "name") await page.screenshot({ path: join(OUT, "story-author-REAL.png") });
    const before = await page.evaluate(() => location.pathname + location.search);
    const target = how === "name" ? page.getByTestId("story-author").getByText("Dipannita Sen") : page.getByTestId("story-author").locator("img, div").first();
    await target.click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => location.pathname + location.search);
    const open = await page.getByTestId("story-author").count();
    console.log(`${how}: ${before} -> ${after}${open ? " (viewer still open)" : " (viewer closed)"}`);
    if (after === before || open) fail(`tapping the ${how} did not open the profile`);
    await context.close();
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
