#!/usr/bin/env node
/**
 * App Store review videos, recorded on the iOS Simulator by a GitHub job.
 *
 * WHY THIS EXISTS. App Review (2026-09-28, guidelines 1.2 and 5.1.1(v)) asked
 * for screen recordings of: the Terms (EULA) agreement, Report, Block, and
 * in-app account deletion. The Owner cannot record a phone himself, so this
 * script drives the REAL app (the same web bundle the TestFlight build ships,
 * production backend) inside the simulator and records the simulator screen.
 *
 * HOW (rewritten after runs #3-#4). The first version drove the app through
 * the WKWebView's remote-inspector ("WEBVIEW" context). On the runner's newest
 * simulator (iOS 26.2) that context never appeared, even with the web view
 * marked inspectable. This version does not need it: it reads and taps the app
 * through the iOS ACCESSIBILITY tree (XCUITest), the same layer Apple's own UI
 * tests and VoiceOver use. Every element is found by the name a VoiceOver user
 * would hear ("Proceed", "Post options", "Report content", "Delete Forever").
 *
 * Captions are burned into the video afterwards with ffmpeg from the timestamps
 * recorded here, so nothing is injected into the app.
 *
 * EVIDENCE, independent of the video: a screenshot after every step and the
 * accessibility tree (page source) on any failure go to OUT_DIR/steps/.
 *
 * WHAT IT WRITES TO PRODUCTION, on purpose and nothing else:
 *   video 1  one post report and one block by the DEMO account; the block is
 *            undone on camera (Settings > Blocked members > Unblock);
 *   video 2  deletion of the THROWAWAY account given in REVIEW_DELETE_*.
 *
 * NO CAPTCHA IS BYPASSED. Sign-in goes through the app's normal flow, including
 * Cloudflare Turnstile. If sign-in does not complete, the script stops and says
 * so. Credentials come only from the environment and are never printed.
 */
import { remote } from "webdriverio";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const UDID = need("SIM_UDID");
const APP_PATH = need("APP_PATH");
const BUNDLE = "com.fiftymmretina.app";
const OUT = process.env.OUT_DIR || "review-videos";
const STEPS = `${OUT}/steps`;
const DEMO = { email: need("REVIEW_DEMO_EMAIL"), password: need("REVIEW_DEMO_PASSWORD") };
const DEL = { email: need("REVIEW_DELETE_EMAIL"), password: need("REVIEW_DELETE_PASSWORD") };
const ONLY = (process.env.ONLY || "").trim(); // "1", "2" or "" for both
mkdirSync(STEPS, { recursive: true });

