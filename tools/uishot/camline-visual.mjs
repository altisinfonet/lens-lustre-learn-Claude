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
import { measureCardInk } from "./card-ink.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, "camline-baseline");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const UPDATE = process.argv.includes("--update");
/** Local runs only (another OS renders fonts differently): skip the picture comparison, keep every other check. */
const NO_BASELINE = process.argv.includes("--no-baseline");
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
  // Owner report 3 Nov: the slider dots close together, and NO empty band under
  // the photo when there is no camera line (switch OFF as on live, or no details).
  ["web-desktop-album", "post=c", DESKTOP, false],
  ["web-phone-album", "post=c&w=phone", PHONE, false],
  ["app-phone-album", "post=c&w=phone&app=1", PHONE, false],
  ["web-desktop-switch-off", "post=a&off=1", DESKTOP, false],
  ["web-phone-switch-off", "post=a&off=1&w=phone", PHONE, false],
  ["app-phone-switch-off", "post=a&off=1&w=phone&app=1", PHONE, false],
  ["web-phone-album-switch-off", "post=c&off=1&w=phone", PHONE, false],
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

/** A fixed, file-free "photo": a grey wall and a red floor, as in the approved mockup. */
const photoSvg = (hue, floorHue) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">`
  + `<stop offset="0%" stop-color="hsl(${hue} 8% 38%)"/><stop offset="35%" stop-color="hsl(${hue} 6% 64%)"/>`
  + `<stop offset="70%" stop-color="hsl(${hue} 6% 42%)"/><stop offset="100%" stop-color="hsl(${hue} 6% 26%)"/></linearGradient></defs>`
  + `<rect width="1200" height="800" fill="url(#g)"/><rect y="610" width="1200" height="190" fill="hsl(${floorHue} 60% 26%)"/></svg>`;

async function shoot(browser, s) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The harness photo host: every copy of a post's photo is the same fixed picture.
  await page.route("https://cdn.harness.test/**", (route) => {
    const river = route.request().url().includes("-river-");
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: photoSvg(river ? 200 : 30, river ? 220 : 0) });
  });
  // Audit M5 (no layout shift): from the moment the photo frame and the action
  // row both exist, the gap between them is sampled every frame. The camera
  // details arrive AFTER the card paints; the gap must never change for a
  // member (the line's height is reserved while they are read).
  await page.addInitScript(() => {
    const gaps = [];
    window.__camGaps = gaps;
    const tick = () => {
      const frame = document.querySelector("#cardwrap .cursor-zoom-in");
      const act = document.querySelector("#cardwrap [data-post-id] button[aria-label*='omment' i]");
      if (frame && act) gaps.push(Math.round(act.getBoundingClientRect().top - frame.getBoundingClientRect().bottom));
      if (gaps.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`${BASE}/camlineharness.html?${s.query}`);
  await page.waitForSelector("#cardwrap img", { timeout: 60_000 });
  const withCamera = /post=[ac]/.test(s.query) && !s.query.includes("off=1");
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
      gaps: [...new Set(window.__camGaps ?? [])],
      lastGap: (window.__camGaps ?? []).at(-1) ?? null,
      // centre-to-centre distances of the slider dots, px
      dotSteps: (() => {
        const d = [...document.querySelectorAll("#cardwrap [data-slider-dots] > *")].map((e) => { const b = e.getBoundingClientRect(); return b.left + b.width / 2; });
        return d.slice(1).map((x, i) => Math.round(x - d[i]));
      })(),
    };
  });
  // What the EYE sees under the photo (Owner, 3 Nov ~16:20Z): ink, not boxes.
  const ink = await measureCardInk(page, await page.$("#cardwrap [data-post-id]"));
  const card = await (await page.$("#cardwrap")).screenshot();
  const lineEl = await page.$("[data-camera-line]");
  const line = lineEl ? await lineEl.screenshot() : null;
  await ctx.close();
  return { card, line, dom, ink, errors };
}

/**
 * THE VISIBLE GAPS AND THE ONE LEFT EDGE (Owner report 3 Nov 2026 ~16:20Z).
 *
 * "Not done": the eye saw 13 px of empty card between the photo and the Like
 * icon and 17 px between the icons and the caption (measured on live, ink, 1280
 * and 390 px) — #846 had only measured the BOXES (0 px). And with the camera
 * line open, the camera icon (x 16), its 2nd line (x 36), the Like icon (x 17)
 * and the caption (x 12) started at four different places.
 *
 * Ink only — what the eye sees, never a box:
 *   photo → icons (no camera line)        4–7 px
 *   photo → camera line, line → icons     4–9 px each
 *   icons → caption                       6–11 px
 *   camera icon, its 2nd line, the Like icon: within 1.5 px of the caption's left edge
 */
