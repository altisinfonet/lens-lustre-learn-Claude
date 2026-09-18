#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────────
// GOVERNANCE HEALTH CHECK — REPORT ONLY.
//
// This instrument READS. It never writes to a ledger, never edits a governance
// document, never changes a repository setting, never touches the database or
// production. That constraint is not incidental — it is §1.2 of
// docs/gates/GOVERNANCE.md, and a governance control that could change the
// thing it audits would be worthless as evidence.
//
// It exits 0 even when it finds problems. Findings are the product; a red
// build is not. Turning any check into a merge blocker is a separate unit with
// its own Owner decision (Governance V2 plan, GOV-3 → blocking promotion).
//
// WHAT IT REFUSES TO DO
// A check that cannot be evidenced reports UNVERIFIED. It never reports PASS
// on absent evidence. Branch protection is the live example: reading it needs
// administration-level access this repository has deliberately not granted
// (Owner decision O-8), so that check is UNVERIFIED by design and says so.
//
// NO TIME-BASED LOGIC. Owner decision O-6 removed the aged/escalated model
// entirely: no SLA, no review_by, no opened-date, no timer. A hold's age is
// not a governance signal. The hold check below looks at conditions and
// evidence, never at elapsed time.
//
// Usage:  node scripts/gov-health-check.mjs [--json] [--root <dir>]
// ───────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const AS_JSON = args.includes("--json");
const ROOT = (() => {
  const i = args.indexOf("--root");
  return i >= 0 && args[i + 1] ? args[i + 1] : process.cwd();
})();

const MANIFEST = "docs/gates/governance-manifest.json";
const CHARTER = "docs/gates/GOVERNANCE.md";
const BOOTLOADER = "CLAUDE.md";

// O-9, Owner-approved. The only hard numbers in this instrument.
const CLAUDE_MAX_LINES = 100;
const CLAUDE_MAX_BYTES = 8192;

const findings = [];
const rd = (p) => readFileSync(join(ROOT, p), "utf8");
const has = (p) => existsSync(join(ROOT, p));

/** status: PASS | FINDING | UNVERIFIED | NOT_EVALUATED */
function record(check, status, detail, items = []) {
  findings.push({ check, status, detail, items });
}

// Walk tracked-ish files, skipping directories that are never governance input.
const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next"]);
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

// ── 1 · Manifest self-consistency ──────────────────────────────────────────
let manifest = null;
(function manifestSelfConsistency() {
  const CHECK = "1. manifest self-consistency";
  if (!has(MANIFEST)) {
    record(CHECK, "FINDING", `${MANIFEST} is missing`);
    return;
  }
  try {
    manifest = JSON.parse(rd(MANIFEST));
  } catch (err) {
    record(CHECK, "FINDING", `${MANIFEST} does not parse: ${err.message}`);
    return;
  }
  const required = [
    "manifest", "manifest_version", "charter", "authority", "roles",
    "ownership", "layers", "evidence_precedence", "control_constraints",
    "hold_model", "amendment", "status_vocabulary",
  ];
  const missing = required.filter((k) => !(k in manifest));
  if (missing.length) {
    record(CHECK, "FINDING", "manifest is missing required keys", missing);
    return;
  }
  const problems = [];
  const docs = manifest.ownership?.documents;
  if (!Array.isArray(docs) || docs.length === 0) {
    problems.push("ownership.documents is absent or empty");
  } else {
    for (const d of docs) {
      if (!d.path || !d.owner) problems.push(`ownership entry lacks path/owner: ${JSON.stringify(d)}`);
      if (d.owner === "shared" && !Array.isArray(d.shared_between)) {
        problems.push(`${d.path} is shared but names no shared_between`);
      }
    }
  }
  const layerIds = (manifest.layers || []).map((l) => l.id);
  for (const want of ["L0", "L1", "L2", "L3"]) {
    if (!layerIds.includes(want)) problems.push(`layer ${want} is not defined`);
  }
  // O-6: the manifest must not describe a time-based lifecycle.
  const hm = manifest.hold_model || {};
  if (hm.time_based !== false) problems.push("hold_model.time_based is not false — O-6 forbids a time-based model");
  const forbiddenFields = ["review_by", "opened", "aged", "escalated", "sla", "timer"];
  for (const f of hm.required_fields || []) {
    if (forbiddenFields.includes(String(f).toLowerCase())) {
      problems.push(`hold_model.required_fields contains a time-based field: ${f}`);
    }
  }
  record(CHECK, problems.length ? "FINDING" : "PASS",
    problems.length ? "manifest is internally inconsistent" : "manifest parses and is internally consistent",
    problems);
})();

