/**
 * THE UI GATE MUST NOT BE REMOVABLE BY ACCIDENT — OR QUIETLY ON PURPOSE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, 2026-08-19. The owner's objection was not about one bug:
 *
 *   "we will build one gate you will break another gate which is working.
 *    This should not happen"
 *
 * A gate answers that only for as long as it is actually wired up. Every part
 * of this one can be disabled by a single small edit that looks harmless in a
 * diff and breaks nothing else: drop `ui-gate` from `build-aab`'s `needs` and
 * the build stops waiting for it; add `|| true` and it always passes; delete
 * `baseline.json` and the diff silently has nothing to compare against and says
 * so in a line nobody reads; put `--baseline-write` in the workflow and every
 * run re-records its own baseline and agrees with itself for ever.
 *
 * None of those fail a typecheck. None fail any other test. Each leaves a green
 * pipeline that is no longer checking anything — which is worse than having no
 * gate, because the green is now a lie.
 *
 * So the gate's own wiring is asserted here, from the files themselves.
 *
 * ⚠ IF THIS FILE FAILS, THE GATE HAS BEEN WEAKENED. Restore the wiring rather
 * than relaxing the assertion. Deleting a check to get green is the exact move
 * this repository has already paid for once.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WORKFLOW = join(ROOT, ".github/workflows/android-build.yml");
const STANDALONE = join(ROOT, ".github/workflows/ui-gate.yml");
const CAPTURE = join(ROOT, "tools/uishot/capture.mjs");
const GATE = join(ROOT, "tools/uishot/gate.mjs");
const BASELINE = join(ROOT, "tools/uishot/baseline.json");

/**
 * ⚠ COMMENTS ARE STRIPPED BEFORE ANY "IS IT DISABLED?" CHECK, and this test
 * caught the need for it on itself. Both workflows explain, in a comment, that
 * there is deliberately no `|| true` fallback — and that sentence contains the
 * literal `|| true`, so the assertion fired on the prose describing the rule it
 * was enforcing. Funny once; a permanently red gate otherwise, and a red gate
 * gets relaxed rather than read.
 *
 * Only whole-line comments are removed. A real `run: npm run ui:gate || true`
 * is code, survives this, and is still caught — proven by mutations 3 and 17 in
 * tools/mutate-ui-gate.mjs.
 */
const stripYamlComments = (s: string) =>
  s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

const workflow = existsSync(WORKFLOW) ? stripYamlComments(readFileSync(WORKFLOW, "utf8")) : "";
const standalone = existsSync(STANDALONE) ? stripYamlComments(readFileSync(STANDALONE, "utf8")) : "";
const capture = existsSync(CAPTURE) ? readFileSync(CAPTURE, "utf8") : "";
const gate = existsSync(GATE) ? readFileSync(GATE, "utf8") : "";
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

