/**
 * S11 deps · the production dependency tree stays out of the vulnerable
 * ranges of the high/moderate advisories fixed on 2026-10-30.
 *
 * Measured before the fix (`npm audit --omit=dev`, staging ba508d1):
 * 19 findings, 14 high. After: 5 findings, 1 high (zod, below), 4 moderate.
 * 2026-10-31: new advisories put glob 10.5.0, minimatch 9.0.9 and picomatch
 * 4.0.3 (now in the production tree via sucrase → tinyglobby) back in range:
 * 8 findings → 5 after a lockfile-only fix (sucrase 3.35.1, picomatch 4.0.7). `npm audit fix` (lockfile only, package.json ranges
 * unchanged) moved every production copy below out of its vulnerable range.
 * The CI security gate still blocks only on `critical`, so without this test a
 * later lockfile regeneration could bring any of these back silently.
 *
 * Kept on purpose (not in the table): zod 3.25.x. Its advisory (GHSA-mrhx-c7xc-m3w5,
 * memory exhaustion validating oversized *constrained collections*) has its fix
 * only in zod 4, which changes email validation on Login/Signup. The app's
 * schemas are plain string/object/enum checks; the second test keeps that true.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type V = [number, number, number];
const parse = (s: string): V => {
  const [a, b, c] = s.split("-")[0].split(".").map((n) => Number.parseInt(n, 10));
  return [a || 0, b || 0, c || 0];
};
const cmp = (x: V, y: V) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/** Vulnerable range(s) per package, from the advisories: [lowest affected, highest affected]. */
const VULNERABLE: Record<string, [string, string] | [string, string][]> = {
  "@remix-run/router": ["0.0.0", "1.23.2"],
  "brace-expansion": ["2.0.0", "2.1.6"],
  dompurify: ["0.0.0", "3.4.16"],
  fflate: ["0.8.0", "0.8.2"],
  // 2026-10-31: GHSA AbortSignal cancellation bypass, >=9.0.0 <=14.0.1 (supersedes 10.2.0–10.4.5).
  glob: ["9.0.0", "14.0.1"],
  lodash: ["0.0.0", "4.17.23"],
  // 2026-10-31: globparts amplification DoS, <11.0.1 (supersedes 9.0.0–9.0.6).
  minimatch: ["0.0.0", "11.0.0"],
  nanoid: ["0.0.0", "3.3.17"],
  // 2026-10-31: POSIX class method injection + extglob ReDoS, >=4.0.0 <4.0.4.
  picomatch: [["0.0.0", "2.3.1"], ["4.0.0", "4.0.3"]],
  postcss: ["0.0.0", "8.5.22"],
  "postcss-selector-parser": ["0.0.0", "6.1.4"],
  // The two HIGH react-router advisories end at 6.30.3 (fixed 6.30.4). Two
  // MODERATE ones (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg) are fixed only in
  // v7 and are recorded, not covered here.
  "react-router": ["6.0.0", "6.30.3"],
  "react-router-dom": ["6.0.0", "6.30.3"],
  "source-map-js": ["1.0.0", "1.2.1"],
  ws: ["8.0.0", "8.20.1"],
  yaml: ["2.0.0", "2.8.2"],
};

const lock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string; dev?: boolean }>;
};

describe("production dependencies stay out of fixed advisory ranges", () => {
  it("no production copy of a fixed package is in its vulnerable range", () => {
    const hits: string[] = [];
    for (const [path, meta] of Object.entries(lock.packages)) {
      if (!path || meta.dev || !meta.version) continue;
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const entry = VULNERABLE[name];
      if (!entry) continue;
      const ranges = (Array.isArray(entry[0]) ? entry : [entry]) as [string, string][];
      const v = parse(meta.version);
      for (const range of ranges) {
        if (cmp(v, parse(range[0])) >= 0 && cmp(v, parse(range[1])) <= 0) {
          hits.push(`${path}@${meta.version} (vulnerable ${range[0]}–${range[1]})`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("app zod schemas use no constrained collections (keeps the zod advisory unreachable)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /from ["']zod/.test(src) && /\bz\.(array|set|map|record|tuple)\s*\(/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
