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
 * LEG 2 (offline like, delivered exactly once) is BLOCKED on OFF-2 — the
 * outbox and D1's server-side idempotency keys do not exist yet. It is
 * reported as BLOCKED in the output, never as a pass.
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

const result = { at: new Date().toISOString(), seedShown: false, storedFeed: false, offlineShown: false, controlShown: null, offlineLike: "BLOCKED on OFF-2 (outbox + D1 idempotency keys)", verdict: "FAIL" };
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

  await browser.close();
  const ok = result.seedShown && result.storedFeed && result.offlineShown && result.controlShown === false;
  result.verdict = ok ? "PASS (leg 1); leg 2 BLOCKED" : "FAIL";
  code = ok ? 0 : 1;
} catch (e) {
  result.error = String(e && e.message ? e.message : e);
} finally {
  stop();
}
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
process.exit(code);
