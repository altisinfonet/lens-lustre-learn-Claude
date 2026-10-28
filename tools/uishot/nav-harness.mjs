#!/usr/bin/env node
/**
 * L1 · THE NAVIGATION HARNESS — `node tools/uishot/nav-harness.mjs`.
 *
 * F-REV4-7 (REV4 plan, 13 Oct 2026): Back looped on a post's comments and
 * never returned to the feed. Closing the comments overlay PUSHED a history
 * entry instead of stepping back, and a watcher re-opened the thread whenever
 * Back landed on `?comments=<same id>` again.
 *
 * This drives the REAL Feed and the REAL PostDetail (navharness.html →
 * src/uiharness/nav/main.tsx, the real Layout + CommentsOverlay, fake backend)
 * in a real browser, on the page's REAL history stack, with the browser's own
 * Back. Each journey asserts where Back lands, that the thread does not come
 * back, and that closing adds no history entry (history.length unchanged).
 * The scroll journeys assert that the feed is where the member left it. The
 * `native` journeys run the same page with the Android stub (navharness.html
 * `?native=1`): a notification tap at cold start and Android Back are
 * delivered through the listeners the REAL app registered.
 *
 *   --browser chromium | chrome | msedge | firefox | webkit   (default chromium)
 *   --base http://127.0.0.1:5196   use a dev server that is already running
 *   --json <file>                  write the reading
 *   --only <text>                  run only the journeys whose name contains <text> (for debugging one)
 *   --origin https://localhost     S4-c: serve the page AT the Android app's origin (the Capacitor
 *                                  shell loads https://localhost) — every request to that origin,
 *                                  the dev server's socket included, is answered by the dev server
 *
 * Starts its own Vite dev server unless --base is given; exit code = verdict.
 * What it cannot prove (a real phone must): the FEEL of the Android Back
 * gesture and of Vaul's swipe under a thumb. The swipe journey here is a mouse
 * drag on the sheet — the same pointer events, not the same hand.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const BROWSER = arg("--browser", "chromium");
const out = arg("--json", null);
const ONLY = arg("--only", null);
const ORIGIN = arg("--origin", null);
/** 5196: 5197 is the encoder harness, 5198 the offline harness, 5199 the UI gate. */
const PORT = 5196;
const BASE = arg("--base", null) || `http://127.0.0.1:${PORT}`;
const ownServer = !arg("--base", null);

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
    const p = join(root, d, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}

let server = null;
const stop = () => {
  if (!server) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-server.pid, "SIGTERM");
  } catch { /* gone */ }
  server = null;
};
if (ownServer) {
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", shell: process.platform === "win32",
  });
  process.on("exit", stop);
}

