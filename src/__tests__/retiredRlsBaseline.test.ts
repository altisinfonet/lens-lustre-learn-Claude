// @vitest-environment node
/**
 * S11 · the frozen RLS baseline is retired, not left looking like a guard.
 * scripts/audits/rls-authority-scan.mjs compared migration TEXT against a
 * baseline frozen 2026-05-12. The workflow that ran it was deleted in cd3dc7ef
 * and nothing re-added it, so for months it guarded nothing — and run today it
 * reports ~495 "new" findings, mostly trigger functions that by design check
 * no caller. Live security is measured on the database instead
 * (PROBE_s1_phase0_security_20261028.sql, S1P0-2 measures the same rule live).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("retired: frozen RLS authority baseline", () => {
  it("the scanner and its baseline are gone", () => {
    expect(existsSync(join(ROOT, "scripts/audits/rls-authority-scan.mjs"))).toBe(false);
    expect(existsSync(join(ROOT, "scripts/audits/baselines/rls-authority-baseline.json"))).toBe(false);
  });
  it("no workflow or package script still names it", () => {
    const wf = readdirSync(join(ROOT, ".github/workflows")).map((f) => readFileSync(join(ROOT, ".github/workflows", f), "utf8"));
    for (const t of [...wf, readFileSync(join(ROOT, "package.json"), "utf8")]) expect(t).not.toMatch(/rls-authority-(scan|baseline)/);
  });
  it("its design doc says RETIRED first and names the live measurement", () => {
    const doc = readFileSync(join(ROOT, "docs/fix-sprints/sprint-0-phase-0b-6-rls-authority-guardrail.md"), "utf8");
    const head = doc.split("\n").slice(0, 12).join("\n");
    expect(head).toMatch(/RETIRED/);
    expect(head).not.toMatch(/GUARDRAIL ACTIVE/);
    expect(head).toContain("PROBE_s1_phase0_security_20261028.sql");
  });
});
