#!/usr/bin/env node
/**
 * CAMERA LINE · VISUAL BASELINE — `node tools/uishot/camline-visual.mjs`
 *
 * Owner rule (2026-11-03): "showing one design and building another" is not
 * accepted. The pictures the Owner approves are photographed HERE, from the
 * REAL feed card (src/components/post/PostCard.tsx → CameraDetails.tsx) with
 * the REAL CSS, in a real Chromium, through camlineharness.html. They are
 * committed in tools/uishot/camline-baseline/, and every run compares the
 * screen with them: a later change to these screens fails CI until the Owner
 * approves new pictures (re-run with --update and commit them).
 *
 * It also proves "exact same to same in app and web": the camera line of the
 * Android shell (window.Capacitor) must be pixel-identical to the website's at
 * the same width, member and admin, closed and opened.
 *
 *   --update        write the baselines instead of comparing
 *   --out <dir>     also write every screenshot there (the Owner's PNGs)
 *   --json <file>   write the result
 *   --base <url>    use a running server (else starts Vite on 5194)
 *
 * Rendered with prefers-reduced-motion so the "lens focus" entry is already
 * finished (the end state is the same pixels) and nothing is mid-animation.
 * Baselines are made on the CI runner (ubuntu, its fonts): a picture taken on
 * another OS differs in font rendering and must not be committed.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, "camline-baseline");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const UPDATE = process.argv.includes("--update");
const OUT = arg("--out", null);
const JSON_OUT = arg("--json", null);
/** 5194: 5195–5199 belong to the other harnesses. */
const PORT = 5194;
const BASE = arg("--base", null) || `http://127.0.0.1:${PORT}`;
/** A pixel "differs" when any channel moves more than this (0–255). */
const CHANNEL = 40;
/** A picture "matches" when at most this share of its pixels differ (anti-aliasing noise). */
const SHARE = 0.002;

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
    try { const r = await fetch(`${BASE}/camlineharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Every view the Owner approves: web desktop / web phone / app, member + admin closed/opened, with and without camera details. */
const SCENES = [
  ["web-desktop-member", "post=a", DESKTOP, false],
  ["web-desktop-admin-closed", "post=a&admin=1", DESKTOP, false],
  ["web-desktop-admin-opened", "post=a&admin=1", DESKTOP, true],
  ["web-desktop-no-camera-details", "post=b", DESKTOP, false],
  ["web-phone-member", "post=a&w=phone", PHONE, false],
  ["web-phone-admin-closed", "post=a&admin=1&w=phone", PHONE, false],
  ["web-phone-admin-opened", "post=a&admin=1&w=phone", PHONE, true],
  ["web-phone-no-camera-details", "post=b&w=phone", PHONE, false],
  ["app-phone-member", "post=a&w=phone&app=1", PHONE, false],
  ["app-phone-admin-closed", "post=a&admin=1&w=phone&app=1", PHONE, false],
  ["app-phone-admin-opened", "post=a&admin=1&w=phone&app=1", PHONE, true],
  ["app-phone-no-camera-details", "post=b&w=phone&app=1", PHONE, false],
].map(([name, query, viewport, open]) => ({ name, query, viewport, open }));

/**
 * Pixel comparison, done by the browser itself (no image library to install):
 * both PNGs are decoded into canvases and every pixel is compared.
 */
let comparePage = null;
async function diff(aBuf, bBuf) {
  return comparePage.evaluate(async ({ a, b, channel, share }) => {
    const decode = async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, d: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
    };
    const x = await decode(a);
    const y = await decode(b);
    if (x.w !== y.w || x.h !== y.h) return { same: false, why: `size ${x.w}x${x.h} vs ${y.w}x${y.h}` };
    let bad = 0;
    for (let i = 0; i < x.d.length; i += 4) {
      if (Math.abs(x.d[i] - y.d[i]) > channel || Math.abs(x.d[i + 1] - y.d[i + 1]) > channel
        || Math.abs(x.d[i + 2] - y.d[i + 2]) > channel || Math.abs(x.d[i + 3] - y.d[i + 3]) > channel) bad++;
    }
    const s = bad / (x.w * x.h);
    return { same: s <= share, why: `${bad} px differ (${(s * 100).toFixed(3)} %)` };
  }, { a: aBuf.toString("base64"), b: bBuf.toString("base64"), channel: CHANNEL, share: SHARE });
}

async function shoot(browser, s) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/camlineharness.html?${s.query}`);
  await page.waitForSelector("#cardwrap img", { timeout: 60_000 });
  const withCamera = s.query.includes("post=a");
  if (withCamera) await page.waitForSelector("[data-camera-line]", { timeout: 30_000 });
  // The admin answer waits for the dashboard bootstrap (≤ 3.5 s): wait it out
  // for EVERY scene, so a member scene is photographed after it too.
  if (s.query.includes("admin=1")) await page.waitForSelector("[data-camera-line] button", { timeout: 30_000 });
  await page.waitForTimeout(4500);
  if (s.open) {
    await page.click("[data-camera-line] button");
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => document.fonts.ready);
  const dom = await page.evaluate(() => {
    const l = document.querySelector("[data-camera-line]");
    return {
      line: l ? l.textContent : null,
      button: !!l?.querySelector("button"),
      expanded: l?.querySelector("button")?.getAttribute("aria-expanded") ?? null,
      location: /Location removed|owner can hide this|Location is always removed/.test(document.body.textContent ?? ""),
      afterPhoto: l ? !!l.previousElementSibling?.querySelector(".cursor-zoom-in") : null,
    };
  });
  const card = await (await page.$("#cardwrap")).screenshot();
  const lineEl = await page.$("[data-camera-line]");
  const line = lineEl ? await lineEl.screenshot() : null;
  await ctx.close();
  return { card, line, dom, errors };
}

