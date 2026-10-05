#!/usr/bin/env node
/**
 * OFF-6 · THE OFFLINE CI HARNESS — `node tools/uishot/offline-harness.mjs`.
 *
 * R-90: "CI harness. App starts offline → cached feed shown. A like made
 * offline → delivered once online, exactly once."
 *
 * LEG 1 (this file proves it): a real Chromium loads the REAL Feed screen
 * (offlineharness.html → src/uiharness/offline/main.tsx) online against the
 * harness fake backend, so OFF-1 writes the feed to IndexedDB. The feed's old
 * localStorage page is then deleted (so it cannot be what answers), and the app
 * is started again with NO data network. The fixture post's caption must be on
 * screen. CONTROL: the same offline start WITHOUT the OFF-1 bridge must NOT
 * show it — if the control shows it, the harness is measuring the wrong thing
 * and fails.
 *
 * LEG 2 (OFF-2): with no data network, the member taps Like on the fixture
 * post through the REAL Feed screen (twice: the fixture post is already liked,
 * so it is unlike-then-like, which must collapse to ONE queued like, R5). The like must be kept ON THE DEVICE (the
 * outbox, IndexedDB `retina-outbox`), survive the app being closed, and when
 * the app starts again online it must reach the server EXACTLY ONCE — while
 * the server is made to lose the answer to the first two sends (`lose=2`: each
 * one commits, then the fetch throws), so the outbox has to send it 3 times.
 * The server is fakeTables.ts: it enforces staging's unique constraints, so a
 * repeat that is not harmless shows up as a second row. Pass = 1 row, ≥3
 * sends, outbox empty. Fails first on the pre-OFF-2 app: React Query pauses
 * the like in memory, the restart loses it, and the server gets 0 rows.
 *
 * Starts its own Vite dev server like gate.mjs; exit code = the verdict.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
const SENTINEL = "Morning fog on the river";
const out = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
    const p = join(root, d, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}

const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
const stop = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ } };
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch(`${BASE}/offlineharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

const result = { at: new Date().toISOString(), seedShown: false, storedFeed: false, offlineShown: false, controlShown: null,
  offlineLike: { tapped: false, queuedOnDevice: null, serverRows: null, sends: null, outboxLeft: null, log: null }, verdict: "FAIL" };

const readOutbox = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open("retina-outbox");
  req.onerror = () => resolve([]);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("items")) return resolve([]);
    const all = db.transaction("items").objectStore("items").getAll();
    all.onsuccess = () => resolve(all.result.map((i) => ({ kind: i.action.kind, key: i.key, attempts: i.attempts })));
    all.onerror = () => resolve([]);
  };
}));
let code = 1;
try {
  await waitUp();
  const exe = chromePath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // 1) online: the feed loads and OFF-1 stores it
  await page.goto(`${BASE}/offlineharness.html?phase=seed`, { waitUntil: "load" });
  await page.getByText(SENTINEL, { exact: false }).first().waitFor({ timeout: 60_000 });
  result.seedShown = true;
  await page.waitForTimeout(2000); // OFF-1 write debounce is 800 ms
  result.storedFeed = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("retina-offline");
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) return resolve(false);
      const all = db.transaction("kv").objectStore("kv").getAll();
      all.onsuccess = () => resolve(all.result.some((r) => Array.isArray(r.key) && r.key[0] === "feed"));
      all.onerror = () => resolve(false);
    };
  }));
  // the pre-OFF-1 cache must not be what answers next
  await page.evaluate(() => localStorage.removeItem("feed_cache_v1"));

  // 2) the app starts with no data network
  await page.goto(`${BASE}/offlineharness.html?phase=offline`, { waitUntil: "load" });
  result.offlineShown = await page.getByText(SENTINEL, { exact: false }).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);

  // 3) control: same start without the bridge
  await page.evaluate(() => localStorage.removeItem("feed_cache_v1"));
  await page.goto(`${BASE}/offlineharness.html?phase=offline&nobridge=1`, { waitUntil: "load" });
  await page.waitForTimeout(6000);
  result.controlShown = (await page.getByText(SENTINEL, { exact: false }).count()) > 0;

  // 4) LEG 2 — offline again, tap Like on the fixture post (the real button)
  await page.goto(`${BASE}/offlineharness.html?phase=offline`, { waitUntil: "load" });
  await page.getByText(SENTINEL, { exact: false }).first().waitFor({ timeout: 20_000 });
  result.offlineLike.tapped = await page.evaluate((sentinel) => {
    const cap = [...document.querySelectorAll("p, span, div")].find((el) => el.children.length === 0 && el.textContent.includes(sentinel));
    let card = cap;
    while (card && !card.querySelector("button[aria-label][title] svg")) card = card.parentElement;
    const commentBtn = card && [...card.querySelectorAll("button[aria-label]")].find((b) => b.querySelector("svg") && /comment/i.test(b.getAttribute("aria-label") || ""));
    const like = commentBtn && commentBtn.parentElement.querySelector("div.relative > button");
    if (!like) return false;
    window.__off6like = like;
    return true;
  }, SENTINEL);
  // The fixture member has ALREADY liked this post, so the first tap is an
  // unlike and the second a like: two actions offline that must collapse to
  // the last intent (OFF-5 R5) — ONE "like" on the device.
  if (result.offlineLike.tapped) {
    await page.evaluate(() => window.__off6like.click());
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__off6like.click());
  }
  await page.waitForTimeout(1500);
  const queued = await readOutbox(page);
  result.offlineLike.queuedOnDevice = queued.length === 1 && queued[0].kind === "react";

  // 5) the app is closed and started again, ONLINE; the server loses the first two answers
  await page.goto(`${BASE}/offlineharness.html?phase=reconnect&lose=2`, { waitUntil: "load" });
  await page.getByText(SENTINEL, { exact: false }).first().waitFor({ timeout: 20_000 });
  for (let i = 0; i < 30; i++) {
    if ((await readOutbox(page)).length === 0) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(500);
  const server = await page.evaluate(() => {
    const s = window.__off6server;
    return s ? { rows: s.rows("post_reactions").length, log: [...s.log] } : null;
  });
  result.offlineLike.serverRows = server ? server.rows : null;
  result.offlineLike.log = server ? server.log : null;
  result.offlineLike.sends = server ? server.log.filter((l) => l.startsWith("POST post_reactions")).length : null;
  result.offlineLike.outboxLeft = (await readOutbox(page)).length;

  await browser.close();
  const leg1 = result.seedShown && result.storedFeed && result.offlineShown && result.controlShown === false;
  const L = result.offlineLike;
  const leg2 = L.tapped && L.queuedOnDevice && L.serverRows === 1 && L.sends >= 3 && L.outboxLeft === 0;
  result.verdict = leg1 && leg2 ? "PASS (leg 1 + leg 2)" : `FAIL (leg 1 ${leg1 ? "pass" : "FAIL"}, leg 2 ${leg2 ? "pass" : "FAIL"})`;
  code = leg1 && leg2 ? 0 : 1;
} catch (e) {
  result.error = String(e && e.message ? e.message : e);
} finally {
  stop();
}
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
process.exit(code);
