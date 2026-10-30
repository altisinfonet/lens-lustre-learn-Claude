#!/usr/bin/env node
/**
 * P23 · S10a-2 — THE TEN SURFACES, CHECKED IN CI (docs/evidence/d2/phase5/P23/S10a-DECISION.md §2–§3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT. Over the 11 harness scenes of the ten primary surfaces, at iphone-390
 * and desktop-1280, in Chromium (the Android app's WebView engine), five checks:
 *
 *   A  axe — WCAG 2.2 AA tags and the pinned axe-core of the UI-gate ratchet,
 *      no rule disabled. Counted per rule, as the ratchet counts.
 *   B  kbd-tab-unreached — a visible, enabled interactive control that no Tab
 *      press ever focuses in a full Tab cycle from the top of the page (a radio
 *      group / tablist / menu with a roving tabindex counts once).
 *   C  kbd-focus-invisible — Tab lands on a control and none of outline,
 *      box-shadow, border colour, background, colour or text-decoration of the
 *      control (or its parent, which is where some focus rings are drawn)
 *      differs from its unfocused style.
 *   D  kbd-trap — focus stops moving, or comes back to a control it already
 *      visited before the cycle is over, while no modal dialog is open (2.1.2).
 *      Inside an open modal dialog cycling is the dialog's job, not a trap.
 *   E  kbd-esc-dialog — a [role=dialog] / [role=alertdialog] open on the page
 *      is still open after Escape.
 *
 * Counts per "<scene>--<width>" are judged by the SAME ratchet as axe
 * (`compareAxe`, tools/uishot/axe-ratchet.mjs) against the committed
 * tools/uishot/a11y-surfaces.baseline.json: counts only go down, a new rule or
 * a dirty clean entry fails, a missing entry or a check that threw fails, and
 * every improvement must lower the baseline in the PR that makes it.
 *
 *   node tools/uishot/a11y-surfaces.mjs                  # start the harness, check, judge
 *   node tools/uishot/a11y-surfaces.mjs --record         # also ADD entries the baseline lacks
 *   node tools/uishot/a11y-surfaces.mjs --lower          # also LOWER entries that went down
 *   node tools/uishot/a11y-surfaces.mjs --self-test      # prove each check fires
 *   UI_HARNESS_BASE=http://127.0.0.1:5199 … --no-serve   # against a harness already running
 *
 * --record never touches an entry that exists (a first measurement, not a
 * raise). --lower never raises a count or adds a rule. Raising a number means
 * editing the JSON by hand, which shows in the diff.
 *
 * The harness server is started the way gate.mjs starts it (detached vite on
 * 5199, a timeout is a FAILURE, the server log is kept and printed on failure).
 * gate.mjs is not refactored to share this: it is the required UI gate and its
 * shape is pinned by src/__tests__/uiGateCannotBeBypassed.test.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AXE_TAGS, compareAxe, countsFromAxe } from "./axe-ratchet.mjs";

export const BASELINE_PATH = "tools/uishot/a11y-surfaces.baseline.json";
const AXE_SOURCE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/** The ten primary surfaces (S10a-DECISION.md §2) — 11 scenes, login and sign-up are one surface. */
export const SURFACE_SCENES = [
  "screen-feed",
  "screen-post-detail",
  "comments-panel",
  "composer-full",
  "screen-profile",
  "screen-edit-profile",
  "screen-notifications",
  "screen-discover",
  "screen-login",
  "screen-signup",
  "screen-admin-health",
];
export const WIDTHS = [
  { name: "iphone-390", width: 390, height: 844, mobile: true },
  { name: "desktop-1280", width: 1280, height: 900, mobile: false },
];

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

// ── the keyboard checks, run in the page ─────────────────────────────────────
const CONTROLS = [
  "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
  "[tabindex]:not([tabindex^='-'])", "[contenteditable=''], [contenteditable=true]",
  "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=switch]", "[role=tab]",
  "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]", "[role=option]",
  "[role=combobox]", "[role=slider]", "[role=spinbutton]", "[role=textbox]", "[role=searchbox]",
].join(",");
const STYLE_PROPS = [
  "outline-style", "outline-width", "outline-color", "box-shadow", "border-top-color", "border-bottom-color",
  "border-left-color", "border-right-color", "background-color", "color", "text-decoration-line",
];

