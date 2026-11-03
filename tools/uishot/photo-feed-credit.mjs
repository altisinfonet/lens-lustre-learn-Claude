#!/usr/bin/env node
/**
 * THE CREDIT IS NEVER ON SCREEN — `node tools/uishot/photo-feed-credit.mjs`
 *
 * Photo plan Unit A (Owner, 3 Nov 2026, confirmed sheet point 3; audit B1, B2,
 * M6). Real browsers open photofeedharness.html: a photo made by the REAL
 * uploader encoder with the REAL names, shown in the REAL feed card and the
 * REAL full-screen viewer. A file is "credited" when its PIXELS carry the
 * credit (the harness compares each copy with a twin encoded with an empty
 * credit), so a wrong naming rule cannot hide a credited file.
 *
 * 1. FEED (Chromium): no request for a credited file, for the v3 (`-l5`) and
 *    the v2 (`-l4`, the 3 live posts) shapes × large / 601–1080 px photos ×
 *    desktop 1280 / phone 390 × DPR 1, 1.5, 2, 3 for the switch answer arriving
 *    late (cold start) and signed out, and at DPR 2 / 3 for switch on, off and
 *    image errors (every copy's first request fails → the fallback).
 * 2. FULL SCREEN (Chromium, Firefox, WebKit; both shapes; signed out): the
 *    pixels on screen equal the CLEAN copy drawn in the same box, and differ
 *    from the credited file drawn there (so the check is not vacuous); a real
 *    right-click lands on an <img> whose source is the CREDITED file — what
 *    "save image as" / "copy image address" get. The target URL is logged.
 * 3. WEB == APP: the feed card in the Android shell (window.Capacitor) is
 *    pixel-identical to the website's at 390 px, member and admin.
 *
 *   --out <dir>     write the PNGs (feed cards, full screen) and the request log
 *   --json <file>   write the result
 *   --base <url>    use a running server (else starts Vite on 5193)
 *   --quick         feed matrix at DPR 2 only (local runs)
 *   --skip-feed     parts 2 and 3 only (local runs)
 */
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { PNG } from "pngjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg("--out", null);
const JSON_OUT = arg("--json", null);
const QUICK = process.argv.includes("--quick");
const PORT = 5193;
const BASE = arg("--base", null) || `http://127.0.0.1:${PORT}`;
/** A pixel "differs" when any channel moves more than this (0–255) — the camline rule. */
const CHANNEL = 40;
/** Two pictures "match" when at most this share of pixels differ (resampling noise). */
const SHARE = 0.002;
/** The credited reference must differ from the clean one in at least this many pixels. */
const CREDIT_MIN_PIXELS = 40;

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

const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
const name = (u) => u.split("/").pop();

/** Pixel comparison of two PNG buffers of the same size. */
function diff(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  if (a.width !== b.width || a.height !== b.height) return { same: false, differing: Infinity, why: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > CHANNEL || Math.abs(a.data[i + 1] - b.data[i + 1]) > CHANNEL || Math.abs(a.data[i + 2] - b.data[i + 2]) > CHANNEL) n++;
  }
  const share = n / (a.width * a.height);
  return { same: share <= SHARE, differing: n, why: `${n} px differ (${(share * 100).toFixed(3)} %)` };
}

async function open(browser, { vp, dpr, viewer, size, shape, admin = false, app = false }) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: dpr, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const requested = [];
  const failedOnce = new Set();
  await page.route("https://cdn.harness.test/**", async (route) => {
    const url = route.request().url();
    requested.push(url);
    // viewer "err": every copy's FIRST request fails, so every fallback path runs.
    if (viewer === "err" && !failedOnce.has(url)) { failedOnce.add(url); return route.fulfill({ status: 404, body: "" }); }
    const hit = await page.evaluate((u) => window.__photoStore?.[u] ?? null, url).catch(() => null);
    if (!hit) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: hit.type, body: Buffer.from(hit.b64, "base64") });
  });
  const qs = new URLSearchParams({
    viewer, ...(vp === "phone" ? { w: "phone" } : {}), ...(size === "small" ? { small: "1" } : {}),
    ...(shape === "legacy" ? { legacy: "1" } : {}), ...(admin ? { admin: "1" } : {}), ...(app ? { app: "1" } : {}),
  });
  await page.goto(`${BASE}/photofeedharness.html?${qs}`, { timeout: 180_000 });
  await page.waitForFunction(() => window.__photoReady === true, null, { timeout: 120_000 });
  await page.waitForSelector("#cardwrap img", { timeout: 60_000 });
  // Past the late switch answer (6 s) and its re-render, with time to fetch.
  await page.waitForTimeout(viewer === "late" ? 9000 : 3500);
  const store = await page.evaluate(() => window.__photoStore);
  const credited = Object.values(store).filter((s) => s.credited).map((s) => s.url);
  return { ctx, page, requested, store, credited, errors };
}