// ── 2 · Charter / manifest pointer integrity ───────────────────────────────
(function pointerIntegrity() {
  const CHECK = "2. governance pointer integrity";
  if (!manifest) { record(CHECK, "NOT_EVALUATED", "manifest unavailable"); return; }
  const broken = [];
  const charterPath = manifest.charter;
  if (!charterPath) broken.push("manifest.charter is not set");
  else if (!has(charterPath)) broken.push(`manifest.charter -> ${charterPath} does not exist`);
  for (const [k, v] of Object.entries(manifest.authority || {})) {
    if (!has(v)) broken.push(`authority.${k} -> ${v} does not exist`);
  }
  for (const d of manifest.ownership?.documents || []) {
    if (!has(d.path)) broken.push(`ownership -> ${d.path} does not exist`);
  }
  // Repo-relative paths the charter itself points at.
  if (has(CHARTER)) {
    const refs = new Set((rd(CHARTER).match(/`((?:docs|src|scripts|supabase|\.github)\/[^`\s]+|CLAUDE\.md)`/g) || [])
      .map((m) => m.replace(/`/g, "")));
    for (const r of refs) {
      const bare = r.replace(/\/\*\*$/, "");
      if (r.endsWith("/**")) { if (!has(bare)) broken.push(`charter -> ${r} (dir ${bare}) does not exist`); }
      else if (!has(r)) broken.push(`charter -> ${r} does not exist`);
    }
  }
  record(CHECK, broken.length ? "FINDING" : "PASS",
    broken.length ? "governance documents point at paths that do not exist" : "every governance pointer resolves",
    broken);
})();

// ── 3 · Governance-document staleness ──────────────────────────────────────
// Only evaluated where project governance has actually decided a threshold.
// No threshold is invented here; absence is reported as NOT_EVALUATED.
(function staleness() {
  const CHECK = "3. governance-document staleness";
  const policy = manifest?.staleness_policy;
  if (!policy || policy.decided !== true) {
    record(CHECK, "NOT_EVALUATED",
      "no max-staleness threshold has been decided by project governance (manifest.staleness_policy.decided is not true); no threshold is assumed");
    return;
  }
  record(CHECK, "NOT_EVALUATED",
    "staleness_policy.decided is true but no per-document thresholds are defined in the manifest");
})();

// ── 4 · Phantom workflow references ────────────────────────────────────────
(function phantomWorkflows() {
  const CHECK = "4. phantom workflow references";
  const wfDir = ".github/workflows";
  const present = new Set(has(wfDir) ? readdirSync(join(ROOT, wfDir)) : []);
  const phantoms = new Map();
  for (const f of walk("").filter((p) => p.endsWith(".md"))) {
    let text;
    try { text = rd(f); } catch { continue; }
    for (const m of text.match(/\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml/g) || []) {
      const name = m.split("/").pop();
      if (!present.has(name)) {
        if (!phantoms.has(name)) phantoms.set(name, new Set());
        phantoms.get(name).add(f);
      }
    }
  }
  const items = [...phantoms.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, files]) => `${name} — referenced by ${files.size} file(s): ${[...files].slice(0, 4).join(", ")}${files.size > 4 ? ", …" : ""}`);
  record(CHECK, items.length ? "FINDING" : "PASS",
    items.length ? `${items.length} workflow name(s) referenced in documentation do not exist` : "every workflow referenced in documentation exists",
    items);
})();

// ── 5 · Governance PR scope / ownership enforcement status ─────────────────
// Reports what is mechanically enforced. It does not enforce anything itself.
(function prScopeEnforcement() {
  const CHECK = "5. PR scope / ownership enforcement status";
  const items = [];
  const codeowners = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"].find(has);
  items.push(codeowners ? `CODEOWNERS present at ${codeowners}` : "no CODEOWNERS file — path ownership is not mechanically checked");
  const wfDir = ".github/workflows";
  const wfs = has(wfDir) ? readdirSync(join(ROOT, wfDir)) : [];
  const scopeCheckers = wfs.filter((w) => /scope|ownership|codeowner/i.test(w));
  items.push(scopeCheckers.length
    ? `workflows that appear to check scope/ownership: ${scopeCheckers.join(", ")}`
    : "no workflow inspects changed paths against the ownership map");
  items.push("this instrument is report-only and enforces nothing");
  record(CHECK, "FINDING",
    "one-scoped-unit-per-PR and path ownership are documented rules with no mechanical enforcement",
    items);
})();

