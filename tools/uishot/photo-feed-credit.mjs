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
 *   --skip-feed     parts 0, 2 and 3 only (local runs)
 *   --only-credit   part 0 only: the credit inside every saved file (local runs)
 */
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { PNG } from "pngjs";
import sharp from "sharp";
import { creditSvg } from "../media-derivatives/credit-svg.mjs";

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

/*
 * THE CREDIT INSIDE THE SAVED FILE (fault 1, Owner web check 3 Nov): measured
 * from the file's own bytes against its clean twin — the credit's box (width
 * and height as a share of the image) and its opacity (alpha = lift / headroom
 * on clearly lifted pixels). The Owner's rule: one third of the first credit's
 * size and half its opacity. The first credit measured 57 % of the width at
 * alpha ≈ 0.82 on live; one third / half is ≈ 19–23 % and ≈ 0.41.
 */
const CREDIT_LIMITS = { maxWidthPct: 32, maxHeightPct: 3.5, minAlpha: 0.25, maxAlpha: 0.55 };
async function measureCredit(credB64, cleanB64) {
  const a0 = Buffer.from(credB64, "base64");
  const m = await sharp(a0).metadata();
  const A = await sharp(a0).raw().removeAlpha().toBuffer();
  const B = await sharp(Buffer.from(cleanB64, "base64")).resize(m.width, m.height, { fit: "fill" }).raw().removeAlpha().toBuffer();
  const est = []; let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = (y * m.width + x) * 3;
    const c = (B[i] + B[i + 1] + B[i + 2]) / 3, v = (A[i] + A[i + 1] + A[i + 2]) / 3;
    if (v - c > 25 && 255 - c > 60) { est.push((v - c) / (255 - c)); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  }
  est.sort((p, q) => p - q);
  if (!est.length) return { size: `${m.width}x${m.height}`, px: 0, widthPct: 0, heightPct: 0, alphaP90: 0 };
  return {
    size: `${m.width}x${m.height}`, px: est.length,
    widthPct: +((maxx - minx + 1) / m.width * 100).toFixed(1),
    heightPct: +((maxy - miny + 1) / m.height * 100).toFixed(2),
    alphaP90: +est[Math.floor(est.length * 0.9)].toFixed(2),
  };
}
function creditFail(row, c) {
  const L = CREDIT_LIMITS;
  if (!c || c.px === 0) return fail(row, "the saved file carries no credit at all");
  if (c.widthPct > L.maxWidthPct) fail(row, `the credit is ${c.widthPct} % of the width (max ${L.maxWidthPct} %: one third of the first size)`);
  if (c.heightPct > L.maxHeightPct) fail(row, `the credit is ${c.heightPct} % of the height (max ${L.maxHeightPct} %)`);
  if (c.alphaP90 > L.maxAlpha || c.alphaP90 < L.minAlpha) fail(row, `the credit's opacity is ${c.alphaP90} (want ${L.minAlpha}–${L.maxAlpha}: half of the first ≈ 0.82)`);
}
/** The saved file's bottom-right corner, zoomed 3× (the Owner's PNGs). */
async function corner(b64, out) {
  const buf = Buffer.from(b64, "base64");
  const m = await sharp(buf).metadata();
  const w = Math.round(m.width * 0.5), h = Math.round(m.height * 0.18);
  await sharp(buf).extract({ left: m.width - w, top: m.height - h, width: w, height: h }).resize({ width: w * 3, kernel: "nearest" }).png().toFile(out);
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

// ── 0. THE CREDIT INSIDE EVERY SAVED FILE, for every path that draws it ─────
//   · new uploads: the browser canvas (photoCredit.drawCredit) — the harness
//     encodes with the REAL uploader; every credited copy it stored is measured;
//   · the backfill / rectify workers: sharp + credit-svg.mjs, exactly as
//     tools/media-derivatives/{photo-set,rectify-l4}.mjs draw it, on the clean
//     1080 the uploader made (the rectify case) — measured the same way.
{
  const browser = await chromium.launch();
  for (const size of ["large", "small"]) {
    const r = await open(browser, { vp: "desktop", dpr: 1, viewer: "out", size, shape: "v3" });
    for (const s of Object.values(r.store).filter((x) => x.credited)) {
      const row = { part: "credit in the saved file", path: "upload (browser canvas)", size, file: name(s.url), ok: true };
      row.credit = await measureCredit(s.b64, s.twin);
      creditFail(row, row.credit);
      rows.push(row);
      console.log(`${row.ok ? "PASS" : "FAIL"} credit in saved file · upload canvas · ${size} · ${row.file} ${JSON.stringify(row.credit)}${row.failed ? ` — ${row.failed.join("; ")}` : ""}`);
    }
    // the worker path, on the clean 1080 this photo's post names
    const cleanUrl = Object.keys(r.store).find((u) => /-l5\.webp$/.test(u));
    if (cleanUrl) {
      const clean = Buffer.from(r.store[cleanUrl].b64, "base64");
      const m = await sharp(clean).metadata();
      const out = await sharp(clean).composite([{ input: Buffer.from(creditSvg(m.width, m.height, "© Dipannita Sen, 50mm Retina World")), top: 0, left: 0 }]).webp({ quality: 85 }).toBuffer();
      const row = { part: "credit in the saved file", path: "backfill / rectify worker (sharp + credit-svg)", size, file: `${m.width}x${m.height}`, ok: true };
      row.credit = await measureCredit(out.toString("base64"), r.store[cleanUrl].b64);
      creditFail(row, row.credit);
      rows.push(row);
      console.log(`${row.ok ? "PASS" : "FAIL"} credit in saved file · worker svg · ${size} · ${JSON.stringify(row.credit)}${row.failed ? ` — ${row.failed.join("; ")}` : ""}`);
      if (OUT) await corner(out.toString("base64"), join(OUT, `saved-worker-${size}.png`));
    }
    await r.ctx.close();
  }
  await browser.close();
}
const ONLY_CREDIT = process.argv.includes("--only-credit");

// ── 1. FEED: never a credited request ──────────────────────────────────────
if (!process.argv.includes("--skip-feed") && !ONLY_CREDIT) {
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
for (const [engine, type] of ONLY_CREDIT ? [] : Object.entries(engines)) {
  const browser = await type.launch();
  // A CURSOR PARKED over the feed while it wheel-scrolls (review of #854): the
  // photo passes under the still cursor and the reader pauses on it — zero
  // credited requests (feed weight unchanged).
  {
    const pr = { part: "parked cursor, feed scrolls under it", engine, ok: true };
    try {
      const r2 = await open(browser, { vp: "desktop", dpr: 1, viewer: "out", size: "large", shape: "v3" });
      await r2.page.evaluate(() => { const s = document.createElement("div"); s.style.height = "1400px"; document.getElementById("cardwrap").before(s); });
      await r2.page.mouse.move(640, 450, { steps: 3 }); // over the spacer, not a photo
      const from = r2.requested.length;
      let under = false;
      for (let i = 0; i < 8; i++) {
        await r2.page.mouse.wheel(0, 220);
        await r2.page.waitForTimeout(1200);
        under = under || (await r2.page.evaluate(() => { const e = document.elementFromPoint(640, 450); return !!e && e.tagName === "IMG" && !!e.closest("#cardwrap"); }));
      }
      const got = [...new Set(r2.requested.slice(from).filter((u) => r2.credited.includes(u)))];
      pr.photoPassedUnderCursor = under;
      pr.creditedRequests = got.map(name);
      if (!under) fail(pr, "the photo never passed under the cursor — the check would be vacuous");
      if (got.length) fail(pr, `credited file requested while only scrolling: ${got.map(name).join(", ")}`);
      await r2.ctx.close();
    } catch (e) {
      fail(pr, `threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    rows.push(pr);
    console.log(`${pr.ok ? "PASS" : "FAIL"} parked cursor + scroll ${engine} — photo under cursor ${pr.photoPassedUnderCursor}, credited requests ${JSON.stringify(pr.creditedRequests ?? [])}${pr.failed ? ` — ${pr.failed.join("; ")}` : ""}`);
  }
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
      // FEED right-click (fault 2, 3 Nov): the file a "save image" gets is the
      // credited copy, and the card's pixels do not change.
      {
        const fr = { part: "feed right-click", engine, shape, ok: true };
        const card = await r.page.$("#cardwrap .cursor-zoom-in");
        const fimg = await r.page.$("#cardwrap .cursor-zoom-in img:not([aria-hidden])");
        const before = await card.screenshot();
        const fb = await fimg.boundingBox();
        // a real user: the mouse comes onto the photo, rests, then right-clicks
        await r.page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2, { steps: 4 });
        await r.page.waitForTimeout(1500);
        await r.page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2, { button: "right" });
        await r.page.waitForTimeout(800);
        await r.page.mouse.move(5, 5);
        await r.page.waitForTimeout(300);
        const after = await card.screenshot();
        const ftarget = await r.page.evaluate(() => window.__ctx);
        fr.contextMenuTarget = ftarget;
        const same = diff(before, after);
        fr.screenBeforeVsAfter = same.why;
        if (!ftarget || !r.credited.includes(ftarget)) fail(fr, `feed right-click target is ${ftarget} — not the credited file`);
        if (!same.same) fail(fr, `the feed card's pixels changed at the right-click: ${same.why}`);
        if (ftarget && r.store[ftarget]?.twin) {
          fr.creditInSavedFile = await measureCredit(r.store[ftarget].b64, r.store[ftarget].twin);
          creditFail(fr, fr.creditInSavedFile);
          if (OUT) await corner(r.store[ftarget].b64, join(OUT, `saved-feed-${engine}-${shape}.png`));
        }
        if (OUT) writeFileSync(join(OUT, `feed-card-after-right-click-${engine}-${shape}.png`), after);
        rows.push(fr);
        console.log(`${fr.ok ? "PASS" : "FAIL"} feed right-click ${engine} ${shape} — target ${ftarget ? name(ftarget) : "?"}, screen ${same.why}${fr.creditInSavedFile ? `, credit ${JSON.stringify(fr.creditInSavedFile)}` : ""}${fr.failed ? ` — ${fr.failed.join("; ")}` : ""}`);
        if (ftarget) console.log(`    context-menu target URL: ${ftarget}`);
        await r.page.evaluate(() => { window.__ctx = null; });
      }
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
      if (target && r.store[target]?.twin) {
        row.creditInSavedFile = await measureCredit(r.store[target].b64, r.store[target].twin);
        creditFail(row, row.creditInSavedFile);
        if (OUT) await corner(r.store[target].b64, join(OUT, `saved-full-screen-${engine}-${shape}.png`));
      }
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
if (!ONLY_CREDIT) {
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
