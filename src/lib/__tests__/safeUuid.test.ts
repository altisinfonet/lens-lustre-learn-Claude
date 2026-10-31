import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { safeRandomUUID } from "@/lib/safeUuid";
import { stripComments } from "@/test-utils/sourceText";

/**
 * A MISSING `crypto.randomUUID` MUST NEVER BLANK A PAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT PRODUCTION RECORDED — Admin → Site Health → Client failures, 2026-08-09,
 * build `2026-08-07-7` (1058), both rows `platform = app`:
 *
 *   Blank page / crash   7×   TypeError · crypto.randomUUID is not a function
 *   sys                 13×   A route crashed; the member is looking at the
 *                             Reload screen, not the page they asked for.
 *
 * Twenty failures in one hour. The owner's report: *"after changing pages
 * sometimes coming and sometime showing blank pages"*.
 *
 * `crypto.randomUUID` needs Chromium 92+ AND a secure context. An Android
 * System WebView that has never been updated has neither, and it updates via
 * the Play Store independently of the OS — so a current Android tells you
 * nothing. Every call site sat in a render or a react-query `queryFn`, so the
 * TypeError reached AppErrorBoundary and the member got a header with nothing
 * under it.
 *
 * These tests do the thing that never happened before: they DELETE
 * `crypto.randomUUID` and prove the app still gets a UUID.
 */

const ORIGINAL = globalThis.crypto?.randomUUID;

afterEach(() => {
  if (ORIGINAL) {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: ORIGINAL,
      configurable: true,
      writable: true,
    });
  }
});

/** Accepts only a real RFC 4122 v4: version nibble 4, variant 8|9|a|b. */
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const stub = (impl: unknown) =>
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: impl,
    configurable: true,
    writable: true,
  });

describe("safeRandomUUID", () => {
  it("returns a v4 uuid on a normal browser", () => {
    expect(safeRandomUUID()).toMatch(V4);
  });

  it("still returns a v4 uuid when crypto.randomUUID does not exist", () => {
    // THE BUG, reproduced. Before this file, this is where the app threw.
    stub(undefined);
    expect(() => safeRandomUUID()).not.toThrow();
    expect(safeRandomUUID()).toMatch(V4);
  });

  it("still returns a v4 uuid when crypto.randomUUID exists but throws", () => {
    // Hardened/embedded WebViews can expose the name and refuse the call.
    stub(() => {
      throw new TypeError("blocked");
    });
    expect(safeRandomUUID()).toMatch(V4);
  });

  it("does not collide — 2000 fallback ids are all distinct", () => {
    stub(undefined);
    const seen = new Set(Array.from({ length: 2000 }, () => safeRandomUUID()));
    expect(seen.size).toBe(2000);
  });

  it("sets the version and variant bits, not just the shape", () => {
    stub(undefined);
    for (let i = 0; i < 50; i++) {
      const id = safeRandomUUID();
      expect(id[14]).toBe("4");
      expect("89ab").toContain(id[19]);
    }
  });
});

/**
 * THE REGRESSION GATE.
 *
 * Fixing the 14 call sites is worth nothing if the 15th is added next week.
 * This walks the whole of `src/` and fails on any direct call.
 */
describe("no source file calls the raw Web Crypto UUID generator", () => {
  const ROOT = path.resolve(process.cwd(), "src");
  /** safeUuid.ts documents the banned pattern in prose; that must not count. */
  const ALLOWED = new Set([path.join(ROOT, "lib", "safeUuid.ts")]);

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };

  it("finds none", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (ALLOWED.has(file)) continue;
      const code = stripComments(fs
        .readFileSync(file, "utf8"));
      if (/\bcrypto\s*\.\s*randomUUID\s*\(/.test(code)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(
      offenders,
      // The banned call is deliberately NOT spelled out here: this message
      // lives in a string literal, and the scan below strips comments but not
      // strings, so writing it would make this gate flag its own test file —
      // and the only honest way to silence that is an exclusion, which is one
      // more place a real offender could hide. Zero exclusions is stronger.
      `Import { safeRandomUUID } from "@/lib/safeUuid" and call that instead. The raw Web Crypto UUID generator blanks the page on an out-of-date Android WebView — see the file header for the production numbers. Offending files:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
