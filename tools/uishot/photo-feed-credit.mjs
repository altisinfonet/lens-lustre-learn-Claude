#!/usr/bin/env node
/**
 * PHOTO FEED · "THE FEED NEVER LOADS A CREDITED FILE" — `node tools/uishot/photo-feed-credit.mjs`
 *
 * Photo plan Unit A (audit B1, B2, M6). A real Chromium opens
 * photofeedharness.html: a photo made by the REAL uploader encoder with the
 * REAL names, shown in the REAL feed card. Every request the page makes to the
 * photo host is recorded. A file is "credited" when its PIXELS carry the credit
 * (the harness compares each copy with a twin encoded with an empty credit), so
 * a wrong naming rule cannot hide a credited file.
 *
 * Matrix: DPR 1, 1.5, 2, 3 × desktop 1280 / phone 390 × viewer on / late
 * (switch answer after the first paint) / off / signed out, for a large photo
 * and a 601–1080 px photo (?small=1). FAIL = any feed request for a credited file.
 * Then full screen is opened once (desktop, DPR 2, viewer on) and must show the
 * credited 2048 when the switch is on — the credit belongs there.
 *
 *   --out <dir>     write the PNGs (feed card + full screen) and the request log
 *   --json <file>   write the result
 *   --photo <file>  use this photo instead of the generated scene (PNGs only; never committed)
 *   --base <url>    use a running server (else starts Vite on 5193)
 */
import { spawn, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg("--out", null);
const JSON_OUT = arg("--json", null);
const PHOTO = arg("--photo", null);
const PORT = 5193;
const BASE = arg("--base", null) || `http://127.0.0.1:${PORT}`;

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
const DPRS = [1, 1.5, 2, 3];
const VIEWERS = ["on", "late", "off", "out"];
const SIZES = ["large", "small"];
const photoBytes = PHOTO ? readFileSync(PHOTO) : null;

async function open(browser, { vp, dpr, viewer, size }) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: dpr, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const requested = [];
  if (photoBytes) {
    await page.route("https://photo.harness.test/**", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: photoBytes }));
  }
  await page.route("https://cdn.harness.test/**", async (route) => {
    const url = route.request().url();
    requested.push(url);
    const hit = await page.evaluate((u) => window.__photoStore?.[u] ?? null, url).catch(() => null);
    if (!hit) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: hit.type, body: Buffer.from(hit.b64, "base64") });
  });
  const qs = new URLSearchParams({ viewer, ...(vp === "phone" ? { w: "phone" } : {}), ...(size === "small" ? { small: "1" } : {}), ...(photoBytes ? { src: "https://photo.harness.test/source.jpg" } : {}) });
  await page.goto(`${BASE}/photofeedharness.html?${qs}`);
  await page.waitForFunction(() => window.__photoReady === true, null, { timeout: 90_000 });
  await page.waitForSelector("#cardwrap img", { timeout: 60_000 });
  // Past the late switch answer (6 s) and its re-render, with time to fetch.
  await page.waitForTimeout(viewer === "late" ? 9000 : 4000);
  const store = await page.evaluate(() => window.__photoStore);
  const shown = await page.evaluate(() => [...document.querySelectorAll("#cardwrap img")].map((i) => i.currentSrc).filter(Boolean));
  return { ctx, page, requested, store, shown, errors };
}

await waitUp();
const browser = await chromium.launch();
if (OUT) mkdirSync(OUT, { recursive: true });
const rows = [];
let pass = true;
for (const size of SIZES) {
  for (const vp of Object.keys(VIEWPORTS)) {
    for (const dpr of DPRS) {
      for (const viewer of VIEWERS) {
        const r = await open(browser, { vp, dpr, viewer, size });
        const credited = Object.values(r.store).filter((s) => s.credited).map((s) => s.url);
        const bad = [...new Set(r.requested.filter((u) => credited.includes(u)))];
        const row = { size, vp, dpr, viewer, ok: bad.length === 0 && credited.length > 0, credited, badRequests: bad, shown: r.shown, errors: r.errors };
        if (credited.length === 0) row.why = "the encoder produced no credited copy — the check would be vacuous";
        if (!row.ok) pass = false;
        rows.push(row);
        console.log(`${row.ok ? "PASS" : "FAIL"} ${size} ${vp} dpr ${dpr} viewer ${viewer}${bad.length ? ` — feed loaded credited ${bad.map((u) => u.split("/").pop()).join(", ")}` : ""}`);
        if (OUT && size === "large" && dpr === 2 && viewer === "on") {
          writeFileSync(join(OUT, `feed-card-${vp}-dpr2.png`), await (await r.page.$("#cardwrap")).screenshot());
        }
        await r.ctx.close();
      }
    }
  }
}

// Full screen (desktop, DPR 2, switch on): the credited 2048 belongs HERE.
{
  const r = await open(browser, { vp: "desktop", dpr: 2, viewer: "on", size: "large" });
  const before = r.requested.length;
  await r.page.click("#cardwrap .cursor-zoom-in");
  await r.page.waitForTimeout(3000);
  const credited = Object.values(r.store).filter((s) => s.credited).map((s) => s.url);
  const fs = r.requested.slice(before);
  const row = { fullScreen: true, requested: fs, showsCredited: fs.some((u) => credited.includes(u)) };
  rows.push(row);
  console.log(`${row.showsCredited ? "PASS" : "FAIL"} full screen shows the credited 2048 (${fs.map((u) => u.split("/").pop()).join(", ") || "nothing requested"})`);
  if (!row.showsCredited) pass = false;
  if (OUT) {
    await r.page.screenshot({ path: join(OUT, "full-screen-desktop-dpr2.png") });
    const credUrl = credited[0];
    if (credUrl) writeFileSync(join(OUT, `credited-2048-${credUrl.split("/").pop()}`), Buffer.from(r.store[credUrl].b64, "base64"));
  }
  await r.ctx.close();
}

await browser.close();
stop();
const result = { pass, rows };
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));
console.log(pass ? "PHOTO FEED CREDIT: PASS" : "PHOTO FEED CREDIT: FAIL");
process.exit(pass ? 0 : 1);
