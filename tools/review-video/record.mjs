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
 * HOW. Appium (XCUITest driver) attaches to the app's WKWebView (Debug builds
 * are inspectable), and every step runs against the live DOM: a red tap marker
 * is drawn where the step "taps", then the element is clicked. A caption bar
 * at the top of the screen says what is being shown, so a reviewer can follow
 * the video without sound.
 *
 * WHAT IT WRITES TO PRODUCTION, on purpose and nothing else:
 *   video 1  one post report and one block by the DEMO account, then the block
 *            is undone on camera (Settings > Blocked members > Unblock);
 *   video 2  deletion of the THROWAWAY account given in REVIEW_DELETE_*.
 *
 * NO CAPTCHA IS BYPASSED. Sign-in goes through the app's normal flow, including
 * Cloudflare Turnstile. If Turnstile refuses the runner, the script stops and
 * says so; it does not try to get around it.
 *
 * Credentials come only from the environment and are never printed.
 */
import { remote } from "webdriverio";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const UDID = need("SIM_UDID");
const OUT = process.env.OUT_DIR || "review-videos";
const DEMO = { email: need("REVIEW_DEMO_EMAIL"), password: need("REVIEW_DEMO_PASSWORD") };
const DEL = { email: need("REVIEW_DELETE_EMAIL"), password: need("REVIEW_DELETE_PASSWORD") };
const ONLY = (process.env.ONLY || "").trim(); // "1", "2" or "" for both
mkdirSync(OUT, { recursive: true });

