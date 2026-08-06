/**
 * THE CATALOG AND THE DOCUMENT CAN NEVER DISAGREE.
 *
 * Owner, 2026-08-06: "Maintain an Error Catalog — keep a single document such
 * as /docs/error-codes.md."
 *
 * A catalog in code plus a catalog in a document is two catalogs, and two
 * catalogs drift. This file makes drift a CI failure: docs/error-codes.md must
 * be exactly what renderCatalogMarkdown() produces. If you add a code, run
 * `npx tsx scripts/generate-error-codes.ts` and commit both.
 *
 * It also pins the rules that make codes worth having at all: unique, correctly
 * shaped, permanent, and carrying a resolution that tells you what to DO.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ERROR_CATALOG,
  CODE_PATTERN,
  renderCatalogMarkdown,
  getErrorCode,
  isKnownErrorCode,
} from "@/lib/errorCodes";

const DOC = join(__dirname, "..", "..", "..", "docs", "error-codes.md");

describe("docs/error-codes.md is generated, never hand-written", () => {
  it("the file on disk matches the catalog exactly", () => {
    const onDisk = readFileSync(DOC, "utf8");
    expect(onDisk).toBe(renderCatalogMarkdown());
  });

  it("every code in the catalog appears in the document", () => {
    const onDisk = readFileSync(DOC, "utf8");
    for (const entry of ERROR_CATALOG) {
      expect(onDisk).toContain(`| ${entry.code} |`);
    }
  });

  it("the document warns that it is generated", () => {
    expect(readFileSync(DOC, "utf8")).toContain("GENERATED FILE");
  });
});

describe("the codes themselves", () => {
  it("every code matches the shape the database enforces", () => {
    for (const entry of ERROR_CATALOG) {
      expect(entry.code, `${entry.code} must be PREFIX-NNNN`).toMatch(CODE_PATTERN);
    }
  });

  it("no code is used twice — a recycled code makes history a lie", () => {
    const seen = new Set<string>();
    for (const entry of ERROR_CATALOG) {
      expect(seen.has(entry.code), `${entry.code} is duplicated`).toBe(false);
      seen.add(entry.code);
    }
  });

  it("every entry has a real description and an ACTIONABLE resolution", () => {
    for (const entry of ERROR_CATALOG) {
      expect(entry.description.length, `${entry.code} description too short`).toBeGreaterThan(15);
      expect(entry.resolution.length, `${entry.code} resolution too short`).toBeGreaterThan(15);
      // A resolution that just restates the failure helps nobody.
      expect(entry.resolution.toLowerCase(), `${entry.code} resolution is not actionable`).not.toBe(
        entry.description.toLowerCase(),
      );
    }
  });

  it("no banned generic wording anywhere in the catalog", () => {
    const banned = [/something went wrong/i, /api failed/i, /unknown error/i, /oops/i];
    for (const entry of ERROR_CATALOG) {
      for (const pattern of banned) {
        expect(pattern.test(entry.description), `${entry.code} description`).toBe(false);
        expect(pattern.test(entry.resolution), `${entry.code} resolution`).toBe(false);
      }
    }
  });

  it("lookup works and unknown codes are reported as unknown", () => {
    expect(getErrorCode("DB-3002")?.severity).toBe("error");
    expect(isKnownErrorCode("DB-3002")).toBe(true);
    expect(isKnownErrorCode("NOPE-0000")).toBe(false);
    expect(getErrorCode("NOPE-0000")).toBeUndefined();
  });

  it("the codes the owner named in the standard exist", () => {
    // He wrote these into the directive; they must resolve.
    for (const code of ["AUTH-1001", "VAL-2001", "DB-3001", "DB-3002", "API-4001", "FILE-5001"]) {
      expect(isKnownErrorCode(code), `${code} missing from catalog`).toBe(true);
    }
  });
});
