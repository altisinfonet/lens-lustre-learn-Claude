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
 * and fails. S7b-3 added a SECOND reader of the same device store (the saved
 * feed, `feedArchive`, keys ["feed-archive", n]); the control removes those
 * records too, so it still tests exactly one thing: OFF-1's record present,
 * its reader off. LEG 1b (S7b-3): OFF-1's records removed, the bridge off, only
 * the saved feed left — the post must still be on screen (fails before S7b-3).
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
 * LEG 3 (S7b-7, flight mode beyond the feed): a post page and a
 * photographer's profile are opened once online; then, with no data network,
 * the post page must show the post (never "Post not found"), the profile the
 * photographer's name, every screen (feed, post, profile) the "No internet —
 * showing saved" bar, and no screen an error, a "gone" verdict or the
 * placeholder name "Photographer". Fails before S7b-4 (post page: "Post not
 * found") and before S7b-5 (no bar).
 *
 * LEG 4 (S7b-7, OFF-2 for follows): on that profile, offline, the member taps
 * Follow. It must be kept on the device, marked "Will send when online", and
 * after a restart online with the first two answers lost (`lose=2`) reach the
 * server EXACTLY ONCE (fakeTables enforces follows' unique key). Fails before
 * S7b-5 (the follow is not kept: 0 rows).
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
// S7b-7 fixtures: the fixture post (by the member) and another photographer.
const POST_ID = "aaaaaaa1-0000-4000-8000-000000000001";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_NAME = "Ranjana Bhattacharya Chowdhury";
const OFFLINE_BAR = "No internet — showing saved";
// Words that must never be on a screen in flight mode: an error screen, a
// "gone" verdict for something the phone has seen, or a placeholder name.
const FORBIDDEN = ["Something went wrong", "Post not found", "This profile doesn't exist", "Photographer"];
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
  archiveStored: false, archiveOnlyShown: false,
  pages: { postSeeded: false, profileSeeded: false, postOffline: false, profileOffline: false, bar: { feed: false, post: false, profile: false }, forbiddenSeen: [] },
  offlineFollow: { tapped: false, marked: false, queuedOnDevice: null, serverRows: null, sends: null, outboxLeft: null, log: null },
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
// Device-store records whose key starts with `prefix` ("feed" = OFF-1's query
// page, "feed-archive" = S7b-3's saved feed): count them, or delete them.
const deviceRecords = (page, prefix, del = false) => page.evaluate(([prefix, del]) => new Promise((resolve) => {
  const req = indexedDB.open("retina-offline");
  req.onerror = () => resolve(0);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("kv")) return resolve(0);
    const tx = db.transaction("kv", del ? "readwrite" : "readonly");
    const store = tx.objectStore("kv");
    const all = store.getAll();
    let n = 0;
    all.onsuccess = () => {
      for (const r of all.result) {
        if (!Array.isArray(r.key) || r.key[0] !== prefix) continue;
        if (Array.isArray(r.data) && r.data.length === 0) continue; // empty archive chunk
        n++;
        if (del) store.delete(r.id);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(n); };
    tx.onerror = () => resolve(0);
  };
}), [prefix, del]);
const waitForRecords = async (page, prefix) => {
  for (let i = 0; i < 20; i++) {
    if ((await deviceRecords(page, prefix)) > 0) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

const screenText = (page) => page.evaluate(() => document.body.innerText);
const forbiddenIn = (text) => FORBIDDEN.filter((w) => text.includes(w));
// Visible copies only: the profile renders its header twice (phone and desktop
// layouts, one hidden by CSS), so the first match in the page can be hidden.
const shows = (page, text, timeout = 20_000) =>
  page.getByText(text, { exact: false }).locator("visible=true").first().waitFor({ timeout }).then(() => true, () => false);

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
  // Leave the live app (review #548): its saved-feed write is debounced, so
  // deleting those records while it still runs could race a late write back.
  // A static file of the same site: same IndexedDB, no app running.
  await waitForRecords(page, "feed-archive");
  await page.goto(`${BASE}/robots.txt`, { waitUntil: "load" });

  // 2) the app starts with no data network. Only OFF-1's record may answer:
  // S7b-3's saved feed is removed here too (review #548), so this run and the
  // control below differ in ONE thing — the bridge — and leg 1 still proves
  // OFF-1's reader on its own. Leg 1b proves the saved feed on its own.
  await deviceRecords(page, "feed-archive", true);
  await page.goto(`${BASE}/offlineharness.html?phase=offline`, { waitUntil: "load" });
  result.offlineShown = await page.getByText(SENTINEL, { exact: false }).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);

  // 3) control: same start without the bridge (S7b-3's saved feed, the other
  // reader of this store, removed as in step 2 — the step 2 run may have
  // written nothing new, as it was offline)
  await page.evaluate(() => localStorage.removeItem("feed_cache_v1"));
  await deviceRecords(page, "feed-archive", true);
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

  // 6) LEG 1b (S7b-3) — last, so legs 1 and 2 stay independent. Online once
  // more so the saved feed is written, then OFF-1's record removed and the
  // bridge off: only the saved feed is left to show the post.
  await page.goto(`${BASE}/offlineharness.html?phase=seed`, { waitUntil: "load" });
  await page.getByText(SENTINEL, { exact: false }).first().waitFor({ timeout: 60_000 });
  result.archiveStored = await waitForRecords(page, "feed-archive");
  await page.goto(`${BASE}/robots.txt`, { waitUntil: "load" }); // no app running while deleting
  await page.evaluate(() => localStorage.removeItem("feed_cache_v1"));
  await deviceRecords(page, "feed", true);
  await page.goto(`${BASE}/offlineharness.html?phase=offline&nobridge=1`, { waitUntil: "load" });
  result.archiveOnlyShown = await page.getByText(SENTINEL, { exact: false }).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);

  // 7) LEG 3 (S7b-4/S7b-5) — flight mode beyond the feed. Online: the post
  // page and a photographer's profile are opened once (so the phone has seen
  // them). Then with no data network: the post page shows the post (never "Post
  // not found"), the profile shows the photographer's name, every screen
  // carries the "No internet — showing saved" bar, and no screen shows an error
  // or a placeholder name.
  const P = result.pages;
  await page.goto(`${BASE}/offlineharness.html?phase=seed&route=post&id=${POST_ID}`, { waitUntil: "load" });
  P.postSeeded = await shows(page, SENTINEL, 60_000);
  await page.waitForTimeout(2000); // device-store writes are debounced
  await page.goto(`${BASE}/offlineharness.html?phase=seed&route=profile&id=${AUTHOR_ID}`, { waitUntil: "load" });
  P.profileSeeded = await shows(page, AUTHOR_NAME, 60_000);
  await page.waitForTimeout(2000);
  const seen = new Set();
  const offlineScreen = async (key, query, expect) => {
    await page.goto(`${BASE}/offlineharness.html?phase=offline${query}`, { waitUntil: "load" });
    const ok = await shows(page, expect);
    P.bar[key] = await shows(page, OFFLINE_BAR, 10_000);
    await page.waitForTimeout(1500); // let any late error state render
    for (const w of forbiddenIn(await screenText(page))) seen.add(`${key}: ${w}`);
    return ok;
  };
  await offlineScreen("feed", "", SENTINEL);
  P.postOffline = await offlineScreen("post", `&route=post&id=${POST_ID}`, SENTINEL);
  P.profileOffline = await offlineScreen("profile", `&route=profile&id=${AUTHOR_ID}`, AUTHOR_NAME);

  // 8) LEG 4 (S7b-5) — on that profile, still with no network, the member taps
  // Follow. It must be kept on the device and marked "Will send when online";
  // after a restart ONLINE, with the server losing its first two answers, the
  // follow must reach it EXACTLY ONCE (fakeTables enforces follows' unique key).
  const F = result.offlineFollow;
  const follow = page.getByRole("button", { name: /^Follow$/ }).locator("visible=true").first();
  F.tapped = await follow.waitFor({ timeout: 10_000 }).then(() => follow.click()).then(() => true, () => false);
  F.marked = await page.getByTestId("pending-mark").locator("visible=true").first().waitFor({ timeout: 5_000 }).then(() => true, () => false);
  await page.waitForTimeout(1500);
  for (const w of forbiddenIn(await screenText(page))) seen.add(`follow: ${w}`);
  const fq = await readOutbox(page);
  F.queuedOnDevice = fq.length === 1 && fq[0].kind === "follow";
  await page.goto(`${BASE}/offlineharness.html?phase=reconnect&lose=2&route=profile&id=${AUTHOR_ID}`, { waitUntil: "load" });
  await shows(page, AUTHOR_NAME);
  for (let i = 0; i < 30; i++) {
    if ((await readOutbox(page)).length === 0) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(500);
  const fs = await page.evaluate(() => {
    const s = window.__off6server;
    return s ? { rows: s.rows("follows").length, log: [...s.log] } : null;
  });
  F.serverRows = fs ? fs.rows : null;
  F.log = fs ? fs.log : null;
  F.sends = fs ? fs.log.filter((l) => l.startsWith("POST follows")).length : null;
  F.outboxLeft = (await readOutbox(page)).length;
  P.forbiddenSeen = [...seen];

  await browser.close();
  const leg1 = result.seedShown && result.storedFeed && result.offlineShown && result.controlShown === false;
  const leg1b = result.archiveStored && result.archiveOnlyShown;
  const L = result.offlineLike;
  const leg2 = L.tapped && L.queuedOnDevice && L.serverRows === 1 && L.sends >= 3 && L.outboxLeft === 0;
  const leg3 = P.postSeeded && P.profileSeeded && P.postOffline && P.profileOffline
    && P.bar.feed && P.bar.post && P.bar.profile && P.forbiddenSeen.length === 0;
  const leg4 = F.tapped && F.marked && F.queuedOnDevice && F.serverRows === 1 && F.sends >= 3 && F.outboxLeft === 0;
  const ok = leg1 && leg1b && leg2 && leg3 && leg4;
  const legs = { "1": leg1, "1b": leg1b, "2": leg2, "3": leg3, "4": leg4 };
  result.verdict = ok ? "PASS (legs 1, 1b, 2, 3, 4)"
    : `FAIL (${Object.entries(legs).map(([k, v]) => `leg ${k} ${v ? "pass" : "FAIL"}`).join(", ")})`;
  code = ok ? 0 : 1;
} catch (e) {
  result.error = String(e && e.message ? e.message : e);
} finally {
  stop();
}
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
process.exit(code);
