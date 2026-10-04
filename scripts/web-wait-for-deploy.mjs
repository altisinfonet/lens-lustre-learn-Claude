#!/usr/bin/env node
/**
 * F-AUD-1 · wait until the origin serves the pushed commit, THEN measure.
 *
 * Reads `<meta name="build-commit">` from the origin's index.html (stamped by
 * scripts/web-build-commit.mjs) every POLL_S seconds until:
 *   • it names the expected commit                         -> exit 0 (measure now)
 *   • it names a NEWER commit that contains the expected one -> exit 0 (a later
 *     push superseded ours; its build includes our change)
 *   • TIMEOUT_S passes                                      -> exit 1, saying what
 *     was served — never "measure anyway", because measuring the wrong build is
 *     exactly the defect (main #12, run 37206638044, R-94).
 * An absent stamp is "not deployed yet" until the timeout, then a failure that
 * names the cause (a build from before F-AUD-1, or a stripped meta tag).
 *
 *   node scripts/web-wait-for-deploy.mjs <origin> <expected-sha> [--timeout 1200] [--poll 20]
 *   node scripts/web-wait-for-deploy.mjs --self-test
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readStamp } from "./web-build-commit.mjs";

/** Pure decision. `contains(served, expected)` answers "is expected an ancestor of served?". */
export function decide(served, expected, contains) {
  if (!served) return { done: false, why: "no build-commit stamp served yet" };
  if (served === expected) return { done: true, why: "served build = pushed commit" };
  if (/^[0-9a-f]{40}$/.test(served) && contains(served, expected)) return { done: true, why: `served build ${served.slice(0, 7)} is newer and contains ${expected.slice(0, 7)}` };
  return { done: false, why: `served build is ${served.slice(0, 12)}, not ${expected.slice(0, 7)} yet` };
}

export const SELF_TEST = [
  ["same commit", "a".repeat(40), "a".repeat(40), false, true],
  ["older build still served", "b".repeat(40), "a".repeat(40), false, false],
  ["newer build containing ours", "c".repeat(40), "a".repeat(40), true, true],
  ["no stamp yet", null, "a".repeat(40), false, false],
  ["'unknown' stamp", "unknown", "a".repeat(40), true, false],
];
export function selfTest() {
  return SELF_TEST.filter(([, s, e, anc, want]) => decide(s, e, () => anc).done !== want).map(([n]) => n);
}

function gitContains(served, expected) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", expected, served], { stdio: "ignore" });
    return true;
  } catch { return false; }
}

function fetchStamp(origin) {
  try {
    const html = execFileSync("curl", ["-sS", "--compressed", "--max-time", "20", "-H", "cache-control: no-cache", `${origin.replace(/\/+$/, "")}/?deploycheck=${Date.now()}`], { encoding: "utf8" });
    return readStamp(html);
  } catch { return null; }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const a = process.argv.slice(2);
  if (a.includes("--self-test")) {
    const f = selfTest();
    f.forEach((n) => console.error("SELF-TEST FAIL · " + n));
    console.log(`self-test: ${SELF_TEST.length - f.length}/${SELF_TEST.length} cases decided correctly`);
    process.exit(f.length ? 1 : 0);
  }
  const [origin, expected] = a.filter((x) => !x.startsWith("--"));
  const num = (k, d) => { const i = a.indexOf(k); return i >= 0 ? Number(a[i + 1]) : d; };
  const timeoutS = num("--timeout", 1200), pollS = num("--poll", 20);
  if (!origin || !/^[0-9a-f]{40}$/.test(expected || "")) { console.error("usage: <origin> <40-hex sha>"); process.exit(2); }
  const deadline = Date.now() + timeoutS * 1000;
  let last = "";
  for (;;) {
    const served = fetchStamp(origin);
    const d = decide(served, expected, gitContains);
    if (d.why !== last) { console.log(`[${new Date().toISOString()}] ${d.why}`); last = d.why; }
    if (d.done) process.exit(0);
    if (Date.now() > deadline) {
      console.error(`::error::F-AUD-1 · ${origin} did not serve ${expected.slice(0, 7)} within ${timeoutS}s (last: ${d.why}). Not measuring the wrong build.`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, pollS * 1000));
  }
}
