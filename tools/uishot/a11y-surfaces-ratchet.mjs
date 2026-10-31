/**
 * P23 S10a-2 · THE A11Y-SURFACES RATCHET — the pure half of a11y-surfaces.mjs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * No browser, no file system, no side effects: everything here is a function
 * of its arguments, so vitest can pin it (src/__tests__/a11ySurfacesRatchet
 * .test.ts) and `a11y-surfaces.mjs --self-test` can prove it before trusting
 * its verdict.
 *
 * THE JUDGE IS NOT NEW. Counts are judged by `compareAxe()` from
 * axe-ratchet.mjs — the same function the UI gate's axe ratchet uses, called
 * unchanged — so every rule in docs/evidence/d2/phase5/P23/S10a-DECISION.md §3
 * holds: any count up, a new rule, a clean entry dirty, a count down without
 * the baseline lowered, an entry that did not run, a check that threw.
 *
 * THE ONLY DIFFERENCE IS THE KEY. axe.baseline.json is keyed by scene alone
 * (it runs once, at iphone-390). This baseline is keyed by scene AND width:
 *
 *     { "surfaces": { "<scene>": { "<width>": { "<rule>": n } } } }
 *
 * `flatten()` turns that into compareAxe's `{ scenes: { "<scene> @ <width>":
 * {...} } }` shape; `unflatten()` goes back. axe-ratchet.mjs is not touched,
 * so the UI gate's ratchet behaves exactly as before.
 *
 * TWO RULES ON TOP OF compareAxe, both stricter, never looser:
 *   • an entry with NO baseline is a FAILURE even when it is clean, naming
 *     every finding — compareAxe would pass a "new clean scene"; here a
 *     scene/width nobody recorded has not been looked at, which is not clean;
 *   • `--record` writes only entries that do not exist yet, and refuses —
 *     writing nothing — if asked to touch one that does. Recording is a first
 *     measurement, never a raise.
 *
 * Rule names carry the check letter: `A:<axe rule id>`, `B:tab-unreached`,
 * `C:focus-not-visible`, `D:keyboard-trap`, `E:escape-does-not-close`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { compareAxe, lowerBaseline } from "./axe-ratchet.mjs";

export const A11Y_BASELINE_PATH = "tools/uishot/a11y-surfaces.baseline.json";

/** S10a-DECISION.md §2 — the 11 scenes of the ten primary surfaces. */
export const SURFACE_SCENES = [
  "screen-feed",
  "screen-post-detail",
  "comments-panel",
  "composer-full",
  "screen-profile",
  "screen-edit-profile",
  "screen-notifications",
  "screen-discover",
  "screen-login",
  "screen-signup",
  "screen-admin-health",
];

/** S10a-DECISION.md §3 — the two widths; dimensions as tools/uishot/capture.mjs. */
export const SURFACE_WIDTHS = [
  { name: "iphone-390", width: 390, height: 844, mobile: true },
  { name: "desktop-1280", width: 1280, height: 900, mobile: false },
];

export const CHECK_RULES = {
  B: "B:tab-unreached",
  C: "C:focus-not-visible",
  D: "D:keyboard-trap",
  E: "E:escape-does-not-close",
};

const SEP = " @ ";
export const entryKey = (scene, width) => `${scene}${SEP}${width}`;
export function splitKey(key) {
  const i = key.lastIndexOf(SEP);
  return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + SEP.length)];
}

/** nested baseline → compareAxe's flat `{ scenes }` shape. null when malformed. */
export function flatten(baseline) {
  const s = baseline?.surfaces;
  if (!s || typeof s !== "object") return null;
  const scenes = {};
  for (const [scene, widths] of Object.entries(s)) {
    for (const [width, counts] of Object.entries(widths ?? {})) scenes[entryKey(scene, width)] = counts;
  }
  return { scenes };
}

/** flat `{ key: counts }` → nested `{ scene: { width: counts } }`, sorted. */
export function unflatten(flat) {
  const out = {};
  for (const key of Object.keys(flat).sort()) {
    const [scene, width] = splitKey(key);
    (out[scene] ??= {})[width] = Object.fromEntries(Object.entries(flat[key]).sort());
  }
  return out;
}

/** compareAxe's wording names axe.baseline.json; say which file is meant here. */
const reword = (msg) =>
  msg.replace(/axe\.baseline\.json/g, "a11y-surfaces.baseline.json").replace(/axe did not run/g, "a check did not run").replace(/axe baseline/g, "a11y-surfaces baseline");

/**
 * @param baseline { surfaces: { scene: { width: { rule: n } } } }
 * @param current  { "<scene> @ <width>": { rule: n } | { error } }
 * @param fullRun  true when every scene/width of SURFACE_SCENES × SURFACE_WIDTHS ran
 * @returns string[] — failures; empty means pass
 */
export function judge(baseline, current, fullRun) {
  const flat = flatten(baseline);
  if (!flat) return ["a11y-surfaces baseline has no `surfaces` object — refusing to pass against nothing"];
  const fails = [];
  const recorded = {};
  for (const [key, cur] of Object.entries(current)) {
    if (key in flat.scenes) { recorded[key] = cur; continue; }
    if (cur && typeof cur.error === "string") { fails.push(`${key}: a check did not run (${cur.error})`); continue; }
    const rules = Object.entries(cur);
    fails.push(`${key}: NOT RECORDED — no baseline entry for this scene/width (${rules.length ? rules.map(([r, n]) => `${r}=${n}`).join(", ") : "no findings"}); record it with --record`);
  }
  for (const f of compareAxe(flat, recorded, false)) fails.push(reword(f));
  if (fullRun) {
    for (const key of Object.keys(flat.scenes)) {
      if (!(key in current)) fails.push(`${key}: in the a11y-surfaces baseline but did not run at all`);
    }
  }
  return fails;
}

/**
 * First measurement only. Returns the new baseline; throws — so nothing is
 * written — when any measured entry already exists or did not run.
 */
export function recordBaseline(baseline, current) {
  const flat = flatten(baseline) ?? { scenes: {} };
  const existing = Object.keys(current).filter((k) => k in flat.scenes);
  if (existing.length) {
    throw new Error(`--record refuses to touch ${existing.length} existing entr${existing.length === 1 ? "y" : "ies"} (${existing.join(", ")}). Recording is a first measurement only — lower with --lower; never raise.`);
  }
  const errored = Object.entries(current).filter(([, c]) => c && typeof c.error === "string");
  if (errored.length) throw new Error(`--record refuses entries whose checks did not run: ${errored.map(([k, c]) => `${k} (${c.error})`).join(", ")}`);
  if (Object.keys(current).length === 0) throw new Error("--record: nothing was measured");
  return { ...baseline, surfaces: unflatten({ ...flat.scenes, ...current }) };
}

/** Lower-only, via axe-ratchet's lowerBaseline. Refuses an unrecorded entry (that is --record's job). */
export function lowerSurfaces(baseline, current) {
  const flat = flatten(baseline);
  if (!flat) throw new Error("a11y-surfaces baseline has no `surfaces` object");
  const fresh = Object.keys(current).filter((k) => !(k in flat.scenes));
  if (fresh.length) throw new Error(`--lower never adds an entry (${fresh.join(", ")}) — use --record`);
  const next = lowerBaseline(flat, current);
  return { ...baseline, surfaces: unflatten(next.scenes) };
}