// ── 6 · Ownership gaps ─────────────────────────────────────────────────────
(function ownershipGaps() {
  const CHECK = "6. ownership gaps";
  if (!manifest) { record(CHECK, "NOT_EVALUATED", "manifest unavailable"); return; }
  const owned = new Set((manifest.ownership?.documents || []).map((d) => d.path));
  // Paths the Addendum's own §3.1 map already assigns.
  const addendumOwned = [/^docs\/gates\//, /^docs\/PROMOTION_LEDGER\.md$/, /^docs\/evidence\//];
  // Governance-relevant paths that live OUTSIDE the Addendum's owned trees:
  // process machinery under .github/ and the governance files under docs/gates.
  const candidates = [
    ...walk(".github").filter((p) => p.endsWith(".md")),
    ...walk("docs/gates").filter((p) => p.endsWith(".md") || p.endsWith(".json")),
  ];
  const gaps = [];
  for (const c of new Set(candidates)) {
    if (!has(c)) continue; // a path that does not exist cannot be an ownership gap
    if (owned.has(c)) continue;
    if (addendumOwned.some((re) => re.test(c))) continue;
    gaps.push(c);
  }
  record(CHECK, gaps.length ? "FINDING" : "PASS",
    gaps.length
      ? "governance-relevant paths with no named owner in the manifest or Addendum §3.1 — reported, never assigned"
      : "no unassigned governance-relevant paths found",
    gaps);
})();

// ── 7 · Version / status consistency ───────────────────────────────────────
(function versionStatus() {
  const CHECK = "7. version / status consistency";
  if (!manifest) { record(CHECK, "NOT_EVALUATED", "manifest unavailable"); return; }
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.manifest_version || ""))) {
    problems.push(`manifest_version is not semver-shaped: ${manifest.manifest_version}`);
  }
  if (has(CHARTER)) {
    const head = rd(CHARTER).split("\n").slice(0, 10).join("\n");
    if (!/\*\*Status:\*\*/.test(head)) problems.push("charter header does not declare a Status");
    if (!/\*\*Owner of this document:\*\*/.test(head)) problems.push("charter header does not declare an owner");
  } else {
    problems.push(`${CHARTER} is missing`);
  }
  // A document the manifest calls current must not also call itself superseded.
  for (const d of manifest.ownership?.documents || []) {
    if (!has(d.path) || !d.path.endsWith(".md")) continue;
    const head = rd(d.path).split("\n").slice(0, 12).join("\n");
    if (/SUPERSEDED/i.test(head)) problems.push(`${d.path} is owned/current in the manifest but its header says SUPERSEDED`);
  }
  record(CHECK, problems.length ? "FINDING" : "PASS",
    problems.length ? "version/status declarations disagree" : "version and status declarations are consistent",
    problems);
})();

// ── 8 · Hold-condition inconsistency (O-6) ─────────────────────────────────
// Evidence-based only. No age, no SLA, no timer, no review_by — by decision.
(function holds() {
  const CHECK = "8. hold conditions (O-6)";
  const reg = "docs/gates/GATE_REGISTER.md";
  if (!has(reg)) { record(CHECK, "NOT_EVALUATED", `${reg} not found`); return; }
  const lines = rd(reg).split("\n");
  const rows = lines.filter((l) => /^\|\s*\*\*H-\d+\*\*/.test(l));
  if (!rows.length) {
    record(CHECK, "NOT_EVALUATED", "no standing-hold rows (H-n) found to evaluate");
    return;
  }
  const items = [];
  let ownerActionCount = 0;
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    const id = (cells[0] || "").replace(/\*/g, "");
    const released = cells[3] || cells[cells.length - 1] || "";
    const needsOwner = /\bOwner\b/.test(released);
    if (needsOwner) ownerActionCount++;
    items.push(`${id} — release condition: "${released.replace(/\*/g, "").slice(0, 120)}"${needsOwner ? "  [requires Owner action]" : ""}`);
  }
  // The O-6 record shape is defined in the charter; the register does not yet
  // carry those fields, so per-hold state cannot be read mechanically.
  const shapeKnown = /\bcurrent state\b/i.test(rd(reg)) && /\bresolution record\b/i.test(rd(reg));
  items.push(shapeKnown
    ? "hold rows carry O-6 fields"
    : "hold rows do not yet carry the O-6 fields (owner / release condition / current state / evidence / resolution record) — applying the model to this table is a separate Auditor act per charter §3.4");
  items.push(`${ownerActionCount} of ${rows.length} hold(s) name an Owner action in their release condition`);
  items.push("whether a release condition is in fact satisfied requires live evidence this instrument cannot read; those holds are listed for Auditor judgement, never auto-resolved");
  record(CHECK, "FINDING",
    `${rows.length} standing hold(s) present; release conditions listed for Auditor reconciliation`,
    items);
})();