/** Tags every candidate control, records its unfocused style. Returns { n, modal }. */
function prepare({ selector, props }) {
  const visible = (el) => {
    if (el.closest("[inert]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const isDialogOpen = (d) => visible(d);
  const dialogs = [...document.querySelectorAll("[role=dialog],[role=alertdialog]")].filter(isDialogOpen);
  const modal = dialogs.find((d) => d.getAttribute("aria-modal") === "true" || d.tagName === "DIALOG") ?? null;
  const scope = modal ?? document;
  const style = (el) => {
    // A focus style behind `transition-colors duration-500` reads as its START
    // value right after Tab; finish running transitions first, so the style
    // compared is the one the member ends up seeing.
    const settle = (e) => { for (const a of e.getAnimations?.() ?? []) { try { a.finish(); } catch { /* infinite */ } } };
    const pick = (e) => { settle(e); const s = getComputedStyle(e); return props.map((p) => s.getPropertyValue(p)).join("|"); };
    return pick(el) + "||" + (el.parentElement ? pick(el.parentElement) : "");
  };
  // Start from the top of the page — unless a modal holds focus, which it is meant to.
  // blur() alone is not enough: Chromium keeps the blurred element as the Tab
  // starting point, so a page that autofocuses a field mid-page (login, sign-up)
  // would be walked from that field and everything above it would read as
  // unreachable. Focusing <body> moves the starting point to the top.
  if (!modal) {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const had = document.body.getAttribute("tabindex");
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    if (had === null) document.body.removeAttribute("tabindex"); else document.body.setAttribute("tabindex", had);
  }
  let n = 0;
  const groups = new Map();
  for (const el of scope.querySelectorAll(selector)) {
    if (!visible(el)) continue;
    if (el.disabled || el.getAttribute("aria-disabled") === "true" && el.matches("button,input,select,textarea")) continue;
    if (el.parentElement?.closest(selector) && el.parentElement.closest(selector) !== el && el.closest("a[href],button") !== el) continue; // nested inside another control
    let group = "";
    const role = el.getAttribute("role");
    if (el.matches("input[type=radio]") && el.name) group = "radio:" + el.name;
    else if (role && ["radio", "tab", "menuitem", "menuitemradio", "menuitemcheckbox", "option"].includes(role)) {
      const owner = el.closest("[role=radiogroup],[role=tablist],[role=menu],[role=menubar],[role=listbox]");
      if (owner) { if (!groups.has(owner)) groups.set(owner, "g" + groups.size); group = groups.get(owner); }
    }
    el.setAttribute("data-a11y-k", String(n));
    el.setAttribute("data-a11y-g", group || "k" + n);
    el.setAttribute("data-a11y-s", style(el));
    n += 1;
  }
  window.__a11y = { style };
  return { n, modal: !!modal, dialogs: dialogs.length };
}

/** What Tab just landed on: { k, g, changed, body, label }. */
function landed() {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return { body: true };
  const el = a.closest("[data-a11y-k]");
  const label = (a.tagName + " " + (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 40)).trim();
  if (!el) return { k: null, g: null, changed: true, label, sig: a.tagName + ":" + (a.id || "") + ":" + label };
  return { k: el.getAttribute("data-a11y-k"), g: el.getAttribute("data-a11y-g"), changed: window.__a11y.style(el) !== el.getAttribute("data-a11y-s"), label, sig: "k" + el.getAttribute("data-a11y-k") };
}

function openDialogs() {
  return [...document.querySelectorAll("[role=dialog],[role=alertdialog]")].filter((d) => {
    const r = d.getBoundingClientRect();
    const s = getComputedStyle(d);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && d.isConnected;
  }).length;
}

/** One page, all five checks. Returns { counts, notes }. */
export async function measure(page) {
  const counts = {};
  const notes = [];
  const add = (rule, n = 1) => { if (n > 0) counts[rule] = (counts[rule] ?? 0) + n; };

  // A · axe
  await page.addScriptTag({ path: AXE_SOURCE });
  const axe = await page.evaluate(async (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }), AXE_TAGS);
  Object.assign(counts, countsFromAxe(axe));

  // B · C · D · Tab cycle from the top of the page
  const prep = await page.evaluate(prepare, { selector: CONTROLS, props: STYLE_PROPS });
  await page.evaluate(() => window.scrollTo(0, 0));
  const reachedGroups = new Set();
  const allGroups = new Set(await page.$$eval("[data-a11y-g]", (els) => els.map((e) => e.getAttribute("data-a11y-g"))));
  const seen = new Set();
  const invisible = new Set();
  let prev = null;
  let first = null;
  let trap = false;
  let ended = false;
  const cap = prep.n * 2 + 40;
  for (let i = 0; i < cap; i++) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(landed);
    if (at.body) { ended = true; break; }
    // Outside a modal, a full cycle ends by Tab leaving the page (focus goes to
    // the browser: activeElement is body). Coming back to the first stop
    // without leaving is a cycle in a subset — a trap. Inside a modal dialog,
    // coming back to the first stop IS the end of the cycle.
    if (first === null) first = at.sig;
    else if (at.sig === first && prep.modal) { ended = true; break; }
    if (prev !== null && at.sig === prev) { trap = true; notes.push(`focus stopped moving on ${at.label}`); break; }
    if (seen.has(at.sig) && !prep.modal) { trap = true; notes.push(`focus cycled back to ${at.label} before the end of the page`); break; }
    seen.add(at.sig);
    prev = at.sig;
    if (at.g) reachedGroups.add(at.g);
    if (at.k !== null && !at.changed) invisible.add(at.k);
  }
  if (!ended && !trap) notes.push(`Tab cycle not finished after ${cap} presses — reach counted on what was visited`);
  const unreached = [...allGroups].filter((g) => !reachedGroups.has(g));
  add("kbd-tab-unreached", unreached.length);
  add("kbd-focus-invisible", invisible.size);
  // Name what was found, so a count is never the only evidence.
  const unreachedNames = await page.$$eval("[data-a11y-g]", (els, gs) => els.filter((e) => gs.includes(e.getAttribute("data-a11y-g"))).map((e) => `${e.tagName.toLowerCase()}${e.getAttribute("role") ? `[role=${e.getAttribute("role")}]` : ""}${e.getAttribute("tabindex") !== null ? `[tabindex=${e.getAttribute("tabindex")}]` : ""} "${(e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`), unreached);
  const invisibleNames = await page.$$eval("[data-a11y-k]", (els, ks) => els.filter((e) => ks.includes(e.getAttribute("data-a11y-k"))).map((e) => `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || e.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`), [...invisible]);
  if (trap) add("kbd-trap", 1);

  // E · Escape closes an open dialog
  const before = await page.evaluate(openDialogs);
  if (before > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const after = await page.evaluate(openDialogs);
    add("kbd-esc-dialog", Math.min(before, after));
  }
  return { counts, notes, controls: prep.n, unreached: unreachedNames, focusInvisible: invisibleNames, axe: axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 10) })) };
}

