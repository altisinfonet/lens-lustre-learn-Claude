#!/usr/bin/env node
/**
 * S6-d · the S6 gate, measured in a real browser against /s6harness.html:
 *   "_exclude_ids at page 100 = 0 · 1 channel · 0 unfiltered hot bindings ·
 *    ≤ 15 mounted cards after 30 pages"
 * Usage: node tools/uishot/s6-paging-harness.mjs --browsers chromium --json out.json
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox } from "playwright";

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const browsers = (arg("--browsers") ?? "chromium").split(",").map((s) => s.trim()).filter(Boolean);
const out = arg("--json");

function linuxChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
    const p = join(root, d, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}
const launch = {
  chromium: () => { const exe = linuxChromium(); return chromium.launch(exe ? { executablePath: exe } : {}); },
  chrome: () => chromium.launch({ channel: "chrome" }),
  msedge: () => chromium.launch({ channel: "msedge" }),
  firefox: () => firefox.launch(),
};

// The dev server is node itself (no shell), so it starts and stops the same way on every OS.
const server = spawn(process.execPath, [join("node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    VITE_SUPABASE_URL: "https://testprojectref0000x.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key-not-real",
    VITE_SUPABASE_PROJECT_ID: "testprojectref0000x",
    ...process.env,
  },
});
const serverLog = [];
server.stdout.on("data", (b) => { serverLog.push(String(b)); });
server.stderr.on("data", (b) => { serverLog.push(String(b)); });
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 180; i++) {
    if (server.exitCode !== null) throw new Error(`the dev server exited with code ${server.exitCode}`);
    try { const r = await fetch(`${BASE}/s6harness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

const sleep = (page, ms) => page.waitForTimeout(ms);
const HOT = new Set(["posts", "post_reactions", "post_comments", "post_shares"]);
/** Mounted cards: a card wrapper whose contents exist (a placeholder is empty). */
const mountedCards = (page) => page.evaluate(() =>
  [...document.querySelectorAll("[data-seen-post]")].filter((el) => (el.textContent ?? "").trim().length > 0).length);
const requestsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__s6.requests)));
/** Channels the client has joined and not left, with their postgres_changes bindings. */
const channelsOf = (page) => page.evaluate(() => {
  const open = new Map();
  for (const raw of window.__rtFrames ?? []) {
    let m; try { m = JSON.parse(raw); } catch { continue; }
    // supabase-js v2 frames: [join_ref, ref, topic, event, payload] or {topic, event, payload}
    const [topic, event, payload] = Array.isArray(m) ? [m[2], m[3], m[4]] : [m.topic, m.event, m.payload];
    if (event === "phx_join") open.set(topic, payload?.config?.postgres_changes ?? []);
    if (event === "phx_leave") open.delete(topic);
  }
  return [...open].map(([topic, bindings]) => ({ topic, bindings }));
});

async function scrollUntil(page, pages, r) {
  for (let i = 0; i < pages * 6; i++) {
    const n = (await requestsOf(page)).length;
    if (n >= pages) return n;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(page, 250);
  }
  return (await requestsOf(page)).length;
}

async function run(name) {
  const r = { browser: name, version: null, checks: {}, detail: {}, verdict: "FAIL" };
  const check = (key, ok, detail) => { r.checks[key] = !!ok; if (detail !== undefined) r.detail[key] = detail; };
  const browser = await launch[name]();
  r.version = browser.version();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/s6harness.html`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-seen-post]").length >= 10, null, { timeout: 120_000 });

    // ── 30 pages → at most 15 cards mounted
    const n30 = await scrollUntil(page, 30, r);
    await sleep(page, 1500);
    const mounted = await mountedCards(page);
    const wrappers = await page.evaluate(() => document.querySelectorAll("[data-seen-post]").length);
    check("S6_30_pages_reached", n30 >= 30, { requests: n30 });
    check("S6_mounted_cards_le_15_after_30_pages", n30 >= 30 && mounted <= 15, { mounted, wrappers });

    // ── 100 pages → page 100 uploads no _exclude_ids
    const n100 = await scrollUntil(page, 100, r);
    const reqs = await requestsOf(page);
    const p100 = reqs[99] ?? null;
    check("S6_100_pages_reached", n100 >= 100, { requests: n100 });
    check("S6_page_100_exclude_ids_0", !!p100 && p100.uploaded === 0, p100);

    // ── realtime: one feed-live channel, no unfiltered hot binding — read at
    // rest: after the 1.5 s rebuild debounce and the 5 s handover in which the
    // replaced channel is kept until its successor is subscribed (the fake
    // socket never answers a join, so the full 5 s applies here).
    await sleep(page, 7000);
    const chans = await channelsOf(page);
    const feedLive = chans.filter((c) => /^realtime:feed-live/.test(c.topic));
    const unfiltered = chans.flatMap((c) => (c.bindings ?? []).filter((b) => HOT.has(b.table) && !b.filter).map((b) => `${c.topic} ${b.table} ${b.event}`));
    check("S6_one_feed_live_channel", feedLive.length === 1, feedLive.map((c) => c.topic));
    check("S6_zero_unfiltered_hot_bindings", feedLive.length >= 1 && unfiltered.length === 0, unfiltered);

    r.verdict = Object.values(r.checks).every(Boolean) ? "PASS" : "FAIL";
    await ctx.close();
  } finally {
    await browser.close();
  }
  return r;
}

const result = { at: new Date().toISOString(), browsers: [], verdict: "FAIL" };
let code = 1;
try {
  await waitUp();
  for (const name of browsers) {
    if (!launch[name]) { result.browsers.push({ browser: name, verdict: "FAIL", error: "unknown browser" }); continue; }
    let r;
    try { r = await run(name); } catch (e) { r = { browser: name, verdict: "FAIL", error: String(e?.message ?? e).slice(0, 600) }; }
    result.browsers.push(r);
    const failed = Object.entries(r.checks ?? {}).filter(([, ok]) => !ok).map(([k]) => k);
    console.log(`[s6] ${name} ${r.version ?? ""}: ${r.verdict} — ${Object.keys(r.checks ?? {}).length - failed.length}/${Object.keys(r.checks ?? {}).length} checks${failed.length ? " — FAILED: " + failed.join(", ") : ""}${r.error ? " — ERROR: " + r.error.split("\n")[0] : ""}`);
    for (const k of failed) console.log(`[s6]   ${k}: ${JSON.stringify(r.detail?.[k] ?? null).slice(0, 400)}`);
  }
  result.verdict = result.browsers.length > 0 && result.browsers.every((b) => b.verdict === "PASS") ? "PASS" : "FAIL";
  code = result.verdict === "PASS" ? 0 : 1;
} catch (e) {
  result.error = String(e?.message ?? e);
  console.error(`[s6] FAILED: ${result.error}`);
  console.error(serverLog.join("").slice(-3000));
} finally {
  stop();
}
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(`[s6] verdict: ${result.verdict}`);
process.exit(code);