// ── 9 · CLAUDE.md budget (O-9) ─────────────────────────────────────────────
(function claudeBudget() {
  const CHECK = "9. CLAUDE.md size budget (O-9)";
  if (!has(BOOTLOADER)) { record(CHECK, "FINDING", `${BOOTLOADER} is missing`); return; }
  const raw = readFileSync(join(ROOT, BOOTLOADER));
  const bytes = raw.length;
  const lineCount = raw.toString("utf8").split("\n").length - (raw.toString("utf8").endsWith("\n") ? 1 : 0);
  const over = [];
  if (lineCount > CLAUDE_MAX_LINES) over.push(`${lineCount} lines exceeds the ${CLAUDE_MAX_LINES}-line budget`);
  if (bytes > CLAUDE_MAX_BYTES) over.push(`${bytes} bytes exceeds the ${CLAUDE_MAX_BYTES}-byte budget`);
  record(CHECK, over.length ? "FINDING" : "PASS",
    `${BOOTLOADER} is ${lineCount} lines / ${bytes} bytes (budget ${CLAUDE_MAX_LINES} lines / ${CLAUDE_MAX_BYTES} bytes)`,
    over);
})();

// ── 10 · Branch-protection drift ───────────────────────────────────────────
// Owner decision O-8: no administration-level credential is provisioned.
// Therefore this reports UNVERIFIED. It must never report PASS.
(function branchProtection() {
  const CHECK = "10. branch-protection drift";
  record(CHECK, "UNVERIFIED",
    "reading branch protection requires administration-level access, which is deliberately not provisioned (Owner decision O-8). No pass is asserted and no state is inferred; verify by reading the live settings directly.",
    [
      "expected state is defined by Owner decision O-11 and is not restated here",
      "an UNVERIFIED result is not a failure and is not a pass",
    ]);
})();

// ── Report ─────────────────────────────────────────────────────────────────
const counts = findings.reduce((a, f) => ((a[f.status] = (a[f.status] || 0) + 1), a), {});
const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

if (AS_JSON) {
  console.log(JSON.stringify({ generated: stamp, root: relative(process.cwd(), ROOT) || ".", counts, findings }, null, 2));
} else {
  const L = [];
  L.push(`# Governance health report`);
  L.push("");
  L.push(`Generated ${stamp} · report-only · this instrument changes nothing.`);
  L.push("");
  L.push(`**PASS ${counts.PASS || 0} · FINDING ${counts.FINDING || 0} · UNVERIFIED ${counts.UNVERIFIED || 0} · NOT EVALUATED ${counts.NOT_EVALUATED || 0}**`);
  L.push("");
  L.push(`An UNVERIFIED result means the evidence for that check was not available. It is not a pass and not a failure.`);
  L.push("");
  for (const f of findings) {
    L.push(`## ${f.check} — ${f.status.replace("_", " ")}`);
    L.push("");
    L.push(f.detail);
    if (f.items.length) {
      L.push("");
      for (const it of f.items) L.push(`- ${it}`);
    }
    L.push("");
  }
  L.push(`---`);
  L.push(`Findings are for Auditor review. Nothing here has been written to a ledger, a governance document, a repository setting, the database or production.`);
  const out = L.join("\n");
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + "\n"); } catch { /* summary is best-effort */ }
  }
}

// Report-only: findings never fail the run.
process.exit(0);
