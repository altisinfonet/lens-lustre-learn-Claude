#!/usr/bin/env node
/**
 * BUG 5 · THE COMMENTS LOAD-TIME INSTRUMENT — `node tools/uishot/comments-load-timing.mjs`.
 *
 * Owner, 15 Oct 2026: "comments take very long to load ('Loading comments…')".
 * This measures it on the REAL deployed site in a real browser, as an
 * anonymous reader of a public post (/post/:id is public by design, App.tsx):
 *
 *   t0  = the click on the post's comments button
 *   end = the first comment's text is visible inside the comments dialog
 *
 * and lists every request the page made in between (method, path, start and
 * end in ms after t0), so a waterfall reads as a staircase and an N+1 as a
 * column of the same path. Each run is a FRESH browser context — a member's
 * first open — and the page is left to go idle before the click, so nothing
 * the post page itself loads is counted against the comments.
 *
 *   --base https://staging.50mmretina.com   (default)
 *   --post <uuid>        a public post that has at least one comment (required)
 *   --text <string>      a substring of one of its comments (required)
 *   --runs 5             runs per reading (median reported)
 *   --rtt <ms>           add <ms> of latency to every request (Chromium CDP), to read
 *                        the same waterfall at a phone-network round trip
 *   --json <file>        write the reading
 *
 * Read-only: it opens a page and clicks the comments button. It signs nothing
 * in and writes nothing.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const BASE = arg("--base", "https://staging.50mmretina.com");
const POST = arg("--post", null);
const TEXT = arg("--text", null);
const RUNS = Number(arg("--runs", "5"));
const out = arg("--json", null);
const RTT = Number(arg("--rtt", "0"));
if (!POST || !TEXT) {
  console.error("--post <uuid> and --text <comment substring> are required");
  process.exit(2);
}

const shortPath = (u) => {
  const url = new URL(u);
  const q = url.search.length > 90 ? `${url.search.slice(0, 90)}…` : url.search;
  return `${url.host.split(".")[0]}${url.pathname}${q}`;
};

async function oneRun(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (RTT > 0) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: RTT, downloadThroughput: -1, uploadThroughput: -1 });
  }
  await page.goto(`${BASE}/post/${POST}`, { waitUntil: "networkidle", timeout: 90_000 });
  const button = page.locator('button[aria-label*="omment"]').first();
  await button.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1500); // let late post-page requests settle before t0

  /**
   * ALL TIMES ARE TAKEN INSIDE THE PAGE, on one clock (performance.now()):
   * t0 from a capture-phase click listener, the first comment from a
   * MutationObserver, the requests from Resource Timing. Playwright's own
   * waitFor polls on a back-off (up to 500 ms between looks), which rounded
   * the first reading of this instrument to ~900 ms whatever really happened.
   */
  await page.evaluate((text) => {
    const w = window;
    w.__cl = { t0: null, first: null, sawLoading: false };
    document.addEventListener("click", () => { if (w.__cl.t0 === null) w.__cl.t0 = performance.now(); }, { capture: true });
    const look = () => {
      if (w.__cl.t0 === null || w.__cl.first !== null) return;
      const d = document.querySelector('[role="dialog"]');
      if (!d) return;
      const body = d.textContent || "";
      if (body.includes("Loading comments…")) w.__cl.sawLoading = true;
      if (body.includes(text)) w.__cl.first = performance.now();
    };
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, TEXT);
  await button.click();
  await page.waitForFunction(() => window.__cl.first !== null, null, { timeout: 60_000, polling: 50 });
  await page.waitForTimeout(1500); // catch the requests that finish after the first paint
  const reading = await page.evaluate(() => {
    const { t0, first, sawLoading } = window.__cl;
    const res = performance
      .getEntriesByType("resource")
      .filter((e) => e.startTime >= t0 - 1)
      .map((e) => ({ url: e.name, start: Math.round(e.startTime - t0), end: Math.round(e.responseEnd - t0) }));
    return { firstCommentMs: Math.round(first - t0), sawLoading, res };
  });
  await ctx.close();
  const all = reading.res.map((e) => ({ path: shortPath(e.url), start: e.start, end: e.end, api: /supabase\.co/.test(e.url) }));
  const api = all.filter((x) => x.api).map(({ path, start, end }) => ({ path, start, end }));
  return {
    firstCommentMs: reading.firstCommentMs,
    sawLoadingText: reading.sawLoading,
    apiRequestsBeforeFirstComment: api.filter((x) => x.start <= reading.firstCommentMs).length,
    apiRequestsTotal: api.length,
    requests: api,
    otherRequestsBeforeFirstComment: all.filter((x) => !x.api && x.start <= reading.firstCommentMs).map(({ path, start, end }) => ({ path, start, end })),
  };
}

const browser = await chromium.launch();
const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await oneRun(browser);
  runs.push(r);
  console.log(`run ${i + 1}: first comment ${r.firstCommentMs} ms · ${r.apiRequestsBeforeFirstComment} API requests before it (${r.apiRequestsTotal} in all)`);
}
await browser.close();
const sorted = runs.map((r) => r.firstCommentMs).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
console.log(`\nmedian first comment: ${median} ms over ${RUNS} runs (min ${sorted[0]}, max ${sorted.at(-1)})`);
console.log("\nrun 1 waterfall (ms after the click):");
for (const q of runs[0].requests) console.log(`  ${String(q.start).padStart(5)} → ${String(q.end ?? "—").padStart(5)}  ${q.path}`);
if (runs[0].otherRequestsBeforeFirstComment.length) {
  console.log("\nnon-API requests before the first comment (run 1):");
  for (const q of runs[0].otherRequestsBeforeFirstComment) console.log(`  ${String(q.start).padStart(5)} → ${String(q.end ?? "—").padStart(5)}  ${q.path}`);
}
if (out) writeFileSync(out, JSON.stringify({ base: BASE, post: POST, runs: RUNS, addedLatencyMs: RTT, medianFirstCommentMs: median, at: new Date().toISOString(), detail: runs }, null, 2));
