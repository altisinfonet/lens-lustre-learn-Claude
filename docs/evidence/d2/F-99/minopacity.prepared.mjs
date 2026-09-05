/**
 * F-99 — MINIMUM OPACITY ACROSS THE WHOLE LOAD, not just the first frame.
 *
 * The Auditor's criterion, and the reason a first-frame check is not enough:
 * content parked at opacity 0 that never finishes revealing is invisible for
 * the entire session, and a probe that samples once at t=0 could still miss a
 * block that goes to 0 at t=1 and stays. So every text-bearing block is
 * sampled repeatedly across the load and the WORST value it ever shows is what
 * is reported.
 *
 * ⚠⚠ ITS GREEN PROVED NOTHING, AND THE PLANT IS HOW I FOUND THAT OUT. ⚠⚠
 *
 * First run on the fixed tree: 13 scenes, worst opacity 1. Then I restored the
 * shipped defect — hidden back to opacity 0 — and re-ran it. STILL 1. It could
 * not fail on the defect it exists to catch.
 *
 * The reason is the scene list, not the probe. EIGHT OF THE TEN affected pages
 * have no harness scene at all:
 *
 *     /feed          scene exists        /friends       NO SCENE
 *     /profile       scene exists        /dashboard     NO SCENE
 *                                        /competitions  NO SCENE
 *                                        /wallet        NO SCENE
 *                                        /certificates  NO SCENE
 *                                        /winners       NO SCENE
 *                                        /index         NO SCENE
 *                                        /referrals     NO SCENE
 *
 * None of the 13 scenes it loads renders a page that used fadeUp, so the sweep
 * never touched the code under test. This is C-87 a sixth time and mine again:
 * an instrument that cannot fail on the shape that survived it. I nearly
 * reported its 13-scenes-worst-1 as evidence.
 *
 * SO DO NOT READ A PASS FROM THIS AS COVERAGE until the missing scenes exist.
 * The rule is currently enforced by the SOURCE check in
 * src/lib/__tests__/contentNeverStartsInvisible.test.tsx, which reads every
 * page file and therefore does cover all ten. This probe is the second opinion
 * that will matter once the harness can actually load them.
 *
 * Run against the UI harness with the lane env supplied:
 *   npx vite --host 127.0.0.1 --port 5199 --strictPort
 *   node docs/evidence/d2/F-99/minopacity.prepared.mjs
 */
import { chromium } from "playwright";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  for (const d of readdirSync(root))
    for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
}

const BASE = process.env.UI_HARNESS_BASE ?? "http://127.0.0.1:5199";
const SHOTS = process.env.F99_SHOTS ?? "/tmp/f99";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: chromePath() });
const probe = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await probe.goto(`${BASE}/uiharness.html`, { waitUntil: "networkidle" });
const scenes = await probe.$$eval("a[href^='?scene=']", (as) =>
  as.map((a) => new URL(a.href).searchParams.get("scene")).filter(Boolean),
);
await probe.close();

let worstOverall = 1;
const rows = [];
for (const scene of scenes.filter((s) => s.startsWith("screen-"))) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${BASE}/uiharness.html?scene=${scene}`, { waitUntil: "networkidle" });

  // Sample repeatedly: the worst value any text block EVER shows.
  const worst = await page.evaluate(async () => {
    /*
     * TWO EXCLUSIONS, BOTH FOUND BY THE PROBE'S FIRST RUN REPORTING THINGS THAT
     * WERE TRUE BUT NOT DEFECTS. Recorded rather than silently tightened,
     * because narrowing a probe is exactly how a probe stops being able to fail.
     *
     *   group-hover  — a deliberately hidden overlay revealed on hover or on
     *                  first tap. PostCard's reach/view badge sits at opacity-0
     *                  with group-hover/media:opacity-100 and pointer-events:
     *                  none. It reported as "979reached706viewed at opacity 0"
     *                  on screen-feed and screen-post-detail. Nothing is
     *                  stranded; it is not meant to be visible yet.
     *   animate-pulse — a loading indicator whose whole job is to pulse.
     *                  screen-profile's "Loading..." read 0.880799 mid-pulse.
     *
     * Neither exclusion looks at the OPACITY, only at the declared intent, so a
     * genuinely stranded block carrying either class would still be caught by
     * its ancestors and siblings.
     */
    const deliberate = (el) => {
      const c = typeof el.className === "string" ? el.className : "";
      return c.includes("group-hover") || c.includes("animate-pulse");
    };
    const readable = () =>
      [...document.querySelectorAll("div,section,article,main,li")].filter((el) => {
        const t = (el.textContent || "").trim();
        if (t.length < 8) return false;
        if (deliberate(el)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    let min = 1, culprit = "";
    for (let i = 0; i < 40; i++) {
      for (const el of readable()) {
        const o = parseFloat(getComputedStyle(el).opacity);
        if (!Number.isNaN(o) && o < min) {
          min = o;
          culprit = (el.textContent || "").trim().slice(0, 60);
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { min, culprit };
  });

  await page.screenshot({ path: join(SHOTS, `${scene}.png`), fullPage: false });
  rows.push([scene, worst.min, worst.culprit]);
  if (worst.min < worstOverall) worstOverall = worst.min;
  await page.close();
}
await browser.close();

for (const [scene, min, culprit] of rows.sort((a, b) => a[1] - b[1])) {
  const flag = min < 1 ? "FAIL" : "ok  ";
  console.log(`${flag} ${String(min).padEnd(10)} ${scene.padEnd(34)} ${culprit}`);
}
console.log(`\nworst opacity any readable block ever showed: ${worstOverall}`);
console.log(`frames written to ${SHOTS}`);
process.exit(worstOverall < 1 ? 1 : 0);