async function waitUp() {
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch(`${BASE}/navharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

async function launch() {
  if (BROWSER === "firefox") return firefox.launch();
  if (BROWSER === "webkit") return webkit.launch();
  if (BROWSER === "chrome" || BROWSER === "msedge") return chromium.launch({ channel: BROWSER });
  if (BROWSER !== "chromium") throw new Error(`unknown --browser ${BROWSER}`);
  const exe = chromePath();
  if (exe) return chromium.launch({ executablePath: exe });
  try {
    return await chromium.launch();
  } catch (e) {
    // Only the full Chromium build is installed (no separate headless shell):
    // the same engine, started through its own headless mode.
    if (!/Executable doesn't exist/i.test(String(e?.message))) throw e;
    return chromium.launch({ channel: "chromium" });
  }
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
/** A post id no fixture carries — the post a notification points at after it was deleted. */
const GONE_POST = "00000000-0000-4000-8000-00000000dead";
/** px the feed may differ from where it was left and still count as "exactly". */
const SCROLL_TOLERANCE = 2;

/** Where the router is: path + query, read from the page itself. */
const where = (page) => page.evaluate(() => location.pathname + location.search);
const histLen = (page) => page.evaluate(() => history.length);
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
const dialog = (page) => page.getByRole("dialog");
const commentButtons = (page) => page.getByRole("button", { name: "Comment" });

async function settle(page, ms = 400) { await page.waitForTimeout(ms); }

async function waitWhere(page, expected, timeout = 8000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeout) {
    last = await where(page);
    if (last === expected) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`expected to be at ${expected}, still at ${last}`);
}

async function startAt(page, start, native = false) {
  const q = `${native ? "native=1&" : ""}start=${encodeURIComponent(start)}`;
  await page.goto(`${ORIGIN || BASE}/navharness.html?${q}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  if (ORIGIN) {
    const o = await page.evaluate(() => location.origin);
    if (o !== ORIGIN.replace(/\/$/, "")) throw new Error(`the page is at ${o}, not the app's origin ${ORIGIN}`);
  }
}

async function openFeedFromBelow(page) {
  await startAt(page, "/below");
  await page.getByTestId("to-feed").click({ timeout: 120000 });
  await waitWhere(page, "/feed");
  await commentButtons(page).first().waitFor({ timeout: 120000 });
}

async function openComments(page, button = commentButtons(page).first()) {
  await button.click();
  await dialog(page).waitFor({ state: "visible", timeout: 15000 });
}

async function closeBy(page, method) {
  if (method === "x") await dialog(page).getByRole("button", { name: "Close" }).click();
  else if (method === "escape") await page.keyboard.press("Escape");
  else if (method === "backdrop") await page.mouse.click(8, 8); // outside the centred modal
  else throw new Error(`unknown close method ${method}`);
}

/**
 * Swipe the sheet down, as a thumb does: press on its header, drag most of a
 * screen, let go. Vaul ignores a drag in the first 500 ms after opening (its
 * own guard against an accidental dismiss), hence the wait.
 */
async function swipeSheetDown(page) {
  await settle(page, 800);
  const box = await dialog(page).getByText("Comments", { exact: true }).first().boundingBox();
  if (!box) throw new Error("the sheet's header is not on screen");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x, y + i * 45);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/**
 * The thread is closed AND STAYS closed. The sheet takes about half a second to
 * slide away, and a slow machine takes longer — so first let the exit finish
 * (a fixed pause here once reported a closing sheet as "open again"), then
 * look a second time for anything that brought it back.
 */
async function noDialog(page, label) {
  try {
    await dialog(page).first().waitFor({ state: "hidden", timeout: 6000 });
  } catch {
    throw new Error(`${label}: the comments overlay is still open`);
  }
  await settle(page, 600);
  if (await dialog(page).first().isVisible().catch(() => false)) throw new Error(`${label}: the comments overlay is open again`);
}

/**
 * This element has stopped moving on the page: everything ABOVE it has drawn.
 * A position read before that is a position on a page that is about to move
 * under it (seen on a busy machine: "was at 1681, came back at 1364" — 1364
 * was right, 1681 had been read mid-load). The element's own offset is watched
 * rather than the page's height, because the END of the fixture feed never
 * settles (its load-more row comes and goes) and that is no concern of a
 * position higher up.
 */
async function stableOffset(page, locator, quietMs = 800, timeout = 20000) {
  const t0 = Date.now();
  let last = null;
  let since = Date.now();
  while (Date.now() - t0 < timeout) {
    const top = await locator.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
    if (top !== last) { last = top; since = Date.now(); }
    else if (Date.now() - since >= quietMs) return top;
    await page.waitForTimeout(100);
  }
  throw new Error(`the feed never stopped moving (the comment icon was last ${last}px down the page)`);
}

/**
 * Scroll the feed well down — to the MIDDLE of the page, not its end — and
 * leave a comment icon in the middle of the screen, so tapping it needs no
 * scrolling (a click scrolls its target into view, which would BE the movement
 * this is trying to measure). Not the end, because at the end "restored" cannot
 * be told from "scrolled as far as the page goes".
 */
async function scrollFeedDown(page) {
  const button = commentButtons(page).nth(1);
  await stableOffset(page, button);
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await stableOffset(page, button); // scrolling mounts more cards; let that finish too
  const { y, max } = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    max: document.documentElement.scrollHeight - window.innerHeight,
  }));
  if (y < 300) throw new Error(`the fixture feed is too short to prove a scroll position (only ${y}px down)`);
  if (y > max - 150) throw new Error(`${y}px is the end of the page (${max}px) — a restore there proves nothing`);
  return { y, button };
}

/** Wait until the feed is back where it was left — or say where it stopped. */
async function waitScroll(page, expected, label, timeout = 5000) {
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < timeout) {
    last = await scrollY(page);
    if (Math.abs(last - expected) <= SCROLL_TOLERANCE) {
      await settle(page, 700); // …and it must STAY there once everything has drawn
      last = await scrollY(page);
      if (Math.abs(last - expected) <= SCROLL_TOLERANCE) return last;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`${label}: the feed was at ${expected}px and came back at ${last}px`);
}

/**
 * B1 · WHAT IS ON SCREEN, NOT ONLY HOW FAR DOWN. The feed's cards in page
 * order, and the one at the top of the viewport (the first whose bottom edge is
 * still below the top of the screen). The same scroll offset over a RE-DEALT
 * feed is a different post at the same height — exactly what an offset-only
 * check could not see.
 */
const feedOnScreen = (page) => page.evaluate(() => {
  const cards = [...document.querySelectorAll("[data-post-id]")];
  const top = cards.find((el) => el.getBoundingClientRect().bottom > 1);
  return { order: cards.map((el) => el.getAttribute("data-post-id")), top: top ? top.getAttribute("data-post-id") : null };
});
/** How many different deals (session seeds) the fake feed has been asked for so far. */
const deals = (page) => page.evaluate(() => window.__navDeals ?? 0);
/**
 * The feed has stopped loading pages: no request to the fake feed for a whole
 * second. Scrolling mounts the load-more row, and a page still in flight when
 * the journey leaves would either land after "what was on screen" was read or
 * (React Query de-duplicates a mount's fetch into one already running) swallow
 * the fresh visit's new deal. Both are the journey's timing, not the app's.
 */
