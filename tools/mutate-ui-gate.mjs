#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE UI GATE'S WIRING (Gate 4).
 *
 * The gate itself is mutation-proven elsewhere (restore the DOB nav bug and the
 * sweep goes red). This proves the thing one level up: that the gate cannot be
 * DISCONNECTED without the suite noticing.
 *
 * Every mutation below is a one-line edit that looks harmless in a diff, breaks
 * no other test, and leaves a green pipeline that has stopped checking
 * anything. That is the failure mode worth protecting against — a gate quietly
 * unhooked is worse than no gate, because the green now lies.
 *
 * Each mutation is applied to a copy, restored afterwards, and the run ends by
 * re-asserting every file matches the snapshot this run took.
 * Usage: `node tools/mutate-ui-gate.mjs`
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const WF = ".github/workflows/android-build.yml";
const CAP = "tools/uishot/capture.mjs";
const GATE = "tools/uishot/gate.mjs";
const BASE = "tools/uishot/baseline.json";
const PKG = "package.json";
const STANDALONE = ".github/workflows/ui-gate.yml";
const SUITE = "src/__tests__/uiGateCannotBeBypassed.test.ts";

const MUTATIONS = [
  {
    control: "1. build-aab stops depending on the gate",
    file: WF,
    from: "    needs: [security-gate, ui-gate]",
    to: "    needs: security-gate",
  },
  {
    control: "2. the ui-gate job is deleted outright",
    file: WF,
    transform: (s) => s.slice(0, s.indexOf("  ui-gate:")) + s.slice(s.indexOf("  build-aab:")),
  },
  {
    control: "3. the gate step swallows its failure with `|| true`",
    file: WF,
    from: "        run: npm run ui:gate",
    to: "        run: npm run ui:gate || true",
  },
  {
    control: "4. the gate step is marked continue-on-error",
    file: WF,
    from: "      - name: Every control reachable, nothing regressed against the baseline",
    to: "      - name: Every control reachable, nothing regressed against the baseline\n        continue-on-error: true",
  },
  {
    control: "5. CI re-records the baseline every run, so it agrees with itself",
    file: WF,
    from: "        run: npm run ui:gate",
    to: "        run: npm run ui:gate -- --baseline-write",
  },
  {
    control: "6. the sweep stops exiting non-zero on findings",
    file: CAP,
    from: "process.exit(problems > 0 ? 1 : 0);",
    to: "process.exit(0);",
  },
  {
    control: "7. the runner stops propagating the sweep's exit code",
    file: GATE,
    from: "process.exit(exitCode);",
    to: "process.exit(0);",
  },
  {
    control: "8. a harness that never starts becomes a pass, not a failure",
    file: GATE,
    from: "  throw new Error(`the harness never answered",
    to: "  return; // (silently give up) // `the harness never answered",
  },
  {
    control: "9. GATE 1 — the reachability hit test is removed",
    file: CAP,
    from: "const hit = document.elementFromPoint((vl + vr) / 2, (vt + vb) / 2);",
    to: "const hit = el; // (reachability check neutered)",
  },
  {
    control: "10. GATE 2 — the baseline file is deleted",
    file: BASE,
    delete: true,
  },
  {
    control: "11. GATE 2 — the baseline is emptied but left present",
    file: BASE,
    transform: () => "{}\n",
  },
  {
    control: "12. GATE 2 — the diff stops detecting a vanished control",
    file: CAP,
    from: "is gone (was present in the baseline)",
    to: "is absent, which is probably fine",
  },
  {
    control: "13. GATE 2 — the diff stops detecting lost dropdown options",
    file: CAP,
    from: "options now, had",
    to: "options, previously",
  },
  {
    control: "14. the npm script is repointed at something weaker",
    file: PKG,
    from: '"ui:gate": "node tools/uishot/gate.mjs"',
    to: '"ui:gate": "echo skipped"',
  },
  {
    control: "15. the standalone per-push gate workflow is deleted",
    file: STANDALONE,
    delete: true,
  },
  {
    control: "16. the standalone gate stops running on push",
    file: STANDALONE,
    from: "  push:\n    branches: [main]",
    to: "  workflow_dispatch:",
  },
  {
    control: "17. the standalone gate swallows its failure",
    file: STANDALONE,
    from: "        run: npm run ui:gate",
    to: "        run: npm run ui:gate || true",
  },
];

const read = (f) => readFileSync(f, "utf8");
const TOUCHED = [...new Set(MUTATIONS.map((m) => m.file))];
const originals = new Map();
for (const f of TOUCHED) originals.set(f, read(f));

function suiteResult() {
  try {
    execSync(`npx vitest run ${SUITE} --reporter=basic`, { stdio: "pipe" });
    return "GREEN";
  } catch {
    return "RED";
  }
}

console.log("baseline (no mutation):", suiteResult(), "\n");
let failures = 0;

for (const m of MUTATIONS) {
  const src = originals.get(m.file);
  if (m.from && !src.includes(m.from)) {
    console.log(`⚠ SKIPPED  ${m.control} — anchor not found in ${m.file}`);
    failures++;
    continue;
  }
  try {
    if (m.delete) unlinkSync(m.file);
    else if (m.transform) writeFileSync(m.file, m.transform(src));
    else writeFileSync(m.file, src.replace(m.from, m.to));

    const r = suiteResult();
    const ok = r === "RED";
    if (!ok) failures++;
    console.log(`${ok ? "✓ DETECTED" : "✗ UNDETECTED"}  ${m.control}  → suite ${r}`);
  } finally {
    writeFileSync(m.file, src);
  }
}

for (const [f, s] of originals) writeFileSync(f, s);
const leftover = [...originals.entries()].filter(([f, s]) => !existsSync(f) || read(f) !== s).map(([f]) => f);
const dirty = leftover.join("\n");
console.log("\nfiles differing from the pre-run snapshot:", dirty === "" ? "NONE (fully restored)" : `LEFTOVER:\n${dirty}`);
console.log(failures === 0
  ? "\nALL CONTROLS DETECTED. The gate cannot be unhooked without the suite going red."
  : `\n${failures} CONTROL(S) NOT DETECTED — the gate can be disabled silently.`);
process.exit(failures === 0 && dirty === "" ? 0 : 1);