await waitUp();
const browser = await chromium.launch();
comparePage = await browser.newPage();
await comparePage.goto(`${BASE}/camlineharness.html?compare=1`).catch(() => {});
const rows = [];
const shots = {};
let pass = true;
if (UPDATE) mkdirSync(BASELINE, { recursive: true });
if (OUT) mkdirSync(OUT, { recursive: true });
for (const s of SCENES) {
  const r = await shoot(browser, s);
  shots[s.name] = r;
  const file = join(BASELINE, `${s.name}.png`);
  if (OUT) writeFileSync(join(OUT, `${s.name}.png`), r.card);
  const row = { scene: s.name, ...r.dom, errors: r.errors };
  // What every picture must show, whatever the baseline says.
  const hasLine = s.query.includes("post=a");
  const admin = s.query.includes("admin=1");
  const checks = [
    [!r.dom.location, "no 'Location removed' text"],
    [hasLine ? r.dom.line?.startsWith("Nikon Z 6II · 24 mm · f/7.1 · 1/125 s · ISO 5000") : r.dom.line === null, hasLine ? "the clean one-line summary" : "nothing without camera details"],
    [!hasLine || r.dom.afterPhoto, "the line directly after the photo"],
    [!hasLine || r.dom.button === admin, admin ? "admins get the arrow" : "members: not clickable"],
    [!s.open || r.dom.expanded === "true", "opened"],
    [r.errors.length === 0, "no page errors"],
  ];
  row.failed = checks.filter(([ok]) => !ok).map(([, what]) => what);
  if (UPDATE) {
    writeFileSync(file, r.card);
    row.baseline = "written";
  } else if (!existsSync(file)) {
    row.failed.push("no approved baseline — run with --update on the CI runner and commit it");
  } else {
    const d = await diff(readFileSync(file), r.card);
    row.baseline = d.why;
    if (!d.same) row.failed.push(`differs from the approved picture: ${d.why}`);
  }
  if (row.failed.length) pass = false;
  rows.push(row);
}
// Exact same to same: the app's camera line == the website's, at 390 px.
for (const v of ["member", "admin-closed", "admin-opened"]) {
  const web = shots[`web-phone-${v}`].line;
  const app = shots[`app-phone-${v}`].line;
  const d = web && app ? await diff(web, app) : { same: false, why: "a line is missing" };
  const row = { scene: `app == web (${v}, 390 px camera line)`, baseline: d.why, failed: d.same ? [] : [`app and web differ: ${d.why}`] };
  if (!d.same) pass = false;
  rows.push(row);
}
await browser.close();
stop();

for (const r of rows) console.log(`${r.failed.length ? "FAIL" : "PASS"}  ${r.scene}${r.baseline ? `  [${r.baseline}]` : ""}${r.failed.length ? `\n      ✗ ${r.failed.join("\n      ✗ ")}` : ""}`);
console.log(pass ? "\nCAMERA LINE VISUAL: PASS" : "\nCAMERA LINE VISUAL: FAIL");
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ pass, rows }, null, 2));
process.exit(pass ? 0 : 1);
