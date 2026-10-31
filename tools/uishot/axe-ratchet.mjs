#!/usr/bin/env node
/**
 * THE AXE RATCHET — P23 clause 2 ("automated checks in CI"), as a ratchet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT. `capture.mjs` runs axe-core once per scene at the iphone-390 viewport
 * (tags wcag2a wcag2aa wcag21a wcag21aa wcag22aa — WCAG 2.2 AA, the level fixed
 * by docs/evidence/d2/phase5/P23/DECISION.md §1) and hands the per-scene,
 * per-rule node counts to `compareAxe()` below, which judges them against the
 * committed `tools/uishot/axe.baseline.json`.
 *
 * WHY A RATCHET AND NOT "ZERO VIOLATIONS". The baseline measured 2026-10-04 is
 * 37 failing nodes in 11 of 50 scenes. A check that fails every pull request
 * until all 37 are fixed gets switched off inside a week (the tap-target
 * reasoning, tools/uishot/tap-targets.mjs). So it is binding from day one on
 * everything that can get WORSE, and every number in the baseline is a debt,
 * not a standard (DECISION.md C3, C4: criticals to 0 before P-5 promotes).
 *
 * THE GATE FAILS WHEN (DECISION.md C3, every one):
 *   1. a scene's count for a rule goes UP;
 *   2. a NEW RULE appears in a scene that already had violations;
 *   3. a CLEAN scene (recorded with {}) gets any violation;
 *   4. a NEW scene (not in the baseline) has any violation;
 *   5. a count goes DOWN and the baseline was not lowered with it — so every
 *      improvement is locked in by the same PR that made it;
 *   6. on a full run, a baseline scene did not run at all, or axe itself
 *      threw on a scene (an axe that did not run is not a clean scene).
 *
 * LOWERING THE BASELINE is a deliberate, reviewed act:
 *     node tools/uishot/axe-ratchet.mjs --lower /tmp/shots/axe-current.json
 * It only ever LOWERS (or records a new clean scene). It refuses to raise a
 * count or add a rule — raising one means editing the JSON by hand, which
 * shows in the diff, and is Standing Rule 19 in reverse. Never do it to make
 * a red go away.
 *
 * No rule is disabled. There is no allow-list yet; if one is ever needed it is
 * a committed file, one line per scene + rule + selector with a reason (C2).
 *
 *   node tools/uishot/axe-ratchet.mjs --self-test   # proves every failure path
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
export const AXE_VIEWPORT = "iphone-390";
export const AXE_BASELINE_PATH = "tools/uishot/axe.baseline.json";

/** axe results → { rule: nodeCount }, violations only. */
export function countsFromAxe(results) {
  const out = {};
  for (const v of results.violations ?? []) out[v.id] = (out[v.id] ?? 0) + v.nodes.length;
  return out;
}

/**
 * @param baseline { scenes: { [scene]: { [rule]: n } } }
 * @param current  { [scene]: { [rule]: n } | { error: string } }
 * @param fullRun  true when every scene the harness offers was swept
 * @returns string[] — failures; empty means pass
 */
export function compareAxe(baseline, current, fullRun) {
  const fails = [];
  const base = baseline?.scenes;
  if (!base || typeof base !== "object") return ["axe baseline has no `scenes` object — refusing to pass against nothing"];

  for (const [scene, cur] of Object.entries(current)) {
    if (cur && typeof cur.error === "string") { fails.push(`${scene}: axe did not run (${cur.error})`); continue; }
    const b = base[scene];
    for (const [rule, n] of Object.entries(cur)) {
      if (!b) { fails.push(`${scene}: NEW scene has ${n} ${rule} violation(s) — a new scene must be clean`); continue; }
      if (Object.keys(b).length === 0) { fails.push(`${scene}: CLEAN scene now has ${n} ${rule} violation(s)`); continue; }
      if (!(rule in b)) { fails.push(`${scene}: NEW rule ${rule} (${n} node(s)) — not in the baseline`); continue; }
      if (n > b[rule]) fails.push(`${scene}: ${rule} went UP ${b[rule]} → ${n}`);
      if (n < b[rule]) fails.push(`${scene}: ${rule} went DOWN ${b[rule]} → ${n} — lower axe.baseline.json in this PR (--lower)`);
    }
    if (b) {
      for (const [rule, n] of Object.entries(b)) {
        if (!(rule in cur) && n > 0) fails.push(`${scene}: ${rule} went DOWN ${n} → 0 — lower axe.baseline.json in this PR (--lower)`);
      }
    }
  }
  if (fullRun) {
    for (const scene of Object.keys(base)) {
      if (!(scene in current)) fails.push(`${scene}: in the axe baseline but did not run at all`);
    }
  }
  return fails;
}

