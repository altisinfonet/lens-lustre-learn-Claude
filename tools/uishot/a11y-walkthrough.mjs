#!/usr/bin/env node
/**
 * P23 S10a-4 — THE SCRIPTED KEYBOARD + SCREEN-READER WALKTHROUGH.
 *
 * Spec: docs/evidence/d2/phase5/P23/S10a-DECISION.md §4. For each of the ten
 * surfaces (11 scenes, a11y-surfaces-ratchet.mjs SURFACE_SCENES) at both widths
 * (iphone-390, desktop-1280), in Chromium (the Android app's WebView engine)
 * and WebKit (Safari's), on the UI gate's harness (uiharness.html, fake data,
 * no network), it records:
 *   1. the TAB ORDER — every stop's role and accessible name, in order;
 *   2. the ACCESSIBILITY TREE a screen reader is given (Playwright
 *      ariaSnapshot), cut to headings, landmarks and controls;
 *   3. counted findings: unnamed controls, no level-1 heading, no `main`
 *      landmark.
 * The report is written as Markdown (--md) and JSON (--json). The committed
 * docs/evidence/d2/phase5/P23/WALKTHROUGH.md is that Markdown.
 *
 * WHAT IT DOES NOT REPLACE (§4): it reads the tree a screen reader is given; it
 * does not listen to TalkBack / VoiceOver / NVDA, live-region timing or
 * gestures. The hands-on half of clause 3 stays the Owner/D2 item.
 *
 * A REPORT, NOT A RATCHET: findings are counted and published; the run fails
 * only when the self-test fails or a scene does not run (a scene that did not
 * run is never "clean").
 *
 *   node tools/uishot/a11y-walkthrough.mjs --self-test
 *   node tools/uishot/a11y-walkthrough.mjs --browser chromium,webkit --md out.md --json out.json
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, webkit } from "playwright";
import { SURFACE_SCENES, SURFACE_WIDTHS } from "./a11y-surfaces-ratchet.mjs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const flag = (n) => argv.includes(n);
const PORT = 5197;
const BASE = arg("--base") || `http://127.0.0.1:${PORT}`;
const MAX_TABS = 400;
const log = (m) => console.log(`[a11y-walkthrough] ${m}`);
const ENGINES = { chromium, webkit };

/** Roles a person can operate; each must have a name (WAI-ARIA "name required"). */
const CONTROL_ROLES = ["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "tab",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "spinbutton", "listbox", "treeitem"];
const LANDMARK_ROLES = ["banner", "main", "navigation", "contentinfo", "complementary", "region", "search", "form", "dialog", "alertdialog"];
const KEEP = new RegExp(`^\\s*- (${[...CONTROL_ROLES, ...LANDMARK_ROLES, "heading"].join("|")})\\b`);
const CONTROL_LINE = new RegExp(`^\\s*- (${CONTROL_ROLES.join("|")})\\b(.*)$`);

/**
 * ariaSnapshot is YAML: when a name holds ": ", "#" or quotes, Playwright wraps
 * the WHOLE entry in single quotes — `- 'link "Terms: of use"':` — with '' for a
 * literal '. Unwrap it so every rule below sees `- role "name"` (review #751).
 */
export function unquoteLine(line) {
  // The quoted part may be followed by ":" and an inline value (a filled field:
  // `- 'textbox "City: home"': Pune`, review #751); inside it, '' is a literal '.
  const m = line.match(/^(\s*- )'((?:[^']|'')*)'(:.*)?$/);
  return m ? `${m[1]}${m[2].replace(/''/g, "'")}${m[3] ?? ""}` : line;
}

/** "- button \"Like\" [pressed]" → { role, name }. A control with no quoted name is unnamed. */
export function parseLine(line) {
  line = unquoteLine(line);
  const m = line.match(/^\s*- ([a-z]+)\b\s*(?:"((?:[^"\\]|\\.)*)")?/);
  return m ? { role: m[1], name: (m[2] ?? "").replace(/\\"/g, '"').trim() } : null;
}

/** Findings from one aria snapshot (pure; the self-test and the unit test use it). */
export function findingsFromSnapshot(snapshot) {
  const lines = snapshot.split("\n").map(unquoteLine);
  const unnamed = [];
  for (const l of lines) {
    if (!CONTROL_LINE.test(l)) continue;
    const p = parseLine(l);
    if (p && !p.name) unnamed.push(l.trim());
  }
  const hasH1 = lines.some((l) => /^\s*- heading\b.*\[level=1\]/.test(l));
  const hasMain = lines.some((l) => /^\s*- main\b/.test(l));
  return { unnamed, noH1: !hasH1, noMain: !hasMain };
}

export const treeOutline = (snapshot) => snapshot.split("\n").map(unquoteLine).filter((l) => KEEP.test(l)).map((l) => l.replace(/\s+$/, ""));

async function settle(page) {
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
}

/** Tab from the top of the page until focus comes back round (or leaves the page). */
async function tabOrder(page) {
  // Start from the TOP. blur() alone leaves the browser's sequential-focus
  // starting point on the element that had focus (an autofocused field), so
  // every stop before it would be skipped. A non-tabbable marker at the start
  // of <body>, focused, moves the starting point there without adding a stop.
  await page.evaluate(() => {
    let m = document.getElementById("__walk_start");
    if (!m) { m = document.createElement("span"); m.id = "__walk_start"; m.tabIndex = -1; document.body.prepend(m); }
    m.focus(); window.scrollTo(0, 0);
  });
  const stops = [];
  let first = null;
  let ended = false;
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el.id === "__walk_start") return null;
      if (!el.dataset.walkId) el.dataset.walkId = String(Math.random()).slice(2);
      return el.dataset.walkId;
    });
    if (id === null) { if (stops.length) { ended = true; break; } else continue; }
    if (id === first) { ended = true; break; }
    if (first === null) first = id;
    let snap = "";
    try { snap = await page.locator(":focus").first().ariaSnapshot({ timeout: 2000 }); } catch { snap = ""; }
    const head = snap.split("\n")[0] || "";
    const p = parseLine(head);
    const tag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? "");
    stops.push({ role: p?.role ?? `(${tag})`, name: p?.name ?? "" });
  }
  // Never a silent cut: a walk that hit MAX_TABS without coming back round says so.
  if (!ended) stops.truncated = true;
  return stops;
}

