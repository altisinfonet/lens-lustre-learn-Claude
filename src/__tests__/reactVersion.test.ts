/**
 * THE REACT 19 GATE.
 *
 * Owner, 2026-08-15: *"update my react version from react 18 to react 19. ix
 * all issues accordingly."*
 *
 * This file exists so the upgrade cannot silently slide back, and so the ONE
 * package that was deliberately left behind is named rather than forgotten.
 *
 * WHY A TEST AND NOT JUST A package.json ENTRY: an `npm install` of any package
 * that declares an older peer range can quietly pull React 18 back into the
 * tree, and everything would keep compiling. The app would then be running a
 * different framework from the one it was tested against, and nothing would say
 * so. This asserts what is ACTUALLY INSTALLED, not what package.json asks for.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

/** The version actually on disk, which is the only one that runs. */
function installed(name: string): string | null {
  const p = join(root, "node_modules", name, "package.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")).version as string;
}

describe("React 19 is what is asked for AND what is installed", () => {
  for (const name of ["react", "react-dom"]) {
    it(`${name} is requested at v19`, () => {
      expect(deps[name]).toMatch(/^[~^]?19\./);
    });

    it(`${name} INSTALLED on disk is v19 — the range is not the same as the truth`, () => {
      expect(installed(name)).toMatch(/^19\./);
    });
  }

  it("the type packages match the runtime, or every type is a lie", () => {
    expect(deps["@types/react"]).toMatch(/^[~^]?19\./);
    expect(deps["@types/react-dom"]).toMatch(/^[~^]?19\./);
  });

  it("@testing-library/react is >= 16.1, the first release that supports React 19", () => {
    const v = installed("@testing-library/react");
    expect(v).not.toBeNull();
    const [maj, min] = v!.split(".").map(Number);
    expect(maj > 16 || (maj === 16 && min >= 1)).toBe(true);
  });

  it("@testing-library/dom is present — v16 stopped bundling it, and 16 suites died without it", () => {
    // Found the hard way during this upgrade: `--legacy-peer-deps` dropped it
    // and sixteen test files failed with "Cannot find module".
    expect(installed("@testing-library/dom")).not.toBeNull();
  });
});

describe("the app entry uses the React 18+ root API", () => {
  const main = readFileSync(join(root, "src/main.tsx"), "utf8");

  it("mounts with createRoot", () => {
    expect(main).toMatch(/createRoot/);
  });

  it("never calls the render API React 19 removed", () => {
    expect(main).not.toMatch(/ReactDOM\.render|ReactDOM\.hydrate\b/);
  });
});

describe("no source file uses an API React 19 removed", () => {
  // A regression here would not fail the type checker — these are runtime
  // removals, so the app would build and then throw in front of a member.
  const files = new Set<string>();
  const walk = (dir: string) => {
    for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) files.add(p);
    }
  };
  walk(join(root, "src"));

  const REMOVED: Array<[string, RegExp]> = [
    ["findDOMNode", /\bfindDOMNode\s*\(/],
    ["ReactDOM.render", /ReactDOM\.render\s*\(/],
    ["ReactDOM.hydrate", /ReactDOM\.hydrate\s*\(/],
    ["unmountComponentAtNode", /\bunmountComponentAtNode\s*\(/],
    ["React.createFactory", /createFactory\s*\(/],
    // defaultProps on a FUNCTION component is ignored by React 19. Class
    // components still honour it, but this app has no class components.
    ["defaultProps", /\.defaultProps\s*=/],
    // A string ref — ref="name" — is removed. Written to avoid matching href=.
    ["string ref", /(?<![a-zA-Z])ref\s*=\s*"/],
  ];

  for (const [label, re] of REMOVED) {
    it(`does not use ${label}`, () => {
      const hits: string[] = [];
      for (const f of files) {
        if (f.endsWith("reactVersion.test.ts")) continue; // this file names them
        if (re.test(readFileSync(f, "utf8"))) hits.push(f.replace(root + "/", ""));
      }
      expect(hits).toEqual([]);
    });
  }
});

describe("no package is left on a React 18 peer range any more", () => {
  /**
   * HISTORY, kept because the shape of the bug matters more than the fix.
   *
   * The React 18 → 19 upgrade (2026-08-15) left react-day-picker on v8, whose
   * peer range stops at React 18. Nothing on a populated machine noticed —
   * typecheck, tests and build all stayed green — but every clean checkout
   * died on ERESOLVE, which meant Cloudflare Pages, both GitHub Actions
   * workflows, and the Android build. The website silently stopped updating
   * for nine hours and the OWNER found it, not me.
   *
   * `.npmrc legacy-peer-deps=true` was the hold. This is the cure: v10.0.1,
   * whose peer range is `react: >=16.8.0`. Verified by running `npm ci` from
   * a copy of package.json + package-lock.json with NO .npmrc present —
   * exit 0, no ERESOLVE. The .npmrc is deleted; `cleanInstallResolves.test.ts`
   * asserts it stays deleted.
   *
   * v9 was the other candidate and was rejected on measurement, not taste:
   * 9.14 hard-depends on date-fns-jalali AND a hijri converter; v10 carries
   * only date-fns + @date-fns/tz.
   */
  it("react-day-picker is on v10 — the version that peers on React 19", () => {
    expect(installed("react-day-picker")).toMatch(/^10\./);
  });

  it("its declared peer range actually admits React 19", () => {
    // The whole point of the upgrade. Asserting the VERSION alone would pass
    // against a hypothetical v10 that still capped at React 18 — read the
    // range and check it, rather than trusting the number.
    const peers = JSON.parse(
      readFileSync(join(root, "node_modules/react-day-picker/package.json"), "utf8"),
    ).peerDependencies as Record<string, string>;
    expect(peers.react).toBe(">=16.8.0");
    expect(peers.react).not.toMatch(/\^18|<\s*19/);
  });

  it("uses none of the APIs React 19 removed", () => {
    const bundle = readFileSync(
      join(root, "node_modules/react-day-picker/dist/cjs/index.js"),
      "utf8",
    );
    for (const banned of ["findDOMNode", "createFactory", "ReactDOM.render"]) {
      expect(bundle).not.toContain(banned);
    }
  });

  it("every OTHER React-coupled package accepts React 19", () => {
    // vaul and next-themes were bumped for exactly this reason.
    const v = installed("vaul");
    expect(v).not.toBeNull();
    expect(Number(v!.split(".")[0])).toBeGreaterThanOrEqual(1);
    expect(deps["next-themes"]).toMatch(/0\.4\./);
  });
});
