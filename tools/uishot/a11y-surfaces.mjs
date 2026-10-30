#!/usr/bin/env node
/**
 * P23 S10a-2 · THE TEN PRIMARY SURFACES, CHECKED A–E, AS A RATCHET.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Spec: docs/evidence/d2/phase5/P23/S10a-DECISION.md §2 (the 11 scenes) and §3
 * (the checks). Runs in its own workflow, .github/workflows/d2-a11y-surfaces.yml
 * (decision S3 — ui-gate.yml is not touched), against the same harness the UI
 * gate uses (`uiharness.html` on a Vite dev server, fake backend, no network),
 * at iphone-390 and desktop-1280, in Chromium (the Android WebView's engine).
 *
 *   A  axe — tags AXE_TAGS and the pinned axe-core of axe-ratchet.mjs, no rule
 *      disabled. Rule names `A:<axe rule id>`, counted in failing nodes.
 *   B  Tab reach — every visible, enabled interactive control in scope is
 *      focused by Tab during a full cycle from the top of the page. A radio
 *      group (and any roving-tabindex group: tabs, menu items, options, tree
 *      items) counts once. "In scope": not aria-hidden, not inert, and — when
 *      a modal dialog is open — inside it (what is behind a modal is meant to
 *      be unreachable). `B:tab-unreached`, one per control.
 *   C  visible focus — at each Tab stop, at least one of outline, box-shadow,
 *      border, background, colour or text-decoration (on the element or its
 *      ::before/::after) differs from the same element unfocused.
 *      `C:focus-not-visible`, one per stop. CSS transitions are switched off
 *      for the walk (after axe) so a 150 ms ring fade is not read as "none".
 *   D  no keyboard trap (WCAG 2.1.2) — repeated Tab keeps moving and comes back
 *      to the start of the page; focus that stops moving, or cycles without
 *      ever returning while no modal dialog is open, is a trap.
 *      `D:keyboard-trap`, one per trap.
 *   E  Escape closes — every open [role=dialog]/[role=alertdialog] is still
 *      open after Escape (focus placed inside it first). `E:escape-does-not-
 *      close`, one per dialog.
 *
 * Counts per scene/width are judged by compareAxe() (axe-ratchet.mjs, called
 * unchanged) against tools/uishot/a11y-surfaces.baseline.json, keyed by scene
 * AND width — see a11y-surfaces-ratchet.mjs. A scene/width with no baseline
 * entry FAILS, naming every finding.
 *
 *   node tools/uishot/a11y-surfaces.mjs                  # all 11 × 2; exit = verdict
 *   node tools/uishot/a11y-surfaces.mjs screen-feed      # one scene (not a full run)
 *   node tools/uishot/a11y-surfaces.mjs --json out.json  # also write the report
 *   node tools/uishot/a11y-surfaces.mjs --record         # FIRST measurement of entries
 *                                                        # that do not exist; refuses
 *                                                        # (exit 1) to touch one that does
 *   node tools/uishot/a11y-surfaces.mjs --lower out.json # lower from a report; never raises
 *   node tools/uishot/a11y-surfaces.mjs --self-test      # proves every check fires
 *   --base <url>   use a harness already running there instead of starting one
 *
 * ⚠ THE EXIT CODE IS THE VERDICT. Anything that makes this exit 0 when a check
 * moved against the baseline turns it into decoration.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AXE_TAGS, countsFromAxe } from "./axe-ratchet.mjs";
import {
  A11Y_BASELINE_PATH, SURFACE_SCENES, SURFACE_WIDTHS, CHECK_RULES,
  entryKey, judge, recordBaseline, lowerSurfaces,
} from "./a11y-surfaces-ratchet.mjs";

const require = createRequire(import.meta.url);
/** axe-core, pinned exactly in package.json — the SAME file capture.mjs injects. */
const AXE_SOURCE = require.resolve("axe-core/axe.min.js");
const AXE_VERSION = JSON.parse(readFileSync(join(dirname(AXE_SOURCE), "package.json"), "utf8")).version;
const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const VALUE_FLAGS = new Set(["--json", "--base", "--lower"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(argv[i - 1]));

/** 5195: 5196 nav harness, 5197 encoder, 5198 offline, 5199 the UI gate (run side by side). */
const PORT = 5195;
const BASE = arg("--base") || `http://127.0.0.1:${PORT}`;
const log = (m) => console.log(`[a11y-surfaces] ${m}`);
/** The report directory may not exist yet (CI writes under /tmp/a11y-surfaces). */
const writeReport = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-linux/headless_shell"]) {
    const p = join(root, d, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}

// ── In-page helpers (serialised into the page; no closures over Node scope) ──

/** Installs window.__a11y: element ids without touching the DOM, and the style signature. */
function installHelpers() {
  if (window.__a11y) return;
  const ids = new WeakMap();
  const els = [];
  const idOf = (el) => { if (!ids.has(el)) { ids.set(el, els.length); els.push(el); } return ids.get(el); };
  const path = (el) => {
    if (!el || !el.tagName) return String(el);
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const role = el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "";
    const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${role}${cls}`.slice(0, 90) + (name ? ` "${name}"` : "");
  };
  const PROPS = ["outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "boxShadow",
    "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderTopStyle", "backgroundColor", "backgroundImage", "color", "textDecorationLine", "textDecorationColor"];
  const sigOf = (el) => {
    const parts = [];
    for (const pseudo of [null, "::before", "::after"]) {
      const s = getComputedStyle(el, pseudo);
      if (pseudo && (s.content === "none" || s.content === "normal")) { parts.push("-"); continue; }
      const o = {};
      for (const p of PROPS) o[p] = s[p];
      // An outline with no style or no width draws nothing, whatever its colour.
      if (o.outlineStyle === "none" || parseFloat(o.outlineWidth) === 0) { o.outlineStyle = "none"; o.outlineWidth = o.outlineColor = o.outlineOffset = "-"; }
      parts.push(JSON.stringify(o));
    }
    return parts;
  };
  const visible = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  /**
   * WHERE an element is, as a CSS path of nth-child steps. React may REMOUNT a
   * control after Tab has visited it (a component declared inside render, a
   * state change on scroll): the node that was focused is gone and an
   * identical one stands in its place. Measured 2026-10-30 on screen-feed's
   * category chips — reached by Tab, then replaced. Identity alone would call
   * the replacement "never reached"; its position says it was.
   */
  const where = (el) => {
    const steps = [];
    for (let e = el; e && e.parentElement && e !== document.body; e = e.parentElement) {
      steps.unshift(`${e.tagName.toLowerCase()}:nth-child(${[...e.parentElement.children].indexOf(e) + 1})`);
    }
    return "body > " + steps.join(" > ");
  };
  const openDialogs = () => [...document.querySelectorAll("[role=dialog],[role=alertdialog]")]
    .filter((d) => visible(d) && d.getAttribute("data-state") !== "closed" && !d.closest("[aria-hidden=true]"));
  /** The topmost open MODAL dialog: aria-modal, alertdialog, or one the app has hidden everything else behind. */
  const modalScope = () => {
    const hiddenOthers = !!document.querySelector("[data-aria-hidden=true], [aria-hidden=true][data-aria-hidden]");
    const modal = openDialogs().filter((d) => d.getAttribute("aria-modal") === "true" || d.getAttribute("role") === "alertdialog" || hiddenOthers);
    return modal.length ? modal[modal.length - 1] : null;
  };
  window.__a11y = { ids, els, idOf, path, where, sigOf, visible, openDialogs, modalScope, focused: new Map(), stops: [], stopWhere: new Map() };
}

/** The current Tab stop, or null when focus has left the document's controls (the wrap). */
function readStop() {
  const A = window.__a11y;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const id = A.idOf(el);
  if (!A.focused.has(id)) { A.focused.set(id, el.tagName === "IFRAME" ? null : A.sigOf(el)); A.stops.push(id); A.stopWhere.set(id, A.where(el)); }
  return { id, iframe: el.tagName === "IFRAME", path: A.path(el) };
}

const WIDGET_ROLES = ["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
  "option", "slider", "spinbutton", "combobox", "textbox", "searchbox", "treeitem", "scrollbar"];
const CONTROL_SELECTOR = [
  "a[href]", "area[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary", "iframe",
  "[contenteditable='']", "[contenteditable=true]", "audio[controls]", "video[controls]", "[tabindex]",
  ...WIDGET_ROLES.map((r) => `[role=${r}]`),
].join(",");

/** Visible, enabled, in-scope controls, grouped (B). Run after the walk; reads A.ids for "reached". */
function controlsInScope([selector, widgetRoles]) {
  const WIDGET = new Set(widgetRoles);
  const A = window.__a11y;
  const scope = A.modalScope();
  const ROVING = { radio: "radiogroup", tab: "tablist", menuitem: "menu,menubar", menuitemcheckbox: "menu,menubar", menuitemradio: "menu,menubar", option: "listbox", treeitem: "tree" };
  const groups = new Map();
  for (const el of document.querySelectorAll(selector)) {
    const role = el.getAttribute("role");
    const nativeInteractive = el.matches("a[href],area[href],button,input,select,textarea,summary,iframe,[contenteditable='' i],[contenteditable=true i],audio[controls],video[controls]");
    // [tabindex] alone makes a control only when it puts the element IN the tab
    // order; an ARIA widget role makes one whatever its tabindex says.
    if (!nativeInteractive && !(role && WIDGET.has(role)) && el.tabIndex < 0) continue;
    if (el.matches(":disabled") || el.closest("[aria-hidden=true],[inert]")) continue;
    if (scope && !scope.contains(el)) continue;
    if (!A.visible(el)) continue;
    let key = `el:${A.idOf(el)}`;
    let container = null;
    if (el.matches("input[type=radio]") && el.name) { key = `radio:${el.form ? A.idOf(el.form) : "doc"}:${el.name}`; }
    else if (role && ROVING[role]) { container = el.closest(ROVING[role].split(",").map((r) => `[role=${r}]`).join(",")); if (container) key = `group:${A.idOf(container)}`; }
    if (!groups.has(key)) groups.set(key, { members: [], container });
    groups.get(key).members.push(el);
  }
  const reached = new Set(A.stops);
  const reachedAt = new Set(A.stopWhere.values());
  const wasReached = (el) => (A.ids.has(el) && reached.has(A.ids.get(el))) || reachedAt.has(A.where(el));
  const unreached = [];
  let count = 0;
  for (const g of groups.values()) {
    count++;
    const hit = g.members.some(wasReached) || (g.container && wasReached(g.container));
    if (!hit) unreached.push(g.members.length > 1 ? `${A.path(g.members[0])} (group of ${g.members.length})` : A.path(g.members[0]));
  }
  return { count, unreached, modal: scope ? A.path(scope) : null };
}

/** C — compare every stop's focused signature with the same element unfocused. Run with nothing focused. */
function focusNotVisible() {
  const A = window.__a11y;
  const out = [];
  for (const id of A.stops) {
    const focused = A.focused.get(id);
    if (!focused) continue; // an iframe: its focus is drawn inside it
    // Remounted since (see where()): compare the node that now stands in its place.
    let el = A.els[id];
    if (!el.isConnected) {
      const now = document.querySelector(A.stopWhere.get(id));
      if (!now || now.tagName !== el.tagName) continue; // genuinely gone: nothing to compare
      el = now;
    }
    const rest = A.sigOf(el);
    if (rest.every((p, i) => p === focused[i])) out.push(A.path(el));
  }
  return out;
}

// ── One page, all five checks ───────────────────────────────────────────────

async function settle(page) {
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
    for (const img of document.images) if (img.loading === "lazy" && !img.complete) img.loading = "eager";
  });
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 800 }).catch(() => {});
  await page.waitForTimeout(200);
}

/**
 * @returns {{ counts: Record<string, number>, findings: Record<string, string[]>, stats: object }}
 * Throws when a check could not run — the caller records { error }, which fails.
 */
async function measure(page) {
  const counts = {};
  const findings = {};
  const add = (rule, list) => { if (list.length) { counts[rule] = (counts[rule] ?? 0) + list.length; (findings[rule] ??= []).push(...list); } };

  // A — axe, exactly as capture.mjs runs it.
  await page.addScriptTag({ path: AXE_SOURCE });
  const axe = await page.evaluate(async (tags) => {
    // @ts-ignore — injected above
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return { violations: r.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => `${n.target.join(" ")}  ${n.html.slice(0, 120)}`) })) };
  }, AXE_TAGS);
  for (const [rule, n] of Object.entries(countsFromAxe(axe))) counts[`A:${rule}`] = n;
  for (const v of axe.violations) findings[`A:${v.id}`] = v.nodes;

  // Transitions off for the keyboard walk: C compares end states, not a fade caught halfway.
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important}" });
  await page.evaluate(installHelpers);
  await page.evaluate(() => window.scrollTo(0, 0));

  // B, C, D — one Tab walk. The budget scales with the page; it ends early on
  // the second return to the start (a full cycle seen) or on a settled cycle.
  const focusables = await page.evaluate((sel) => document.querySelectorAll(sel).length, CONTROL_SELECTOR);
  const budget = Math.min(3 * focusables + 60, 1500);
  let wraps = 0, prev = null, same = 0, stuck = null, lastNew = 0;
  const seen = new Set();
  const seq = [];
  for (let i = 0; i < budget; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(readStop);
    if (!s) { wraps++; prev = null; same = 0; if (wraps >= 2) break; continue; }
    seq.push(s);
    if (!seen.has(s.id)) { seen.add(s.id); lastNew = i; }
    if (s.id === prev && !s.iframe) { if (++same >= 2) { stuck = s; break; } } else same = 0;
    prev = s.id;
    // A cycle that has stopped finding anything new and has not come back to the start.
    if (wraps === 0 && i - lastNew > seen.size + 5) break;
  }
  const modal = await page.evaluate(() => { const m = window.__a11y.modalScope(); return m ? window.__a11y.path(m) : null; });

  // D
  if (stuck) add(CHECK_RULES.D, [`focus stops moving at ${stuck.path}`]);
  else if (wraps === 0 && seq.length) {
    const cycle = [...new Map(seq.slice(-Math.max(seen.size, 1)).map((s) => [s.id, s.path])).values()];
    const inModal = modal && (await page.evaluate((ids) => {
      const A = window.__a11y; const m = A.modalScope();
      return !!m && ids.every((id) => m.contains(A.els[id]));
    }, [...new Set(seq.slice(-Math.max(seen.size, 1)).map((s) => s.id))]));
    if (!inModal) add(CHECK_RULES.D, [`Tab cycles among ${cycle.length} stop(s) and never returns to the start, with no modal dialog open: ${cycle.slice(0, 6).join(" → ")}`]);
  }

  // C — read with nothing focused.
  await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur(); });
  await page.waitForTimeout(50);
  add(CHECK_RULES.C, await page.evaluate(focusNotVisible));

  // B
  const reach = await page.evaluate(controlsInScope, [CONTROL_SELECTOR, WIDGET_ROLES]);
  add(CHECK_RULES.B, reach.unreached);

  // E — last, because it changes what is open. Topmost first.
  const dialogCount = await page.evaluate(() => { const A = window.__a11y; const ds = A.openDialogs(); ds.forEach((d) => A.idOf(d)); return ds.length; });
  const escFails = [];
  for (let k = 0; k < dialogCount; k++) {
    const target = await page.evaluate(() => {
      const A = window.__a11y; const ds = A.openDialogs().filter((d) => !A.__tried?.has(d));
      const d = ds[ds.length - 1]; if (!d) return null;
      (A.__tried ??= new Set()).add(d);
      if (!d.contains(document.activeElement)) {
        const f = [...d.querySelectorAll("a[href],button:not(:disabled),input:not([type=hidden]):not(:disabled),select,textarea,[tabindex]")].find((x) => x.tabIndex >= 0 && A.visible(x));
        (f ?? d).focus?.();
      }
      window.__a11yEsc = d;
      return A.path(d);
    });
    if (!target) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const open = await page.evaluate(() => { const d = window.__a11yEsc; return d.isConnected && window.__a11y.visible(d) && d.getAttribute("data-state") !== "closed"; });
    if (open) escFails.push(target);
  }
  add(CHECK_RULES.E, escFails);

  return { counts, findings, stats: { tabStops: seen.size, wraps, controls: reach.count, modal: reach.modal, dialogs: dialogCount, budget } };
}

async function newPage(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: "en-GB",
    timezoneId: "Asia/Kolkata",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  return { ctx, page: await ctx.newPage() };
}

const summarise = (counts) => {
  const by = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const [r, n] of Object.entries(counts)) by[r[0]] = (by[r[0]] ?? 0) + n;
  return by;
};

// ── --self-test ─────────────────────────────────────────────────────────────

function selfTestLogic() {
  let bad = 0;
  const ok = (cond, name) => { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) bad++; };
  const k1 = entryKey("s", "iphone-390"), k2 = entryKey("s", "desktop-1280");
  const B = { surfaces: { s: { "iphone-390": { "A:label": 1, "B:tab-unreached": 2 }, "desktop-1280": {} } } };
  ok(judge(B, { [k1]: { "A:label": 1, "B:tab-unreached": 2 }, [k2]: {} }, true).length === 0, "ratchet: identical counts per scene AND width → pass");
  ok(judge(B, { [k1]: { "A:label": 1, "B:tab-unreached": 2 }, [k2]: { "C:focus-not-visible": 1 } }, true).length === 1, "ratchet: the same scene, other width, gets dirty → fail (widths are separate entries)");
  ok(judge(B, { [k1]: { "A:label": 1, "B:tab-unreached": 3 }, [k2]: {} }, true).length === 1, "ratchet: count up → fail");
  ok(judge(B, { [k1]: { "A:label": 1, "B:tab-unreached": 1 }, [k2]: {} }, true).length === 1, "ratchet: count down, baseline not lowered → fail");
  ok(judge(B, { [k1]: { "A:label": 1, "B:tab-unreached": 2, "D:keyboard-trap": 1 }, [k2]: {} }, true).length === 1, "ratchet: new rule → fail");
  ok(judge(B, { [k1]: { "A:label": 1, "B:tab-unreached": 2 } }, true).length === 1, "ratchet: a baseline entry did not run (full run) → fail");
  ok(judge(B, { [k1]: { "A:label": 1, "B:tab-unreached": 2 } }, false).length === 0, "ratchet: filtered run ignores entries it did not ask for");
  ok(judge(B, { [k1]: { error: "boom" }, [k2]: {} }, true).length === 1, "ratchet: a check threw → fail");
  ok(judge(B, { [entryKey("t", "iphone-390")]: {} }, false).length === 1, "ratchet: an UNRECORDED entry fails even when clean");
  const named = judge(B, { [entryKey("t", "iphone-390")]: { "A:label": 2, "E:escape-does-not-close": 1 } }, false);
  ok(named.length === 1 && /A:label=2/.test(named[0]) && /E:escape-does-not-close=1/.test(named[0]), "ratchet: an unrecorded entry names every finding");
  ok(judge({}, {}, true).length > 0, "ratchet: a baseline with no `surfaces` never passes");
  ok(judge({ surfaces: {} }, { [k1]: {} }, true).length === 1, "ratchet: the empty first-commit baseline fails every entry");
  // --record
  const rec = recordBaseline({ _about: "x", surfaces: {} }, { [k1]: { "A:label": 1 }, [k2]: {} });
  ok(rec._about === "x" && rec.surfaces.s["iphone-390"]["A:label"] === 1 && judge(rec, { [k1]: { "A:label": 1 }, [k2]: {} }, true).length === 0, "--record writes first measurements, then they pass");
  let threw = null; try { recordBaseline(B, { [k1]: { "A:label": 0 } }); } catch (e) { threw = e.message; }
  ok(!!threw && /refuses to touch 1 existing entry/.test(threw), "--record REFUSES to touch an existing entry");
  threw = null; try { recordBaseline(B, { [entryKey("t", "iphone-390")]: {}, [k1]: { "A:label": 1, "B:tab-unreached": 2 } }); } catch (e) { threw = e.message; }
  ok(!!threw, "--record refuses the whole write when any one entry exists (nothing half-written)");
  threw = null; try { recordBaseline({ surfaces: {} }, { [k1]: { error: "x" } }); } catch (e) { threw = e.message; }
  ok(!!threw, "--record refuses an entry whose checks did not run");
  // --lower
  const low = lowerSurfaces(B, { [k1]: { "A:label": 1, "B:tab-unreached": 1 }, [k2]: {} });
  ok(low.surfaces.s["iphone-390"]["B:tab-unreached"] === 1, "--lower records an improvement");
  threw = null; try { lowerSurfaces(B, { [k1]: { "A:label": 2, "B:tab-unreached": 2 } }); } catch { threw = true; }
  ok(!!threw, "--lower refuses a raise");
  threw = null; try { lowerSurfaces(B, { [entryKey("t", "iphone-390")]: {} }); } catch { threw = true; }
  ok(!!threw, "--lower refuses to add an entry (that is --record's job)");
  return bad;
}

/** What each seeded defect must produce, and nothing else. */
const SEEDED_EXPECT = {
  A: { rule: "A:button-name", match: /#defect-a/ },
  B: { rule: CHECK_RULES.B, match: /#defect-b/ },
  // Two C defects: outline:none, and Tailwind's outline-none (a transparent outline).
  C: { rule: CHECK_RULES.C, match: /#defect-c\b/, count: 2, matchAll: [/#defect-c(?!2)\b/, /#defect-c2\b/] },
  D: { rule: CHECK_RULES.D, match: /trap-1|trap-2/ },
  E: { rule: CHECK_RULES.E, match: /#defect-e/ },
};

async function selfTestPages(browser) {
  let bad = 0;
  const ok = (cond, name) => { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) bad++; };
  const results = {};
  for (const vp of SURFACE_WIDTHS) {
    for (const which of ["seeded", "clean", "clean-modal"]) {
      const { ctx, page } = await newPage(browser, vp);
      await page.goto(pathToFileURL(join(HERE, "a11y-surfaces-selftest", `${which}.html`)).href);
      let r;
      try { r = await measure(page); } catch (e) { r = { error: String(e?.message ?? e) }; }
      await ctx.close();
      results[`${which} @ ${vp.name}`] = r;
      if (r.error) { ok(false, `${which} @ ${vp.name}: the checks ran (${r.error})`); continue; }
      if (which !== "seeded") {
        ok(Object.keys(r.counts).length === 0, `${which} page @ ${vp.name}: NOTHING reported${Object.keys(r.counts).length ? ` — got ${JSON.stringify(r.findings)}` : ""}`);
        continue;
      }
      for (const [check, exp] of Object.entries(SEEDED_EXPECT)) {
        const rules = Object.keys(r.counts).filter((k) => k[0] === check);
        const list = r.findings[exp.rule] ?? [];
        const want = exp.count ?? 1;
        const fired = rules.length === 1 && rules[0] === exp.rule && r.counts[exp.rule] === want
          && (exp.matchAll ? exp.matchAll.every((m) => list.some((f) => m.test(f))) : exp.match.test(list[0] ?? ""));
        ok(fired, `seeded page @ ${vp.name}: check ${check} fires on exactly its seeded defect(s) — ${rules.length ? rules.map((x) => `${x}=${r.counts[x]}: ${(r.findings[x] ?? []).join(" | ").slice(0, 140)}`).join("; ") : "NOT FIRED"}`);
      }
    }
  }
  return { bad, results };
}

// ── Running the harness ─────────────────────────────────────────────────────

let server = null;
const stopServer = () => { if (!server) return; try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ } server = null; };
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });
process.on("SIGTERM", () => { stopServer(); process.exit(143); });
const serverLog = [];

async function startHarness() {
  if (arg("--base")) return;
  log(`starting the harness on ${BASE} (the UI gate's uiharness.html)`);
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  const keep = (b) => { serverLog.push(b.toString()); if (serverLog.length > 200) serverLog.shift(); };
  server.stdout.on("data", keep);
  server.stderr.on("data", keep);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the dev server exited early with code ${server.exitCode}`);
    try { const r = await fetch(`${BASE}/uiharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  // A FAILURE, never a skip.
  throw new Error(`the harness never answered at ${BASE}/uiharness.html within 180 s`);
}

async function runSurfaces(browser, scenes) {
  const current = {};
  const detail = {};
  for (const scene of scenes) {
    for (const vp of SURFACE_WIDTHS) {
      const key = entryKey(scene, vp.name);
      const { ctx, page } = await newPage(browser, vp);
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 200)));
      try {
        await page.goto(`${BASE}/uiharness.html?scene=${encodeURIComponent(scene)}`, { waitUntil: "networkidle", timeout: 45000 });
        await settle(page);
        // A scene that did not mount is not a clean scene.
        const mounted = await page.evaluate(() => (document.getElementById("harness-root")?.children.length ?? 0) > 0 && !/UI harness/.test(document.querySelector("h1")?.textContent ?? "") );
        if (!mounted) throw new Error("the scene did not mount (blank page or the harness index)");
        const r = await measure(page);
        current[key] = r.counts;
        detail[key] = { findings: r.findings, stats: r.stats, pageErrors };
        const by = summarise(r.counts);
        log(`${key}: A ${by.A} · B ${by.B} · C ${by.C} · D ${by.D} · E ${by.E}   (${r.stats.tabStops} tab stops, ${r.stats.controls} controls, ${r.stats.dialogs} open dialog(s)${r.stats.modal ? `, modal ${r.stats.modal}` : ""})`);
      } catch (e) {
        current[key] = { error: String(e?.message ?? e).slice(0, 200) };
        detail[key] = { error: current[key].error, pageErrors };
        log(`${key}: CHECKS DID NOT RUN — ${current[key].error}`);
      }
      await ctx.close();
    }
  }
  return { current, detail };
}

