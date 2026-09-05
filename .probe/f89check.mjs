/**
 * F-89 acceptance probe.
 *
 * Four false greens were reported against an earlier instrument and each is
 * defended against here explicitly:
 *
 *  v1  passed on a page that had never rendered ("Loading…" for ~29s).
 *      -> GATE ON THE 404's OWN HEADLINE, never on a timer.
 *  v2  counted the SITE HEADER's Login/Join as the 404's way back in.
 *      -> only links inside the page's own content are counted; anything inside
 *         header / footer / nav / aside is excluded.
 *  v3  measured the instant the text appeared; the sidebars land later.
 *      -> wait for the document to SETTLE (body text stable across samples)
 *         before measuring anything.
 *  v4  counted anchors that are in the DOM but display:none inside a hidden
 *      sidebar. -> visibility is measured from the box, not from presence.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PHASE = process.argv[2] || "after";
const SCENE_MODE = process.argv[3] === "scene";
const OUT = `/tmp/f89/${PHASE}`;
mkdirSync(OUT, { recursive: true });
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://127.0.0.1:5207";
/**
 * Real-server mode uses a MULTI-segment dead path, i.e. the catch-all route.
 *
 * The single-segment path (the Owner's exact case) goes through
 * CustomUrlProfile, whose resolve_custom_url RPC never settles in this
 * container — measured, 146s and still spinning, because the egress proxy
 * resets POSTs to supabase.co and the client does not give up. The 404 is
 * therefore never reached HERE and the page sits on the sidebar's "Welcome /
 * Join our community" forever. That is this container, not the product.
 *
 * The single-segment composition is covered instead by the jsdom test
 * `notFoundBareShell.test.tsx`, which asserts CustomUrlProfile's in-place
 * <NotFound /> raises the bare-shell flag.
 */
const DEAD = "/no/such/page/at/all";

const CASES = [
  { w: 1280, h: 900, theme: "dark", name: "desktop-1280" },
  { w: 1280, h: 900, theme: "light", name: "desktop-1280" },
  { w: 360, h: 800, theme: "dark", name: "android-360" },
  { w: 360, h: 800, theme: "light", name: "android-360" },
];

/** Present on both the old and the new page, so the gate works either side. */
const RENDERED = () => /This frame is empty|404/.test(document.body.innerText || "");

const MEASURE = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const isChrome = (el) => !!el.closest("header, footer, nav, aside");

  const asides = [...document.querySelectorAll("aside")].filter(visible);
  const anchors = [...document.querySelectorAll("a[href]")].filter((a) => visible(a) && !isChrome(a));
  const href = (h) => anchors.some((a) => (a.getAttribute("href") || "") === h);

  const h1 = document.querySelector("h1");
  return {
    sidebarsVisible: asides.length,
    pageOverflowPx: document.documentElement.scrollWidth - window.innerWidth,
    signup: href("/signup"),
    login: href("/login"),
    home: href("/"),
    ownLinks: anchors.map((a) => a.getAttribute("href")),
    h1: h1 ? h1.textContent.trim() : null,
    bodyLen: (document.body.innerText || "").length,
  };
};

async function settle(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  // 1. gate on render
  while (Date.now() < deadline) {
    if (await page.evaluate(RENDERED)) break;
    await page.waitForTimeout(500);
  }
  if (!(await page.evaluate(RENDERED))) throw new Error("404 never rendered within timeout");
  // 2. gate on settle — the headline lands before the sidebars do
  let prev = -1, stable = 0;
  while (Date.now() < deadline && stable < 3) {
    const len = await page.evaluate(() => (document.body.innerText || "").length);
    stable = len === prev ? stable + 1 : 0;
    prev = len;
    await page.waitForTimeout(400);
  }
  return prev;
}

const browser = await chromium.launch({ executablePath: EXE });
let failures = 0;
for (const c of CASES) {
  // Real-server mode can only be signed OUT here: auth comes from Supabase and
  // this container's proxy resets CONNECT to it. The signed-IN half is covered
  // by scene mode, where the harness seeds the session. Stated, not glossed.
  for (const signedOut of SCENE_MODE ? [true, false] : [true]) {
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 2 });
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), c.theme);
    const page = await ctx.newPage();
    const url = SCENE_MODE
      ? `${BASE}/uiharness.html?scene=${signedOut ? "screen-not-found-signed-out" : "screen-not-found"}`
      : `${BASE}${DEAD}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const bodyLen = await settle(page);
    const m = await page.evaluate(MEASURE);
    const who = signedOut ? "signed-out" : "signed-in ";
    await page.screenshot({ path: `${OUT}/${c.name}--${c.theme}--${who.trim()}.png`, fullPage: false });

    const problems = [];
    if (m.sidebarsVisible > 0) problems.push(`${m.sidebarsVisible} sidebar(s) visible`);
    if (m.pageOverflowPx > 0) problems.push(`horizontal overflow ${m.pageOverflowPx}px`);
    if (signedOut && !(m.signup && m.login)) problems.push("no signup+login in the page's own content");
    if (!signedOut && !m.home) problems.push("no way home in the page's own content");
    if (!signedOut && (m.signup || m.login)) problems.push("signed-in member shown auth links");
    if (problems.length) failures += problems.length;

    console.log(
      `  ${problems.length ? "FAIL" : "ok  "} ${c.name.padEnd(13)} ${c.theme.padEnd(6)} ${who} ` +
      `asides=${m.sidebarsVisible} overflow=${m.pageOverflowPx} signup=${String(m.signup).padEnd(5)} ` +
      `login=${String(m.login).padEnd(5)} home=${String(m.home).padEnd(5)} bodyLen=${bodyLen} h1=${JSON.stringify(m.h1)}` +
      (problems.length ? `\n         -> ${problems.join("; ")}\n         -> own links: ${JSON.stringify(m.ownLinks)}` : ""),
    );
    await ctx.close();
  }
}
await browser.close();
console.log(failures === 0 ? "\nF-89 CHECK: PASS" : `\nF-89 CHECK: FAIL — ${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
