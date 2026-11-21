#!/usr/bin/env node
/**
 * MESSAGES (M8) — `node tools/uishot/messages-shots.mjs <out-dir>`
 *
 * Photographs the REAL pages /messages (Messages tab, Requests tab), one chat and one request chat
 * (scenes screen-messages, screen-message-thread, screen-message-request, synthetic sample) in Chromium at
 * desktop 1280 and phone 390. Fails if any request had no fixture.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: messages-shots.mjs <out-dir>");
mkdirSync(OUT, { recursive: true });

const PORT = Number(process.env.SHOT_PORT ?? 5299);
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

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

/** [file, scene(+query), viewport, wait-for testid, steps(page)] */
const SHOTS = [
  ["menu-phone", "screen-messages", PHONE, "conversation-row", async (p) => {
    await p.getByRole("button", { name: /^Menu/ }).first().click();
    await p.getByRole("dialog", { name: "Menu" }).waitFor({ timeout: 30000 });
    await p.waitForTimeout(900);
  }],
  ["profile-button-desktop", "screen-wall-messages", DESKTOP, "message-btn", null],
  ["profile-button-phone", "screen-wall-messages", PHONE, "message-btn", null],
  ["chat-helpline-phone", "screen-message-thread&help=1", PHONE, "bubble-mine", async (p) => {
    await p.getByLabel("Message…").fill("I feel like I want to die");
    await p.getByRole("button", { name: "Send" }).click();
    await p.getByTestId("helpline-card").waitFor({ timeout: 30000 });
    await p.waitForTimeout(600);
  }],
  ["chat-emoji-phone", "screen-message-thread", PHONE, "smart-replies", async (p) => {
    await p.getByRole("button", { name: "Emoji" }).click();
    await p.getByTestId("emoji-picker").waitFor({ timeout: 30000 });
    await p.waitForTimeout(700);
  }],
  ["chat-emoji-desktop", "screen-message-thread", DESKTOP, "smart-replies", async (p) => {
    await p.getByRole("button", { name: "Emoji" }).click();
    await p.getByTestId("emoji-picker").waitFor({ timeout: 30000 });
    await p.waitForTimeout(700);
  }],
  ["chat-reading-only-phone", "screen-message-thread&sendoff=1", PHONE, "send-off-note", null],
  ["inbox-desktop", "screen-messages", DESKTOP, "conversation-row", null],
  ["inbox-phone", "screen-messages", PHONE, "conversation-row", null],
  ["requests-phone", "screen-messages", PHONE, "conversation-row", async (p) => { await p.getByRole("tab", { name: /Requests/ }).click(); await p.waitForTimeout(800); }],
  ["chat-ticks-sent-phone", "screen-message-thread&ticks=sent", PHONE, "tick-sent", null],
  ["chat-ticks-delivered-phone", "screen-message-thread&ticks=delivered", PHONE, "tick-delivered", null],
  ["chat-typing-phone", "screen-message-thread&typing=1", PHONE, "typing-dots", null],
  ["chat-reply-bar-desktop", "screen-message-thread", DESKTOP, "bubble-theirs", async (p) => {
    const b = p.getByTestId("bubble-theirs").last();
    await b.hover();
    await p.getByTestId("reply-button").last().click();
    await p.getByTestId("reply-bar").waitFor({ timeout: 30000 });
    await p.getByLabel("Message…").fill("It was the 50mm f/1.4 😊");
    await p.waitForTimeout(500);
  }],
  ["footer-chat-phone", "screen-messages", PHONE, "footer-chat-icon", async (p) => { await p.waitForTimeout(700); }],
  ["footer-nochat-phone", "screen-feed", PHONE, "mobile-bottom-nav", async (p) => { await p.waitForTimeout(900); }],
  ["menu-no-messages-phone", "screen-messages", PHONE, "conversation-row", async (p) => { await p.getByRole("button", { name: /^Menu/ }).first().click(); await p.getByRole("dialog", { name: "Menu" }).waitFor({ timeout: 30000 }); await p.waitForTimeout(900); }],
  ["chat-desktop", "screen-message-thread", DESKTOP, "bubble-mine", null],
  ["chat-phone", "screen-message-thread", PHONE, "bubble-mine", null],
  ["request-phone", "screen-message-request", PHONE, "request-bar", null],
];

let failed = false;
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const [name, scene, viewport, testid, steps] of SHOTS) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: "reduce", isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
    const page = await context.newPage();
    const missing = [];
    page.on("console", (m) => { if (/NO FIXTURE/.test(m.text())) missing.push(m.text().slice(0, 160)); });
    await page.goto(`${BASE}/uiharness.html?scene=${scene}&strict=0`, { waitUntil: "load", timeout: 180000 });
    await page.waitForSelector(`[data-testid='${testid}']:visible`, { timeout: 60000 });
    await page.waitForTimeout(1500);
    if (steps) await steps(page);
    await page.screenshot({ path: join(OUT, `messages-${name}-REAL.png`), fullPage: false });
    const uniq = [...new Set(missing)];
    console.log(`${name}: saved${uniq.length ? ` — MISSING FIXTURES: ${uniq.join(" | ")}` : ""}`);
    if (uniq.length) failed = true;
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