await waitUp();
{
  // Warm the dev server once (first-load dependency optimisation is slow).
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(`${BASE}/photofeedharness.html?viewer=out`, { timeout: 300_000 }).catch(() => {});
  await p.waitForFunction(() => window.__photoReady === true, null, { timeout: 300_000 }).catch(() => {});
  await b.close();
}
if (OUT) mkdirSync(OUT, { recursive: true });
const rows = [];
let pass = true;
const fail = (row, why) => { row.ok = false; (row.failed ??= []).push(why); pass = false; };

// ── 1. FEED: never a credited request ──────────────────────────────────────
if (!process.argv.includes("--skip-feed")) {
  const browser = await chromium.launch();
  const plan = [];
  for (const shape of ["v3", "legacy"]) {
    for (const size of ["large", "small"]) {
      for (const vp of Object.keys(VIEWPORTS)) {
        for (const dpr of QUICK ? [2] : [1, 1.5, 2, 3]) for (const viewer of ["late", "out"]) plan.push({ shape, size, vp, dpr, viewer });
        for (const dpr of QUICK ? [2] : [2, 3]) for (const viewer of ["on", "off", "err"]) plan.push({ shape, size, vp, dpr, viewer });
      }
    }
  }
  for (const s of plan) {
    const r = await open(browser, s);
    const bad = [...new Set(r.requested.filter((u) => r.credited.includes(u)))];
    const row = { part: "feed", ...s, ok: true, credited: r.credited.map(name), requested: r.requested.map(name), errors: r.errors };
    if (r.credited.length === 0) fail(row, "the encoder produced no credited copy — the check would be vacuous");
    if (bad.length) fail(row, `feed loaded credited ${bad.map(name).join(", ")}`);
    rows.push(row);
    console.log(`${row.ok ? "PASS" : "FAIL"} feed ${s.shape} ${s.size} ${s.vp} dpr ${s.dpr} viewer ${s.viewer}${bad.length ? ` — ${bad.map(name).join(", ")}` : ""}`);
    await r.ctx.close();
  }
  await browser.close();
}