describe("the UI gate is wired into the build and cannot be silently bypassed", () => {
  it("all three pieces exist (guards against a vacuous pass)", () => {
    // Without this, deleting the tooling would make the assertions below pass
    // by matching nothing.
    expect(existsSync(WORKFLOW), "the Android workflow is gone").toBe(true);
    expect(capture.length, "tools/uishot/capture.mjs is gone — there is no sweep").toBeGreaterThan(2000);
    expect(gate.length, "tools/uishot/gate.mjs is gone — nothing joins the server to the sweep").toBeGreaterThan(500);
  });

  it("the workflow declares a ui-gate job that runs the gate command", () => {
    expect(/^\s{2}ui-gate:/m.test(workflow), "the ui-gate job has been removed from the workflow").toBe(true);
    expect(
      /run:\s*npm run ui:gate\b/.test(workflow),
      "the ui-gate job no longer runs `npm run ui:gate` — it may be running something weaker",
    ).toBe(true);
  });

  it("the Android build DEPENDS on the ui gate, so a red gate produces no .aab", () => {
    const needs = /^\s{2}build-aab:\s*\n(?:.*\n)*?\s*needs:\s*(.+)$/m.exec(workflow);
    expect(needs, "build-aab no longer declares `needs:` at all").not.toBeNull();
    expect(
      needs![1].includes("ui-gate"),
      `build-aab's needs is "${needs?.[1]}" — it no longer waits for ui-gate, so the ` +
        `build runs and an .aab is produced even when the gate is red`,
    ).toBe(true);
  });

  it("the gate ALSO runs on every push, not only when a build is cut", () => {
    /**
     * android-build.yml only fires on `ANDROID_BUILD_TRIGGER` or on edits to
     * itself, so without this a broken control could sit on main for days and
     * only surface on release day — when the cost of finding out is highest and
     * the temptation to wave it through is greatest.
     *
     * This is an ADDITION, never a replacement: a job in one workflow cannot be
     * a `needs:` dependency of a job in another, so the copy in android-build.yml
     * is still the only thing that actually blocks a release.
     */
    expect(
      existsSync(STANDALONE),
      ".github/workflows/ui-gate.yml is gone — the gate now only runs when a build is cut, " +
        "so a regression can sit on main unnoticed until release day",
    ).toBe(true);
    expect(/^\s*push:/m.test(standalone), "the standalone gate no longer runs on push").toBe(true);
    expect(/run:\s*npm run ui:gate\b/.test(standalone), "the standalone gate no longer runs the gate command").toBe(true);
    expect(/\|\|\s*true/.test(standalone), "the standalone gate swallows its failure with `|| true`").toBe(false);
    expect(/continue-on-error:\s*true/.test(standalone), "the standalone gate is continue-on-error").toBe(false);
    expect(/--baseline-write/.test(standalone), "the standalone gate re-records its own baseline").toBe(false);
  });

  it("nothing swallows the gate's failure", () => {
    // `|| true`, `continue-on-error` or `if: always()` on the gate STEP would
    // each turn a red gate green while leaving the job visibly present.
    const job = workflow.slice(workflow.indexOf("  ui-gate:"), workflow.indexOf("  build-aab:"));
    const gateStep = job.slice(0, job.indexOf("Upload the screenshots"));
    expect(/\|\|\s*true/.test(gateStep), "the gate step swallows its own failure with `|| true`").toBe(false);
    expect(/continue-on-error:\s*true/.test(gateStep), "the gate step is continue-on-error").toBe(false);
    expect(
      /--baseline-write/.test(job),
      "the workflow passes --baseline-write, so every run re-records its own baseline and " +
        "can only ever agree with itself. Recording the baseline is a reviewed act, not a CI step.",
    ).toBe(false);
  });

  it("`npm run ui:gate` still points at the real runner", () => {
    expect(pkg.scripts?.["ui:gate"]).toBe("node tools/uishot/gate.mjs");
    expect(pkg.scripts?.["ui:shot"]).toBe("node tools/uishot/capture.mjs");
  });

  it("the gate runner exits with the sweep's own result", () => {
    // If this stops being true, every check below it is decoration: the job
    // would pass regardless of what the sweep found.
    expect(/process\.exit\(exitCode\)/.test(gate), "gate.mjs no longer exits with the sweep's code").toBe(true);
    expect(
      /throw new Error\(`the harness never answered/.test(gate),
      "a harness that never starts no longer FAILS — it would read as 'nothing to report'",
    ).toBe(true);
  });

  it("the sweep still fails the process when it finds something", () => {
    expect(
      /process\.exit\(problems > 0 \? 1 : 0\)/.test(capture),
      "capture.mjs no longer exits non-zero on findings — the whole gate is now decoration",
    ).toBe(true);
  });

  it("GATE 1 — the universal reachability check is still in the sweep", () => {
    expect(
      /elementFromPoint\(\(vl \+ vr\) \/ 2, \(vt \+ vb\) \/ 2\)/.test(capture),
      "the reachability hit test is gone — this is the check that catches the DOB class of bug",
    ).toBe(true);
    expect(/controls not reachable at their own centre/.test(capture)).toBe(true);
  });

  it("GATE 2 — the baseline diff is still in the sweep, and still has a baseline", () => {
    expect(/BASELINE REGRESSIONS/.test(capture), "the baseline diff has been removed").toBe(true);
    expect(
      existsSync(BASELINE),
      "tools/uishot/baseline.json is gone. The diff then has nothing to compare against and " +
        "reports it in one line that fails nothing — a green gate checking half of what it claims.",
    ).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    const keys = Object.keys(baseline);
    const controls = keys.reduce((n, k) => n + baseline[k].length, 0);
    // Emptying the file is the other way to disable the diff while leaving it
    // present. Recorded 2026-08-19: 140 keys, 2,528 controls.
    expect(keys.length, "the baseline covers far fewer screens than it did").toBeGreaterThan(100);
    expect(controls, "the baseline is nearly empty — it can no longer detect a regression").toBeGreaterThan(1500);
  });

  it("the three regression rules the baseline diff enforces are all still there", () => {
    for (const [rule, needle] of [
      ["a control disappearing", "is gone (was present in the baseline)"],
      ["a dropdown losing options", "options now, had"],
      ["a control shrinking below the tap floor", "a tappable size)"],
    ] as const) {
      expect(capture.includes(needle), `the baseline diff no longer detects ${rule}`).toBe(true);
    }
  });
});