// ── self-test: one seeded defect per check, and a clean page ─────────────────
const CSS = `<style>button,a,input,div[tabindex]{outline:none} :focus-visible{outline:3px solid #f0f}</style>`;
const PAGES = {
  clean: `${CSS}<main><h1>Clean</h1><a href="#x">A link</a> <button>Save</button> <label>Name <input></label></main>`,
  "unnamed-button": `${CSS}<main><h1>t</h1><button></button> <a href="#x">ok</a></main>`,
  unreachable: `${CSS}<main><h1>t</h1><a href="#x">ok</a> <div role="button" aria-label="Open">Open</div></main>`,
  "no-focus-style": `${CSS}<style>#n:focus-visible{outline:none}</style><main><h1>t</h1><a href="#x">ok</a> <button id="n">No ring</button></main>`,
  trap: `${CSS}<main><h1>t</h1><button id="a">A</button><button id="b">B</button><button>C</button></main>
    <script>document.getElementById("b").addEventListener("keydown",(e)=>{if(e.key==="Tab"){e.preventDefault();document.getElementById("a").focus();}});</script>`,
  "dialog-ignores-escape": `${CSS}<main><h1>t</h1><div role="dialog" aria-label="Sheet" style="padding:8px;border:1px solid"><button>Close</button></div></main>`,
  "dialog-closes": `${CSS}<main><h1>t</h1><div role="dialog" aria-label="Sheet" id="d" style="padding:8px;border:1px solid"><button>Close</button></div></main>
    <script>document.addEventListener("keydown",(e)=>{if(e.key==="Escape")document.getElementById("d").remove();});</script>`,
  // measurement trap 1: an autofocused field mid-page must not hide the controls above it
  "autofocus-mid-page": `${CSS}<main><h1>t</h1><a href="#x">Back</a> <button>Google</button> <label>Email <input autofocus></label> <button>Go</button></main>`,
  // measurement trap 2: a focus style behind a 500 ms transition is still a focus style
  "focus-transition": `<style>input{outline:none;border:0;border-bottom:1px solid #888;transition:border-color .5s} input:focus{border-bottom-color:#f0f}</style><main><h1>t</h1><label>Name <input></label></main>`,
  // a modal keeps focus inside by design (as Radix sheets do): not a trap
  "modal-keeps-focus": `${CSS}<main inert><h1>t</h1><a href="#x">behind</a></main>
    <div role="dialog" aria-modal="true" aria-label="Sheet" id="d" style="padding:8px;border:1px solid"><button id="a">One</button> <button id="b">Two</button></div>
    <script>document.getElementById("b").addEventListener("keydown",(e)=>{if(e.key==="Tab"){e.preventDefault();document.getElementById("a").focus();}});
    document.addEventListener("keydown",(e)=>{if(e.key==="Escape")document.getElementById("d").remove();});</script>`,
};
const EXPECT = {
  clean: {},
  "unnamed-button": { "button-name": 1 },
  unreachable: { "kbd-tab-unreached": 1 },
  "no-focus-style": { "kbd-focus-invisible": 1 },
  trap: { "kbd-tab-unreached": 1, "kbd-trap": 1 }, // the trap also hides the control after it
  "dialog-ignores-escape": { "kbd-esc-dialog": 1 },
  "dialog-closes": {},
  "autofocus-mid-page": {},
  "focus-transition": {},
  "modal-keeps-focus": {},
};