async function feedQuiet(page, quietMs = 1000, timeout = 20000) {
  const calls = () => page.evaluate(() => window.__navFeedCalls ?? 0);
  const t0 = Date.now();
  let last = await calls();
  let since = Date.now();
  while (Date.now() - t0 < timeout) {
    await page.waitForTimeout(100);
    const now = await calls();
    if (now !== last) { last = now; since = Date.now(); }
    else if (Date.now() - since >= quietMs) return;
  }
  throw new Error("the feed never stopped loading pages");
}

/**
 * Tap a row once it has stopped moving — as a person does, who taps what they
 * see, not what is still zooming in. The bell's panel opens with a short scale
 * animation; measured in Firefox, the row settles within ~7 frames and then
 * holds still, but a click aimed at it MID-zoom is refused there ("element is
 * not stable") and never retried into success.
 */
async function tapSettled(page, locator, timeout = 30000) {
  await locator.waitFor({ state: "visible", timeout });
  let last = "";
  let since = Date.now();
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const b = await locator.boundingBox();
    const key = b ? [b.x, b.y, b.width, b.height].map((v) => v.toFixed(1)).join(",") : "";
    if (key !== last) { last = key; since = Date.now(); }
    else if (key && Date.now() - since >= 300) break;
    await page.waitForTimeout(50);
  }
  await locator.click({ timeout });
}

/** An in-app PUSH, as a link inside the app does — once the router has handed over its navigate. */
async function inApp(page, to) {
  await page.waitForFunction(() => typeof window.__nav?.navigate === "function", null, { timeout: 120000 });
  await page.evaluate((t) => window.__nav.navigate(t), to);
}

const nativeReady = (page) => page.waitForFunction(
  () => !!(window.__navNative && window.__navNative.back && window.__navNative.tapped), null, { timeout: 120000 });
const pressBack = async (page) => { await page.evaluate(() => window.__navNative.pressBack()); await settle(page, 500); };
const exits = (page) => page.evaluate(() => window.__navNative.exits);

/**
 * S4-c · THE APP'S ORIGIN. The Android app is this same web app loaded from
 * https://localhost inside a WebView. Here every request the page makes to
 * that origin is fetched from the dev server and handed back as if
 * https://localhost had answered — so `location.origin`, secure-context rules
 * and history all behave as in the app. The dev server's own socket
 * (wss://localhost) is joined to the real one, so the page does not reload.
 */
/** The dev server's answers, kept for the run: its modules do not change while it runs, and re-proxying hundreds of them per journey is minutes. */
const originCache = new Map();
async function serveAtOrigin(ctx) {
  const origin = ORIGIN.replace(/\/$/, "");
  await ctx.route(`${origin}/**`, async (route) => {
    const req = route.request();
    const url = BASE + req.url().slice(origin.length);
    const cacheable = req.method() === "GET" && !url.includes("/navharness.html");
    try {
      let hit = cacheable ? originCache.get(url) : undefined;
      if (!hit) {
        const res = await route.fetch({ url });
        hit = { status: res.status(), headers: res.headers(), body: await res.body() };
        if (cacheable && hit.status === 200) originCache.set(url, hit);
      }
      await route.fulfill(hit);
    } catch {
      await route.abort();
    }
  });
  const wsOrigin = origin.replace(/^https/, "wss").replace(/^http/, "ws");
  await ctx.routeWebSocket((u) => u.href.startsWith(wsOrigin), (ws) => {
    ws.connectToServer(BASE.replace(/^http/, "ws") + ws.url().slice(wsOrigin.length));
  });
}

/** Each journey: a fresh browser context (fresh history), its own verdict. */
const JOURNEYS = [];
const journey = (name, viewport, fn) => JOURNEYS.push({ name, viewport, fn, control: false });
/**
 * A CONTROL: a journey that was never broken, so it passes before the fix too.
 * It is here because a harness in which everything fails on the old code cannot
 * tell "the bug" from "the harness is wrong" — and because it must STAY true.
 * The browser's own Back, with no close in between, was always correct: the
 * loop needed a close (which pushed) followed by a Back (which re-opened).
 */
const control = (name, viewport, fn) => JOURNEYS.push({ name, viewport, fn, control: true });

