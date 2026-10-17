#!/usr/bin/env node
/**
 * STAGE L2 (F-REV4-8) · THE FEED-SEEN HARNESS — `node tools/uishot/feed-seen-harness.mjs`
 *
 * Real browsers, the REAL Feed screen (feedseenharness.html →
 * src/uiharness/feedseen/main.tsx), the real IntersectionObserver, the real
 * OFF-2 outbox. It proves, on the wire and in pixels, what jsdom cannot:
 *
 *   A  the first page is asked for with a session seed
 *   B  a post is recorded as SEEN at ≥ 50 % for 1 continuous second — and a
 *      post held on screen for less than a second, or never shown, is NOT
 *   C  one view per post per session (scrolled away and back: still one row)
 *   D  "N new posts": the pill appears and NOT ONE POST MOVES (same pixels,
 *      same scroll offset, no feed request)
 *   E  tapping it: what was seen is sent BEFORE the new deal is asked for; the
 *      deal has a NEW seed and starts at the first page; the new posts lead;
 *      nothing already seen is on the first screen
 *   F  the next page of that session carries the SAME seed and excludes what
 *      was delivered — no post twice
 *   G  a seen-write whose answer is lost twice is sent again with the SAME ids
 *      and lands exactly once; the outbox ends empty
 *   H  when the feed RPC fails, the chronological fallback still shows posts
 *      and the screen says "Couldn't refresh — tap to retry"; the tap recovers
 *
 * The server is a stand-in (see the page's header); the SQL is proven on PGlite.
 *
 *   --browsers chromium,chrome,msedge,firefox   (default: chromium)
 *   --json <file>                               write the result
 * `chrome` and `msedge` use the browsers installed on this machine; `chromium`
 * and `firefox` are Playwright's. Starts its own Vite dev server; exit code =
 * the verdict (every browser asked for must pass).
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox } from "playwright";

const PORT = 5197;
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
    try { const r = await fetch(`${BASE}/feedseenharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

const sleep = (page, ms) => page.waitForTimeout(ms);
const logOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__l2.log)));
const rowsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__l2.server.rows("feed_events"))));
/** Every card in DOM order, with how much of it is on screen right now. */
const cardsOf = (page) => page.evaluate(() => [...document.querySelectorAll("[data-seen-post]")].map((el) => {
  const r = el.getBoundingClientRect();
  const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  return { id: el.getAttribute("data-seen-post"), top: Math.round(r.top * 10) / 10, height: r.height, ratio: r.height > 0 ? vis / r.height : 0, share: vis / innerHeight };
}));
const scrollToY = (page, y) => page.evaluate((v) => window.scrollTo(0, v), y);
const centre = (page, id) => page.evaluate((v) => {
  const el = document.querySelector(`[data-seen-post="${v}"]`);
  const r = el.getBoundingClientRect();
  window.scrollTo(0, window.scrollY + r.top - (innerHeight - r.height) / 2);
}, id);
/** Hide and show the tab: flushes what was seen (on hide) and runs the 60-second count once (on show). */
async function blink(page, hiddenMs = 700) {
  await page.evaluate(() => window.__l2.setHidden(true));
  await sleep(page, hiddenMs);
  await page.evaluate(() => window.__l2.setHidden(false));
  await sleep(page, 400);
}
const readOutbox = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open("retina-outbox");
  req.onerror = () => resolve(-1);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("items")) return resolve(0);
    const all = db.transaction("items").objectStore("items").getAll();
    all.onsuccess = () => resolve(all.result.length);
    all.onerror = () => resolve(-1);
  };
}));
const enough = (c) => c.ratio >= 0.5 || c.share >= 0.5;