async function selfTest(browser) {
  const fails = [];
  for (const [name, html] of Object.entries(PAGES)) {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html lang="en"><head><title>${name}</title></head><body>${html}</body></html>`);
    const { counts, notes } = await measure(page);
    await page.close();
    // the page's own seeded rule, and nothing from the five checks it did not seed
    const want = EXPECT[name];
    const kbd = Object.fromEntries(Object.entries(counts).filter(([r]) => r.startsWith("kbd-") || r in want));
    const ok = JSON.stringify(kbd) === JSON.stringify(want);
    console.log(`${ok ? "PASS" : "FAIL"}  self-test ${name.padEnd(22)} got ${JSON.stringify(counts)}${notes.length ? "  (" + notes.join("; ") + ")" : ""}`);
    if (!ok) fails.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(kbd)}`);
  }
  return fails;
}

// ── the harness server, started as gate.mjs starts it ────────────────────────
async function startHarness(base) {
  const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5199", "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  const log = [];
  const keep = (b) => { log.push(b.toString()); if (log.length > 200) log.shift(); };
  server.stdout.on("data", keep);
  server.stderr.on("data", keep);
  const stop = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ } };
  process.on("exit", stop);
  const deadline = Date.now() + 180_000;
  let last = "no attempt";
  while (Date.now() < deadline) {
    if (server.exitCode !== null) { stop(); throw new Error(`the dev server exited early (${server.exitCode})\n${log.join("").slice(-3000)}`); }
    try { const r = await fetch(`${base}/uiharness.html`); if (r.ok) return { stop }; last = `HTTP ${r.status}`; } catch (e) { last = String(e.message).slice(0, 120); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error(`the harness never answered within 180 s (last: ${last})\n${log.join("").slice(-3000)}`);
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const BASE = process.env.UI_HARNESS_BASE ?? "http://127.0.0.1:5199";
const OUT = process.env.A11Y_OUT ?? "/tmp/a11y-surfaces";

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const exe = chromePath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  if (args.includes("--self-test")) {
    const fails = await selfTest(browser);
    await browser.close();
    console.log(fails.length ? `\nSELF-TEST FAILED:\n  ${fails.join("\n  ")}` : "\nSELF-TEST PASS: every check fires on its seeded defect, and the clean pages are clean");
    process.exit(fails.length ? 1 : 0);
  }

  let server = null;
  if (!args.includes("--no-serve")) server = await startHarness(BASE);
  const current = {};
  const report = { at: new Date().toISOString(), tags: AXE_TAGS, engine: "chromium", entries: {} };
  try {
    for (const scene of SURFACE_SCENES) {
      for (const w of WIDTHS) {
        const key = `${scene}--${w.name}`;
        const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 1, isMobile: w.mobile, hasTouch: w.mobile, locale: "en-GB", timezoneId: "Asia/Kolkata", colorScheme: "dark", reducedMotion: "reduce" });
        const page = await ctx.newPage();
        try {
          await page.goto(`${BASE}/uiharness.html?scene=${encodeURIComponent(scene)}`, { waitUntil: "networkidle", timeout: 60_000 });
          await page.waitForTimeout(1200);
          const r = await measure(page);
          current[key] = r.counts;
          report.entries[key] = r;
          console.log(`${key.padEnd(36)} ${String(r.controls).padStart(3)} controls  ${JSON.stringify(r.counts)}${r.notes.length ? "  · " + r.notes.join("; ") : ""}`);
        } catch (e) {
          current[key] = { error: String(e.message).split("\n")[0].slice(0, 200) };
          report.entries[key] = current[key];
          console.log(`${key.padEnd(36)} ERROR ${current[key].error}`);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server?.stop();
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "a11y-surfaces-current.json"), JSON.stringify(report, null, 2) + "\n");

  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : { scenes: {} };
  if (args.includes("--record") || args.includes("--lower")) {
    const next = { ...baseline, scenes: { ...baseline.scenes } };
    let changed = 0;
    for (const [key, cur] of Object.entries(current)) {
      if (cur.error) continue;
      const b = next.scenes[key];
      if (!b) { if (args.includes("--record")) { next.scenes[key] = cur; changed++; } continue; }
      if (!args.includes("--lower")) continue;
      const lowered = {};
      let ok = true;
      for (const [rule, n] of Object.entries(cur)) { if (!(rule in b) || n > b[rule]) ok = false; else lowered[rule] = n; }
      if (ok && JSON.stringify(lowered) !== JSON.stringify(b)) { next.scenes[key] = lowered; changed++; }
    }
    next.scenes = Object.fromEntries(Object.entries(next.scenes).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`\nbaseline: ${changed} entr${changed === 1 ? "y" : "ies"} written to ${BASELINE_PATH} (never raised, never overwritten by --record)`);
  }

  const judged = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : { scenes: {} };
  const fails = compareAxe(judged, current, true);
  // A ratchet with an EMPTY baseline judges nothing missing; every entry must exist.
  for (const key of Object.keys(current)) if (!(key in (judged.scenes ?? {})) && Object.keys(current[key]).length === 0) fails.push(`${key}: no baseline entry — record it (--record)`);
  if (fails.length) {
    console.log(`\nA11Y SURFACES FAIL (${fails.length}):\n  ${fails.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\nA11Y SURFACES PASS: ${Object.keys(current).length} scene/width entries match ${BASELINE_PATH}`);
}
