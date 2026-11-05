#!/usr/bin/env node
/**
 * EVERY FEED PHOTO ON SCREEN IN UNDER 1 SECOND — `node tools/uishot/photo-feed-speed.mjs`
 *
 * Owner rule (5 Nov 2026): "Plan always will be photo must come in App less
 * than 1 sec", like Instagram — measured on a slow phone link, not a fast desk.
 * Real Chromium opens photofeedharness.html (REAL uploader encoder, REAL feed
 * card) as a phone: 390 px wide, DPR 3, all photo files sharing ONE 100 KB/s link
 * after 150 ms of latency. For each photo shape it measures the time from the
 * card's photo frame appearing to the FIRST photo layer (the small preview or
 * the sharp copy) having loaded, and fails above SPEED_LIMIT_MS:
 *   v3 (`-l5`), legacy (`-l4`), old (unmarked, with the backfill's clean
 *   copies named by post_photo_feed_copies) — and for "old" the feed must
 *   never download the original.
 * "old, no copies" (an old photo the backfill never reached) is measured and
 * reported, not gated: it has no small copy at all.
 *
 *   --base <url>   use a running server (else starts Vite on 5194)
 *   --json <file>  write the result
 */
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const PORT = 5194;
const BASE = arg("--base", null) || `http://127.0.0.1:${PORT}`;
const JSON_OUT = arg("--json", null);
/** THE LIMIT. */
export const SPEED_LIMIT_MS = 1000;
/** The slow phone link: 100 KB/s after 150 ms (Owner's measured link, 5 Nov 2026: 86–110 KB/s). */
const BYTES_PER_S = 100_000;
const LATENCY_MS = 150;

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
for (let i = 0; i < 180; i++) {
  try { const r = await fetch(`${BASE}/photofeedharness.html`); if (r.ok) break; } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 1000));
}

/** Installed before the page runs: when the photo frame appears, and when its first photo layer loads. */
const PROBE = () => {
  const w = window;
  w.__speed = { frameAt: null, firstAt: null, firstSrc: null };
  const watch = (img) => {
    if (img.__watched || img.closest("[data-feed-photo]") === null) return;
    // The blurred fill is decoration, not the photo: it does not count.
    if (img.getAttribute("aria-hidden") === "true" && !img.hasAttribute("data-feed-preview")) return;
    img.__watched = true;
    const done = () => { if (w.__speed.firstAt === null && img.naturalWidth > 0) { w.__speed.firstAt = performance.now(); w.__speed.firstSrc = img.currentSrc || img.src; } };
    if (img.complete) done(); else img.addEventListener("load", done, { once: true });
  };
  new MutationObserver(() => {
    const frame = document.querySelector("#cardwrap [data-feed-photo]");
    if (frame && w.__speed.frameAt === null) w.__speed.frameAt = performance.now();
    document.querySelectorAll("#cardwrap [data-feed-photo] img").forEach(watch);
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
};

const shapes = [
  { key: "v3", qs: "", gate: true },
  { key: "legacy", qs: "&legacy=1", gate: true },
  { key: "old", qs: "&old=1", gate: true, noOriginal: true },
  { key: "old, no copies", qs: "&old=1&nocopies=1", gate: false },
];
const browser = await chromium.launch();
const rows = [];
let pass = true;
for (const s of shapes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.addInitScript(PROBE);
  const requested = [];
  let pipeFreeAt = 0;
  await page.route("https://cdn.harness.test/**", async (route) => {
    const url = route.request().url().replace(/\?.*$/, "");
    requested.push(url);
    const hit = await page.evaluate((u) => window.__photoStore?.[u] ?? null, url).catch(() => null);
    if (!hit) return route.fulfill({ status: 404, body: "" });
    const body = Buffer.from(hit.b64, "base64");
    // ONE shared link (review of #918: per-request delays let every file have
    // the whole 100 KB/s). Files are served one after another in the order the
    // page asked for them, so a big file asked first delays the small one.
    const start = Math.max(Date.now() + LATENCY_MS, pipeFreeAt);
    pipeFreeAt = start + (body.length / BYTES_PER_S) * 1000;
    await new Promise((r) => setTimeout(r, pipeFreeAt - Date.now()));
    return route.fulfill({ status: 200, contentType: hit.type, headers: { "Access-Control-Allow-Origin": "*" }, body });
  });
  const row = { shape: s.key, ok: true };
  try {
    await page.goto(`${BASE}/photofeedharness.html?viewer=out&w=phone${s.qs}`, { timeout: 300_000 });
    await page.waitForFunction(() => window.__photoReady === true, null, { timeout: 300_000 });
    await page.waitForFunction(() => window.__speed?.firstAt !== null, null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const sp = await page.evaluate(() => window.__speed);
    const store = await page.evaluate(() => window.__photoStore);
    row.ms = sp.firstAt !== null && sp.frameAt !== null ? Math.round(sp.firstAt - sp.frameAt) : null;
    row.first = sp.firstSrc ? sp.firstSrc.split("/").pop() : null;
    row.firstKB = sp.firstSrc && store[sp.firstSrc.replace(/\?.*$/, "")] ? Math.round((store[sp.firstSrc.replace(/\?.*$/, "")].b64.length * 0.75) / 1024) : null;
    if (s.gate && (row.ms === null || row.ms > SPEED_LIMIT_MS)) { row.ok = false; row.why = `first photo after ${row.ms ?? "never"} ms (limit ${SPEED_LIMIT_MS})`; }
    if (s.noOriginal) {
      // Wait for the sharp copy too, then check the original was never asked for.
      await page.waitForTimeout(6000);
      const orig = requested.filter((u) => /\/1700000000000-IMG_0001\.webp$/.test(u));
      row.originalRequested = orig.length;
      if (orig.length) { row.ok = false; row.why = `${row.why ? row.why + "; " : ""}the feed downloaded the original`; }
    }
  } catch (e) {
    row.ok = false; row.why = `threw: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!row.ok && s.gate) pass = false;
  rows.push(row);
  console.log(`${row.ok ? "PASS" : s.gate ? "FAIL" : "INFO"} ${s.key}: first photo in ${row.ms ?? "?"} ms (${row.first ?? "none"}, ${row.firstKB ?? "?"} KB)${row.why ? ` — ${row.why}` : ""}`);
  await ctx.close();
}
await browser.close();
stop();
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ pass, limitMs: SPEED_LIMIT_MS, link: `${BYTES_PER_S / 1000} KB/s + ${LATENCY_MS} ms`, rows }, null, 2));
console.log(pass ? "FEED PHOTO SPEED: PASS" : "FEED PHOTO SPEED: FAIL");
process.exit(pass ? 0 : 1);