function need(k) {
  const v = process.env[k];
  if (!v) { console.error(`::error::${k} is not set. Add it under Settings > Secrets and variables > Actions.`); process.exit(2); }
  return v;
}
const log = (m) => console.log(`[review-video] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── screen recording ──────────────────────────────────────────────────────
function startRecording(name) {
  const file = `${OUT}/${name}.mp4`;
  const p = spawn("xcrun", ["simctl", "io", UDID, "recordVideo", "--codec=h264", "--force", file], { stdio: "inherit" });
  log(`recording → ${file}`);
  return { file, stop: () => new Promise((res) => { p.on("exit", () => res(file)); p.kill("SIGINT"); }) };
}

// ── driver ────────────────────────────────────────────────────────────────
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
    "appium:bundleId": "com.fiftymmretina.app",
    "appium:noReset": true,
    "appium:autoAcceptAlerts": true,
    "appium:newCommandTimeout": 900,
    "appium:wdaLaunchTimeout": 1_200_000,
    "appium:wdaConnectionTimeout": 1_200_000,
    "appium:webviewConnectTimeout": 60_000,
    "appium:includeSafariInWebviews": false,
  },
});

async function toWebview() {
  for (let i = 0; i < 60; i++) {
    const ctxs = await driver.getContexts();
    const wv = ctxs.map((c) => (typeof c === "string" ? c : c.id)).find((c) => c.startsWith("WEBVIEW"));
    if (wv) { await driver.switchContext(wv); log(`context ${wv}`); return; }
    await sleep(2000);
  }
  throw new Error("The app's web view never became inspectable (is this a Debug build?)");
}

// Page-side helpers, installed once per page load. Kept as one string so the
// exact code that runs in the app is readable here.
const HELPERS = `
if (!window.__rv) {
  const st = document.createElement('style');
  st.textContent = '#__rv_cap{position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top) + 6px);z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;font:600 15px/1.35 -apple-system,system-ui,sans-serif;padding:10px 12px;border-radius:12px;border:2px solid #f59e0b;pointer-events:none;text-align:center}'
    + '.__rv_tap{position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(239,68,68,.45);border:3px solid #ef4444;pointer-events:none;transition:transform .5s,opacity .5s}';
  document.head.appendChild(st);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const clickable = (el) => el.closest('button,a,[role=menuitem],[role=tab],label,input') || el;
  window.__rv = {
    caption(t) { let c = document.getElementById('__rv_cap'); if (!c) { c = document.createElement('div'); c.id = '__rv_cap'; document.body.appendChild(c); } c.textContent = t; },
    byText(re, root) {
      const rx = new RegExp(re, 'i');
      const all = [...(root || document).querySelectorAll('button,a,[role=menuitem],[role=tab],label,span,div,h1,h2,h3,p')];
      const hits = all.filter((el) => visible(el) && rx.test((el.innerText || '').trim()) && ![...el.children].some((ch) => rx.test((ch.innerText || '').trim())));
      return hits.length ? clickable(hits[hits.length - 1]) : null;
    },
    mark(el) { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const d = document.createElement('div'); d.className = '__rv_tap'; d.style.left = (r.left + r.width / 2) + 'px'; d.style.top = (r.top + r.height / 2) + 'px'; document.body.appendChild(d); setTimeout(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; }, 450); setTimeout(() => d.remove(), 1100); },
    setInput(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
    go(path) { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); },
  };
}`;
const js = async (body, ...args) => { await driver.execute(HELPERS); return driver.execute(body, ...args); };

async function caption(t) { log(`caption: ${t}`); await js("window.__rv.caption(arguments[0])", t); await sleep(1800); }
async function waitFor(fnBody, what, ms = 30_000, ...args) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await js(fnBody, ...args)) return; } catch { /* page navigating */ }
    await sleep(500);
  }
  const text = await js("return (document.body.innerText || '').slice(0, 1500)").catch(() => "");
  throw new Error(`Timed out waiting for: ${what}\n--- page text ---\n${text}`);
}
/** Tap the element found by `finder` (JS returning an element). */
async function tap(finder, what, ...args) {
  await waitFor(`return !!(${finder})`, what, 30_000, ...args);
  await js(`const el = ${finder}; window.__rv.mark(el);`, ...args);
  await sleep(650);
  await js(`const el = ${finder}; el.click();`, ...args);
  log(`tapped: ${what}`);
  await sleep(1200);
}
const tapText = (re, what) => tap("window.__rv.byText(arguments[0])", what || re, re);
async function typeInto(selector, value, what, secret = false) {
  await waitFor(`return !!document.querySelector(arguments[0])`, what, 30_000, selector);
  await js("const el=document.querySelector(arguments[0]); window.__rv.mark(el); el.focus();", selector);
  await sleep(500);
  await js("window.__rv.setInput(document.querySelector(arguments[0]), arguments[1])", selector, value);
  log(`typed ${secret ? "(hidden)" : JSON.stringify(value)} into ${what}`);
  await sleep(700);
}
const path = () => js("return location.pathname + location.search");
async function go(p) { await js("window.__rv.go(arguments[0])", p); await sleep(2000); }
async function signOutOffCamera() {
  await js("try{localStorage.clear();sessionStorage.clear();}catch(e){} location.replace('/login');");
  await sleep(4000);
}
async function signIn(acct, label) {
  await go("/login");
  await caption(`Sign in with the ${label} (email + password — the only sign-in on iOS)`);
  await typeInto('input[type="email"]', acct.email, "email");
  await tap(`document.querySelector('button[type="submit"]')`, "Continue");
  await typeInto('input[autocomplete="current-password"], input[type="password"]', acct.password, "password", true);
  await tap(`[...document.querySelectorAll('button[type="submit"]')].pop()`, "Sign in");
  try {
    await waitFor("return !location.pathname.startsWith('/login')", "leaving /login after sign-in", 45_000);
  } catch (e) {
    throw new Error(`Sign-in did not complete. If the page mentions a captcha, Cloudflare refused this runner (not bypassed by design).\n${e.message}`);
  }
  log(`signed in as ${label}, now at ${await path()}`);
}

// ── VIDEO 1: Terms (EULA) → Report → Block → Blocked members ─────────────
async function video1() {
  await signOutOffCamera();
  const rec = startRecording("video1-terms-report-block");
  try {
    await sleep(1500);
    await caption("50mm Retina World (iOS) — Guideline 1.2: Terms, Report and Block");
    await go("/signup");
    await caption("Sign Up: an account cannot be created without agreeing to the Terms (EULA)");
    await tap(`document.querySelector('[data-testid="signup-eula-checkbox"]')`, "Terms checkbox");
    await caption("The Terms state there is no tolerance for objectionable content or abusive users");
    await tap(`[...document.querySelectorAll('a[href="/community-guidelines"]')].pop()`, "Terms link");
    await waitFor("return location.pathname === '/community-guidelines'", "terms page");
    for (let i = 0; i < 6; i++) { await js("window.scrollBy({top: 280, behavior: 'smooth'})"); await sleep(900); }
    await js("history.back()"); await sleep(2000);

    await signIn(DEMO, "demo account");
    await go("/feed");
    await caption("Feed: every post by another member has a ••• menu with Report and Block");
    // First post whose menu offers "Report content" (i.e. not the demo account's own post).
    const MENU = `[...document.querySelectorAll('button.grid.h-11.w-11')].filter(b => b.querySelector('svg'))`;
    await waitFor(`return ${MENU}.length > 0`, "post menus in the feed", 45_000);
    let found = false;
    const n = await js(`return ${MENU}.length`);
    for (let i = 0; i < n && !found; i++) {
      await js(`const b=${MENU}[arguments[0]]; b.scrollIntoView({block:'center'}); window.__rv.mark(b);`, i);
      await sleep(600);
      await js(`${MENU}[arguments[0]].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0}))`, i);
      await sleep(900);
      found = await js("return !!window.__rv.byText('^Report content$')");
      if (!found) { await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await sleep(600); }
      else await js("window.__rvMenuIndex = arguments[0]", i);
    }
    if (!found) throw new Error("No post by another member was found in the demo account's feed.");
    await tapText("^Report content$", "Report content");
    await caption("Report: choose a reason and submit — it goes to our moderation team");
    await tapText("^Inappropriate$", "reason: Inappropriate");
    await tapText("^Submit Report$", "Submit Report");
    await waitFor("return /Report submitted/i.test(document.body.innerText)", "Report submitted toast", 15_000).catch(() => log("toast not seen (may have faded)"));
    await sleep(1500);

    await caption("Block: removes the member's content from your feed instantly and notifies our moderators");
    await js(`const b=${MENU}[window.__rvMenuIndex]; b.scrollIntoView({block:'center'}); window.__rv.mark(b);`);
    await sleep(600);
    await js(`${MENU}[window.__rvMenuIndex].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0}))`);
    await sleep(900);
    const blockedName = await js("const el=document.querySelector('[data-testid=\"post-block-user\"]'); return el ? el.innerText.replace(/^Block\\s*/,'').trim() : ''");
    await tap(`document.querySelector('[data-testid="post-block-user"]')`, "Block member");
    await tap(`[...document.querySelectorAll('[role=alertdialog] button')].find(b => b.innerText.trim() === 'Block')`, "confirm Block");
    await caption(`${blockedName || "The member"} is blocked — their posts are gone from the feed`);
    await sleep(2500);

    await go("/dashboard?tab=settings");
    await waitFor("return !!window.__rv.byText('^Blocked members$')", "Blocked members section", 30_000);
    await js("window.__rv.byText('^Blocked members$').scrollIntoView({block:'start'}); window.scrollBy(0,-90)");
    await caption("Dashboard › Settings › Blocked members lists everyone you have blocked");
    await sleep(2500);
    await caption("Members can also unblock from here");
    await tapText("^Unblock$", "Unblock");
    await sleep(2000);
    await caption("End of recording — Terms, Report and Block");
  } finally {
    await rec.stop();
  }
}

// ── VIDEO 2: in-app account deletion ─────────────────────────────────────
async function video2() {
  await signOutOffCamera();
  const rec = startRecording("video2-delete-account");
  try {
    await sleep(1500);
    await caption("50mm Retina World (iOS) — Guideline 5.1.1(v): deleting an account in the app");
    await signIn(DEL, "test account to be deleted");
    await go("/feed");
    await caption("Open the Profile menu (bottom bar)");
    await tapText("^Profile$", "Profile tab");
    await caption("Tap Delete Account");
    await tapText("^Delete Account$", "Delete Account");
    await waitFor("return !!document.getElementById('delete-account')", "Delete Account section", 30_000);
    await sleep(1500);
    await caption("Delete My Account → type DELETE → Delete Forever");
    await tapText("^Delete My Account$", "Delete My Account");
    await typeInto('input[aria-label="Type DELETE to confirm account deletion"]', "DELETE", "confirmation box");
    await tapText("^Delete Forever$", "Delete Forever");
    await waitFor("return !location.pathname.startsWith('/dashboard')", "sign-out after deletion", 60_000);
    await caption("The account and its data are deleted and the user is signed out");
    await sleep(3000);
    await caption("End of recording — account deletion");
  } finally {
    await rec.stop();
  }
}

let failed = false;
try {
  await toWebview();
  if (!ONLY || ONLY === "1") await video1();
  if (!ONLY || ONLY === "2") await video2();
} catch (e) {
  failed = true;
  console.error(`::error::${String(e.message || e).split("\n")[0]}`);
  console.error(e.message || e);
  try { await driver.saveScreenshot(`${OUT}/failure.png`); } catch { /* ignore */ }
} finally {
  await driver.deleteSession().catch(() => {});
}
process.exit(failed ? 1 : 0);
