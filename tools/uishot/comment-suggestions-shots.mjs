#!/usr/bin/env node
/**
 * PHOTOGRAPHY COMMENT SUGGESTIONS (Owner 18 Nov 2026) — `node tools/uishot/comment-suggestions-shots.mjs <out-dir>`
 *
 * Real screens, Chromium: the comment box with the suggestion row in the app
 * (`?native=1`, phone 390) in English and in Bengali (app_lang=bn), the box
 * after tapping a phrase, and Admin → Comments with the editor (desktop 1280).
 * Fails if the row is missing or a tap does not put the phrase in the box.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: comment-suggestions-shots.mjs <out-dir>");
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
const PHONE = { width: 390, height: 844 };

try {
  await waitForServer();
  const browser = await chromium.launch();

  for (const [name, lang, tap] of [["app-en", "en", false], ["app-bn", "bn", false], ["app-en-tapped", "en", true]]) {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, reducedMotion: "reduce", isMobile: true, hasTouch: true });
    await ctx.addInitScript((l) => { try { localStorage.setItem("app_lang", l); } catch { /* none */ } }, lang);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/uiharness.html?scene=comments-v3-sample&strict=0&native=1`, { waitUntil: "load", timeout: 180000 });
    const row = page.getByTestId("comment-suggestions");
    await row.waitFor({ timeout: 60000 }).catch(() => fail(`${name}: no suggestion row`));
    await page.waitForTimeout(1200);
    if (tap) {
      await row.scrollIntoViewIfNeeded();
      await row.getByRole("button").nth(1).click();
      await page.waitForTimeout(400);
      const box = await page.locator("textarea, input[type='text'], [contenteditable='true']").last().evaluate((el) => el.value ?? el.textContent ?? "");
      if (!/composition/i.test(box)) fail(`${name}: tapping "Great composition 👏" did not put it in the box (box: "${box}")`);
    }
    await page.screenshot({ path: join(OUT, `comments-NEW-${name}-REAL.png`) });
    console.log(`comments-NEW-${name}: saved`);
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/uiharness.html?scene=screen-admin-comments&strict=0`, { waitUntil: "load", timeout: 180000 });
  await page.getByTestId("admin-comment-suggestions").waitFor({ timeout: 60000 }).catch(() => fail("admin: no suggestions editor"));
  await page.getByRole("button", { name: "Other languages for phrase 1" }).click().catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "admin-comments-NEW-editor-REAL.png") });
  console.log("admin-comments-NEW-editor: saved");
  await browser.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
