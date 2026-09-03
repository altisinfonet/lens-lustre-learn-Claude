/**
 * THE TYPECHECK MUST ACTUALLY CHECK SOMETHING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS — a failure of mine, 2026-08-15, recorded so it cannot
 * happen the same way twice.
 *
 * All day I ran `npx tsc --noEmit` and reported "typecheck clean". The root
 * `tsconfig.json` has `"files": []` and only project *references*, and plain
 * `tsc` does not follow references without `--build`. **So that command
 * compiled ZERO files and could not have failed.** Every "0 type errors" I
 * reported was a measurement of nothing.
 *
 * What it hid: a broken import I introduced into THREE files, and five real
 * type errors from the React 19 upgrade — `useRef()` with no argument (React 19
 * requires one) and the global `JSX` namespace (React 19 removed it). I had
 * reported that upgrade as needing "zero source changes". It needed five.
 *
 * The build caught the broken import; nothing caught the type errors, because
 * `npm run build` uses esbuild, which strips types without checking them.
 *
 * The correct command — the one CI has always run — is
 * `tsc --noEmit -p tsconfig.app.json`, now `npm run typecheck`.
 *
 * THE LESSON, which is the same one this project keeps relearning: a green
 * result from a command that checks nothing is indistinguishable from a green
 * result from a command that checks everything. The only defence is to prove
 * the check can FAIL. That is what this file does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("the typecheck command points at a config that has files", () => {
  it("there is a `typecheck` script, so nobody has to remember the flags", () => {
    expect(pkg.scripts?.typecheck).toBeTruthy();
  });

  it("it names a project config — bare `tsc --noEmit` compiles NOTHING here", () => {
    // The exact trap: the root tsconfig has "files": [] and only references.
    // `-b` is the short form of `--build`. F-52 moved CI to `-b tsconfig.json`
    // (both projects, strict included); the script now matches it, so accept it.
    expect(pkg.scripts.typecheck).toMatch(
      /-p\s+tsconfig\.app\.json|--build|-b\s+tsconfig\.json/,
    );
  });

  it("the root config really is the empty one, so this is not superstition", () => {
    const rootCfg = JSON.parse(
      readFileSync(join(root, "tsconfig.json"), "utf8").replace(/\/\/.*$/gm, ""),
    );
    expect(rootCfg.files).toEqual([]);
    expect(Array.isArray(rootCfg.references)).toBe(true);
  });

  it("CI runs the same command as the script — one of them being right is not enough", () => {
    // ⚠ F-60 CLOSED HERE, 2026-09-03. This asserted the LITERAL STRING
    // `tsc --noEmit -p tsconfig.app.json`, so when F-52 correctly moved CI to
    // `npx tsc -b tsconfig.json` on 2026-09-01 the assertion started failing —
    // and it failed for the right reason: package.json still carried the weak
    // `-p tsconfig.app.json` command, so `npm run typecheck` locally checked a
    // project with "strict": false while CI checked both projects strictly.
    // The two really had drifted apart. The fix is package.json, not this file.
    //
    // Rewritten to assert the RELATIONSHIP the test's name claims — CI runs the same
    // command as the script — instead of a hard-coded string that has to be
    // edited by hand every time the command legitimately changes. A literal
    // that must be maintained in lockstep with the thing it guards is not a
    // guard; it is a second copy of the thing.
    const ci = readFileSync(join(root, ".github/workflows/typecheck.yml"), "utf8");
    const cmd = String(pkg.scripts.typecheck).trim();
    const runLines = [...ci.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1].trim());
    expect(runLines.some((l) => l === cmd || l === `npx ${cmd}`)).toBe(true);
  });

  it("the app config actually includes src", () => {
    const app = JSON.parse(
      readFileSync(join(root, "tsconfig.app.json"), "utf8").replace(/\/\/.*$/gm, ""),
    );
    expect(app.include).toContain("src");
  });
});

describe("every source file parses — the gap between the checks", () => {
  /**
   * A syntactically broken file passed BOTH `tsc` (vacuous) and `vitest` (the
   * file was not imported by any test) and was caught only by the production
   * build. This closes that gap in the fast gate: 766 files parse in well under
   * a second, so there is no reason not to.
   */
  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(p);
    }
  })(join(root, "src"));

  it("finds the source tree (a vacuity guard on THIS test)", () => {
    // Without this, an empty file list would make the check below pass by
    // examining nothing — which is precisely the bug being guarded against.
    expect(files.length).toBeGreaterThan(300);
  });

  it("parses every one of them", async () => {
    /**
     * TypeScript's own parser, not esbuild. esbuild was the obvious choice —
     * it is what the production build uses — but its binding needs a real
     * `TextEncoder`, and jsdom's is not backed by a genuine `Uint8Array`, so it
     * dies with "Invariant violation". Running this file in the node
     * environment instead broke on the shared test setup, which assumes
     * `window`. `typescript` is already a dependency, works anywhere, and
     * reports the same syntax errors.
     */
    const tsMod = await import("typescript");
    const ts = (tsMod as unknown as { default?: typeof tsMod }).default ?? tsMod;
    const broken: string[] = [];
    for (const f of files) {
      // createSourceFile PARSES and never emits. `transpileModule` was tried
      // first and died with "Debug Failure. Output generation failed" on a file
      // it could parse but not emit — an emit failure is not a syntax error,
      // and a gate that reports one as the other is a gate people switch off.
      const sf = ts.createSourceFile(
        f,
        readFileSync(f, "utf8"),
        ts.ScriptTarget.Latest,
        false,
        f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const diags = (sf as unknown as { parseDiagnostics?: Array<{ messageText: unknown }> }).parseDiagnostics ?? [];
      for (const d of diags) {
        broken.push(`${f.replace(root + "/", "")}: ${ts.flattenDiagnosticMessageText(d.messageText as string, " ")}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("the React 19 type changes that were missed", () => {
  /**
   * These five were introduced by the React 18 → 19 upgrade and reported as
   * "zero source changes needed", because the command that would have found
   * them was checking nothing. Pinned so a revert is loud.
   */
  it("useRef is never called with no argument — React 19 requires one", () => {
    const files: string[] = [];
    (function walk(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    })(join(root, "src"));

    const offenders = files.filter((f) =>
      /useRef<[^>]*>\(\)/.test(readFileSync(f, "utf8")),
    ).map((f) => f.replace(root + "/", ""));
    expect(offenders).toEqual([]);
  });

  it("the global JSX namespace is imported where it is used", () => {
    const p = join(root, "src/components/post/ScheduledPostsList.tsx");
    const src = readFileSync(p, "utf8");
    if (/\bJSX\.Element\b/.test(src)) {
      expect(src).toMatch(/import type \{ JSX \} from "react"/);
    }
  });
});
