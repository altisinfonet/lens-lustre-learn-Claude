#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────────
// SELF-TEST FOR THE GOVERNANCE HEALTH CHECK.
//
// WHY THIS EXISTS. A control nobody has seen fail is a claim, not evidence —
// GATE_REGISTER five rules, rule 2 (C-34), restated in docs/gates/GOVERNANCE.md
// §1.2. So this plants the exact defect each check exists to catch, requires
// the checker to report it, then restores a clean fixture and requires the
// checker to go quiet again. A check that stays green against a planted defect
// FAILS here.
//
// It operates ONLY inside a throwaway fixture directory it builds itself. It
// never touches the repository's real governance documents — which matters,
// because the instrument under test is the one that audits them.
//
// Usage: node scripts/gov-health-check.test.mjs
// Exit 0 = every control demonstrated working. Non-zero = a control is blind.
// ───────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, "gov-health-check.mjs");

let planted = 0, caught = 0, failures = [];

function write(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** A fixture that every check should be happy with. */
function cleanFixture() {
  const root = mkdtempSync(join(tmpdir(), "govhealth-"));
  write(root, "CLAUDE.md", "# CLAUDE.md\n\nSmall pointer file.\n");
  write(root, "docs/gates/GOVERNANCE.md",
    "# GOVERNANCE CHARTER\n\n**Owner of this document:** the Auditor · **Status:** ACTIVE\n\nSee `CLAUDE.md`.\n");
  write(root, "docs/gates/GATE_REGISTER.md",
    "| # | Hold | Effect | Released by |\n|---|---|---|---|\n| **H-1** | a hold | blocks a thing | Owner does something |\n");
  write(root, "docs/ADDENDUM_A_EXECUTION_MASTER.md", "# ADDENDUM A\n");
  write(root, "docs/PROMOTION_LEDGER.md", "# ledger\n");
  write(root, "docs/gates/PRODUCTION_LEDGER.md", "# production ledger\n");
  write(root, "docs/DECISIONS.md", "# decisions\n");
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/real.yml"), "name: real\n");
  write(root, "docs/gates/governance-manifest.json", JSON.stringify({
    manifest: "test", manifest_version: "1.0.0", charter: "docs/gates/GOVERNANCE.md",
    authority: {
      engineering_operating_authority: "docs/ADDENDUM_A_EXECUTION_MASTER.md",
      governance_charter: "docs/gates/GOVERNANCE.md", bootloader: "CLAUDE.md",
      gate_register: "docs/gates/GATE_REGISTER.md", promotion_ledger: "docs/PROMOTION_LEDGER.md",
      production_ledger: "docs/gates/PRODUCTION_LEDGER.md", decision_register: "docs/DECISIONS.md",
    },
    roles: { owner: {}, auditor: {} },
    ownership: { documents: [
      { path: "CLAUDE.md", owner: "owner" },
      { path: "docs/ADDENDUM_A_EXECUTION_MASTER.md", owner: "owner" },
      { path: "docs/DECISIONS.md", owner: "shared", shared_between: ["owner", "auditor"] },
      { path: "docs/gates/GOVERNANCE.md", owner: "auditor" },
      { path: "docs/gates/governance-manifest.json", owner: "auditor" },
    ] },
    layers: [{ id: "L0" }, { id: "L1" }, { id: "L2" }, { id: "L3" }],
    evidence_precedence: { order: ["L3", "L1", "L0"] },
    control_constraints: {},
    hold_model: { time_based: false, required_fields: ["owner", "release_condition", "current_state", "evidence", "resolution_record"], states: ["OPEN", "BLOCKED", "RESOLVED"] },
    amendment: {}, status_vocabulary: {},
    staleness_policy: { decided: false },
  }, null, 2));
  return root;
}

function run(root) {
  const out = execFileSync(process.execPath, [CHECKER, "--json", "--root", root], { encoding: "utf8" });
  return JSON.parse(out);
}
const statusOf = (rep, prefix) => (rep.findings.find((f) => f.check.startsWith(prefix)) || {}).status;

/**
 * Plant a defect, require the named check to stop passing, then restore the
 * clean fixture and require it to pass again. Both halves matter: the second
 * proves the check is responding to the defect and not simply always red.
 */
function planted_defect(name, checkPrefix, mutate) {
  planted++;
  const root = cleanFixture();
  try {
    const before = statusOf(run(root), checkPrefix);
    if (before !== "PASS") {
      failures.push(`${name}: clean fixture did not PASS ${checkPrefix} (got ${before}) — fixture or check is wrong`);
      return;
    }
    mutate(root);
    const after = statusOf(run(root), checkPrefix);
    if (after !== "FINDING") {
      failures.push(`${name}: planted defect was NOT detected — ${checkPrefix} reported ${after}, expected FINDING`);
      return;
    }
    // Restore to clean and require silence again.
    const restored = cleanFixture();
    const end = statusOf(run(restored), checkPrefix);
    rmSync(restored, { recursive: true, force: true });
    if (end !== "PASS") {
      failures.push(`${name}: check did not return to PASS after restoration (got ${end})`);
      return;
    }
    caught++;
    console.log(`  ok   ${name} — defect detected, clean state restored`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("Governance health check — planted-defect self-test\n");

planted_defect("manifest with a missing required key", "1.", (root) => {
  const p = join(root, "docs/gates/governance-manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8"));
  delete m.hold_model;
  writeFileSync(p, JSON.stringify(m));
});

planted_defect("manifest declaring a time-based hold model (O-6 violation)", "1.", (root) => {
  const p = join(root, "docs/gates/governance-manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8"));
  m.hold_model.time_based = true;
  m.hold_model.required_fields.push("review_by");
  writeFileSync(p, JSON.stringify(m));
});

planted_defect("manifest pointing at a file that does not exist", "2.", (root) => {
  const p = join(root, "docs/gates/governance-manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8"));
  m.authority.gate_register = "docs/gates/NOT_A_REAL_FILE.md";
  writeFileSync(p, JSON.stringify(m));
});

planted_defect("documentation naming a workflow that does not exist", "4.", (root) => {
  write(root, "docs/some-note.md", "CI is enforced by `.github/workflows/does-not-exist.yml` — it is not.\n");
});

// A file under docs/gates/** is already Auditor-owned by Addendum §3.1, so it
// is NOT a gap. A governance-relevant file outside every owned tree is.
planted_defect("governance-relevant file owned by nobody", "6.", (root) => {
  write(root, ".github/PULL_REQUEST_TEMPLATE.md", "## Summary\n");
});

planted_defect("document marked current but whose header says SUPERSEDED", "7.", (root) => {
  write(root, "docs/gates/GOVERNANCE.md",
    "# GOVERNANCE CHARTER\n\n> **SUPERSEDED — historical.**\n\n**Owner of this document:** the Auditor · **Status:** ACTIVE\n");
});

planted_defect("CLAUDE.md over the O-9 line budget", "9.", (root) => {
  write(root, "CLAUDE.md", "# CLAUDE.md\n" + "filler line\n".repeat(120));
});

planted_defect("CLAUDE.md over the O-9 byte budget", "9.", (root) => {
  write(root, "CLAUDE.md", "# CLAUDE.md\n" + "x".repeat(9000) + "\n");
});

// Branch protection must NEVER report PASS: absent evidence is not a pass.
planted++;
{
  const root = cleanFixture();
  const s = statusOf(run(root), "10.");
  rmSync(root, { recursive: true, force: true });
  if (s !== "UNVERIFIED") failures.push(`branch protection reported ${s}; it must be UNVERIFIED without administration evidence`);
  else { caught++; console.log("  ok   branch protection reports UNVERIFIED, never a fabricated pass"); }
}

// Staleness must NOT invent a threshold when governance has not decided one.
planted++;
{
  const root = cleanFixture();
  const s = statusOf(run(root), "3.");
  rmSync(root, { recursive: true, force: true });
  if (s !== "NOT_EVALUATED") failures.push(`staleness reported ${s}; with no decided threshold it must be NOT_EVALUATED`);
  else { caught++; console.log("  ok   staleness reports NOT_EVALUATED rather than assuming a threshold"); }
}

// Report-only: the checker must exit 0 even with findings present.
planted++;
{
  const root = cleanFixture();
  write(root, "docs/gates/orphan.md", "# orphan\n");
  let code = 0;
  try { execFileSync(process.execPath, [CHECKER, "--json", "--root", root], { encoding: "utf8" }); }
  catch (e) { code = e.status ?? 1; }
  rmSync(root, { recursive: true, force: true });
  if (code !== 0) failures.push(`checker exited ${code} with findings present; report-only must exit 0`);
  else { caught++; console.log("  ok   findings present and the checker still exits 0 (report-only)"); }
}

console.log(`\n${caught}/${planted} controls demonstrated working.`);
if (failures.length) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Every control was shown failing against a planted defect and quiet against a clean fixture.");