function inkChecks(ink, { hasLine, opened }) {
  const g = ink.gaps;
  const L = ink.lefts;
  const within = (v, lo, hi) => typeof v === "number" && v >= lo && v <= hi;
  const lined = (v) => typeof v === "number" && typeof L.caption === "number" && Math.abs(v - L.caption) <= 1.5;
  const out = [
    [within(g.iconsToCaption, 6, 11), `icons → caption, visible: ${g.iconsToCaption} px (6–11)`],
    [lined(L.like), `the Like icon starts at the caption's left edge (Like ${L.like}, caption ${L.caption})`],
  ];
  if (hasLine) {
    out.push(
      [within(g.photoToCamera, 4, 9), `photo → camera line, visible: ${g.photoToCamera} px (4–9)`],
      [within(g.cameraToIcons, 4, 9), `camera line → icons, visible: ${g.cameraToIcons} px (4–9)`],
      [lined(L.cameraIcon), `the camera icon starts at the caption's left edge (camera ${L.cameraIcon}, caption ${L.caption})`],
    );
    if (opened) out.push([lined(L.cameraLine2), `the 2nd line starts under the camera icon, at the caption's left edge (2nd line ${L.cameraLine2}, caption ${L.caption})`]);
  } else {
    out.push([within(g.photoToIcons, 4, 7), `photo → icons, visible: ${g.photoToIcons} px (4–7)`]);
  }
  return out;
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
  delete row.gaps;
  row.shift = `gaps under the photo, in order seen: ${r.dom.gaps.join(" → ")} px`;
  // What every picture must show, whatever the baseline says.
  const hasLine = /post=[ac]/.test(s.query) && !s.query.includes("off=1");
  const isAlbum = s.query.includes("post=c");
  const admin = s.query.includes("admin=1");
  const checks = [
    [!r.dom.location, "no 'Location removed' text"],
    [hasLine ? r.dom.line?.startsWith("Nikon Z 6II · 24 mm · f/7.1 · 1/125 s · ISO 5000") : r.dom.line === null, hasLine ? "the clean one-line summary" : "nothing without camera details"],
    [!hasLine || r.dom.afterPhoto, "the line directly after the photo"],
    [!hasLine || r.dom.button === admin, admin ? "admins get the arrow" : "members: not clickable"],
    [!s.open || r.dom.expanded === "true", "opened"],
    [r.errors.length === 0, "no page errors"],
    // Members: once the switch answer is in (the first non-zero gap), the card
    // never jumps while the camera details are read — the line's height is
    // held. (Before the switch answer the line is absent: audit Unit B. A NEW
    // photo WITHOUT details gives its held height back once: reported, not
    // judged — it needs the details delivered with the feed page.) Admins grow
    // once, to their 44 px tap row.
    [admin || !hasLine || r.dom.gaps.filter((g) => g !== 0).length === 1, `no layout shift under the photo once the switch is known (gaps seen: ${r.dom.gaps.join(", ")} px)`],
    // Owner, 3 Nov: no camera line → NO empty space between the photo and Like / Comment / Share.
    [hasLine || r.dom.lastGap === 0, `no empty band under the photo without a camera line (last gap ${r.dom.lastGap} px)`],
    // Owner, 3 Nov: the slider dots close together (≤ 14 px apart, centre to centre).
    [!isAlbum || (r.dom.dotSteps.length === 2 && r.dom.dotSteps.every((x) => x > 0 && x <= 14)), `slider dots close together (steps ${r.dom.dotSteps.join(", ")} px)`],
    // Owner, 3 Nov ~16:20Z (screenshots 3 + 4): measured on VISIBLE pixels.
    ...inkChecks(r.ink, { hasLine, opened: s.open }),
  ];
  row.ink = { ...r.ink.gaps, lefts: r.ink.lefts };
  row.failed = checks.filter(([ok]) => !ok).map(([, what]) => what);
  if (UPDATE) {
    writeFileSync(file, r.card);
    row.baseline = "written";
  } else if (NO_BASELINE) {
    row.baseline = "not compared (--no-baseline)";
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

for (const r of rows) console.log(`${r.failed.length ? "FAIL" : "PASS"}  ${r.scene}${r.baseline ? `  [${r.baseline}]` : ""}${r.ink ? `\n      ink ${JSON.stringify(r.ink)}` : ""}${r.failed.length ? `\n      ✗ ${r.failed.join("\n      ✗ ")}` : ""}`);
console.log(pass ? "\nCAMERA LINE VISUAL: PASS" : "\nCAMERA LINE VISUAL: FAIL");
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ pass, rows }, null, 2));
process.exit(pass ? 0 : 1);
