/**
 * P13 · the EXIF reader (exifr, ~74 KB) is loaded when a photo is read, not
 * with the app. Both callers are already async, so a static import only put it
 * in the entry chunk every visitor downloads before the first screen — and
 * left the entry chunk at its byte ceiling (the production-lane build of the
 * S7b-5a carry was 66 B over).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("exifr is loaded on demand", () => {
  for (const f of ["src/lib/gpsGuard.ts", "src/lib/exifExtract.ts"]) {
    it(`${f} has no static exifr import`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/^\s*import\s+[^;]*from\s+["']exifr["']/m);
      expect(src).toMatch(/import\(\s*["']exifr["']\s*\)/);
    });
  }
});