for (const method of ["x", "escape", "backdrop"]) {
  journey(`feed → comments → close (${method}) → Back → the page below`, DESKTOP, async (page) => {
    await openFeedFromBelow(page);
    const before = await histLen(page);
    await openComments(page);
    const opened = await where(page);
    if (!/^\/feed\?comments=/.test(opened)) throw new Error(`opening did not mirror the thread into the URL: ${opened}`);
    if ((await histLen(page)) !== before + 1) throw new Error("opening must push exactly one entry");
    await closeBy(page, method);
    await waitWhere(page, "/feed");
    await noDialog(page, "after close");
    const afterClose = await histLen(page);
    if (afterClose !== before + 1) throw new Error(`closing added a history entry (${before + 1} → ${afterClose})`);
    await page.goBack();
    await waitWhere(page, "/below");
    await noDialog(page, "after Back");
    return { historyBefore: before, historyAfterClose: afterClose };
  });
}

control("feed → comments → Back (browser) closes it → Back → the page below", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  await openComments(page);
  await page.goBack();
  await waitWhere(page, "/feed");
  await noDialog(page, "after the first Back");
  await page.goBack();
  await waitWhere(page, "/below");
  await noDialog(page, "after the second Back");
});

journey("phone width (sheet): feed → comments → Escape → Back → the page below", PHONE, async (page) => {
  await openFeedFromBelow(page);
  const before = await histLen(page);
  await openComments(page);
  await page.keyboard.press("Escape");
  await waitWhere(page, "/feed");
  await noDialog(page, "after close");
  if ((await histLen(page)) !== before + 1) throw new Error("closing the sheet added a history entry");
  await page.goBack();
  await waitWhere(page, "/below");
  await noDialog(page, "after Back");
});

journey("phone width (sheet): feed → comments → swipe down → Back → the page below", PHONE, async (page) => {
  await openFeedFromBelow(page);
  const before = await histLen(page);
  await openComments(page);
  await swipeSheetDown(page);
  await waitWhere(page, "/feed");
  await noDialog(page, "after the swipe");
  const afterClose = await histLen(page);
  if (afterClose !== before + 1) throw new Error(`swiping the sheet away added a history entry (${before + 1} → ${afterClose})`);
  await page.goBack();
  await waitWhere(page, "/below");
  await noDialog(page, "after Back");
});

control("phone width (sheet): feed → comments → Back closes it → Back → the page below", PHONE, async (page) => {
  await openFeedFromBelow(page);
  await openComments(page);
  await page.goBack();
  await waitWhere(page, "/feed");
  await noDialog(page, "after the first Back");
  await page.goBack();
  await waitWhere(page, "/below");
});

control("/post/<id> (opened in-app, as the bell does) → comments → Back ×2 → feed", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  const postId = await page.evaluate(() => window.__nav.postId);
  await page.getByTestId("to-post").click();
  await waitWhere(page, `/post/${postId}`);
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  await openComments(page);
  await page.goBack();
  await waitWhere(page, `/post/${postId}`);
  await noDialog(page, "after the first Back");
  await page.goBack();
  await waitWhere(page, "/feed");
  await noDialog(page, "after the second Back");
});

journey("/post/<id> (opened in-app) → comments → Escape → Back → feed — the reported loop, on the website", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  const postId = await page.evaluate(() => window.__nav.postId);
  await page.getByTestId("to-post").click();
  await waitWhere(page, `/post/${postId}`);
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  const before = await histLen(page);
  await openComments(page);
  await page.keyboard.press("Escape");
  await waitWhere(page, `/post/${postId}`);
  await noDialog(page, "after close");
  if ((await histLen(page)) !== before + 1) throw new Error("closing added a history entry");
  await page.goBack();
  await waitWhere(page, "/feed");
  await noDialog(page, "after Back");
});

journey("/post/<id> → comments → X → page's own ← Back → feed", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  const postId = await page.evaluate(() => window.__nav.postId);
  await page.getByTestId("to-post").click();
  await waitWhere(page, `/post/${postId}`);
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  await openComments(page);
  await closeBy(page, "x");
  await waitWhere(page, `/post/${postId}`);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await waitWhere(page, "/feed");
  await noDialog(page, "after the page's Back");
});

journey("external link straight to /post/<id> (no in-app history) → page's ← Back → feed, no extra step", DESKTOP, async (page) => {
  const postId = "aaaaaaa1-0000-4000-8000-000000000001";
  await startAt(page, `/post/${postId}`);
  await page.getByRole("button", { name: "Back", exact: true }).waitFor({ timeout: 120000 });
  const before = await histLen(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await waitWhere(page, "/feed");
  if ((await histLen(page)) !== before) throw new Error("the fallback to the feed must REPLACE, not push");
});

journey("cold link that already carries ?comments=<id> → opens → Escape → no step left", DESKTOP, async (page) => {
  const postId = "aaaaaaa1-0000-4000-8000-000000000001";
  await startAt(page, `/feed?comments=${postId}`);
  await commentButtons(page).first().waitFor({ timeout: 120000 }); // the feed has drawn its cards
  await dialog(page).waitFor({ state: "visible", timeout: 15000 });
  const before = await histLen(page);
  await page.keyboard.press("Escape");
  await waitWhere(page, "/feed");
  await noDialog(page, "after close");
  if ((await histLen(page)) !== before) throw new Error("closing a deep-linked thread must replace, not push");
});

// SCROLL. Closing comments is now a step BACK (a traversal), and a traversal is
// what the scroll restore reacts to — so "the feed does not move" and "a fresh
// visit starts at the top" are controls on the fix itself. The round trip
// through a post is the requirement: before L1 it already held in Chromium and
// Firefox (their own restoration lands after React has redrawn the feed) and
// did NOT hold in WebKit — see docs/evidence/d2/L1-navigation/README.md.
control("feed scroll position: comments opened and closed → the feed has not moved", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  const { y, button } = await scrollFeedDown(page);
  await openComments(page, button);
  await page.keyboard.press("Escape");
  await waitWhere(page, "/feed");
  const after = await waitScroll(page, y, "after closing comments");
  return { scrollBefore: y, scrollAfter: after };
});

