/**
 * THE C3 GATE CANNOT PASS BY ACCIDENT. Review of #898: "eslint exited non-zero"
 * also means a crash or a parse error, and a ratchet run that read no files
 * exits 0. These tests run the REAL eslint against deliberately broken configs
 * and require the gate to fail on each.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { judgeRatchet, judgeSelfTest, runRatchet, runSelfTest } from "../../tools/comment-rows-gate.mjs";

const SLOW = 180_000;
const written: string[] = [];

/** A throwaway config at the repo root, so its relative imports resolve. */
function config(name: string, body: string) {
  const file = `.c3-gate-selftest-${process.pid}-${name}.config.js`;
  fs.writeFileSync(file, body);
  written.push(file);
  return file;
}
afterAll(() => { for (const f of written) fs.rmSync(f, { force: true }); });

const withFiles = (files: string, rules = `{ "d2/no-comment-rows": "error" }`) => `
import tseslint from "typescript-eslint";
import rule from "./eslint-rules/no-comment-rows.js";
export default tseslint.config({
  files: ${files},
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  linterOptions: { noInlineConfig: true },
  plugins: { d2: { rules: { "no-comment-rows": rule } } },
  rules: ${rules},
});`;

describe("the self-test, on real eslint", () => {
  it("passes on the real config, on the rule's own message", async () => {
    const r = await runSelfTest();
    expect(r.failed, r.said.join("\n")).toEqual([]);
    expect(r.status).toBe(1);
  }, SLOW);

  it("FAILS when the file is ignored by a config or glob change (eslint exits 0)", async () => {
    const r = await runSelfTest(config("ignored", withFiles(`["nowhere/**/*.tsx"]`)));
    expect(r.status).toBe(0);
    expect(r.failed.join(" ")).toMatch(/not rejected/);
  }, SLOW);

  it("FAILS when the rule is switched off (eslint exits 0)", async () => {
    const r = await runSelfTest(config("off", withFiles(`["src/**/*.tsx"]`, "{}")));
    expect(r.status).toBe(0);
    expect(r.failed.join(" ")).toMatch(/not rejected/);
  }, SLOW);

  it("FAILS when eslint crashes (non-zero, which the old step called a pass)", async () => {
    const r = await runSelfTest(config("crash", `throw new Error("broken config");`));
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBe(1);
    expect(r.failed.join(" ")).toMatch(/crashed/);
  }, SLOW);

  it("FAILS on a parse error (exit 1 with no rule message, which the old step called a pass)", async () => {
    const r = await runSelfTest(undefined, "export const = ;");
    expect(r.status).toBe(1);
    expect(r.failed.join(" ")).toMatch(/d2\/no-comment-rows/);
  }, SLOW);
});

describe("the ratchet, on real eslint", () => {
  it("FAILS when eslint reports 0 files and exits 0 (real run: --quiet empties the list on a clean tree)", async () => {
    const r = await runRatchet(undefined, ["--quiet"]);
    expect(r.status).toBe(0);
    expect(r.linted).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.failed.join(" ")).toMatch(/0 files linted/);
  }, SLOW);

  it("FAILS when the config matches none of the tsx files (one stray file is read, so more-than-0 alone would pass)", async () => {
    const r = await runRatchet(config("none", withFiles(`["nowhere/**/*.tsx"]`)));
    expect(r.ok).toBe(false);
    expect(r.failed.join(" ")).toContain("src/components/comments/CommentThread.tsx");
  }, SLOW);

  it("FAILS when the scope shrinks and a baseline file is no longer read", async () => {
    const r = await runRatchet(config("narrow", withFiles(`["src/pages/HelpSupport.tsx"]`)));
    expect(r.ok).toBe(false);
    expect(r.linted).toBeGreaterThan(0);
    expect(r.failed.join(" ")).toContain("src/components/comments/CommentThread.tsx");
  }, SLOW);

  it("FAILS when eslint crashes", async () => {
    const r = await runRatchet(config("crash2", `throw new Error("broken config");`));
    expect(r.ok).toBe(false);
    expect(r.failed.join(" ")).toMatch(/crashed/);
  }, SLOW);
});

describe("the verdicts, on exact output", () => {
  const result = (filePath: string, messages: unknown[] = []) => ({ filePath, messages });
  const out = (...rows: unknown[]) => JSON.stringify(rows);
  const cwd = process.cwd();
  const baseline = ["src/a.tsx"];
  const rule = { ruleId: "d2/no-comment-rows", severity: 2, message: "Comment list (1 in this file, baseline 0)." };

  it("ratchet: passes only with exit 0, more than 0 files and every baseline file read", () => {
    expect(judgeRatchet({ status: 0, stdout: out(result(`${cwd}/src/a.tsx`)) }, baseline, cwd).ok).toBe(true);
    expect(judgeRatchet({ status: 0, stdout: "[]" }, baseline, cwd).ok).toBe(false);
    expect(judgeRatchet({ status: 0, stdout: out(result(`${cwd}/src/b.tsx`)) }, baseline, cwd).ok).toBe(false);
    expect(judgeRatchet({ status: 1, stdout: out(result(`${cwd}/src/a.tsx`, [rule])) }, baseline, cwd).ok).toBe(false);
    expect(judgeRatchet({ status: 0, stdout: "not json" }, baseline, cwd).ok).toBe(false);
    expect(judgeRatchet({ status: null, stdout: "" }, baseline, cwd).ok).toBe(false);
  });

  it("self-test: passes only on exit 1 with the rule's own message", () => {
    expect(judgeSelfTest({ status: 1, stdout: out(result("x", [rule])) }).ok).toBe(true);
    expect(judgeSelfTest({ status: 0, stdout: out(result("x")) }).ok).toBe(false);
    expect(judgeSelfTest({ status: 2, stdout: "" }).ok).toBe(false);
    expect(judgeSelfTest({ status: 1, stdout: out(result("x", [{ ruleId: "other", message: "Comment list" }])) }).ok).toBe(false);
    expect(judgeSelfTest({ status: 1, stdout: out(result("x", [{ ruleId: "d2/no-comment-rows", message: "something else" }])) }).ok).toBe(false);
  });
});

describe("the workflow", () => {
  const flow = fs.readFileSync(".github/workflows/d2-comment-rows.yml", "utf8");
  it("runs the gate script and has no way to pass quietly", () => {
    expect(flow).toContain("run: node tools/comment-rows-gate.mjs");
    for (const escape of ["continue-on-error", "|| true", "eslint -c"]) expect(flow).not.toContain(escape);
  });
});