function need(k) {
  const v = process.env[k];
  if (!v) { console.error(`::error::${k} is not set.`); process.exit(2); }
  return v;
}
const log = (m) => console.log(`[review-video] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const simctl = (...a) => spawnSync("xcrun", ["simctl", ...a], { stdio: "inherit" });

/** Fresh, signed-out app: uninstall + install + launch (clears the session). */
function freshApp() {
  simctl("terminate", UDID, BUNDLE);
  simctl("uninstall", UDID, BUNDLE);
  simctl("install", UDID, APP_PATH);
  simctl("launch", UDID, BUNDLE);
}

// ── recording + captions ─────────────────────────────────────────────────
let rec = null;
function startRecording(name) {
  const raw = `${OUT}/${name}.raw.mp4`;
  const p = spawn("xcrun", ["simctl", "io", UDID, "recordVideo", "--codec=h264", "--force", raw], { stdio: "inherit" });
  rec = { name, raw, t0: Date.now(), caps: [], proc: p };
  log(`recording → ${raw}`);
}
async function stopRecording() {
  if (!rec) return;
  const r = rec; rec = null;
  await new Promise((res) => { r.proc.on("exit", res); r.proc.kill("SIGINT"); });
  const end = (Date.now() - r.t0) / 1000;
  writeFileSync(`${OUT}/${r.name}.captions.json`, JSON.stringify({ end, caps: r.caps }, null, 2));
  log(`recorded ${r.name} (${end.toFixed(1)} s, ${r.caps.length} captions)`);
}
async function caption(text) {
  log(`caption: ${text}`);
  if (rec) rec.caps.push({ t: (Date.now() - rec.t0) / 1000, text });
  await sleep(2200);
}

// ── driver (native accessibility only) ───────────────────────────────────
const driver = await remote({
  hostname: "127.0.0.1",
  port: 4723,
  logLevel: "warn",
  connectionRetryTimeout: 1_200_000,
  connectionRetryCount: 1,
  capabilities: {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": UDID,
    ...(process.env.SIM_NAME ? { "appium:deviceName": process.env.SIM_NAME } : {}),
    ...(process.env.SIM_VERSION ? { "appium:platformVersion": process.env.SIM_VERSION } : {}),
    "appium:simulatorStartupTimeout": 600_000,
    "appium:bundleId": BUNDLE,
    "appium:noReset": true,
    "appium:autoAcceptAlerts": true,
    "appium:newCommandTimeout": 900,
    "appium:wdaLaunchTimeout": 1_200_000,
    "appium:wdaConnectionTimeout": 1_200_000,
    // Web content in a WKWebView is deep in the tree; the default snapshot
    // depth can cut it off.
    "appium:snapshotMaxDepth": 62,
  },
});

let W = 390, H = 844;
let stepNo = 0;
async function shot(label) {
  stepNo += 1;
  const f = `${STEPS}/${String(stepNo).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png`;
  try { await driver.saveScreenshot(f); } catch { /* ignore */ }
}
async function dumpSource(tag) {
  try { writeFileSync(`${STEPS}/source-${tag}.xml`, await driver.getPageSource()); } catch { /* ignore */ }
}

const q = (s) => s.replace(/"/g, '\\"');
const P = {
  is: (label) => `label == "${q(label)}" OR name == "${q(label)}"`,
  begins: (prefix) => `label BEGINSWITH "${q(prefix)}"`,
  type: (t) => `type == "${t}"`,
};
const onScreen = (r) => r.width > 0 && r.height > 0 && r.y + r.height > 60 && r.y < H - 40 && r.x < W && r.x + r.width > 0;

/** All matching elements with their rects. */
async function all(pred) {
  const els = await driver.$$(`-ios predicate string:${pred}`);
  const out = [];
  for (const el of els) {
    try { out.push({ el, r: await driver.getElementRect(el.elementId) }); } catch { /* stale */ }
  }
  return out;
}
/** Wait for a matching element; prefer one on screen. */
async function find(pred, what, timeout = 30_000) {
  const end = Date.now() + timeout;
  let last = [];
  while (Date.now() < end) {
    last = await all(pred).catch(() => []);
    const vis = last.filter((x) => onScreen(x.r));
    if (vis.length) return vis[vis.length - 1];
    if (last.length) return last[last.length - 1];
    await sleep(700);
  }
  await shot(`missing-${what}`); await dumpSource(`missing-${what.replace(/[^a-z0-9]+/gi, "-")}`);
  throw new Error(`Not found on screen: ${what}`);
}
async function exists(pred, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const a = await all(pred).catch(() => []);
    if (a.some((x) => onScreen(x.r))) return true;
    await sleep(500);
  }
  return false;
}
async function swipe(dir) {
  const x = Math.round(W / 2);
  const [y1, y2] = dir === "up" ? [Math.round(H * 0.72), Math.round(H * 0.38)] : [Math.round(H * 0.38), Math.round(H * 0.72)];
  await driver.execute("mobile: dragFromToForDuration", { duration: 0.35, fromX: x, fromY: y1, toX: x, toY: y2 });
  await sleep(700);
}
/** Scroll until the element is comfortably inside the screen. */
async function reveal(pred, what, max = 14) {
  for (let i = 0; i < max; i++) {
    const a = await all(pred).catch(() => []);
    if (a.length) {
      const { r } = a[a.length - 1];
      if (r.y > 90 && r.y + r.height < H - 110) return a[a.length - 1];
      await swipe(r.y + r.height >= H - 110 ? "up" : "down");
    } else {
      await swipe("up");
    }
  }
  return find(pred, what, 5000);
}
async function tap(pred, what, { scroll = false, timeout } = {}) {
  const hit = scroll ? await reveal(pred, what) : await find(pred, what, timeout);
  const r = hit.r;
  await driver.execute("mobile: tap", { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  log(`tapped: ${what}`);
  await sleep(1300);
  await shot(what);
}
async function typeInto(pred, value, what, secret = false) {
  const { el, r } = await find(pred, what);
  await driver.execute("mobile: tap", { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  await sleep(500);
  await el.setValue(value);
  log(`typed ${secret ? "(hidden)" : JSON.stringify(value)} into ${what}`);
  await sleep(600);
  await shot(`typed-${what}`);
}
async function waitGone(pred, what, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (!(await exists(pred, 800))) return;
    await sleep(800);
  }
  await shot(`stuck-${what}`); await dumpSource(`stuck-${what.replace(/[^a-z0-9]+/gi, "-")}`);
  throw new Error(`Still on screen after ${timeout / 1000}s: ${what}`);
}

async function signIn(acct, label) {
  // Guest bottom bar → Join → the sign-in screen.
  await tap(P.is("Join"), "Join (bottom bar)");
  await caption(`Sign in with the ${label} — email and password (the only sign-in on iOS)`);
  await typeInto(P.type("XCUIElementTypeTextField"), acct.email, "email field");
  await tap(P.is("Proceed"), "Proceed");
  await typeInto(P.type("XCUIElementTypeSecureTextField"), acct.password, "password field", true);
  await tap(P.is("Sign In"), "Sign In");
  try {
    await waitGone(P.type("XCUIElementTypeSecureTextField"), "password field (sign-in pending)", 45_000);
  } catch (e) {
    throw new Error(`Sign-in did not complete. If the screen mentions a captcha, Cloudflare refused this runner (not bypassed by design). ${e.message}`);
  }
  await sleep(2500);
  await shot(`signed-in-${label}`);
  log(`signed in as ${label}`);
}

// ── VIDEO 1: Terms (EULA) → Report → Block → Blocked members ─────────────
async function video1() {
  freshApp();
  await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
  await sleep(6000);
  await shot("launch-video1");
  startRecording("video1-terms-report-block");
  try {
    await caption("50mm Retina World (iOS) — Guideline 1.2: Terms of Use, Report and Block");
    await tap(P.is("Join"), "Join (bottom bar)");
    await tap(P.is("Create one"), "Create one (sign up)");
    await caption("Sign Up: an account cannot be created without agreeing to the Terms of Use (EULA)");
    await tap(`${P.begins("I agree to the")} OR (${P.type("XCUIElementTypeSwitch")})`, "Terms checkbox", { scroll: true });
    await caption("The Terms say there is no tolerance for objectionable content or abusive users");
    await tap(P.is("Terms of Use & Community Guidelines"), "Terms link", { scroll: true });
    await sleep(1500);
    for (let i = 0; i < 5; i++) await swipe("up");
    await shot("terms-page");

    await signIn(DEMO, "demo account");
    await tap(P.is("Feed"), "Feed (bottom bar)");
    await caption("Every post by another member has a ••• menu with Report and Block");
    await find(P.is("Post options"), "a post menu", 45_000);

    // First post whose menu offers "Report content" (not the demo account's own).
    let chosen = -1;
    const menus = (await all(P.is("Post options"))).filter((x) => onScreen(x.r));
    for (let i = 0; i < menus.length && chosen < 0; i++) {
      const r = menus[i].r;
      await driver.execute("mobile: tap", { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      await sleep(1200);
      if (await exists(P.is("Report content"), 2500)) chosen = i;
      else { await driver.execute("mobile: tap", { x: 12, y: Math.round(H / 2) }); await sleep(800); }
    }
    if (chosen < 0) throw new Error("No post by another member on screen in the demo account's feed.");
    await shot("post-menu-open");
    const menuRect = menus[chosen].r;

    await tap(P.is("Report content"), "Report content");
    await caption("Report: choose a reason and submit — it goes to our moderation team");
    await tap(P.is("Inappropriate"), "reason Inappropriate", { scroll: true });
    await tap(P.is("Submit Report"), "Submit Report", { scroll: true });
    await sleep(2000);

    await caption("Block: hides the member's posts from your feed instantly and notifies our moderators");
    // The report panel closed; the menu button is back where it was (or close).
    const again = (await all(P.is("Post options"))).filter((x) => onScreen(x.r))
      .sort((a, b) => Math.abs(a.r.y - menuRect.y) - Math.abs(b.r.y - menuRect.y))[0];
    if (!again) throw new Error("Post menu not found again after reporting.");
    await driver.execute("mobile: tap", { x: Math.round(again.r.x + again.r.width / 2), y: Math.round(again.r.y + again.r.height / 2) });
    await sleep(1200);
    await tap(`${P.begins("Block ")} AND NOT (${P.is("Block")})`, "Block member (menu)");
    await tap(`(${P.is("Block")}) AND ${P.type("XCUIElementTypeButton")}`, "confirm Block");
    await sleep(2500);
    await caption("Blocked — that member's posts are gone from this feed");
    await shot("after-block");

    await tap(P.is("Profile"), "Profile (bottom bar)");
    await tap(P.is("Settings"), "Settings (menu)", { scroll: true });
    await reveal(P.is("Blocked members"), "Blocked members");
    await caption("Dashboard › Settings › Blocked members lists everyone you have blocked");
    await shot("blocked-members");
    await caption("Members can also unblock from here");
    await tap(P.is("Unblock"), "Unblock", { scroll: true });
    await caption("End of recording — Terms, Report and Block");
  } finally {
    await stopRecording();
  }
}

// ── VIDEO 2: in-app account deletion ─────────────────────────────────────
async function video2() {
  freshApp();
  await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
  await sleep(6000);
  await shot("launch-video2");
  startRecording("video2-delete-account");
  try {
    await caption("50mm Retina World (iOS) — Guideline 5.1.1(v): deleting an account inside the app");
    await signIn(DEL, "test account that will be deleted");
    await caption("Open the Profile menu from the bottom bar");
    await tap(P.is("Profile"), "Profile (bottom bar)");
    await caption("Tap Delete Account");
    await tap(P.is("Delete Account"), "Delete Account (menu)", { scroll: true });
    await caption("Delete My Account → type DELETE → Delete Forever");
    await tap(P.is("Delete My Account"), "Delete My Account", { scroll: true });
    await typeInto(P.is("Type DELETE to confirm account deletion"), "DELETE", "confirmation box");
    await tap(P.is("Delete Forever"), "Delete Forever");
    await find(P.is("Join"), "signed-out bottom bar after deletion", 60_000);
    await caption("The account and its data are deleted and the user is signed out");
    await shot("after-delete");
    await caption("End of recording — account deletion");
  } finally {
    await stopRecording();
  }
}

let failed = false;
try {
  const size = await driver.getWindowSize();
  W = size.width; H = size.height;
  log(`window ${W}x${H}`);
  await shot("session-start");
  await dumpSource("session-start");
  if (!ONLY || ONLY === "1") await video1();
  if (!ONLY || ONLY === "2") await video2();
} catch (e) {
  failed = true;
  console.error(`::error::${String(e.message || e).split("\n")[0]}`);
  console.error(e.stack || e);
  await shot("failure"); await dumpSource("failure");
} finally {
  await stopRecording().catch(() => {});
  await driver.deleteSession().catch(() => {});
}
process.exit(failed ? 1 : 0);
