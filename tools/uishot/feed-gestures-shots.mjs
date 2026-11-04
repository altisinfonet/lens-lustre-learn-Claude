#!/usr/bin/env node
/**
 * FEED GESTURES — REAL SCREENS (Owner order, 4 Nov 2026: "exactly like Instagram").
 *
 * Opens the real feed card (photofeedharness.html: PostCard → PostMedia with the
 * real CSS) on a phone — 390×844, DPR 3, touch — and saves real renders of:
 *   1  the card before anything
 *   2  a single tap: nothing opens (no viewer)
 *   3  mid double-tap: the heart on the photo
 *   4  after the double-tap: the post is liked (the card's own like action)
 *   5  mid two-finger pinch: the photo enlarged in place over the feed
 *   6  just after release: springing back
 *   7  after release: back in the card
 *   8  desktop (1280, DPR 2): double-click heart
 * and prints the measured facts (dialogs open, layer transform, like state).
 *
 *   node tools/uishot/feed-gestures-shots.mjs --out <dir> [--base http://127.0.0.1:5173]
 *
 * The pinch is two real touch points through the Chrome DevTools Protocol
 * (Input.dispatchTouchEvent) — Playwright itself has no multi-touch call.
 */
import { spawn, execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg("--out", "feedgest-shots");
const PREFIX = arg("--prefix", "feedgest-REAL-");
const PORT = 5197;
const BASE = arg("--base", null) || `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });

let server = null;
const stop = () => {
  if (!server) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-server.pid, "SIGTERM");
  } catch { /* gone */ }
  server = null;
};
if (!arg("--base", null)) {
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", shell: process.platform === "win32",
  });
  process.on("exit", stop);
}
async function waitUp() {
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch(`${BASE}/photofeedharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

const bare = (u) => u.replace(/\?.*$/, "");
const facts = {};
const shot = async (page, n, label) => {
  const file = join(OUT, `${PREFIX}${n}-${label}.png`);
  await page.screenshot({ path: file });
  console.log(`saved ${file}`);
};

async function openCard(browser, { phone }) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, colorScheme: "dark" }
    : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("https://cdn.harness.test/**", async (route) => {
    const url = bare(route.request().url());
    const hit = await page.evaluate((u) => window.__photoStore?.[u] ?? null, url).catch(() => null);
    if (!hit) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: hit.type, body: Buffer.from(hit.b64, "base64") });
  });
  // A cold Vite dev server transforms the whole app on the first load.
  await page.goto(`${BASE}/photofeedharness.html?viewer=on${phone ? "&w=phone" : ""}`, { timeout: 420_000, waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__photoReady === true, null, { timeout: 300_000 });
  await page.waitForSelector("#cardwrap [data-feed-photo]", { timeout: 60_000 });
  await page.waitForFunction(() => {
    const i = document.querySelector("#cardwrap [data-feed-photo] img:not([aria-hidden])");
    return i && i.complete && i.naturalWidth > 0;
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(800);
  const frame = await page.$("#cardwrap [data-feed-photo]");
  const box = await frame.boundingBox();
  return { ctx, page, errors, box };
}

const dialogs = (page) => page.evaluate(() => document.querySelectorAll("[role=dialog]").length);
const likeState = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll("#cardwrap button")].find((x) => /like/i.test(x.getAttribute("aria-label") ?? "") || /like/i.test(x.textContent ?? ""));
  return b ? { label: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed"), text: (b.textContent ?? "").trim().slice(0, 40) } : null;
});

let failed = false;
try {
  await waitUp();
  const browser = await chromium.launch();

  /* ── phone ── */
  {
    const { ctx, page, errors, box } = await openCard(browser, { phone: true });
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await shot(page, 1, "phone-card-before");
    facts.likeBefore = await likeState(page);

    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(700);
    facts.dialogsAfterSingleTap = await dialogs(page);
    await shot(page, 2, "phone-single-tap-opens-nothing");

    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(90);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(230);
    facts.heartShown = await page.evaluate(() => !!document.querySelector("[data-feed-heart]"));
    await shot(page, 3, "phone-double-tap-heart");
    await page.waitForTimeout(1300);
    facts.likeAfterDoubleTap = await likeState(page);
    facts.dialogsAfterDoubleTap = await dialogs(page);
    await shot(page, 4, "phone-after-double-tap-liked");

    // Two-finger pinch through CDP.
    const cdp = await ctx.newCDPSession(page);
    const pts = (spread, dx, dy) => [
      { x: cx - spread + dx, y: cy + dy, id: 1, radiusX: 6, radiusY: 6, force: 1 },
      { x: cx + spread + dx, y: cy + dy, id: 2, radiusX: 6, radiusY: 6, force: 1 },
    ];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(50, 0, 0) });
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(50 + i * 10, i * 1, i * 2.5) });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(120);
    facts.midPinch = await page.evaluate(() => {
      const l = document.querySelector("[data-feed-pinch-layer]");
      const f = document.querySelector("#cardwrap [data-feed-photo]");
      return { layer: !!l, transform: l?.style.transform ?? null, frameHidden: f?.style.visibility === "hidden" };
    });
    await shot(page, 5, "phone-mid-pinch");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(90);
    await shot(page, 6, "phone-pinch-springing-back");
    await page.waitForTimeout(700);
    facts.afterPinch = await page.evaluate(() => ({
      layer: !!document.querySelector("[data-feed-pinch]"),
      frameVisible: document.querySelector("#cardwrap [data-feed-photo]")?.style.visibility === "",
      dialogs: document.querySelectorAll("[role=dialog]").length,
    }));
    await shot(page, 7, "phone-after-pinch");
    facts.phoneErrors = errors;
    await ctx.close();
  }

  /* ── desktop ── */
  {
    const { ctx, page, errors, box } = await openCard(browser, { phone: false });
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(700);
    facts.desktopDialogsAfterClick = await dialogs(page);
    await page.mouse.dblclick(cx, cy);
    await page.waitForTimeout(230);
    facts.desktopHeart = await page.evaluate(() => !!document.querySelector("[data-feed-heart]"));
    await shot(page, 8, "desktop-double-click-heart");
    await page.waitForTimeout(1300);
    facts.desktopLikeAfter = await likeState(page);
    facts.desktopErrors = errors;
    await ctx.close();
  }

  await browser.close();
  console.log(JSON.stringify(facts, null, 2));
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  stop();
}
process.exit(failed ? 1 : 0);