function printFindings(detail, keys) {
  for (const key of keys) {
    const f = detail[key]?.findings ?? {};
    for (const [rule, list] of Object.entries(f)) for (const item of list) console.log(`        ${key} ${rule}: ${item}`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const exe = chromePath();
const launch = () => chromium.launch(exe ? { executablePath: exe } : {});

if (flag("--self-test")) {
  console.log("── ratchet, --record and --lower (pure) ──");
  const logicBad = selfTestLogic();
  console.log("── the checks fire on the seeded page, and on nothing else ──");
  const browser = await launch();
  const { bad: pageBad, results } = await selfTestPages(browser);
  await browser.close();
  const outPath = arg("--json");
  if (outPath) writeReport(outPath, JSON.stringify({ selfTest: true, at: new Date().toISOString(), axeCore: AXE_VERSION, tags: AXE_TAGS, results, failed: logicBad + pageBad }, null, 2) + "\n");
  const total = logicBad + pageBad;
  console.log(total ? `\nSELF-TEST FAILED (${total}) — a check that cannot fire cannot go green honestly` : "\nself-test: every check fires on its seeded defect and on nothing in the clean page");
  process.exit(total ? 1 : 0);
}

if (flag("--lower")) {
  const report = JSON.parse(readFileSync(arg("--lower"), "utf8"));
  const baseline = JSON.parse(readFileSync(A11Y_BASELINE_PATH, "utf8"));
  try {
    const next = lowerSurfaces(baseline, report.current ?? {});
    writeFileSync(A11Y_BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    log(`baseline lowered from ${arg("--lower")}`);
    process.exit(0);
  } catch (e) { console.error(`[a11y-surfaces] --lower refused: ${e.message}`); process.exit(1); }
}

const unknown = positional.filter((s) => !SURFACE_SCENES.includes(s));
if (unknown.length) { console.error(`[a11y-surfaces] not one of the 11 surfaces of S10a-DECISION.md §2: ${unknown.join(", ")}`); process.exit(2); }
const scenes = positional.length ? positional : SURFACE_SCENES;
const fullRun = positional.length === 0;
const baseline = existsSync(A11Y_BASELINE_PATH) ? JSON.parse(readFileSync(A11Y_BASELINE_PATH, "utf8")) : null;

// --record refuses BEFORE measuring when it can already see the answer.
if (flag("--record") && baseline) {
  const existing = scenes.flatMap((s) => SURFACE_WIDTHS.map((w) => entryKey(s, w.name))).filter((k) => {
    const [s, w] = [k.split(" @ ")[0], k.split(" @ ")[1]];
    return baseline.surfaces?.[s]?.[w] !== undefined;
  });
  if (existing.length) {
    console.error(`[a11y-surfaces] --record REFUSED: ${existing.length} entr${existing.length === 1 ? "y already exists" : "ies already exist"} (${existing.join(", ")}). Recording is a first measurement only; lower with --lower, never raise. Nothing written.`);
    process.exit(1);
  }
}

let exitCode = 1;
let browser = null;
try {
  await startHarness();
  browser = await launch();
  log(`checking ${scenes.length} scene(s) × ${SURFACE_WIDTHS.map((w) => w.name).join(", ")} — axe-core ${AXE_VERSION}, tags ${AXE_TAGS.join(" ")}`);
  const { current, detail } = await runSurfaces(browser, scenes);
  let failures;
  if (flag("--record")) {
    try {
      const next = recordBaseline(baseline ?? { surfaces: {} }, current);
      writeFileSync(A11Y_BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
      log(`--record: wrote ${Object.keys(current).length} first measurement(s) to ${A11Y_BASELINE_PATH}`);
      failures = [];
    } catch (e) {
      failures = [e.message];
      console.error(`[a11y-surfaces] --record REFUSED: ${e.message}`);
    }
  } else {
    failures = judge(baseline, current, fullRun);
  }
  const outPath = arg("--json");
  if (outPath) {
    writeReport(outPath, JSON.stringify({
      at: new Date().toISOString(), axeCore: AXE_VERSION, tags: AXE_TAGS, widths: SURFACE_WIDTHS.map((w) => w.name),
      scenes, fullRun, mode: flag("--record") ? "record" : "judge", baseline: A11Y_BASELINE_PATH,
      current, detail, failures, verdict: failures.length ? "FAIL" : "PASS",
    }, null, 2) + "\n");
    log(`report written to ${outPath}`);
  }
  if (failures.length) {
    console.log(`\nA11Y SURFACES (${failures.length}) — moved against ${A11Y_BASELINE_PATH}:`);
    for (const f of failures) console.log(`    ✗ ${f}`);
    const failing = [...new Set(failures.map((f) => f.split(":")[0]))].filter((k) => k in detail);
    console.log("  findings on the failing entries:");
    printFindings(detail, failing);
    exitCode = 1;
  } else {
    log(flag("--record") ? "recorded." : "clean against the baseline.");
    exitCode = 0;
  }
} catch (e) {
  console.error(`[a11y-surfaces] FAILED: ${e.message}`);
  if (serverLog.length) console.error(serverLog.join("").slice(-4000));
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  stopServer();
}
log(exitCode === 0 ? "PASS" : `FAIL (exit ${exitCode})`);
process.exit(exitCode);
