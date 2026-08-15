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

describe("the one package deliberately left on a React 18 peer range", () => {
  /**
   * react-day-picker@8 declares `^16.8 || ^17 || ^18`, so npm warns. It was
   * NOT upgraded, and the reason is recorded here rather than left as a
   * mystery for the next person:
   *
   *  • It was CHECKED, not assumed: v8's bundle contains zero uses of
   *    findDOMNode, ReactDOM.render, createFactory, defaultProps, propTypes or
   *    string refs — nothing React 19 removed. The stale peer range is a
   *    packaging fact, not a runtime one.
   *  • v9/v10 rename the pieces this app actually uses — `components.IconLeft`
   *    and `IconRight` became a single `Chevron`, and the classNames keys
   *    changed — so upgrading rewrites src/components/ui/calendar.tsx.
   *  • That calendar is the post SCHEDULER. Rewriting it belongs in its own
   *    cycle with its own screenshots, not bolted onto a framework upgrade
   *    whose whole point is that nothing else changes.
   */
  it("is react-day-picker, still on v8, and this is on purpose", () => {
    expect(installed("react-day-picker")).toMatch(/^8\./);
  });

  it("v8 still uses none of the APIs React 19 removed", () => {
    const bundle = readFileSync(
      join(root, "node_modules/react-day-picker/dist/index.js"),
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
