#!/usr/bin/env node
/**
 * SHARED-PIECE VISUAL BASELINES — `node tools/uishot/ui-baselines.mjs`
 *
 * Central-control plan, unit B1 (Owner, 4 Nov 2026: one change, every screen).
 * The REAL PostCard, photo grid, CommentThread, action row, user line and
 * notification rows are photographed through baselinesharness.html at 320, 390
 * and 1280 px on the web and in the Android shell, and compared with the
 * pictures in tools/uishot/ui-baselines/. More than 0.1 % of a picture changed
 * fails CI, so "fixed here, broke there" cannot pass unseen.
 *
 * THE SELF-TEST runs on every comparing run: for every piece, at web-390, one
 * element is moved by 1 px with nothing else touched, and the comparison must
 * call that picture different. A comparison that cannot see 1 px fails here.
 *
 *   --update        write the baselines instead of comparing
 *   --out <dir>     also write every screenshot there
 *   --json <file>   write the result
 *   --base <url>    use a running server (else starts Vite on 5193)
 *   --no-baseline   local runs only: photograph, skip the comparison
 *
 * Baselines are made on the CI runner (ubuntu, its fonts): every run uploads
 * its screenshots, and a picture from another OS must not be committed. A
 * deliberate visible change replaces the PNGs with that run's, in the same PR,
 * after the Owner approves them.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { comparePixels } from "./pixel-compare.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, "ui-baselines");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const UPDATE = process.argv.includes("--update");
const NO_BASELINE = process.argv.includes("--no-baseline");
const OUT = arg("--out", null);
const JSON_OUT = arg("--json", null);
/** 5193: 5194–5199 belong to the other harnesses. */
const PORT = 5193;
const BASE = arg("--base", null) || `http://127.0.0.1:${PORT}`;

/** The plan's limit: more than 0.1 % of the picture changed fails. */
const LIMITS = { channel: 16, share: 0.001, tile: { size: 48, share: 0.04 } };
const PIECES = ["postcard", "photogrid", "commentthread", "actionrow", "userline", "notificationrow"];
const WIDTHS = [
  { name: "web-320", width: 320, height: 800 },
  { name: "web-390", width: 390, height: 844 },
  { name: "web-1280", width: 1280, height: 900 },
  { name: "app-390", width: 390, height: 844, app: true },
];
/** The self-test's width. */
const SELFTEST_WIDTH = "web-390";

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
    try { const r = await fetch(`${BASE}/baselinesharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

/**
 * The harness "photo": a fine diagonal pattern (no flat area, sharp edges), so
 * a 1 px move changes pixels everywhere. A smooth picture would hide the move.
 */
const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="32" height="32" fill="#59626b"/><rect width="10" height="32" fill="#c9b48a"/><rect x="18" width="5" height="32" fill="#22303a"/></pattern></defs><rect width="1200" height="800" fill="url(#p)"/></svg>`;
const FACE = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#7a5c48"/><circle cx="80" cy="62" r="34" fill="#e0c3a4"/><rect x="30" y="108" width="100" height="60" fill="#3f6b7a"/></svg>`;

async function openPiece(browser, piece, w) {
  const ctx = await browser.newContext({
    viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Nothing outside the dev server and the harness photo host: a run depends on no network.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith("data:")) return route.continue();
    if (url.startsWith("https://cdn.harness.test/")) {
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: url.includes("/avatars/") ? FACE : PHOTO });
    }
    return route.abort();
  });
  await page.goto(`${BASE}/baselinesharness.html?piece=${piece}${w.app ? "&app=1" : ""}`, { timeout: 180_000 });
  await page.waitForSelector("[data-baseline]", { timeout: 60_000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  return { ctx, page, errors };
}

/** Every variant of the piece, once its picture has stopped changing. */
async function shootVariants(page) {
  const names = await page.$$eval("[data-baseline]", (els) => els.map((e) => e.getAttribute("data-baseline")));
  const shots = {};
  for (const name of names) {
    const el = await page.$(`[data-baseline="${name}"]`);
    let last = await el.screenshot();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(300);
      const now = await el.screenshot();
      const settled = now.equals(last);
      last = now;
      if (settled) break;
    }
    shots[name] = last;
  }
  return shots;
}