/** Lower-only merge. Throws on any raise or new rule. */
export function lowerBaseline(baseline, current) {
  const scenes = { ...baseline.scenes };
  for (const [scene, cur] of Object.entries(current)) {
    if (cur && typeof cur.error === "string") throw new Error(`${scene}: axe did not run (${cur.error}) — nothing to lower from`);
    const b = scenes[scene];
    if (!b) {
      if (Object.keys(cur).length) throw new Error(`${scene}: new scene with violations — --lower never adds a debt`);
      scenes[scene] = {};
      continue;
    }
    for (const [rule, n] of Object.entries(cur)) {
      if (!(rule in b) || n > b[rule]) throw new Error(`${scene}: ${rule}=${n} is above the baseline (${b[rule] ?? "absent"}) — --lower never raises`);
    }
    scenes[scene] = Object.fromEntries(Object.entries(cur).sort());
  }
  return { ...baseline, scenes: Object.fromEntries(Object.entries(scenes).sort()) };
}

export const totalNodes = (scenes) =>
  Object.values(scenes).reduce((t, s) => t + Object.values(s).reduce((a, n) => a + n, 0), 0);

function selfTest() {
  const B = { scenes: { a: { "button-name": 2, label: 1 }, clean: {} } };
  const cases = [
    ["identical → pass", { a: { "button-name": 2, label: 1 }, clean: {} }, true, 0],
    ["count up → fail", { a: { "button-name": 3, label: 1 }, clean: {} }, true, 1],
    ["new rule → fail", { a: { "button-name": 2, label: 1, "link-name": 1 }, clean: {} }, true, 1],
    ["clean scene gets violation → fail", { a: { "button-name": 2, label: 1 }, clean: { "button-name": 1 } }, true, 1],
    ["new scene with violation → fail", { a: { "button-name": 2, label: 1 }, clean: {}, fresh: { label: 1 } }, true, 1],
    ["new clean scene → pass", { a: { "button-name": 2, label: 1 }, clean: {}, fresh: {} }, true, 0],
    ["count down, baseline not lowered → fail", { a: { "button-name": 1, label: 1 }, clean: {} }, true, 1],
    ["rule gone, baseline not lowered → fail", { a: { "button-name": 2 }, clean: {} }, true, 1],
    ["baseline scene missing on full run → fail", { a: { "button-name": 2, label: 1 } }, true, 1],
    ["baseline scene missing on filtered run → pass", { a: { "button-name": 2, label: 1 } }, false, 0],
    ["axe threw → fail", { a: { error: "boom" }, clean: {} }, true, 1],
  ];
  let bad = 0;
  for (const [name, cur, full, want] of cases) {
    const got = compareAxe(B, cur, full).length;
    const ok = (want === 0) === (got === 0);
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${name} (failures: ${got})`);
  }
  // baseline with no scenes must never pass
  const vacuous = compareAxe({}, {}, true).length > 0;
  console.log(`${vacuous ? "✓" : "✗"} missing baseline → fail`); if (!vacuous) bad++;
  // --lower lowers, and refuses to raise
  const lowered = lowerBaseline(B, { a: { "button-name": 1 }, clean: {} });
  const lowOk = JSON.stringify(lowered.scenes.a) === JSON.stringify({ "button-name": 1 }) && compareAxe(lowered, { a: { "button-name": 1 }, clean: {} }, true).length === 0;
  console.log(`${lowOk ? "✓" : "✗"} --lower records the improvement and then passes`); if (!lowOk) bad++;
  for (const [name, cur] of [["raise", { a: { "button-name": 3, label: 1 } }], ["new rule", { a: { "button-name": 2, label: 1, x: 1 } }], ["new dirty scene", { z: { x: 1 } }]]) {
    let threw = false; try { lowerBaseline(B, cur); } catch { threw = true; }
    console.log(`${threw ? "✓" : "✗"} --lower refuses: ${name}`); if (!threw) bad++;
  }
  const cnt = countsFromAxe({ violations: [{ id: "label", nodes: [1, 2] }, { id: "button-name", nodes: [1] }] });
  const cntOk = cnt.label === 2 && cnt["button-name"] === 1;
  console.log(`${cntOk ? "✓" : "✗"} countsFromAxe sums nodes per rule`); if (!cntOk) bad++;
  console.log(bad ? `\nSELF-TEST FAILED (${bad})` : "\nself-test: all cases behave");
  return bad ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args[0] === "--self-test") process.exit(selfTest());
  if (args[0] === "--lower" && args[1]) {
    const baseline = existsSync(AXE_BASELINE_PATH) ? JSON.parse(readFileSync(AXE_BASELINE_PATH, "utf8")) : null;
    if (!baseline) { console.error(`no ${AXE_BASELINE_PATH}`); process.exit(1); }
    const current = JSON.parse(readFileSync(args[1], "utf8")).scenes;
    const next = lowerBaseline(baseline, current);
    writeFileSync(AXE_BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`axe baseline lowered: ${totalNodes(baseline.scenes)} → ${totalNodes(next.scenes)} nodes`);
    process.exit(0);
  }
  console.error("usage: axe-ratchet.mjs --self-test | --lower <axe-current.json>");
  process.exit(2);
}