for (const viewport of [DESKTOP, PHONE]) {
  journey(`feed scroll position (${viewport.width}px): feed → a post → Back → the feed is where it was left, the same post at the top`, viewport, async (page) => {
    await openFeedFromBelow(page);
    const postId = await page.evaluate(() => window.__nav.postId);
    const { y } = await scrollFeedDown(page);
    await feedQuiet(page);
    if (Math.abs((await scrollY(page)) - y) > SCROLL_TOLERANCE) throw new Error("the feed moved while it finished loading");
    const left = await feedOnScreen(page);
    const dealsBefore = await deals(page);
    await page.evaluate((id) => window.__nav.navigate(`/post/${id}`), postId); // in-app push, no click, no scroll
    await waitWhere(page, `/post/${postId}`);
    await page.getByRole("button", { name: "Back", exact: true }).waitFor({ timeout: 60000 });
    const onPost = await scrollY(page);
    await page.goBack();
    await waitWhere(page, "/feed");
    const after = await waitScroll(page, y, "after returning from the post");
    // B1: the SAME post at the top, the same cards in the same order — and it
    // must still be so once anything a return might have started has landed.
    await settle(page, 1500);
    const back = await feedOnScreen(page);
    if (back.top !== left.top) throw new Error(`the post at the top was ${left.top} and came back as ${back.top} — the feed was re-dealt behind the member`);
    if (back.order.join(",") !== left.order.join(",")) throw new Error(`the feed's order changed on Back: [${left.order}] → [${back.order}]`);
    const dealsAfter = await deals(page);
    if (dealsAfter !== dealsBefore) throw new Error(`Back asked the feed for a new deal (${dealsBefore} → ${dealsAfter} seeds)`);
    if (Math.abs((await scrollY(page)) - y) > SCROLL_TOLERANCE) throw new Error(`the feed moved after the return settled (${y}px → ${await scrollY(page)}px)`);
    return { scrollBefore: y, scrollOnThePostPage: onPost, scrollAfterReturn: after, topPostBefore: left.top, topPostAfter: back.top };
  });
}

control("feed scroll position: a FRESH visit to the feed starts at the top and is a NEW deal (nothing is restored on a push)", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  await scrollFeedDown(page);
  await feedQuiet(page);
  const dealsBefore = await deals(page);
  await page.goBack();
  await waitWhere(page, "/below");
  await page.getByTestId("to-feed").click();
  await waitWhere(page, "/feed");
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  await settle(page, 800);
  const y = await scrollY(page);
  if (y > 100) throw new Error(`a fresh visit to the feed opened ${y}px down`);
  // R-LIVE-5 / 2026-08-05: a fresh visit is a new deal (B1 keeps the deal only on Back).
  let dealsAfter = await deals(page);
  for (let i = 0; i < 80 && dealsAfter <= dealsBefore; i++) { await page.waitForTimeout(100); dealsAfter = await deals(page); }
  if (dealsAfter <= dealsBefore) throw new Error(`a fresh visit to the feed did not ask for a new deal (${dealsBefore} → ${dealsAfter} seeds)`);
  return { scrollOnFreshVisit: y, dealsBefore, dealsAfter };
});

