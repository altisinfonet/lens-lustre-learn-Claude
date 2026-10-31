/**
 * P23 S10a-2 — THE A11Y-SURFACES RATCHET, ITS COMPOSITE KEY, AND --record.
 *
 * The pure half of tools/uishot/a11y-surfaces.mjs (a11y-surfaces-ratchet.mjs).
 * `a11y-surfaces.mjs --self-test` proves the same paths in CI before every
 * verdict; this pins them in vitest so a one-line edit that weakens the judge
 * (pass an unrecorded entry, let --record overwrite, merge the two widths)
 * fails here too. Spec: docs/evidence/d2/phase5/P23/S10a-DECISION.md §3.
 *
 * ⚠ IF THIS FILE FAILS, THE P23 SURFACE CHECK HAS BEEN WEAKENED. Restore the
 * behaviour rather than relaxing the assertion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SURFACE_SCENES, SURFACE_WIDTHS, entryKey, splitKey, flatten, unflatten, judge, recordBaseline, lowerSurfaces,
} from "../../tools/uishot/a11y-surfaces-ratchet.mjs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PHONE = entryKey("s", "iphone-390");
const DESK = entryKey("s", "desktop-1280");
const BASE = { surfaces: { s: { "iphone-390": { "A:label": 1, "B:tab-unreached": 2 }, "desktop-1280": {} } } };

describe("the composite key (scene AND width)", () => {
  it("round-trips through flatten/unflatten", () => {
    expect(splitKey(PHONE)).toEqual(["s", "iphone-390"]);
    const flat = flatten(BASE);
    expect(Object.keys(flat!.scenes).sort()).toEqual([DESK, PHONE].sort());
    expect(unflatten(flat!.scenes)).toEqual(BASE.surfaces);
  });

  it("identical counts at both widths pass", () => {
    expect(judge(BASE, { [PHONE]: { "A:label": 1, "B:tab-unreached": 2 }, [DESK]: {} }, true)).toEqual([]);
  });

  it("the two widths are separate entries: one width dirty fails even when the other carries that count", () => {
    const fails = judge(BASE, { [PHONE]: { "A:label": 1, "B:tab-unreached": 2 }, [DESK]: { "B:tab-unreached": 2 } }, true);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/^s @ desktop-1280: CLEAN scene/);
  });

  it("every compareAxe rule holds per entry: up, down-unlowered, new rule, did not run, threw", () => {
    expect(judge(BASE, { [PHONE]: { "A:label": 2, "B:tab-unreached": 2 }, [DESK]: {} }, true)).toHaveLength(1);
    const down = judge(BASE, { [PHONE]: { "A:label": 1, "B:tab-unreached": 1 }, [DESK]: {} }, true);
    expect(down).toHaveLength(1);
    expect(down[0]).toMatch(/a11y-surfaces\.baseline\.json/); // names THIS baseline, not axe.baseline.json
    expect(judge(BASE, { [PHONE]: { "A:label": 1, "B:tab-unreached": 2, "E:escape-does-not-close": 1 }, [DESK]: {} }, true)).toHaveLength(1);
    expect(judge(BASE, { [PHONE]: { "A:label": 1, "B:tab-unreached": 2 } }, true)).toHaveLength(1);
    expect(judge(BASE, { [PHONE]: { "A:label": 1, "B:tab-unreached": 2 } }, false)).toEqual([]);
    expect(judge(BASE, { [PHONE]: { error: "boom" }, [DESK]: {} }, true)).toHaveLength(1);
  });

  it("an entry with NO baseline fails even when clean, and names every finding", () => {
    expect(judge(BASE, { [entryKey("t", "iphone-390")]: {} }, false)).toHaveLength(1);
    const [f] = judge(BASE, { [entryKey("t", "desktop-1280")]: { "A:link-name": 6, "C:focus-not-visible": 1 } }, false);
    expect(f).toMatch(/NOT RECORDED/);
    expect(f).toMatch(/A:link-name=6/);
    expect(f).toMatch(/C:focus-not-visible=1/);
  });

  it("a baseline with no `surfaces`, or an empty one, never passes a measured entry", () => {
    expect(judge({}, {}, true).length).toBeGreaterThan(0);
    expect(judge(null, {}, true).length).toBeGreaterThan(0);
    expect(judge({ surfaces: {} }, { [PHONE]: {} }, true)).toHaveLength(1);
  });

  it("the axe ratchet's own compareAxe is used, unchanged", () => {
    const src = read("tools/uishot/a11y-surfaces-ratchet.mjs");
    expect(src).toMatch(/import \{ compareAxe, lowerBaseline \} from "\.\/axe-ratchet\.mjs"/);
    expect(src).toMatch(/compareAxe\(flat, recorded, false\)/);
  });
});

describe("--record: a first measurement, never a raise", () => {
  it("writes new entries and keeps the header", () => {
    const next = recordBaseline({ _about: "hdr", surfaces: {} }, { [PHONE]: { "A:label": 1 }, [DESK]: {} });
    expect(next._about).toBe("hdr");
    expect(next.surfaces).toEqual({ s: { "iphone-390": { "A:label": 1 }, "desktop-1280": {} } });
    expect(judge(next, { [PHONE]: { "A:label": 1 }, [DESK]: {} }, true)).toEqual([]);
  });

  it("REFUSES to touch an existing entry — even to lower it", () => {
    expect(() => recordBaseline(BASE, { [PHONE]: { "A:label": 0 } })).toThrow(/refuses to touch 1 existing entry/);
  });

  it("refuses the whole write when any one measured entry exists (nothing half-written)", () => {
    expect(() => recordBaseline(BASE, { [entryKey("new", "iphone-390")]: {}, [DESK]: {} })).toThrow(/refuses to touch/);
  });

  it("refuses an entry whose checks did not run, and an empty measurement", () => {
    expect(() => recordBaseline({ surfaces: {} }, { [PHONE]: { error: "x" } })).toThrow(/did not run/);
    expect(() => recordBaseline({ surfaces: {} }, {})).toThrow(/nothing was measured/);
  });

  it("a second --record over the same entries refuses", () => {
    const first = recordBaseline({ surfaces: {} }, { [PHONE]: {}, [DESK]: { "A:label": 3 } });
    expect(() => recordBaseline(first, { [PHONE]: {}, [DESK]: { "A:label": 3 } })).toThrow(/refuses to touch 2 existing entries/);
  });
});

describe("--lower: only ever lowers, never adds", () => {
  it("records an improvement", () => {
    const next = lowerSurfaces(BASE, { [PHONE]: { "A:label": 1, "B:tab-unreached": 1 }, [DESK]: {} });
    expect(next.surfaces.s["iphone-390"]).toEqual({ "A:label": 1, "B:tab-unreached": 1 });
  });
  it("refuses a raise, a new rule and a new entry", () => {
    expect(() => lowerSurfaces(BASE, { [PHONE]: { "A:label": 2, "B:tab-unreached": 2 } })).toThrow();
    expect(() => lowerSurfaces(BASE, { [DESK]: { "A:label": 1 } })).toThrow();
    expect(() => lowerSurfaces(BASE, { [entryKey("t", "iphone-390")]: {} })).toThrow(/use --record/);
  });
});

describe("the scope is S10a-DECISION.md §2 and §3", () => {
  it("the 11 scenes at the two widths", () => {
    expect(SURFACE_SCENES).toHaveLength(11);
    for (const s of ["screen-feed", "screen-post-detail", "comments-panel", "composer-full", "screen-profile", "screen-edit-profile",
      "screen-notifications", "screen-discover", "screen-login", "screen-signup", "screen-admin-health"]) {
      expect(SURFACE_SCENES).toContain(s);
    }
    expect(SURFACE_WIDTHS.map((w) => w.name)).toEqual(["iphone-390", "desktop-1280"]);
  });

  it("the committed baseline is keyed by scene and width, and only by the 22 known entries", () => {
    const b = JSON.parse(read("tools/uishot/a11y-surfaces.baseline.json"));
    expect(typeof b.surfaces).toBe("object");
    for (const [scene, widths] of Object.entries(b.surfaces as Record<string, Record<string, unknown>>)) {
      expect(SURFACE_SCENES).toContain(scene);
      for (const w of Object.keys(widths)) expect(["iphone-390", "desktop-1280"]).toContain(w);
    }
  });
});

describe("the three a11y-only scenes stay off the harness index (decision S2)", () => {
  const REAL = read("src/uiharness/realScreens.tsx");
  const realScreens = REAL.slice(REAL.indexOf("export const REAL_SCREENS"), REAL.indexOf("export const A11Y_ONLY_SCREENS"));
  const a11yOnly = REAL.slice(REAL.indexOf("export const A11Y_ONLY_SCREENS"));

  it("they are defined in A11Y_ONLY_SCREENS and NOT in REAL_SCREENS (which the index lists)", () => {
    expect(realScreens.length).toBeGreaterThan(0);
    for (const s of ["screen-signup", "screen-edit-profile", "screen-admin-health"]) {
      expect(a11yOnly).toContain(`"${s}":`);
      expect(realScreens).not.toContain(`"${s}":`);
    }
  });

  it("main.tsx resolves them by name but its index lists SCENES alone", () => {
    const MAIN = read("src/uiharness/main.tsx");
    expect(MAIN).toMatch(/const scene = SCENES\[name\] \?\? A11Y_ONLY_SCENES\[name\];/);
    expect(MAIN).toMatch(/Object\.keys\(SCENES\)\.sort\(\)/);
    expect(MAIN).not.toMatch(/Object\.keys\(A11Y_ONLY_SCENES\)/);
    const SCENES_SRC = read("src/uiharness/scenes.tsx");
    const scenesBody = SCENES_SRC.slice(SCENES_SRC.indexOf("export const SCENES"), SCENES_SRC.indexOf("export const A11Y_ONLY_SCENES"));
    expect(scenesBody).not.toMatch(/A11Y_ONLY/);
  });
});

describe("the workflow (decision S3, F-47)", () => {
  /** Comments stripped: the header may NAME what is forbidden. */
  const wf = read(".github/workflows/d2-a11y-surfaces.yml").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  it("runs the self-test BEFORE the real check, and the real check has no fallback", () => {
    const self = wf.indexOf("a11y-surfaces.mjs --self-test");
    const real = wf.indexOf("a11y-surfaces.mjs --json /tmp/a11y-surfaces/report.json");
    expect(self).toBeGreaterThan(0);
    expect(real).toBeGreaterThan(self);
    expect(wf).not.toMatch(/\|\|\s*true/);
    expect(wf).not.toMatch(/--record/);
    expect(wf).not.toMatch(/continue-on-error/);
  });

  it("has no ${{ … }} inside any run: block", () => {
    const lines = wf.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(- )?run: ?(.*)$/.exec(lines[i]);
      if (!m) continue;
      const indent = m[1].length + (m[2] ? 2 : 0);
      const block = [m[3]];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S/) > indent); j++) block.push(lines[j]);
      expect(block.join("\n"), `run: block at line ${i + 1}`).not.toMatch(/\$\{\{/);
    }
  });

  it("ui-gate.yml does not run it (decision S3: a separate job)", () => {
    expect(read(".github/workflows/ui-gate.yml")).not.toMatch(/a11y-surfaces/);
  });
});