/**
 * Moves one small thing by 1 px and nothing else: the first text in the
 * variant, or its first picture or icon when it has no text. `position: relative`
 * keeps the layout as it was, so the picture keeps its size.
 */
const moveOnePixel = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let target = null;
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (walker.currentNode.textContent.trim() && el.getBoundingClientRect().width > 0) { target = el; break; }
  }
  target ??= root.querySelector("img, svg");
  if (!target) throw new Error("nothing to move");
  target.style.position = "relative";
  target.style.left = "1px";
  return target.textContent.trim().slice(0, 24) || target.tagName;
};

const fileOf = (variant, widthName) => `${variant}--${widthName}.png`;

await waitUp();
const browser = await chromium.launch();
const rows = [];
const seen = new Set();
const selftest = {};
if (UPDATE) { rmSync(BASELINE, { recursive: true, force: true }); mkdirSync(BASELINE, { recursive: true }); }
if (OUT) mkdirSync(OUT, { recursive: true });
for (const piece of PIECES) {
  for (const w of WIDTHS) {
    const { ctx, page, errors } = await openPiece(browser, piece, w);
    const shots = await shootVariants(page);
    if (Object.keys(shots).length === 0) rows.push({ scene: `${piece} ${w.name}`, failed: ["no variant drawn"] });
    for (const [variant, png] of Object.entries(shots)) {
      const name = fileOf(variant, w.name);
      seen.add(name);
      const file = join(BASELINE, name);
      const row = { scene: name, failed: [...errors.map((e) => `page error: ${e}`)] };
      if (OUT) writeFileSync(join(OUT, name), png);
      if (UPDATE) {
        writeFileSync(file, png);
        row.baseline = "written";
      } else if (NO_BASELINE) {
        row.baseline = "not compared (--no-baseline)";
      } else if (!existsSync(file)) {
        row.failed.push("no baseline: take this run's PNG from the CI artifact and commit it");
      } else {
        const d = await comparePixels(readFileSync(file), png, LIMITS);
        row.baseline = d.why;
        if (!d.same) row.failed.push(`differs from the baseline: ${d.why}`);
      }
      rows.push(row);
    }
    // THE SELF-TEST: the same comparison must call a 1 px move a difference.
    if (w.name === SELFTEST_WIDTH) {
      for (const [variant, png] of Object.entries(shots)) {
        const moved = await page.$eval(`[data-baseline="${variant}"]`, moveOnePixel);
        const d = await comparePixels(png, await (await page.$(`[data-baseline="${variant}"]`)).screenshot(), LIMITS);
        await page.$eval(`[data-baseline="${variant}"]`, (root) => {
          for (const el of root.querySelectorAll("*")) if (el.style.left === "1px") { el.style.left = ""; el.style.position = ""; }
        });
        selftest[variant] = d;
        rows.push({
          scene: `self-test ${variant}: "${moved}" moved 1 px`, baseline: d.why,
          failed: d.same ? [`the comparison did not see a 1 px move: ${d.why}`] : [],
        });
      }
    }
    await ctx.close();
  }
}
await browser.close();
stop();
// A piece at any width with no picture, or a picture no piece draws any more.
if (!UPDATE && !NO_BASELINE && existsSync(BASELINE)) {
  const stale = readdirSync(BASELINE).filter((f) => f.endsWith(".png") && !seen.has(f));
  rows.push({ scene: "every baseline is still drawn", baseline: `${stale.length} stale`, failed: stale.map((f) => `stale baseline: ${f}`) });
}

const pass = rows.every((r) => r.failed.length === 0);
for (const r of rows) console.log(`${r.failed.length ? "FAIL" : "PASS"}  ${r.scene}${r.baseline ? `  [${r.baseline}]` : ""}${r.failed.length ? `\n      x ${r.failed.join("\n      x ")}` : ""}`);
console.log(pass ? "\nUI BASELINES: PASS" : "\nUI BASELINES: FAIL");
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ pass, rows }, null, 2));
process.exit(pass ? 0 : 1);