// S4-a · UNDER A POST, THE INSTAGRAM WAY: "More posts from <name>" (the
// author's other posts, never the one on screen) and the feed beneath — and
// neither is a dead end: a post opened from there comes Back to this post,
// and Back again to the feed. The post page reads the feed's CURRENT deal; it
// must not ask the server for a new one behind the member's back.
journey("post page: More posts from <name> + the feed beneath → open one → Back → the post → Back → feed", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  await feedQuiet(page);
  const postId = await page.evaluate(() => window.__nav.postId);
  const dealsBefore = await deals(page);
  await page.getByTestId("to-post").click();
  await waitWhere(page, `/post/${postId}`);
  const more = page.getByTestId("more-posts-from");
  await more.waitFor({ timeout: 60000 });
  if (!/More posts from/i.test(await more.getByRole("heading").innerText())) throw new Error("the section has no \"More posts from\" heading");
  const tiles = more.getByRole("button");
  const tileCount = await tiles.count();
  if (tileCount < 1) throw new Error("More posts from <name> shows no posts");
  const beneath = page.getByTestId("post-page-feed");
  await beneath.waitFor({ timeout: 60000 });
  const feedIds = await beneath.locator("[data-post-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-post-id")));
  if (feedIds.length < 1) throw new Error("the feed beneath the post is empty");
  if (feedIds.includes(postId)) throw new Error("the feed beneath repeats the post on screen");
  if (new Set(feedIds).size !== feedIds.length) throw new Error(`the feed beneath repeats a post: [${feedIds}]`);
  if ((await deals(page)) !== dealsBefore) throw new Error("the post page asked the feed for a new deal");
  // The wall's grid: the first tap shows the counts, the second opens the post.
  await tiles.first().click();
  await tiles.first().click();
  const t0 = Date.now();
  let other = await where(page);
  while ((other === `/post/${postId}` || !other.startsWith("/post/")) && Date.now() - t0 < 8000) { await page.waitForTimeout(100); other = await where(page); }
  if (!other.startsWith("/post/") || other === `/post/${postId}`) throw new Error(`a tile under the post opened ${other}`);
  await page.getByRole("button", { name: "Back", exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await waitWhere(page, `/post/${postId}`);
  await page.goBack();
  await waitWhere(page, "/feed");
  return { tiles: tileCount, beneath: feedIds.length, opened: other };
});

// S4-b · A COMMENT NOTIFICATION OPENS THE POST ON THAT COMMENT: the thread
// opens by itself, the comment is in it (even past the first page, a reply
// whose parent is not loaded either), it is marked, and it is ON SCREEN —
// inside the thread's own scrolling band, not merely somewhere in the DOM.
// Back closes the thread and Back again leaves the post, as for any thread.
async function highlighted(page, commentId, label) {
  const row = dialog(page).locator(`[data-comment-id="${commentId}"]`);
  try { await row.waitFor({ state: "attached", timeout: 20000 }); } catch { throw new Error(`${label}: the comment ${commentId} is not in the thread`); }
  if ((await row.getAttribute("data-highlighted")) !== "true") throw new Error(`${label}: the comment is in the thread but not marked`);
  const t0 = Date.now();
  let seen = null;
  while (Date.now() - t0 < 6000) {
    seen = await row.evaluate((el) => {
      const r = el.getBoundingClientRect();
      let band = el.parentElement;
      while (band && !/(auto|scroll)/.test(getComputedStyle(band).overflowY)) band = band.parentElement;
      const b = band ? band.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), bandTop: Math.round(b.top), bandBottom: Math.round(b.bottom) };
    });
    if (seen.top >= seen.bandTop - 1 && seen.bottom <= seen.bandBottom + 1) return seen;
    await page.waitForTimeout(150);
  }
  throw new Error(`${label}: the marked comment is off screen (${JSON.stringify(seen)})`);
}

journey("bell / Notifications row: comment notification → the post opens on that comment (past the first page, a reply) → Back closes → Back → feed", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  const postId = await page.evaluate(() => window.__nav.postId);
  const far = await page.evaluate(() => window.__navComments.far);
  await page.getByTestId("to-post-comment").click();
  await dialog(page).waitFor({ state: "visible", timeout: 60000 });
  await waitWhere(page, `/post/${postId}?comments=${postId}`);
  const at = await highlighted(page, far, "from the bell");
  await page.goBack();
  await waitWhere(page, `/post/${postId}`);
  await noDialog(page, "after the first Back");
  await page.goBack();
  await waitWhere(page, "/feed");
  await noDialog(page, "after the second Back");
  return at;
});

control("a post opened WITHOUT a comment notification does not open its comments", DESKTOP, async (page) => {
  await openFeedFromBelow(page);
  const postId = await page.evaluate(() => window.__nav.postId);
  await page.getByTestId("to-post").click();
  await waitWhere(page, `/post/${postId}`);
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  await settle(page, 1500);
  if (await dialog(page).first().isVisible().catch(() => false)) throw new Error("the comments opened on their own");
});

journey("native (Android stub): cold start → reply notification tap → post on that reply, marked → Back ×2 → feed → Back leaves", PHONE, async (page) => {
  await startAt(page, "/", true);
  await nativeReady(page);
  const postId = await page.evaluate(() => window.__nav.postId);
  const reply = await page.evaluate(() => window.__navComments.reply);
  await page.evaluate((id) => window.__navNative.tap({ type: "comment_reply", reference_id: id }), postId);
  await dialog(page).waitFor({ state: "visible", timeout: 60000 });
  await waitWhere(page, `/post/${postId}?comments=${postId}`);
  const at = await highlighted(page, reply, "from the push");
  await pressBack(page);
  await waitWhere(page, `/post/${postId}`);
  await noDialog(page, "after the first Back");
  await pressBack(page);
  await waitWhere(page, "/feed");
  if ((await exits(page)) !== 0) throw new Error("Back left the app instead of landing on the feed");
  await pressBack(page);
  if ((await exits(page)) !== 1) throw new Error(`on the feed with nothing beneath, Back must leave the app once (asked ${await exits(page)} times)`);
  return at;
});