async function run(name) {
  const r = { browser: name, version: null, checks: {}, detail: {}, verdict: "FAIL" };
  const check = (key, ok, detail) => { r.checks[key] = !!ok; if (detail !== undefined) r.detail[key] = detail; };
  const browser = await launch[name]();
  r.version = browser.version();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    // The first load compiles the whole app in the dev server: generous, once.
    await page.goto(`${BASE}/feedseenharness.html`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-seen-post]").length >= 10, null, { timeout: 120_000 });

    // ── A · the first page carries a session seed
    let log = await logOf(page);
    const rpc0 = log.find((e) => e.kind === "rpc");
    check("A_first_page_has_session_seed", !!rpc0 && typeof rpc0.seed === "string" && rpc0.seed.length >= 16 && rpc0.exclude === 0 && rpc0.newest === 3, rpc0);
    const firstIds = (await cardsOf(page)).map((c) => c.id);

    // ── B · seen at the threshold, not below it
    await scrollToY(page, 0);
    await sleep(page, 1500);                       // the cards at the top have had their second
    const atTop = (await cardsOf(page)).filter(enough).map((c) => c.id);
    const all = await cardsOf(page);
    const below = all.filter((c) => c.top > 844 + 100); // not on screen at all
    const brief = below[0];                         // shown for less than a second
    const never = below[below.length - 1];          // never shown
    await centre(page, brief.id);
    await sleep(page, 400);
    const briefWasEnough = enough((await cardsOf(page)).find((c) => c.id === brief.id));
    await scrollToY(page, 0);
    await sleep(page, 1500);
    await blink(page);
    let rows = await rowsOf(page);
    const seenIds = new Set(rows.filter((x) => x.event_type === "view").map((x) => x.post_id));
    check("B_seen_after_1s_at_50pct", atTop.length >= 1 && atTop.every((id) => seenIds.has(id)), { atTop, recorded: [...seenIds] });
    check("B_not_seen_under_1s", briefWasEnough && !seenIds.has(brief.id), { brief: brief.id, briefWasEnough });
    check("B_not_seen_when_never_shown", !seenIds.has(never.id), { never: never.id });
    log = await logOf(page);
    const writes = log.filter((e) => e.kind === "events");
    const me = await page.evaluate(() => window.__l2.me);
    check("B_written_through_the_outbox_contract",
      writes.length >= 1 && writes.every((w) => w.onConflict === "id" && /resolution=ignore-duplicates/.test(w.prefer ?? "")) &&
      rows.every((x) => x.user_id === me && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(x.id))),
      { writes: writes.length });

    // ── C · one view per post per session
    await scrollToY(page, 3000);
    await sleep(page, 300);
    await scrollToY(page, 0);
    await sleep(page, 1500);
    await blink(page);
    rows = await rowsOf(page);
    const perPost = {};
    for (const x of rows.filter((v) => v.event_type === "view")) perPost[x.post_id] = (perPost[x.post_id] ?? 0) + 1;
    check("C_one_view_per_post_per_session", atTop.every((id) => perPost[id] === 1), perPost);

    // ── D · the pill appears and nothing moves
    await scrollToY(page, 0);
    await sleep(page, 300);
    const before = { cards: (await cardsOf(page)).slice(0, 4), y: await page.evaluate(() => window.scrollY), rpcs: (await logOf(page)).filter((e) => e.kind === "rpc").length };
    const newIds = await page.evaluate(() => window.__l2.addPosts(2));
    await blink(page);
    const pill = page.locator('[data-testid="new-posts-pill"]');
    const pillShown = await pill.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    await sleep(page, 500);                         // let the entry animation finish
    const after = { cards: (await cardsOf(page)).slice(0, 4), y: await page.evaluate(() => window.scrollY), rpcs: (await logOf(page)).filter((e) => e.kind === "rpc").length };
    check("D_pill_shows_the_count", pillShown && (await pill.textContent())?.trim() === "2 new posts", pillShown ? await pill.textContent() : "no pill");
    check("D_list_did_not_move",
      pillShown && before.y === after.y && before.cards.length === after.cards.length &&
      before.cards.every((c, i) => c.id === after.cards[i].id && Math.abs(c.top - after.cards[i].top) < 0.6 && Math.abs(c.height - after.cards[i].height) < 0.6),
      { before: before.cards.map((c) => [c.id.slice(-4), c.top]), after: after.cards.map((c) => [c.id.slice(-4), c.top]), scrollY: [before.y, after.y] });
    check("D_no_feed_request_for_the_pill", before.rpcs === after.rpcs, { before: before.rpcs, after: after.rpcs });
    check("D_pill_floats", pillShown && await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="new-posts-pill-anchor"]')).position === "absolute"));

    // ── E · tapping it: seen first, then a NEW deal from the first page
    const fresh = (await cardsOf(page)).find((c) => !seenIds.has(c.id) && c.top > 844 * 0.6 && c.top < 3000) ?? (await cardsOf(page)).find((c) => !seenIds.has(c.id));
    await centre(page, fresh.id);
    await sleep(page, 1400);                        // seen, and not yet sent (the interval is 15 s)
    const mark = (await logOf(page)).length;
    await pill.click();
    await page.waitForFunction((n) => window.__l2.log.slice(n).some((e) => e.kind === "rpc"), mark, { timeout: 15_000 });
    await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`[data-seen-post="${id}"]`)), newIds, { timeout: 15_000 });
    await sleep(page, 600);
    log = await logOf(page);
    const rpc1 = log.slice(mark).find((e) => e.kind === "rpc");
    const sentFresh = log.find((e) => e.kind === "events" && e.posts.includes(fresh.id));
    check("E_seen_is_sent_before_the_new_deal", !!sentFresh && !!rpc1 && sentFresh.n < rpc1.n, { sentAt: sentFresh?.n, rpcAt: rpc1?.n });
    check("E_new_seed_from_the_first_page", !!rpc1 && typeof rpc1.seed === "string" && rpc1.seed !== rpc0.seed && rpc1.exclude === 0 && rpc1.newest === 3, rpc1);
    check("E_one_request_for_the_new_deal", log.slice(mark).filter((e) => e.kind === "rpc").length === 1);
    const dealt = (await cardsOf(page)).map((c) => c.id);
    rows = await rowsOf(page);
    const seenNow = new Set(rows.filter((x) => x.event_type === "view").map((x) => x.post_id));
    check("E_new_posts_lead", newIds.every((id) => dealt.slice(0, 3).includes(id)), { first3: dealt.slice(0, 3), newIds });
    check("E_nothing_seen_on_the_first_screen", dealt.length === 10 && dealt.every((id) => !seenNow.has(id)) && JSON.stringify(dealt) !== JSON.stringify(firstIds.slice(0, 10)),
      { dealt: dealt.length, seenOnScreen: dealt.filter((id) => seenNow.has(id)) });
    check("E_pill_gone_and_at_the_top", (await pill.count()) === 0 || !(await pill.isVisible()), await page.evaluate(() => window.scrollY));

    // ── F · the next page: same seed, nothing twice
    const markF = (await logOf(page)).length;
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await sleep(page, 400);
      if ((await cardsOf(page)).length >= 20) break;
    }
    log = await logOf(page);
    const rpc2 = log.slice(markF).find((e) => e.kind === "rpc");
    const idsF = (await cardsOf(page)).map((c) => c.id);
    check("F_next_page_same_seed", !!rpc2 && rpc2.seed === rpc1.seed && rpc2.exclude === 10 && rpc2.newest === 0, rpc2);
    check("F_no_post_twice", idsF.length >= 20 && new Set(idsF).size === idsF.length, { cards: idsF.length });

    // ── G · a lost answer: resent with the same ids, exactly once
    await scrollToY(page, 0);
    await sleep(page, 200);
    await page.evaluate(() => window.__l2.server.loseAnswers(2));
    const markG = (await logOf(page)).length;
    await sleep(page, 1500);                        // the new first screen has had its second
    await blink(page);
    await page.waitForFunction((n) => window.__l2.log.slice(n).filter((e) => e.kind === "events").length >= 3, markG, { timeout: 20_000 }).catch(() => {});
    await sleep(page, 800);
    log = await logOf(page);
    const sends = log.slice(markG).filter((e) => e.kind === "events");
    const firstSend = sends[0];
    const resends = firstSend ? sends.filter((s) => JSON.stringify(s.ids) === JSON.stringify(firstSend.ids)) : [];
    rows = await rowsOf(page);
    const idCount = {};
    for (const x of rows) idCount[x.id] = (idCount[x.id] ?? 0) + 1;
    check("G_resent_with_the_same_ids", !!firstSend && resends.length >= 3 && resends.filter((s) => s.lost).length === 2, { sends: sends.map((s) => ({ lost: s.lost, n: s.ids.length })) });
    check("G_exactly_once", !!firstSend && firstSend.ids.every((id) => idCount[id] === 1) && Object.values(idCount).every((n) => n === 1));
    check("G_outbox_empty", (await readOutbox(page)) === 0, await readOutbox(page));

    // ── H · an honest error, and the way out of it
    await page.evaluate(() => { window.__l2.fail(true); window.__l2.addPosts(1); });
    await blink(page);
    const pillH = await pill.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    if (pillH) await pill.click();
    const banner = page.locator('[data-testid="feed-refresh-failed"]');
    const bannerShown = await banner.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    check("H_says_couldnt_refresh", bannerShown && /Couldn.t refresh — tap to retry/.test((await banner.textContent()) ?? ""), bannerShown ? await banner.textContent() : "no banner");
    check("H_posts_still_shown", (await cardsOf(page)).length >= 1);
    await page.evaluate(() => window.__l2.fail(false));
    if (bannerShown) await banner.click();
    const recovered = await banner.waitFor({ state: "detached", timeout: 20_000 }).then(() => true, () => false);
    check("H_tap_recovers", recovered && (await cardsOf(page)).length === 10);

    r.verdict = Object.values(r.checks).length > 0 && Object.values(r.checks).every(Boolean) ? "PASS" : "FAIL";
  } catch (e) {
    r.error = String(e?.stack ?? e).slice(0, 1200);
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
    console.log(`[feed-seen] ${name} ${r.version ?? ""}: ${r.verdict} — ${Object.keys(r.checks ?? {}).length - failed.length}/${Object.keys(r.checks ?? {}).length} checks${failed.length ? " — FAILED: " + failed.join(", ") : ""}${r.error ? " — ERROR: " + r.error.split("\n")[0] : ""}`);
    for (const k of failed) console.log(`[feed-seen]   ${k}: ${JSON.stringify(r.detail?.[k] ?? null).slice(0, 400)}`);
  }
  result.verdict = result.browsers.length > 0 && result.browsers.every((b) => b.verdict === "PASS") ? "PASS" : "FAIL";
  code = result.verdict === "PASS" ? 0 : 1;
} catch (e) {
  result.error = String(e?.message ?? e);
  console.error(`[feed-seen] FAILED: ${result.error}`);
  console.error(serverLog.join("").slice(-3000));
} finally {
  stop();
}
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(`[feed-seen] verdict: ${result.verdict}`);
process.exit(code);
