/**
 * P11 — the bare-<img> rule fails first (C-34). Drives the real rule through
 * ESLint's Linter with a throwaway baseline, and checks the committed baseline
 * against the real tree.
 */
import { describe, it, expect } from "vitest";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import rule from "../../eslint-rules/no-bare-img.js";

function lint(code: string, file: string, baseline: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p11-"));
  const bp = path.join(dir, "b.json");
  fs.writeFileSync(bp, typeof baseline === "string" ? baseline : JSON.stringify(baseline));
  const linter = new Linter({ configType: "flat", cwd: process.cwd() });
  // The flat-config element is built untyped and cast once: typescript-eslint's
  // parser type and ESLint's Linter type disagree on the AST shape, which is a
  // typing mismatch between the two packages, not a behaviour this test needs.
  const config = [{
      files: ["**/*.tsx"],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { d2: { rules: { "no-bare-img": rule } } },
      rules: { "d2/no-bare-img": ["error", { baselinePath: bp }] },
    }] as unknown as Linter.Config[];
  const msgs = linter.verify(code, config, path.join(process.cwd(), file));
  fs.rmSync(dir, { recursive: true, force: true });
  return msgs.map((m) => m.message);
}

const ONE = `export const A = () => <div><img src="/a.webp" alt="" /></div>;`;
const TWO = `export const A = () => <div><img src="/a.webp" alt="" /><img src="/b.webp" alt="" /></div>;`;
const NONE = `export const A = () => <div><picture><source srcSet="/a.webp" /></picture>{"<img"}</div>;`;
const F = "src/components/X.tsx";

describe("d2/no-bare-img", () => {
  it("a file at its baseline passes", () => {
    expect(lint(ONE, F, { files: { [F]: 1 } })).toEqual([]);
  });
  it("a NEW <img> over the baseline fails (each element reported)", () => {
    const m = lint(TWO, F, { files: { [F]: 1 } });
    expect(m).toHaveLength(2);
    expect(m[0]).toMatch(/2 in this file, baseline 1/);
  });
  it("a file not in the baseline has a baseline of 0", () => {
    expect(lint(ONE, F, { files: {} })[0]).toMatch(/baseline 0/);
  });
  it("fewer than the baseline fails until it is lowered (ratchet)", () => {
    expect(lint(NONE, F, { files: { [F]: 1 } })[0]).toMatch(/lower its entry/);
  });
  it("<picture>, <source> and the text \"<img\" are not counted", () => {
    expect(lint(NONE, F, { files: {} })).toEqual([]);
  });
  it("an unreadable baseline is an error, never a silent pass", () => {
    expect(lint(ONE, F, "{not json")[0]).toMatch(/baseline unreadable/);
  });
});

describe("committed baseline", () => {
  it("is well formed and records the 2026-10-04 reading (225 in 110 files)", () => {
    const b = JSON.parse(fs.readFileSync("eslint-rules/no-bare-img.baseline.json", "utf8"));
    const v = Object.values(b.files) as number[];
    expect(v.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    expect(v.length).toBeLessThanOrEqual(110);
    expect(v.reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(225);
  });
});
