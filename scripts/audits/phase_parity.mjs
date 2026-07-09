/**
 * R5 Phase Parity Audit
 * ----------------------
 * Proves that public.current_phase(uuid) (DB) and resolveCompetitionPhase()
 * (client TS) return identical phase strings for 100 sample competition
 * shapes (1 live row + 99 synthetic shapes covering every branch).
 *
 * Run: node scripts/audits/phase_parity.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Inline copy of resolveCompetitionPhase to avoid bundler — must stay
// byte-identical to src/lib/competitionPhase.ts
function resolveCompetitionPhase(comp) {
  if (comp.status === "archived") return "archived";
  const now = new Date();
  if (comp.starts_at && comp.ends_at) {
    const start = new Date(comp.starts_at);
    const end = new Date(comp.ends_at);
    const votingEnd = comp.voting_ends_at ? new Date(comp.voting_ends_at) : end;
    if (now < start) return "upcoming";
    if (now >= start && now <= end) return "submission_open";
    if (now > end && now <= votingEnd) return "voting";
    if (comp.judging_completed) return "result";
    return "judging";
  }
  if (comp.phase && comp.phase !== "") return comp.phase;
  if (comp.status) {
    switch (comp.status) {
      case "draft": case "open": case "upcoming": return "submission_open";
      case "active": case "judging": return "judging";
      case "closed": case "completed": return "result";
      default: return "submission_open";
    }
  }
  return "submission_open";
}

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n").filter(Boolean)
    .map((l) => l.split("=").map((s) => s.trim().replace(/^"|"$/g, "")))
);
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const sb = createClient(url, key);

// 1. Live rows
const { data: liveRows, error } = await sb.rpc("audit_phase_parity", { sample_limit: 100 });
if (error) { console.error("RPC error:", error); process.exit(1); }
console.log(`Live rows fetched: ${liveRows.length}`);

// 2. Synthetic shapes — exercise every branch of the algorithm
const now = Date.now();
const D = (offsetMs) => new Date(now + offsetMs).toISOString();
const HOUR = 3600 * 1000, DAY = 24 * HOUR;

const shapes = [];
for (let i = 0; i < 99; i++) {
  const branch = i % 11;
  let s;
  switch (branch) {
    case 0: s = { status: "archived", starts_at: D(-DAY), ends_at: D(DAY), voting_ends_at: D(2*DAY), judging_completed: false }; break;
    case 1: s = { status: "active", starts_at: D(2*DAY), ends_at: D(5*DAY), voting_ends_at: D(6*DAY), judging_completed: false }; break; // upcoming
    case 2: s = { status: "active", starts_at: D(-DAY), ends_at: D(DAY), voting_ends_at: D(2*DAY), judging_completed: false }; break; // submission_open
    case 3: s = { status: "active", starts_at: D(-2*DAY), ends_at: D(-HOUR), voting_ends_at: D(DAY), judging_completed: false }; break; // voting
    case 4: s = { status: "active", starts_at: D(-5*DAY), ends_at: D(-3*DAY), voting_ends_at: D(-2*DAY), judging_completed: true }; break; // result
    case 5: s = { status: "active", starts_at: D(-5*DAY), ends_at: D(-3*DAY), voting_ends_at: D(-2*DAY), judging_completed: false }; break; // judging
    case 6: s = { status: "active", starts_at: D(-DAY), ends_at: D(DAY), voting_ends_at: null, judging_completed: false }; break; // null voting_ends_at
    case 7: s = { status: "draft", starts_at: null, ends_at: null, voting_ends_at: null, judging_completed: false, phase: null }; break; // legacy status
    case 8: s = { status: "completed", starts_at: null, ends_at: null, voting_ends_at: null, judging_completed: false, phase: null }; break;
    case 9: s = { status: "active", starts_at: null, ends_at: null, voting_ends_at: null, judging_completed: false, phase: "voting" }; break; // legacy phase
    case 10: s = { status: "judging", starts_at: null, ends_at: null, voting_ends_at: null, judging_completed: true, phase: null }; break;
  }
  shapes.push({ idx: i, ...s });
}

let total = 0, mismatches = [];

// Live rows: TS vs SQL
for (const row of liveRows) {
  total++;
  const tsPhase = resolveCompetitionPhase(row);
  if (tsPhase !== row.db_phase) mismatches.push({ id: row.id, ts: tsPhase, sql: row.db_phase, kind: "live" });
}

// Synthetic shapes: TS vs SQL via stateless current_phase_for()
for (const s of shapes) {
  total++;
  const tsPhase = resolveCompetitionPhase(s);
  const { data: sqlPhase, error: e } = await sb.rpc("current_phase_for", {
    p_status: s.status ?? null,
    p_starts_at: s.starts_at ?? null,
    p_ends_at: s.ends_at ?? null,
    p_voting_ends_at: s.voting_ends_at ?? null,
    p_judging_completed: s.judging_completed ?? null,
    p_legacy_phase: s.phase ?? null,
  });
  if (e) { console.error("rpc err", e); process.exit(1); }
  if (tsPhase !== sqlPhase) mismatches.push({ idx: s.idx, shape: s, ts: tsPhase, sql: sqlPhase, kind: "synthetic" });
}

console.log(`\n=== R5 PARITY AUDIT ===`);
console.log(`Live rows (TS vs SQL):           ${liveRows.length}`);
console.log(`Synthetic shapes (TS vs SQL):    ${shapes.length}`);
console.log(`Total samples:                   ${total}`);
console.log(`Mismatches:                      ${mismatches.length}`);
if (mismatches.length) { console.log(JSON.stringify(mismatches, null, 2)); process.exit(1); }
else console.log(`✅ All ${total} samples returned identical phase from client TS + DB SQL.`);
