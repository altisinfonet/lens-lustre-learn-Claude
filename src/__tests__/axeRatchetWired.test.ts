/**
 * P23 clause 2 — THE AXE RATCHET MUST STAY WIRED INTO THE UI GATE.
 *
 * The same reasoning as uiGateCannotBeBypassed.test.ts: each of these is a
 * one-line edit that breaks no other test and leaves a green gate checking
 * nothing — drop the compareAxe() call, delete axe.baseline.json, loosen the
 * axe-core pin, narrow the tags, or have the workflow re-record the baseline.
 *
 * ⚠ IF THIS FILE FAILS, THE ACCESSIBILITY GATE HAS BEEN WEAKENED. Restore the
 * wiring rather than relaxing the assertion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
const capture = read("tools/uishot/capture.mjs");
const ratchet = read("tools/uishot/axe-ratchet.mjs");
const workflow = read(".github/workflows/ui-gate.yml").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const pkg = JSON.parse(read("package.json"));

describe("P23 · the axe ratchet is wired into the UI gate", () => {
  it("axe-core is an exact devDependency at 4.13.0 (the version DECISION.md measured)", () => {
    expect(pkg.devDependencies?.["axe-core"]).toBe("4.13.0");
  });

  it("the baseline exists and records the measured debt (no vacuous pass)", () => {
    const b = JSON.parse(read("tools/uishot/axe.baseline.json") || "{}");
    expect(b.scenes && typeof b.scenes === "object").toBe(true);
    expect(Object.keys(b.scenes).length).toBeGreaterThanOrEqual(50);
  });

  it("WCAG 2.2 AA tags, at the iphone-390 viewport, nothing disabled", () => {
    expect(ratchet).toMatch(/AXE_TAGS = \["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"\]/);
    expect(ratchet).toMatch(/AXE_VIEWPORT = "iphone-390"/);
    expect(capture).not.toMatch(/disableRules|rules:\s*\{/);
  });

  it("capture.mjs runs axe and judges it, and that judgement reaches the exit code", () => {
    expect(capture).toMatch(/window\.axe\.run\(/);
    expect(capture).toMatch(/compareAxe\(axeBaseline, axeCurrent/);
    expect(capture).toMatch(/problems \+= axeFails\.length/);
  });

  it("the workflow never lowers or re-records the baseline itself", () => {
    expect(workflow).not.toMatch(/--lower/);
    expect(workflow).toMatch(/axe-ratchet\.mjs --self-test/);
  });

  it("the ratchet's self-test passes (every failure path fires)", () => {
    const r = spawnSync(process.execPath, ["tools/uishot/axe-ratchet.mjs", "--self-test"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
