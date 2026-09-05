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
for (const scene of scenes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${BASE}/uiharness.html?scene=${scene}`, { waitUntil: "networkidle" });
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
  await page.waitForFunction(
    (names) => {
      // Settle on THE THING BEING MEASURED, not on a proxy for it.
      //
      // This first counted anchors, and that was a proxy: the link count goes
      // stable while the member names are still arriving, so a scene could be
      // sampled before its people rendered. Measured — the single-scene run
      // read "0 live, 0 dead" on screen-feed where the full sweep read 12, and
      // the difference was purely when the sample landed.
      //
      // Counting the member names themselves cannot go stable before they are
      // there. Requiring n > 0 means a scene with no members waits out the
      // deadline rather than passing instantly on an empty page — which is the
      // safe direction, because a scene that renders nobody is exactly the
      // condition that made the first plant a false green.
      let n = 0;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = w.nextNode())) {
        if (names.includes((node.textContent || "").trim())) n++;
      }
      const prev = window.__nameCount;
      window.__nameCount = n;
      return prev !== undefined && prev === n && n > 0;
    },
    members.map((m) => m.name),
    { timeout: 15000, polling: 250 },
  ).catch(() => { /* deadline: measure it anyway and let the result speak */ });

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
  if (found.length) {
    const flag = dead.length ? "FAIL" : "ok  ";
    console.log(`${flag} ${scene.padEnd(36)} ${live} live, ${dead.length} dead`);
    for (const d of dead) {
      console.log(`        DEAD  ${d.name.padEnd(20)} href=${d.href ?? "(no anchor)"}  expected ${d.expected}`);
      console.log(`              ${d.chain}`);
    }
  }
  await page.close();
}
await browser.close();
console.log(`\n${liveTotal} live, ${deadTotal} dead across every scene.`);
process.exit(deadTotal > 0 ? 1 : 0);

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
