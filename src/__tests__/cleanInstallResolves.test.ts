/**
 * `npm ci` MUST RESOLVE — because it is the first line of every build.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS — my failure, 2026-08-15, and the most expensive one of
 * the day, because it was silent AND it was live.
 *
 * The React 18 → 19 upgrade left `react-day-picker@^8.10.1` in the manifest.
 * Its peer range stops at React 18, so **every clean install failed**:
 *
 *     npm error code ERESOLVE
 *     npm error While resolving: react-day-picker@8.10.1
 *     npm error Found: react@19.2.8
 *
 * My machine never saw it. `node_modules` was already populated, so `npm run
 * typecheck`, `npx vitest run` and `npm run build` all passed, all day, and I
 * reported them as green. They were green. They were also measuring a tree that
 * `npm ci` can no longer produce.
 *
 * WHAT IT ACTUALLY BROKE — everything that starts from a clean checkout:
 *   • Cloudflare Pages, which builds the WEBSITE. The site stopped updating.
 *     The owner noticed before I did: "in web i am not seeing the changes".
 *   • `Typecheck` and `Security` in GitHub Actions, red on every push since.
 *   • The Android build, which also begins `npm ci` — it would have failed the
 *     moment it was triggered.
 *
 * And I had answered his question by quoting a stale line in a runbook instead
 * of opening the commit's own status checks, which said "Cloudflare Pages —
 * Building ✗" in plain sight.
 *
 * THE FIX is `.npmrc` with `legacy-peer-deps=true`, which changes the resolver
 * and nothing else. An `overrides` block was tried first and REJECTED on
 * measurement: it makes npm reclassify 141 packages from dev to production in
 * the lockfile, and `security.yml` runs `npm audit --omit=dev`, so it would
 * quietly change what the security gate inspects.
 *
 * THE LESSON is that a gate which runs against an existing `node_modules`
 * cannot see a resolution failure, so the manifest has to be checked directly —
 * which is what this file does, in the fast test run, without a network call.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

const majorOf = (range: string) => Number(String(range).replace(/^[^\d]*/, "").split(".")[0]);

describe("nothing in the manifest can block a clean install", () => {
  it("the resolver setting that makes `npm ci` succeed is committed", () => {
    // Without this, `npm ci` exits non-zero and NO build gets past its first
    // step — not the website, not the Android app, not CI.
    const npmrc = readFileSync(join(root, ".npmrc"), "utf8");
    expect(npmrc).toMatch(/^legacy-peer-deps\s*=\s*true$/m);
  });

  it(".npmrc explains itself, because a bare flag invites deletion", () => {
    const npmrc = readFileSync(join(root, ".npmrc"), "utf8");
    expect(npmrc).toMatch(/react-day-picker/);
    expect(npmrc).toMatch(/ERESOLVE/);
    // And it must say plainly that it is temporary, or it becomes permanent.
    expect(npmrc).toMatch(/HOLD, NOT THE CURE/);
  });

  it("the manifest and lockfile are NOT edited to work around it", () => {
    // Measured: an `overrides` block also fixes the install, but it makes npm
    // reclassify 141 packages from dev to production in the lock — and
    // security.yml runs `npm audit --omit=dev`, so that would silently change
    // what the security gate inspects. The resolver setting changes nothing
    // else; this test is what stops someone "tidying" it into package.json.
    expect(pkg.overrides).toBeUndefined();
    expect(lock.packages?.[""]?.overrides).toBeUndefined();
  });

  it("react-day-picker is still the one that needs the real fix", () => {
    // When it goes to v9 (React 19-ready), .npmrc should be revisited. This
    // test is the reminder, and it fails loudly the day someone upgrades it —
    // which is exactly when the question should be asked.
    const range = pkg.dependencies["react-day-picker"];
    expect(majorOf(range)).toBe(8);
  });

  it("every package that peers on React is either React 19-ready or known", () => {
    /**
     * A census, not a spot check. The next dependency left behind by a major
     * React upgrade breaks the website in exactly the same silent way, and this
     * is the only place it is visible before a push.
     */
    const reactMajor = majorOf(pkg.dependencies.react);
    expect(reactMajor).toBe(19);

    // Named, with the reason, rather than pattern-matched away.
    const KNOWN: Record<string, string> = {
      "react-day-picker": "v8 peers on React <=18; held by .npmrc until v9",
    };

    const offenders: string[] = [];
    for (const [name, entry] of Object.entries<Record<string, unknown>>(lock.packages ?? {})) {
      if (!name.startsWith("node_modules/")) continue;
      const peers = (entry as { peerDependencies?: Record<string, string> }).peerDependencies;
      const wanted = peers?.react;
      if (!wanted) continue;
      const short = name.replace(/^.*node_modules\//, "");
      if (short in KNOWN) continue;
      if (new RegExp(`(^|[^0-9])${reactMajor}([^0-9]|$)`).test(wanted)) continue;
      if (/^\*$|>=\s*1[0-8]/.test(wanted)) continue;
      offenders.push(`${short} peers react@"${wanted}"`);
    }
    expect(offenders, "these would fail `npm ci` on a clean checkout").toEqual([]);
  });

  it("the react and react-dom majors match each other", () => {
    expect(majorOf(pkg.dependencies["react-dom"])).toBe(majorOf(pkg.dependencies.react));
  });
});