journey("native (Android stub): cold start → notification tap → post → comments → Back ×2 → feed → Back leaves the app", PHONE, async (page) => {
  await startAt(page, "/", true);
  await nativeReady(page);
  const postId = await page.evaluate(() => window.__nav.postId);
  // A REACTION notification: the post opens with its comments closed (S4-b:
  // a COMMENT notification opens them by itself — its own journey above).
  await page.evaluate((id) => window.__navNative.tap({ type: "post_reaction", reference_id: id }), postId);
  await waitWhere(page, `/post/${postId}`);
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  await openComments(page);
  await waitWhere(page, `/post/${postId}?comments=${postId}`);
  await pressBack(page); // closes the sheet
  await waitWhere(page, `/post/${postId}`);
  await noDialog(page, "after the first Back");
  if ((await exits(page)) !== 0) throw new Error("Back left the app from the post — the feed was not beneath it");
  await pressBack(page); // leaves the post
  await waitWhere(page, "/feed");
  await noDialog(page, "after the second Back");
  if ((await exits(page)) !== 0) throw new Error("Back left the app instead of landing on the feed");
  await pressBack(page);
  if ((await exits(page)) !== 1) throw new Error(`on the feed with nothing beneath, Back must leave the app once (asked ${await exits(page)} times)`);
  if ((await where(page)) !== "/feed") throw new Error(`the third Back moved to ${await where(page)}`);
});

journey("native (Android stub): cold start → notification for a post that is gone → the feed, with a short notice", PHONE, async (page) => {
  await startAt(page, "/", true);
  await nativeReady(page);
  await page.evaluate((id) => window.__navNative.tap({ type: "post_comment", reference_id: id }), GONE_POST);
  await waitWhere(page, "/feed", 20000);
  await page.getByText("That post is no longer available.").first().waitFor({ state: "visible", timeout: 10000 });
  await pressBack(page);
  // The notice itself is a layer Back may be asked to close first; either way
  // the app must not be stuck on a dead post, and Back must reach "leave".
  if ((await exits(page)) === 0) await pressBack(page);
  if ((await exits(page)) !== 1) throw new Error(`Back never left the app (asked ${await exits(page)} times)`);
  if ((await where(page)) !== "/feed") throw new Error(`ended on ${await where(page)}`);
});

/** The one comment notification the harness bell and Notifications page hold (src/uiharness/nav/main.tsx). */
const BELL_ACTOR = "Noor Abadi";

// S4-c · BACK PER ENTRY. Where Back goes depends on how the member arrived:
//   · the bell (a dropdown on top of whatever page they were on) → Back
//     returns to THAT page;
//   · the Notifications page → Back returns to the Notifications page, and
//     the post's own ← Back does too;
//   · a push notification or an outside link → Back goes to the feed, warm
//     or cold — never out of the app, never to a blank page.
// The bell and the Notifications page here are the REAL components.
// A CONTROL: the bell's row was already an in-app Link, so Back already
// returned to the page beneath — it must STAY so now that the row carries state.
control("bell → a comment notification → the post → Back → the page the member was on (and the bell is closed)", DESKTOP, async (page) => {
  await startAt(page, "/below");
  await page.getByRole("button", { name: "Notifications" }).first().click({ timeout: 120000 });
  await tapSettled(page, page.getByText(BELL_ACTOR).first());
  const postId = await page.evaluate(() => window.__nav.postId);
  await waitWhere(page, `/post/${postId}?comments=${postId}`);
  await page.goBack();
  await waitWhere(page, `/post/${postId}`);
  await page.goBack();
  await waitWhere(page, "/below");
  await noDialog(page, "after Back");
});

// A CONTROL: the Notifications page already pushed the post on top of itself.
control("Notifications page → a notification → the post → Back → the Notifications page; the post's ← Back too", DESKTOP, async (page) => {
  await startAt(page, "/below");
  await inApp(page, "/notifications");
  await waitWhere(page, "/notifications");
  const postId = await page.evaluate(() => window.__nav.postId);
  await tapSettled(page, page.getByText(BELL_ACTOR).first(), 120000);
  await waitWhere(page, `/post/${postId}?comments=${postId}`);
  await page.goBack();
  await waitWhere(page, `/post/${postId}`);
  await page.goBack();
  await waitWhere(page, "/notifications");
  await tapSettled(page, page.getByText(BELL_ACTOR).first());
  await waitWhere(page, `/post/${postId}?comments=${postId}`);
  await page.goBack();
  await waitWhere(page, `/post/${postId}`);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await waitWhere(page, "/notifications");
});