async function walkScene(browser, scene, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1,
    isMobile: vp.mobile && browser.browserType().name() !== "firefox", hasTouch: vp.mobile,
    locale: "en-GB", timezoneId: "Asia/Kolkata", colorScheme: "dark", reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/uiharness.html?scene=${encodeURIComponent(scene)}`, { waitUntil: "networkidle", timeout: 45000 });
    await settle(page);
    const mounted = await page.evaluate(() => (document.getElementById("harness-root")?.children.length ?? 0) > 0);
    if (!mounted) throw new Error("the scene did not mount");
    const snapshot = await page.locator("body").ariaSnapshot({ timeout: 15000 });
    const stops = await tabOrder(page);
    const f = findingsFromSnapshot(snapshot);
    const unnamedStops = stops.filter((s) => !s.name && CONTROL_ROLES.includes(s.role)).length;
    return { ok: true, stops, truncated: !!stops.truncated, tree: treeOutline(snapshot), findings: { ...f, unnamedStops } };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    await ctx.close();
  }
}

// ── self-test: every finding must fire on its seeded defect, and none on a clean page ──
const SEEDED = `<!doctype html><html lang="en"><body><div><button></button><a href="/x"></a><input type="text"></div></body></html>`;
const CLEAN = `<!doctype html><html lang="en"><body><header><nav aria-label="Site"><a href="/">Home</a></nav></header><main><h1>Title</h1><button>Go</button><a href="/t">Terms: of use</a><label>Name <input type="text"></label><label>City: home <input type="text" value="Pune"></label></main></body></html>`;

async function selfTest(engineNames) {
  let ok = true;
  for (const n of engineNames) {
    const browser = await ENGINES[n].launch();
    const page = await browser.newPage();
    await page.setContent(SEEDED);
    const bad = findingsFromSnapshot(await page.locator("body").ariaSnapshot());
    await page.setContent(CLEAN);
    const cleanSnap = await page.locator("body").ariaSnapshot();
    const good = { ...findingsFromSnapshot(cleanSnap), tree: treeOutline(cleanSnap) };
    // Like an autofocused sign-in field: something AFTER the first stops holds focus.
    await page.locator("input").first().focus();
    const stops = await tabOrder(page);
    await browser.close();
    const checks = [
      [bad.unnamed.length >= 3, `seeded page: 3 unnamed controls found (${bad.unnamed.length})`],
      [bad.noH1, "seeded page: missing h1 found"],
      [bad.noMain, "seeded page: missing main found"],
      [good.unnamed.length === 0 && !good.noH1 && !good.noMain, `clean page: no finding (${JSON.stringify({ unnamed: good.unnamed, noH1: good.noH1, noMain: good.noMain })})`],
      [good.tree.some((l) => /link "Terms: of use"/.test(l)), `clean page: a name YAML must quote ("Terms: of use") is in the tree`],
      [good.tree.some((l) => /textbox "City: home"/.test(l)), `clean page: a quoted name WITH a value after it ("City: home" = Pune) is in the tree`],
      [stops.map((s) => `${s.role} ${s.name}`).join("|") === "link Home|button Go|link Terms: of use|textbox Name|textbox City: home",
        `clean page: Tab order reads every stop from the top, also with an autofocused field (${stops.map((s) => `${s.role} "${s.name}"`).join(", ")})`],
    ];
    for (const [pass, what] of checks) { log(`${n} self-test ${pass ? "ok  " : "FAIL"} ${what}`); ok &&= pass; }
  }
  return ok;
}

// ── report ─────────────────────────────────────────────────────────────────
function markdown(results, meta) {
  const out = [];
  out.push("# P23 · S10a-4 — scripted keyboard + screen-reader walkthrough");
  out.push("");
  out.push(`Generated by \`tools/uishot/a11y-walkthrough.mjs\` on the UI gate's harness (fake data, no network) — ${meta.at}, ${meta.engines.join(" + ")}.`);
  out.push("Spec: `docs/evidence/d2/phase5/P23/S10a-DECISION.md` §4. **What this does not replace:** it reads the tree a screen reader is given; it does not listen to TalkBack / VoiceOver / NVDA, live-region timing or gestures — that hands-on half of clause 3 stays the Owner/D2 item.");
  out.push("");
  out.push("## Findings");
  out.push("");
  out.push("| Surface @ width | Engine | Tab stops | Unnamed controls (tree) | Unnamed Tab stops | No h1 | No main |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    const f = r.ok ? r.findings : null;
    out.push(r.ok
      ? `| ${r.scene} @ ${r.width} | ${r.engine} | ${r.stops.length}${r.truncated ? ` (cut at ${MAX_TABS})` : ""} | ${f.unnamed.length} | ${f.unnamedStops} | ${f.noH1 ? "yes" : "—"} | ${f.noMain ? "yes" : "—"} |`
      : `| ${r.scene} @ ${r.width} | ${r.engine} | DID NOT RUN: ${r.error.replace(/\|/g, "/")} | | | | |`);
  }
  out.push("");
  out.push("Harness note: scenes render one component tree inside the harness page, so \"No h1\" / \"No main\" describe the scene as mounted there; the app shell adds its own landmarks around real pages.");
  for (const r of results) {
    out.push("");
    out.push(`## ${r.scene} @ ${r.width} · ${r.engine}`);
    if (!r.ok) { out.push(""); out.push(`Did not run: ${r.error}`); continue; }
    if (r.findings.unnamed.length) { out.push(""); out.push("**Unnamed controls:** " + r.findings.unnamed.map((u) => "`" + u.replace(/`/g, "'") + "`").join(", ")); }
    out.push("");
    out.push(`<details><summary>Tab order (${r.stops.length} stops)</summary>`);
    out.push("");
    r.stops.forEach((s, i) => out.push(`${i + 1}. ${s.role}${s.name ? ` "${s.name.replace(/\n/g, " ").slice(0, 90)}"` : " — **no name**"}`));
    out.push("");
    out.push("</details>");
    out.push("");
    out.push(`<details><summary>Accessibility tree — headings, landmarks, controls (${r.tree.length} lines)</summary>`);
    out.push("");
    out.push("```");
    for (const l of r.tree) out.push(l.length > 160 ? l.slice(0, 157) + "…" : l);
    out.push("```");
    out.push("");
    out.push("</details>");
  }
  return out.join("\n") + "\n";
}

let server = null;
const stopServer = () => { if (!server) return; try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ } server = null; };
process.on("exit", stopServer);

async function startHarness() {
  if (arg("--base")) return;
  log(`starting the harness on ${BASE}`);
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the dev server exited early with code ${server.exitCode}`);
    try { const r = await fetch(`${BASE}/uiharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`the harness never answered at ${BASE}/uiharness.html within 180 s`);
}

const engines = (arg("--browser") || "chromium,webkit").split(",").map((s) => s.trim()).filter(Boolean);
for (const e of engines) if (!ENGINES[e]) { console.error(`unknown --browser ${e} (chromium, webkit)`); process.exit(2); }

if (flag("--self-test")) {
  const ok = await selfTest(engines);
  log(ok ? "self-test PASS" : "self-test FAIL");
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startHarness();
  const results = [];
  for (const e of engines) {
    const browser = await ENGINES[e].launch();
    const only = arg("--scene");
    for (const scene of SURFACE_SCENES.filter((x) => !only || x === only)) for (const vp of SURFACE_WIDTHS) {
      const r = await walkScene(browser, scene, vp);
      results.push({ scene, width: vp.name, engine: e, ...r });
      log(r.ok ? `${e} ${scene} @ ${vp.name}: ${r.stops.length} tab stops, ${r.findings.unnamed.length} unnamed, h1 ${r.findings.noH1 ? "missing" : "ok"}, main ${r.findings.noMain ? "missing" : "ok"}`
               : `${e} ${scene} @ ${vp.name}: DID NOT RUN — ${r.error}`);
    }
    await browser.close();
  }
  stopServer();
  const meta = { at: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", engines };
  const mdPath = arg("--md"); const jsonPath = arg("--json");
  if (mdPath) { mkdirSync(dirname(mdPath), { recursive: true }); writeFileSync(mdPath, markdown(results, meta)); log(`wrote ${mdPath}`); }
  if (jsonPath) { mkdirSync(dirname(jsonPath), { recursive: true }); writeFileSync(jsonPath, JSON.stringify({ meta, results }, null, 1)); }
  const failed = results.filter((r) => !r.ok);
  log(failed.length ? `FAIL — ${failed.length} scene/width/engine did not run` : `PASS — ${results.length} walks recorded`);
  process.exit(failed.length ? 1 : 0);
}
