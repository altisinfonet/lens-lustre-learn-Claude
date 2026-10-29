// @vitest-environment node
/**
 * S11 deps · packages the shipped app never imports stay out of `dependencies`.
 * `npm audit --omit=dev` (security.yml) measures `dependencies` as what ships,
 * so a build-only package listed there inflates (or hides inside) that count.
 *   sharp           — used only by tools/media-derivatives (the backfill), run with devDeps installed
 *   vite-plugin-pwa — not imported anywhere (the service worker is hand-written)
 *   vite-plugin-image-optimizer — vite.config.ts only (build time). It must move
 *                     with sharp: it names sharp as an optional peer, so while it
 *                     stayed in `dependencies`, sharp stayed in the shipped tree
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : files(p);
    return /\.(tsx?|mjs|cjs|js)$/.test(e.name) ? [p] : [];
  });
}
const shipped = [...files(path.join(ROOT, "src")), ...files(path.join(ROOT, "functions")), path.join(ROOT, "vite.config.ts")]
  .filter((f) => !/__tests__|\.test\./.test(f));
const imports = (name: string, list: string[]) =>
  list.filter((f) => new RegExp(`(from|import\\(|require\\()\\s*["']${name}["']`).test(fs.readFileSync(f, "utf8")));

describe("build-only packages are devDependencies", () => {
  for (const name of ["sharp", "vite-plugin-pwa", "vite-plugin-image-optimizer"]) {
    it(`${name}: in devDependencies, not dependencies, and the lockfile agrees`, () => {
      expect(pkg.dependencies?.[name]).toBeUndefined();
      expect(pkg.devDependencies?.[name]).toBeDefined();
      expect(lock.packages[""].dependencies?.[name]).toBeUndefined();
      expect(lock.packages[""].devDependencies?.[name]).toBeDefined();
      expect(lock.packages[`node_modules/${name}`]?.dev).toBe(true);
    });
    it(`${name}: nothing the app ships imports it (vite.config.ts is build time)`, () => {
      const users = imports(name, shipped).map((f) => path.relative(ROOT, f));
      expect(users).toEqual(name === "vite-plugin-image-optimizer" ? ["vite.config.ts"] : []);
    });
  }
  it("sharp's one user is the backfill tool, which CI runs after a full `npm ci`", () => {
    expect(imports("sharp", files(path.join(ROOT, "tools"))).map((f) => path.relative(ROOT, f))).toEqual(["tools/media-derivatives/run.mjs"]);
    expect(fs.readFileSync(path.join(ROOT, ".github/workflows/s3-media-backfill.yml"), "utf8")).toMatch(/run: npm ci --no-audit --no-fund\n/);
  });
});