journey("outside link straight to /notifications → its ← Back → the feed, no extra step (never a blank page)", DESKTOP, async (page) => {
  await startAt(page, "/notifications");
  const back = page.getByRole("button", { name: "Back", exact: true });
  await back.waitFor({ timeout: 120000 });
  const before = await histLen(page);
  await back.click();
  await waitWhere(page, "/feed");
  if ((await histLen(page)) !== before) throw new Error("the fallback to the feed must REPLACE, not push");
});

journey("native (Android stub): app OPEN on another page → push tap → post → Back → the feed (not the page it was on) → Back → that page", PHONE, async (page) => {
  await startAt(page, "/", true);
  await nativeReady(page);
  await inApp(page, "/below");
  await waitWhere(page, "/below");
  const postId = await page.evaluate(() => window.__nav.postId);
  await page.evaluate((id) => window.__navNative.tap({ type: "post_reaction", reference_id: id }), postId);
  await waitWhere(page, `/post/${postId}`);
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  await pressBack(page);
  await waitWhere(page, "/feed");
  if ((await exits(page)) !== 0) throw new Error("Back left the app");
  await pressBack(page);
  await waitWhere(page, "/below");
  if ((await exits(page)) !== 0) throw new Error("Back left the app");
  // #510 review: the feed and the post were pushed in ONE tick — Back's count
  // must hold both, or this Back would leave the app with the start beneath.
  await pressBack(page);
  await waitWhere(page, "/");
  if ((await exits(page)) !== 0) throw new Error("Back left the app with the start screen still beneath");
  await pressBack(page);
  if ((await exits(page)) !== 1) throw new Error(`at the start, Back must leave the app once (asked ${await exits(page)} times)`);
});

journey("native (Android stub): app open ON the feed → push tap → post → Back → the feed, once (no second feed beneath)", PHONE, async (page) => {
  await startAt(page, "/", true);
  await nativeReady(page);
  await inApp(page, "/feed");
  await waitWhere(page, "/feed");
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  const postId = await page.evaluate(() => window.__nav.postId);
  await page.evaluate((id) => window.__navNative.tap({ type: "post_reaction", reference_id: id }), postId);
  await waitWhere(page, `/post/${postId}`);
  await commentButtons(page).first().waitFor({ timeout: 60000 });
  await pressBack(page);
  await waitWhere(page, "/feed");
  await pressBack(page);
  await waitWhere(page, "/");
  if ((await exits(page)) !== 0) throw new Error("Back left the app");
});

const result = { at: new Date().toISOString(), browser: BROWSER, origin: ORIGIN || BASE, version: null, journeys: [], verdict: "FAIL" };
let code = 1;
let browser;
try {
  if (ownServer) await waitUp();
  browser = await launch();
  result.version = browser.version();
  // At the app's origin: the journeys about how the APP is entered and left —
  // push taps and Android Back, the bell, the Notifications page, outside links.
  const APP_JOURNEY = /native|bell|Notifications|outside link|external link/;
  const chosen = (ONLY ? JOURNEYS.filter((x) => x.name.includes(ONLY)) : JOURNEYS).filter((x) => !ORIGIN || APP_JOURNEY.test(x.name));
  if (chosen.length === 0) throw new Error("no journey matched — a run that measures nothing is not a pass");
  for (const j of chosen) {
    const ctx = await browser.newContext({ viewport: j.viewport });
    if (ORIGIN) await serveAtOrigin(ctx);
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    const row = { name: j.name, viewport: `${j.viewport.width}x${j.viewport.height}`, control: j.control, pass: false };
    try {
      const extra = await j.fn(page);
      row.pass = true;
      if (extra) row.reading = extra;
    } catch (e) {
      row.error = String(e?.message || e).split("\n")[0];
      row.at = await where(page).catch(() => null);
    }
    if (consoleErrors.length) row.pageErrors = consoleErrors.slice(0, 3);
    result.journeys.push(row);
    console.log(`${row.pass ? "PASS" : "FAIL"}  [${BROWSER}] ${j.control ? "(control) " : ""}${j.name}${row.error ? `  — ${row.error}` : ""}${row.reading ? `  ${JSON.stringify(row.reading)}` : ""}`);
    await ctx.close();
  }
  result.verdict = result.journeys.every((r) => r.pass) ? "PASS" : "FAIL";
  code = result.verdict === "PASS" ? 0 : 1;
} catch (e) {
  result.error = String(e?.message || e);
  console.error(result.error);
} finally {
  await browser?.close().catch(() => {});
  stop();
}
console.log(`${result.verdict}  ${BROWSER} ${result.version ?? ""} at ${ORIGIN || BASE}: ${result.journeys.filter((r) => r.pass).length}/${result.journeys.length} journeys`);
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
process.exit(code);
