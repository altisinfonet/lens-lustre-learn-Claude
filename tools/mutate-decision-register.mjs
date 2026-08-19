#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE DECISION REGISTER (Gate 3).
 *
 * `docs/DECISIONS.md` only helps if it CANNOT go stale. The whole reason it
 * exists is that the last deliberate withholding — the privacy chooser — was
 * documented in a code comment, which nothing forced anyone to keep true, and
 * the owner ended up finding a missing control with no way to tell it apart
 * from a bug.
 *
 * A register enforced by a test that would pass anyway is the same failure in a
 * new place. So: break each control in turn and require the suite to go red.
 *
 * Every mutation is applied to a copy of the file, the file is restored from
 * that copy afterwards, and the run ends by re-asserting every file matches the
 * snapshot this run took. Usage: `node tools/mutate-decision-register.mjs`
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const REG = "docs/DECISIONS.md";
const PIN = "src/components/__tests__/PrivacyGapDisclosed.test.ts";
const DECOY = "src/__tests__/decisionRegisterMutationDecoy.ts";
const SUITE = "src/__tests__/decisionRegister.test.ts";

/**
 * Each mutation removes ONE control the register depends on. `delete` removes
 * the file entirely; `create` writes a new file that must be rejected.
 */
const MUTATIONS = [
  {
    control: "1. the register itself exists",
    file: REG,
    delete: true,
  },
  {
    control: "2. the register actually holds a decision (non-vacuous)",
    file: REG,
    // Strip every decision section, leaving the prose. Every per-decision
    // assertion would pass vacuously over an empty list.
    transform: (s) => s.slice(0, s.indexOf("## D-001")),
  },
  {
    control: "3. the pinning test carries its @decision marker",
    file: PIN,
    from: " * @decision D-002",
    to: " * (marker removed)",
  },
  {
    control: "4. the named pinning test really exists",
    file: REG,
    from: "**Pinned by:** `src/components/__tests__/PrivacyGapDisclosed.test.ts`",
    to: "**Pinned by:** `src/components/__tests__/NoSuchFile.test.ts`",
  },
  {
    control: "5. a decision must carry a checkable restore condition",
    file: REG,
    from: "- **Restore when:** Nothing to restore",
    to: "- **Restore when:** soon\n- **Ignored:** Nothing to restore",
  },
  {
    control: "6. status must be one of the three known values",
    file: REG,
    from: "- **Status:** ACTIVE",
    to: "- **Status:** probably fine",
  },
  {
    control: "7. a decision must say who decided it",
    file: REG,
    from: "- **Decided by:**",
    to: "- **Decided by (removed):**",
  },
  {
    control: "8. a decision must carry a date",
    file: REG,
    from: "- **Decided:** 2026-08-16",
    to: "- **Decided:** at some point",
  },
  {
    control: "9. decision ids must be unique",
    file: REG,
    transform: (s) => s + "\n\n## D-001 — a duplicate id nobody noticed\n\n" +
      "- **Status:** ACTIVE\n- **Decided:** 2026-08-18\n- **Decided by:** nobody\n" +
      "- **Pinned by:** `src/components/__tests__/PrivacyGapDisclosed.test.ts`\n" +
      "- **Restore when:** never, this entry exists only to prove ids are checked\n",
  },
  {
    control: "10. a test cannot pin a decision that is not registered",
    file: DECOY,
    create: "/** @decision D-999 — an orphan marker with no entry behind it. */\nexport const decoy = true;\n",
  },
];

const read = (f) => readFileSync(f, "utf8");
const TRACKED = [REG, PIN];
const originals = new Map();
for (const f of TRACKED) originals.set(f, read(f));

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
  const isNewFile = Boolean(m.create);
  const src = isNewFile ? null : originals.get(m.file) ?? read(m.file);

  if (m.from && !src.includes(m.from)) {
    console.log(`⚠ SKIPPED  ${m.control} — anchor not found in ${m.file}`);
    failures++;
    continue;
  }

  try {
    if (m.delete) unlinkSync(m.file);
    else if (m.create) writeFileSync(m.file, m.create);
    else if (m.transform) writeFileSync(m.file, m.transform(src));
    else writeFileSync(m.file, src.replace(m.from, m.to));

    const r = suiteResult();
    const ok = r === "RED";
    if (!ok) failures++;
    console.log(`${ok ? "✓ DETECTED" : "✗ UNDETECTED"}  ${m.control}  → suite ${r}`);
  } finally {
    if (m.create) { if (existsSync(m.file)) unlinkSync(m.file); }
    else writeFileSync(m.file, src);
  }
}

// Restore is belt; this is braces.
for (const [f, s] of originals) writeFileSync(f, s);
if (existsSync(DECOY)) unlinkSync(DECOY);
const leftover = [...originals.entries()].filter(([f, s]) => read(f) !== s).map(([f]) => f);
if (existsSync(DECOY)) leftover.push(DECOY);
const dirty = leftover.join("\n");
console.log("\nfiles differing from the pre-run snapshot:", dirty === "" ? "NONE (fully restored)" : `LEFTOVER:\n${dirty}`);
console.log(failures === 0
  ? "\nALL CONTROLS DETECTED. The register cannot go stale without the suite going red."
  : `\n${failures} CONTROL(S) NOT DETECTED — the register is decoration, not proof.`);
process.exit(failures === 0 && dirty === "" ? 0 : 1);
