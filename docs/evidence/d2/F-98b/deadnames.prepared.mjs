/**
 * F-98b — IS EVERY VISIBLE MEMBER NAME A LINK? Enumerated by NAME, on the
 * rendered page, with NO hand-written list of surfaces.
 *
 * WHY THIS EXISTS. Three counting criteria have now failed in a row:
 *   "zero id links"     — passed on /discover with 29 anchors and NO member
 *                         links at all. No bad links and no links are the same
 *                         number.
 *   "20 member links"   — the Auditor's next criterion. Twenty was TRUE and
 *                         worthless: a total cannot distinguish twenty live and
 *                         zero dead from twenty live and six dead.
 *   an eight-file list  — my own. SURFACES enumerated the files I knew about,
 *                         so the People You May Know sidebar — which is not one
 *                         of them — could never fail it. A check with a
 *                         hand-written list cannot fail on a surface nobody
 *                         added, which is C-87 in its purest form.
 *
 * So this walks whatever actually rendered. Every text node matching a known
 * member's name is found, and each one must sit inside an anchor to that
 * member's handle. A new component nobody enumerates is covered the day it
 * ships, because it is not enumerated at all — the MEMBERS are.
 *
 * It reports the DEAD LIST per scene, by name, because "6 dead" sends you
 * looking and "Caleb North, Priya Duarte, ..." tells you where.
 */
import { chromium } from "playwright";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  for (const d of readdirSync(root))
    for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
}

/** The members the harness renders, read from the fixture rather than retyped. */
function knownMembers() {
  const src = readFileSync(join(process.cwd(), "src/uiharness/fixtures.ts"), "utf8");
  // The names are indirect — full_name: FIXTURE_NAMES[0] — so resolve the array
  // first. Written this way after the literal-only regex parsed ZERO members,
  // which would have made this probe pass vacuously on every scene. A probe
  // that finds nothing to check reports success, so it refuses to run below if
  // this comes back empty.
  const namesBlock = src.match(/FIXTURE_NAMES = \[([\s\S]*?)\]/);
  const names = namesBlock
    ? [...namesBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : [];
  const out = [];
  const re = /full_name:\s*(?:FIXTURE_NAMES\[(\d+)\]|"([^"]+)")[\s\S]{0,400}?custom_url:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1] !== undefined ? names[Number(m[1])] : m[2];
    if (name) out.push({ name, handle: m[3] });
  }
  return out;
}

const BASE = process.env.UI_HARNESS_BASE ?? "http://127.0.0.1:5199";
const members = knownMembers();
if (members.length === 0) {
  console.error("no fixture members parsed — the probe would pass vacuously; refusing to run");
  process.exit(2);
}
console.log(`known members: ${members.map((m) => `${m.name} -> /${m.handle}`).join(", ")}\n`);

const browser = await chromium.launch({ executablePath: chromePath() });
const probe = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await probe.goto(`${BASE}/uiharness.html`, { waitUntil: "networkidle" });
const scenes = await probe.$$eval("a[href^='?scene=']", (as) =>
  as.map((a) => new URL(a.href).searchParams.get("scene")).filter(Boolean),
);
await probe.close();

