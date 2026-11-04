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
import { creditFontPx, measureCredit as measureLine, renderCredit } from "../media-derivatives/credit-render.mjs";
import { creditSeen, lineBox } from "./credit-guard.mjs";

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
const CREDIT_LINE = "© Dipannita Sen, 50mm Retina World";
/** The server's path, on bytes the harness hands over: credit-render.mjs, then the workers' WebP. */
async function serverCredit(b64) {
  const { image } = await renderCredit(sharp, Buffer.from(b64, "base64"), CREDIT_LINE);
  return (await image.webp({ quality: 85 }).toBuffer()).toString("base64");
}

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
/** A URL without its query (the credited copy carries ?cv=<urlVersion>, src/lib/creditGeometry.mjs). */
const bare = (u) => (typeof u === "string" ? u.replace(/\?.*$/, "") : u);

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
 * on clearly lifted pixels), searched in the bottom-right corner where it is
 * drawn. Measured on live: v1 57 % of the width at alpha ≈ 0.82; v2 (one third,
 * half) 18–23 % at ≈ 0.40; v3 (one third of v2) 6–8 % at ≈ 0.15 — "unreadable".
 * v4 "MIDDLE SIZE" (Owner, 3 Nov 16:05Z): HALF of v2's size, slightly fainter
 * (≈ 0.30). v5 (Owner approved, 4 Nov): the font follows the SHORT side, 22–28 px,
 * so a share of the width means nothing across sizes. The line's expected width
 * comes from the renderer's own measurement for THIS file; the ink must be within
 * the bounds below of it, which fails every older size on a real file.
 */
