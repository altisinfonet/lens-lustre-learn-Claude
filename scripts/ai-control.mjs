#!/usr/bin/env node
/**
 * CONTROL reconciler. Deliberately boring.
 *
 * It makes NO architectural decision and holds NO opinion. It derives the real
 * state from git and the working tree, compares it against the CLAIMS in
 * AI_CONTROL.md, and prints READY / DRIFT / BLOCKED.
 *
 * WHY THIS EXISTS
 *   Every serious defect in this project so far has been drift, not a bad
 *   decision: a test pinned to a superseded migration, a COALESCE guard
 *   reverted for 8 days, email-queue grants reverted since March, a typecheck
 *   checking zero files, and — on 2026-08-14, mid-session — origin/main moving
 *   two commits ahead of the tree an audit was being measured against.
 *   A status field someone forgot to update is the same failure again. So this
 *   script trusts nothing in AI_CONTROL.md; that file is configuration, not
 *   truth.
 *
 * WHAT IT CANNOT DO
 *   It has no database credential, so it cannot read the applied migration
 *   version. It prints that check as REQUIRES_CONNECTOR rather than guessing.
 *   The agent fills it from the Supabase connector and records it in evidence.
 *   Reporting a gap is correct; inventing a value is not.
 *
 * Exit: 0 READY · 1 DRIFT · 2 BLOCKED · 3 script/config error.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const sh = (cmd) => {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch (e) { return { __err: (e.stderr || e.stdout || String(e)).trim() }; }
};

const rows = [];
let worst = 0; // 0 ok, 1 drift, 2 blocked
const add = (name, status, detail) => {
  rows.push({ name, status, detail });
  if (status === "DRIFT") worst = Math.max(worst, 1);
  if (status === "BLOCKED" || status === "ERROR") worst = 2;
};

// ── config ────────────────────────────────────────────────────────────────
if (!existsSync("AI_CONTROL.md")) {
  console.error("BLOCKED: AI_CONTROL.md not found. Run from the repository root.");
  process.exit(3);
}
const raw = readFileSync("AI_CONTROL.md", "utf8");
const fm = raw.match(/^---\n([\s\S]*?)\n---/);
if (!fm) { console.error("BLOCKED: AI_CONTROL.md has no front-matter block."); process.exit(3); }
const cfg = {};
for (const line of fm[1].split("\n")) {
  const m = line.match(/^([a-z_]+):\s*(.*?)\s*(?:#.*)?$/);
  if (m) cfg[m[1]] = m[2] === "null" || m[2] === "" ? null : m[2];
}

// ── 1. has the remote moved? this is check #1 because it silently invalidates
//       every measurement taken downstream of a stale base.
const fetched = sh("git fetch origin main 2>&1");
if (fetched.__err) add("remote_reachable", "DRIFT", fetched.__err.split("\n")[0]);
const originMain = sh("git rev-parse --short origin/main");
if (originMain.__err) add("origin_main", "ERROR", originMain.__err);
else if (cfg.base_commit && !originMain.startsWith(cfg.base_commit) && !cfg.base_commit.startsWith(originMain))
  add("base_commit", "DRIFT", `claimed ${cfg.base_commit}, origin/main is ${originMain} — re-measure before trusting any prior result`);
else add("base_commit", "OK", originMain);

// ── 2. working tree
const dirty = sh("git status --porcelain");
add("working_tree", dirty === "" ? "OK" : "DRIFT", dirty === "" ? "clean" : `${dirty.split("\n").length} uncommitted path(s)`);

// ── 3. unpushed work
const ahead = sh("git rev-list --count origin/main..HEAD");
add("unpushed_commits", ahead === "0" ? "OK" : "INFO", `${ahead} local commit(s) not on origin/main`);

// ── 4. approved hash still describes the same bytes
if (cfg.approved_hash && cfg.approved_artifact) {
  if (!existsSync(cfg.approved_artifact)) add("approved_hash", "BLOCKED", `artifact missing: ${cfg.approved_artifact}`);
  else {
    const actual = sh(`git hash-object ${cfg.approved_artifact}`);
    add("approved_hash", actual === cfg.approved_hash ? "OK" : "BLOCKED",
        actual === cfg.approved_hash ? `${cfg.approved_hash} verified` : `approval was for ${cfg.approved_hash}, file is now ${actual} — GO is VOID`);
  }
} else add("approved_hash", "INFO", "no production write authorised");

// ── 5. every migration has a rollback — but ONLY from the mandate date forward.
//
// First run of this script flagged ~300 historical migrations and buried every
// other line in the report. A check that always fails is a check nobody reads,
// and this project already has three gates that were green because they were
// looking at the wrong thing. The rule applies to new work; the backlog is a
// separate, deliberate decision, not a per-run alarm.
const migDir = "supabase/migrations", rbDir = "supabase/rollback";
const floor = cfg.rollback_required_from ?? "20260813000000";
if (existsSync(migDir) && existsSync(rbDir)) {
  const all = sh(`ls ${migDir}`).split("\n").filter((f) => f.endsWith(".sql") && !f.includes("ROLLBACK"));
  const inScope = all.filter((f) => (f.match(/^(\d{14})/)?.[1] ?? "0") >= floor);
  const rbs = new Set(sh(`ls ${rbDir}`).split("\n"));
  const missing = inScope.filter((m) => !rbs.has(m.replace(/\.sql$/, "_ROLLBACK.sql")));
  add("rollback_coverage", missing.length ? "DRIFT" : "OK",
      missing.length ? `no rollback for: ${missing.join(", ")}`
                     : `${inScope.length}/${inScope.length} since ${floor} (${all.length - inScope.length} older migrations out of scope)`);
}

// ── 6. the applied migration version — not knowable from here
add("db_migration", "REQUIRES_CONNECTOR", `claimed ${cfg.db_migration}; verify with list_migrations and record in AI_EVIDENCE.md`);

// ── 7. state machine sanity
const STATES = ["DESIGN","APPROVED","IMPLEMENTING","LOCAL_VERIFICATION","READY_FOR_REVIEW","APPROVED_FOR_PRODUCTION","DEPLOYED","POST_DEPLOY_VERIFICATION","CLOSED","BLOCKED"];
add("state", STATES.includes(cfg.state) ? "OK" : "ERROR", cfg.state ?? "<unset>");
if (cfg.state === "BLOCKED") add("blocked_reason", cfg.blocked_reason ? "BLOCKED" : "ERROR", cfg.blocked_reason ?? "state is BLOCKED with no reason recorded");

// ── report
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nCONTROL — ${cfg.project ?? "?"} — phase ${cfg.phase ?? "?"} — ${cfg.state ?? "?"}\n`);
for (const r of rows) console.log(`  ${pad(r.status, 20)} ${pad(r.name, 22)} ${r.detail ?? ""}`);
const verdict = worst === 0 ? "READY" : worst === 1 ? "DRIFT" : "BLOCKED";
console.log(`\n  VERDICT: ${verdict}`);
console.log(`  NEXT:    ${cfg.next_action ?? "<unset>"}`);
if (verdict !== "READY") console.log(`\n  Reconcile before continuing. Do not proceed on a stale base.`);
console.log("");
process.exit(worst === 0 ? 0 : worst === 1 ? 1 : 2);