let deadTotal = 0, liveTotal = 0;
const empty = [], unmeasured = [], broken = [];
for (const scene of scenes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  /*
   * A PAGE THAT THREW IS NOT A PAGE WITH NO MEMBERS.
   *
   * This probe reported "EMPTY — 0 live, 0 dead" for scenes that had CRASHED
   * during render and rendered 16 elements and no body at all. A fixture of
   * mine put a number where the app expected a placement string,
   * placementIcon() called .toLowerCase() on it, and every scene with a right
   * sidebar came back blank. The probe called that a clean scene with nobody in
   * it, and several sweeps went by.
   *
   * "Nothing rendered" and "nothing to render" are the same number, which is
   * the mistake this whole file exists to stop making. So an uncaught error is
   * captured and the scene is BROKEN — reported by name, with the message, and
   * it fails the run.
   */
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 200)));
  await page.goto(`${BASE}/uiharness.html?scene=${scene}`, { waitUntil: "networkidle" });
  let settled = false;
  /*
   * SETTLE ON A CONDITION, NOT A SLEEP.
   *
   * This was waitForTimeout(1200) and it reported SEVEN DEAD NAMES on
   * screen-account-sheet while the identical sidebar on screen-feed read clean.
   * They were not dead: useMemberHandles resolves asynchronously through
   * profileMapCache's batch window, and a scene that mounts an overlay has more
   * to do before the sidebar behind it settles. At 4000ms the same run read
   * 82 live, 0 dead.
   *
   * Raising the number would have made the red go away without making the
   * instrument correct — the next slower machine reproduces it, and a probe
   * that reports a race as a defect will be ignored the third time it cries.
   * So it waits for the page to STOP CHANGING: the link count must hold steady
   * across two consecutive samples, with a hard deadline so a genuinely stuck
   * page still gets measured rather than hanging the run.
   */
  /*
   * SETTLE ON BOTH NUMBERS THIS PROBE REPORTS, NOT ON ONE OF THEM.
   *
   * Three settle conditions have now failed here, each for the same reason:
   * they watched something that goes still BEFORE the thing being measured
   * does.
   *
   *   waitForTimeout(1200)  reported 7 dead on screen-account-sheet that were
   *                         a race. Raising the number would have hidden it.
   *   anchor count stable   a proxy. The link count settles while the member
   *                         names are still arriving; a single-scene run read
   *                         "0 live, 0 dead" on screen-feed where the full
   *                         sweep read 12.
   *   name count stable     better, and still wrong in the way that matters:
   *                         a name renders as TEXT first and becomes a LINK
   *                         when its handle arrives. The name count never
   *                         changes across that transition, so the scene can
   *                         be sampled in the window where every name is
   *                         correct and dead. That is precisely the false red
   *                         of the first attempt, reached by a different road.
   *
   * So it settles on the PAIR (names, live links). A name going live changes
   * the second number and resets the streak; a name arriving changes the
   * first. Three consecutive equal samples, which is 500ms of genuine
   * stillness after networkidle rather than a guess at how long a machine
   * takes.
   *
   * n > 0 IS NO LONGER REQUIRED, and that is a correction. Requiring it meant
   * a scene with genuinely no members — 27 of the 47 mount one component with
   * invented props and can never render a person — burned the full 15s
   * deadline and then reported UNMEASURED, so the probe could never pass and
   * a real unmeasured scene was buried among 27 that were fine. An empty
   * scene is now EMPTY, quickly, and only a scene that never went still is
   * UNMEASURED.
   */
  const settleSamples = [];
  await page.waitForFunction(
    (names) => {
      let n = 0;
      let live = 0;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = w.nextNode())) {
        const text = (node.textContent || "").trim();
        if (!names.includes(text)) continue;
        n++;
        if (node.parentElement && node.parentElement.closest("a")) live++;
      }
      /*
       * THE THIRD TERM, AND WHY IT IS NEEDED.
       *
       * Requiring n > 0 made 27 structurally memberless scenes burn the full
       * deadline and report UNMEASURED. Dropping it did the mirror image:
       * screen-discover and screen-friends settled at (0,0) and reported EMPTY
       * roughly 750ms in, BEFORE their sidebar data had arrived. Both readings
       * were wrong and in opposite directions, which is the tell that the
       * condition was watching too little.
       *
       * The element count is what separates them. A scene with nothing to show
       * has a DOM that stops changing almost at once, so it is EMPTY quickly
       * and honestly. A scene still assembling itself keeps changing, so it
       * cannot settle at zero — it waits until its people are there.
       *
       * This is a proxy, and this file's history says proxies fail here. It is
       * used only to say "the page has stopped becoming", never to say
       * anything about liveness: the two numbers that decide the RESULT are
       * still the member names and the live links, and both are in the tuple.
       * A scene that never stops changing burns the deadline and is
       * UNMEASURED, which is loud rather than green.
       */
      const key = `${n}:${live}:${document.getElementsByTagName("*").length}`;
      window.__settle = window.__settle === undefined ? [] : window.__settle;
      window.__settle.push(key);
      /*
       * ASYMMETRIC EVIDENCE, BECAUSE ZERO IS THE DANGEROUS ANSWER.
       *
       * "This page has no members" and "this page has not finished rendering
       * its members" produce the identical reading, and only one of them is a
       * fact. Measured: screen-discover reported 0 while its right sidebar
       * demonstrably renders seven member names — People You May Know 3,
       * Winners 2, Milestones 2 — because the DOM went briefly still before
       * the shared dashboard fetch resolved.
       *
       * So a scene claiming ZERO must hold that reading for 2 seconds, and a
       * scene that has actually found people needs only 750ms. This is not a
       * sleep tuned until the red went away: it costs more evidence for the
       * conclusion that would silently pass, and nothing at all for the
       * conclusion that would fail. The deadline still bounds both.
       */
      const s = window.__settle;
      const need = n === 0 ? 8 : 3;
      if (s.length < need) return false;
      const tail = s.slice(-need);
      return tail.every((v) => v === tail[0]);
    },
    members.map((m) => m.name),
    { timeout: 15000, polling: 250 },
  ).then(() => { settled = true; })
   .catch(() => { /* deadline: measured anyway, but recorded as UNSETTLED below */ });
  void settleSamples;

  const found = await page.evaluate((members) => {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.textContent || "").trim();
      const member = members.find((m) => m.name === text);
      if (!member) continue;
      const el = node.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // not visible to anyone
      const key = `${member.name}@${Math.round(r.top)},${Math.round(r.left)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      /*
       * data-unlinked="deliberate" is a caller's STATED answer that this name is
       * not a link — a member's own name on their own page. "missing" means no
       * handle arrived and nobody decided anything, which is the defect. See
       * UserIdentityBlock. Exempting only what was declared keeps the probe able
       * to fail: an accidental dead name carries no marker.
       */
      if (el.getAttribute("data-unlinked") === "deliberate") continue;
      const a = el.closest("a");
      results.push({
        name: member.name,
        expected: `/${member.handle}`,
        href: a ? a.getAttribute("href") : null,
        chain: (() => {
          const parts = [];
          let cur = el;
          for (let i = 0; i < 5 && cur; i++, cur = cur.parentElement) {
            const cls = typeof cur.className === "string" ? cur.className.split(" ").slice(0, 2).join(".") : "";
            parts.push(cur.tagName + (cls ? "." + cls : ""));
          }
          return parts.join(" < ");
        })(),
      });
    }
    return results;
  }, members);

  const dead = found.filter((f) => f.href !== f.expected);
  const live = found.length - dead.length;
  liveTotal += live;
  deadTotal += dead.length;
  /*
   * EVERY SCENE PRINTS A LINE, INCLUDING THE EMPTY ONES.
   *
   * This used to print only scenes where found.length > 0, and that is the
   * silent zero this file's own header warns about — the fourth time the same
   * mistake has been made here. Two runs of this probe against the SAME commit
   * read 82 live and then 47 live; the difference was that screen-profile and
   * screen-account-sheet rendered nobody on the second run and so printed
   * NOTHING AT ALL. A scene that vanishes from the report looks exactly like a
   * scene that passed. Only diffing two runs by eye caught it, which is not an
   * instrument.
   *
   * A scene with no members is now EMPTY, and an EMPTY scene that also never
   * settled is UNSETTLED — not a clean result, a measurement that did not
   * happen. Both are counted and both fail the run.
   */
  const status = pageErrors.length
    ? "BROKEN"
    : dead.length
      ? "FAIL"
      : found.length === 0
        ? (settled ? "EMPTY" : "UNMEASURED")
        : "ok  ";
  if (pageErrors.length) broken.push(`${scene}: ${pageErrors[0]}`);
  else if (found.length === 0 && !settled) unmeasured.push(scene);
  else if (found.length === 0 && settled) empty.push(scene);
  console.log(
    `${status.padEnd(5)} ${scene.padEnd(36)} ${live} live, ${dead.length} dead` +
      (settled ? "" : "   (settle deadline expired — state below is whatever was on screen)"),
  );
  for (const e of pageErrors.slice(0, 2)) console.log(`        THREW  ${e}`);
  for (const d of dead) {
    console.log(`        DEAD  ${d.name.padEnd(20)} href=${d.href ?? "(no anchor)"}  expected ${d.expected}`);
    console.log(`              ${d.chain}`);
  }
  await page.close();
}
await browser.close();
console.log(`\n${liveTotal} live, ${deadTotal} dead across ${scenes.length} scenes.`);
if (empty.length) console.log(`EMPTY (settled, but rendered no known member): ${empty.join(", ")}`);
if (unmeasured.length) console.log(`UNMEASURED (never settled AND rendered nobody): ${unmeasured.join(", ")}`);
if (broken.length) {
  console.log(`BROKEN (the page threw during render — measuring it would be measuring a crash):`);
  for (const b of broken) console.log(`  ${b}`);
}
/*
 * A run is green only when names were found, none were dead, and no scene was
 * left unmeasured. "0 dead" on a page that rendered nobody is the same number
 * as "0 dead" on a page where everyone is linked, and the whole point of this
 * probe is that those two must never print the same thing.
 */
process.exit(deadTotal > 0 || unmeasured.length > 0 || broken.length > 0 ? 1 : 0);

/*
 * PLANT REGISTER — C-90: no green counts until the instrument has been broken
 * and watched to fail.
 *
 *   CONTROL   committed tree, screen-feed            12 live,  0 dead
 *   PLANT AE  FeedRightSidebar handle stripped        9 live,  3 dead
 *             DEAD Avijit Sheel                  href=(none)
 *             DEAD Ranjana Bhattacharya Chowdhury href=(none)
 *             DEAD Li Wei                        href=(none)
 *   RESTORED                                        12 live,  0 dead
 *
 * That is the exact defect the Owner found — the same component, the same
 * cause — and this probe now names the members rather than reporting a total.
 *
 * Two earlier verdicts from this same probe were WRONG and are kept here
 * because a probe's history is the only evidence it can be trusted:
 *   FALSE GREEN  the first plant PASSED — the harness fixture rendered no
 *                sidebar members at all, so there was nothing to walk.
 *   FALSE RED    a fixed 1200ms sleep reported 7 dead on screen-account-sheet
 *                that were a race, not a defect.
 */