// ── 2. FULL SCREEN: clean pixels; the context menu acts on the credited file ──
const engines = { chromium, firefox, webkit };
for (const [engine, type] of Object.entries(engines)) {
  const browser = await type.launch();
  for (const shape of ["v3", "legacy"]) {
    const row = { part: "full screen", engine, shape, ok: true };
    try {
      const r = await open(browser, { vp: "desktop", dpr: 2, viewer: "out", size: "large", shape });
      await r.page.evaluate(() => {
        window.__ctx = null;
        document.addEventListener("contextmenu", (e) => {
          const t = e.target;
          window.__ctx = t && t.tagName === "IMG" ? (t.currentSrc || t.src) : (t ? t.tagName : null);
        }, true);
      });
      await r.page.click("#cardwrap .cursor-zoom-in");
      const sel = "[role=dialog] img[data-photo-shown]";
      await r.page.waitForSelector(sel, { timeout: 20_000 });
      await r.page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }, sel, { timeout: 30_000 });
      await r.page.waitForTimeout(1500); // the CSS background (clean copy) paints
      const img = await r.page.$(sel);
      const facts = await img.evaluate((i) => ({ src: i.currentSrc || i.src, shown: i.getAttribute("data-photo-shown") }));
      row.contextFile = name(facts.src);
      row.shownFile = name(facts.shown);
      const box = await img.boundingBox();
      // a real right-click on the middle of the photo
      await r.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      await r.page.waitForTimeout(300);
      const target = await r.page.evaluate(() => window.__ctx);
      row.contextMenuTarget = target;
      if (!target || !r.credited.includes(target)) fail(row, `right-click target is ${target} — not the credited file`);
      if (r.credited.includes(facts.shown)) fail(row, `the painted copy ${name(facts.shown)} is a credited file`);
      // (headless browsers show no native menu; Escape would close the viewer itself)
      await r.page.mouse.move(5, 5);
      const onScreen = await img.screenshot();
      if (OUT) writeFileSync(join(OUT, `full-screen-${engine}-${shape}.png`), onScreen);
      // The same box, drawn plainly with the CLEAN copy, then with the CREDITED file.
      const draw = async (url) => {
        await img.evaluate(async (i, u) => {
          const rect = i.getBoundingClientRect();
          i.style.width = `${rect.width}px`;
          i.style.height = `${rect.height}px`;
          i.style.backgroundImage = "none";
          i.style.objectPosition = "";
          i.removeAttribute("srcset");
          await new Promise((res) => { i.onload = res; i.onerror = res; i.src = u; });
        }, url);
        await r.page.waitForTimeout(400);
        return img.screenshot();
      };
      const cleanRef = await draw(facts.shown);
      const creditRef = await draw(facts.src);
      const vsClean = diff(onScreen, cleanRef);
      const vsCredit = diff(cleanRef, creditRef);
      row.onScreenVsClean = vsClean.why;
      row.cleanVsCredited = vsCredit.why;
      if (!vsClean.same) fail(row, `the screen is not the clean copy: ${vsClean.why}`);
      if (vsCredit.differing < CREDIT_MIN_PIXELS) fail(row, `the credited file looks like the clean one here (${vsCredit.why}) — the check would be vacuous`);
      if (r.errors.length) row.errors = r.errors;
      await r.ctx.close();
    } catch (e) {
      fail(row, `threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    rows.push(row);
    console.log(`${row.ok ? "PASS" : "FAIL"} full screen ${engine} ${shape} — shown ${row.shownFile ?? "?"}, right-click target ${row.contextMenuTarget ? name(row.contextMenuTarget) : "?"}${row.failed ? ` — ${row.failed.join("; ")}` : ""}`);
    if (row.contextMenuTarget) console.log(`    context-menu target URL: ${row.contextMenuTarget}`);
  }
  await browser.close();
}

// ── 3. REAL SCREENS + web == app (390 px, member and admin) ────────────────
{
  const browser = await chromium.launch();
  const shots = {};
  for (const s of [
    { key: "web-desktop-member", vp: "desktop" },
    { key: "web-desktop-admin", vp: "desktop", admin: true },
    { key: "web-phone-member", vp: "phone" },
    { key: "web-phone-admin", vp: "phone", admin: true },
    { key: "app-phone-member", vp: "phone", app: true },
    { key: "app-phone-admin", vp: "phone", admin: true, app: true },
  ]) {
    const r = await open(browser, { ...s, dpr: 2, viewer: "on", size: "large", shape: "v3" });
    shots[s.key] = await (await r.page.$("#cardwrap")).screenshot();
    if (OUT) writeFileSync(join(OUT, `feed-card-${s.key}.png`), shots[s.key]);
    await r.ctx.close();
  }
  for (const who of ["member", "admin"]) {
    const d = diff(shots[`web-phone-${who}`], shots[`app-phone-${who}`]);
    const row = { part: "web == app", who, ok: true, why: d.why };
    if (!d.same) fail(row, `app and web differ at 390 px: ${d.why}`);
    rows.push(row);
    console.log(`${row.ok ? "PASS" : "FAIL"} web == app (${who}, 390 px feed card): ${d.why}`);
  }
  await browser.close();
}

stop();
const result = { pass, rows };
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));
console.log(pass ? "CREDIT NEVER ON SCREEN: PASS" : "CREDIT NEVER ON SCREEN: FAIL");
process.exit(pass ? 0 : 1);