const CREDIT_LIMITS = { minOfExpected: 0.8, maxOfExpected: 1.15, maxHeightPct: 3.5, minAlpha: 0.14, maxAlpha: 0.36 };
async function measureCredit(credB64, cleanB64) {
  const a0 = Buffer.from(credB64, "base64");
  const m = await sharp(a0).metadata();
  const A = await sharp(a0).raw().removeAlpha().toBuffer();
  const B = await sharp(Buffer.from(cleanB64, "base64")).resize(m.width, m.height, { fit: "fill" }).raw().removeAlpha().toBuffer();
  const est = []; let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
  for (let y = Math.floor(m.height * 0.8); y < m.height; y++) for (let x = Math.floor(m.width * 0.3); x < m.width; x++) {
    const i = (y * m.width + x) * 3;
    const c = (B[i] + B[i + 1] + B[i + 2]) / 3, v = (A[i] + A[i + 1] + A[i + 2]) / 3;
    if (v - c > 12 && 255 - c > 60) { est.push((v - c) / (255 - c)); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  }
  est.sort((p, q) => p - q);
  if (!est.length) return { size: `${m.width}x${m.height}`, px: 0, widthPct: 0, heightPct: 0, alphaP90: 0 };
  const { px: fontPx } = await creditFontPx(sharp, m.width, m.height, CREDIT_LINE);
  const expected = (await measureLine(sharp, CREDIT_LINE, fontPx)).w;
  return {
    size: `${m.width}x${m.height}`, px: est.length,
    widthPct: +((maxx - minx + 1) / m.width * 100).toFixed(1),
    ofExpected: +((maxx - minx + 1) / expected).toFixed(2),
    heightPct: +((maxy - miny + 1) / m.height * 100).toFixed(2),
    heightPx: maxy - miny + 1,
    alphaP90: +est[Math.floor(est.length * 0.9)].toFixed(2),
  };
}
function creditFail(row, c) {
  const L = CREDIT_LIMITS;
  if (!c || c.px === 0) return fail(row, "the saved file carries no credit at all");
  if (c.ofExpected > L.maxOfExpected || c.ofExpected < L.minOfExpected) fail(row, `the credit's ink is ${c.ofExpected} × the v5 line for this file (want ${L.minOfExpected}–${L.maxOfExpected})`);
  if (c.heightPct > L.maxHeightPct) fail(row, `the credit is ${c.heightPct} % of the height (max ${L.maxHeightPct} %)`);
  if (c.alphaP90 > L.maxAlpha || c.alphaP90 < L.minAlpha) fail(row, `the credit's opacity is ${c.alphaP90} (want ${L.minAlpha}–${L.maxAlpha})`);
}
/** The saved file's bottom-right corner, zoomed 3× (the Owner's PNGs). */
async function corner(b64, out) {
  const buf = Buffer.from(b64, "base64");
  const m = await sharp(buf).metadata();
  const w = Math.round(m.width * 0.5), h = Math.round(m.height * 0.18);
  await sharp(buf).extract({ left: m.width - w, top: m.height - h, width: w, height: h }).resize({ width: w * 3, kernel: "nearest" }).png().toFile(out);
}

async function open(browser, { vp, dpr, viewer, size, shape, admin = false, app = false, noCredited = false }) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: dpr, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.exposeFunction("__serverCredit", serverCredit);
  const requested = [];
  const failedOnce = new Set();
  await page.route("https://cdn.harness.test/**", async (route) => {
    const url = bare(route.request().url()); // the credited copy is loaded as ?cv=<urlVersion>; the store is keyed by the file
    requested.push(url);
    // noCredited: the window before the server's sweep has drawn the copy.
    if (noCredited && /-r2048c\.webp$/.test(url)) return route.fulfill({ status: 404, body: "" });
    // viewer "err": every copy's FIRST request fails, so every fallback path runs.
    if (viewer === "err" && !failedOnce.has(url)) { failedOnce.add(url); return route.fulfill({ status: 404, body: "" }); }
    const hit = await page.evaluate((u) => window.__photoStore?.[u] ?? null, url).catch(() => null);
    if (!hit) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: hit.type, body: Buffer.from(hit.b64, "base64") });
  });
  const qs = new URLSearchParams({
    viewer, ...(vp === "phone" ? { w: "phone" } : {}), ...(size === "small" ? { small: "1" } : {}),
    ...(shape === "legacy" ? { legacy: "1" } : {}), ...(shape === "old" ? { old: "1" } : {}), ...(admin ? { admin: "1" } : {}), ...(app ? { app: "1" } : {}),
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
//   · new uploads: the harness encodes with the REAL uploader (it draws no credit)
//     and the REAL renderer draws on its private clean 2048, as set-credit.mjs does;
//   · the rectify worker: the same renderer on the clean 1080 the uploader made.
{
  const browser = await chromium.launch();
  for (const size of ["large", "small"]) {
    const r = await open(browser, { vp: "desktop", dpr: 1, viewer: "out", size, shape: "v3" });
    for (const s of Object.values(r.store).filter((x) => x.credited)) {
      const row = { part: "credit in the saved file", path: "new photo (server, clean 2048)", size, file: name(s.url), ok: true };
      row.credit = await measureCredit(s.b64, s.twin);
      creditFail(row, row.credit);
      rows.push(row);
      console.log(`${row.ok ? "PASS" : "FAIL"} credit in saved file · new photo · ${size} · ${row.file} ${JSON.stringify(row.credit)}${row.failed ? ` — ${row.failed.join("; ")}` : ""}`);
    }
    // the worker path, on the clean 1080 this photo's post names
    const cleanUrl = Object.keys(r.store).find((u) => /-l5\.webp$/.test(u));
    if (cleanUrl) {
      const clean = Buffer.from(r.store[cleanUrl].b64, "base64");
      const m = await sharp(clean).metadata();
      const out = Buffer.from(await serverCredit(r.store[cleanUrl].b64), "base64");
      const row = { part: "credit in the saved file", path: "rectified photo (server, clean 1080)", size, file: `${m.width}x${m.height}`, ok: true };
      row.credit = await measureCredit(out.toString("base64"), r.store[cleanUrl].b64);
      creditFail(row, row.credit);
      rows.push(row);
      console.log(`${row.ok ? "PASS" : "FAIL"} credit in saved file · rectified · ${size} · ${JSON.stringify(row.credit)}${row.failed ? ` — ${row.failed.join("; ")}` : ""}`);
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
  // An OLD photo (20261110_0109): its credited copy is looked up — showing the
  // post must still never load it.
  for (const vp of Object.keys(VIEWPORTS)) for (const viewer of ["out", "on", "err"]) plan.push({ shape: "old", size: "large", vp, dpr: 2, viewer });
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

/** The guard, with the renderer's box for the file now in `img` and the photo's place inside the element. */
async function creditOnScreen(cleanRef, creditRef, img) {
  const { nw, nh, photo } = await img.evaluate((i) => {
    const r = i.getBoundingClientRect();
    const k = Math.min(r.width / i.naturalWidth, r.height / i.naturalHeight);
    const w = (i.naturalWidth * k) / r.width, h = (i.naturalHeight * k) / r.height;
    return { nw: i.naturalWidth, nh: i.naturalHeight, photo: { x: (1 - w) / 2, y: (1 - h) / 2, w, h } };
  });
  const { px, inset } = await creditFontPx(sharp, nw, nh, CREDIT_LINE);
  const m = await measureLine(sharp, CREDIT_LINE, px);
  return creditSeen(cleanRef, creditRef, lineBox(nw, nh, { left: nw - inset - m.w, top: nh - inset - m.h, textW: m.w, textH: m.h }), photo);
}

// ── 1b. BEFORE THE SWEEP: no credited file yet. A right-click must leave the
//       feed photo exactly as it was, never a broken image or the placeholder. ──
if (!process.argv.includes("--skip-feed") && !ONLY_CREDIT) {
  const browser = await chromium.launch();
  for (const vp of Object.keys(VIEWPORTS)) {
    const r = await open(browser, { shape: "v3", size: "large", vp, dpr: 2, viewer: "out", noCredited: true });
    const row = { part: "feed before the sweep", vp, ok: true };
    // [sizes]: the photo, not its blurred backdrop. A handle, because arming removes `sizes`.
    const photo = await r.page.locator('#cardwrap img[sizes][src*="-l5"]').first().elementHandle();
    const before = await photo.screenshot();
    await photo.click({ button: "right" });
    await r.page.waitForTimeout(2500); // past the retrier's delays
    await r.page.keyboard.press("Escape");
    const facts = await photo.evaluate((i) => ({ src: i.getAttribute("src"), width: i.naturalWidth, placeholder: i.dataset.fallbackApplied ?? null, armed: i.dataset.saveAs ?? null }));
    const after = await photo.screenshot();
    const same = diff(before, after);
    Object.assign(row, { facts, same: same.why });
    if (!r.requested.some((u) => /-r2048c\.webp$/.test(u))) fail(row, "the right-click never asked for the credited file: the check would be vacuous");
    if (/-r2048c/.test(facts.src) || facts.armed) fail(row, `the photo stayed on the missing credited file (${name(facts.src)})`);
    if (!facts.width) fail(row, "the photo is broken after the right-click");
    if (facts.placeholder) fail(row, "the global fallback planted the placeholder");
    if (!same.same) fail(row, `the photo changed on screen: ${same.why}`);
    rows.push(row);
    console.log(`${row.ok ? "PASS" : "FAIL"} feed before the sweep ${vp}${row.failed ? ` — ${row.failed.join("; ")}` : ""}`);
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
      // A spacer above AND below: below, so the page can always scroll far enough
      // for the photo to pass under the cursor. With only the one above, the
      // last reachable scroll left the cursor ~1 px above the photo once the
      // card got 16 px shorter (the tight row under the photo, 3 Nov) — the
      // check went vacuous, not the credit.
      await r2.page.evaluate(() => { const w = document.getElementById("cardwrap"); for (const where of ["before", "after"]) { const s = document.createElement("div"); s.style.height = "1400px"; w[where](s); } });
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
  // "old": a photo posted before the New Photos plan (unmarked URL) — its save
  // target is the credited copy the lookup names (20261110_0109), exactly like
  // a new photo's; the screen shows the original.
  // "legacy" (a stale v2 `-l4` row, credit fix U1 — Owner 4 Nov "very big
  // credit"): its credited file is the master with the RETIRED big credit, so a
  // right-click — feed or full screen — must NEVER reach it; the clean copy is
  // what the browser saves.
  for (const shape of ["v3", "legacy", "old"]) {
    const row = { part: "full screen", engine, shape, ok: true };
    const retired = shape === "legacy";
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
        const ftarget = bare(await r.page.evaluate(() => window.__ctx));
        fr.contextMenuTarget = ftarget;
        const same = diff(before, after);
        fr.screenBeforeVsAfter = same.why;
        if (retired) {
          if (!ftarget || r.credited.includes(ftarget)) fail(fr, `feed right-click target is ${ftarget} — the retired -l4 credited file (or nothing)`);
        } else if (!ftarget || !r.credited.includes(ftarget)) fail(fr, `feed right-click target is ${ftarget} — not the credited file`);
        if (!same.same) fail(fr, `the feed card's pixels changed at the right-click: ${same.why}`);
        if (!retired && ftarget && r.store[ftarget]?.twin) {
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
      // A v2 set has no save target: the viewer holds the clean copy plainly (no layer).
      const sel = retired ? "[role=dialog] img[src*='-l4-']" : "[role=dialog] img[data-photo-shown]";
      await r.page.waitForSelector(sel, { timeout: 20_000 });
      await r.page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }, sel, { timeout: 30_000 });
      await r.page.waitForTimeout(1500); // the CSS background (clean copy) paints
      const img = await r.page.$(sel);
      const facts = await img.evaluate((i) => ({ src: i.currentSrc || i.src, shown: i.getAttribute("data-photo-shown") || i.currentSrc || i.src }));
      facts.src = bare(facts.src); facts.shown = bare(facts.shown);
      row.contextFile = name(facts.src);
      row.shownFile = name(facts.shown);
      const box = await img.boundingBox();
      // a real right-click on the middle of the photo
      await r.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      await r.page.waitForTimeout(300);
      const target = bare(await r.page.evaluate(() => window.__ctx));
      row.contextMenuTarget = target;
      if (retired) {
        if (!target || r.credited.includes(target)) fail(row, `right-click target is ${target} — the retired -l4 credited file (or nothing)`);
      } else if (!target || !r.credited.includes(target)) fail(row, `right-click target is ${target} — not the credited file`);
      if (!retired && target && r.store[target]?.twin) {
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
      const vsClean = diff(onScreen, cleanRef);
      row.onScreenVsClean = vsClean.why;
      if (!vsClean.same) fail(row, `the screen is not the clean copy: ${vsClean.why}`);
      if (!retired) {
        const creditRef = await draw(facts.src);
        const seen = await creditOnScreen(cleanRef, creditRef, img);
        row.cleanVsCredited = seen.why;
        if (!seen.seen) fail(row, `the credited file shows no credit here (${seen.why}) — the check would be vacuous`);
      }
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
  // OLD photo (20261110_0109): the web asks for its credited copy; the app —
  // which has no save at all — never asks.
  for (const app of [false, true]) {
    const r = await open(browser, { vp: "phone", app, dpr: 2, viewer: "on", size: "large", shape: "old" });
    const calls = await r.page.evaluate(() => globalThis.__oldCreditCalls ?? 0);
    const row = { part: "old photo lookup", app, ok: true, calls };
    if (app && calls !== 0) fail(row, `the app asked post_photo_credit_for ${calls} time(s) — the app has no save`);
    if (!app && calls < 1) fail(row, "the web never asked post_photo_credit_for — an old photo's save would stay clean");
    rows.push(row);
    console.log(`${row.ok ? "PASS" : "FAIL"} old photo lookup ${app ? "app" : "web"}: ${calls} call(s)${row.failed ? ` — ${row.failed.join("; ")}` : ""}`);
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
