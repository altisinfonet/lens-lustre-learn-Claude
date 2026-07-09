#!/usr/bin/env node
/**
 * Phase 0B-7 — Migration / Schema Drift Guardrail
 * ----------------------------------------------------------------
 * Read-only forensic scanner. Walks supabase/migrations/**.sql and
 * detects 9 forbidden destructive / drift patterns against frozen baselines:
 *
 *   1.  DROP COLUMN on a protected table
 *   2.  ALTER TYPE / ALTER COLUMN ... TYPE on protected column
 *   3.  RENAME COLUMN on finance / judging table
 *   4.  destructive enum mutation (ALTER TYPE ... DROP VALUE / RENAME VALUE)
 *   5.  removal of status/round/progression_decision columns
 *   6.  CREATE FUNCTION ... SECURITY DEFINER not in the SECDEF baseline
 *   7.  ALTER TABLE ... DISABLE ROW LEVEL SECURITY on protected table
 *   8.  DROP POLICY on protected table
 *   9.  DROP / ALTER FUNCTION signature change on a baseline-listed RPC
 *
 * Mandate: zero runtime change, zero schema change. Detection only.
 *
 *   Usage:
 *     node scripts/audits/schema-drift-scan.mjs              # check vs baselines
 *     node scripts/audits/schema-drift-scan.mjs --write      # regenerate both baselines
 *     node scripts/audits/schema-drift-scan.mjs --json       # findings JSON
 *
 *   Exit 0 = no NEW drift, 1 = NEW drift detected.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCHEMA_BASELINE = join(ROOT, "scripts/audits/baselines/schema-contract-baseline.json");
const RPC_BASELINE    = join(ROOT, "scripts/audits/baselines/rpc-contract-baseline.json");

// ---- Protected contracts -----------------------------------------------------
// PROTECTED_TABLES are matched as substrings on any referenced table.
const PROTECTED_TABLES = [
  // wallet / finance
  "wallet_transactions", "wallet_balances", "wallet_reconciliation_log",
  "transactions", "payouts", "deposits", "withdrawals", "gifts",
  "referrals", "earnings", "invoices", "orders",
  // judging
  "judge_decisions", "judge_scores", "judge_sessions", "judge_assignments",
  "competition_entries", "competition_rounds", "competitions",
  "photo_verification_requests", "verification_requests",
  "v3_stage_catalog", "stage_catalog", "criteria",
  // notifications
  "notifications", "user_notifications", "notification_emit_log",
  "notification_preferences", "email_queue",
  // roles / admin / audit
  "user_roles", "admin_actions", "db_audit_logs", "activity_logs",
  "moderation", "admin_notifications",
  // certificates + visibility
  "certificates", "certificate_recipients",
  // entries+status
  "entry_public_status",
];

// PROTECTED_COLUMNS are *substring* matches on column tokens that must never
// be silently dropped, retyped, or renamed.
const PROTECTED_COLUMNS = [
  "amount", "balance", "currency",
  "status", "current_round", "progression_decision", "placement",
  "user_id", "judge_id", "competition_id", "entry_id",
  "decision", "score", "tier", "stage_key", "tag_label_canonical",
  "verification_status", "auto_expired", "declared_at", "locked_at",
  "indexing_disabled", "is_active",
];

const isProtectedTable = (name) => {
  if (!name) return false;
  const n = name.toLowerCase().replace(/^public\./, "");
  return PROTECTED_TABLES.some((t) => n === t || n.endsWith(`.${t}`) || n.includes(t));
};
const isProtectedColumn = (name) => {
  if (!name) return false;
  const n = name.toLowerCase().replace(/[`"]/g, "");
  return PROTECTED_COLUMNS.some((c) => n === c || n.endsWith(`_${c}`) || n.includes(c));
};

// ---- Walk SQL ----------------------------------------------------------------
function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".sql")) out.push(p);
  }
  return out;
}
const files = walk(join(ROOT, "supabase/migrations")).sort();

// ---- Detectors ---------------------------------------------------------------
function detectAll(src, rel) {
  const findings = [];
  const lineOf = (idx) => src.slice(0, idx).split("\n").length;
  const push = (line, type, severity, target, snippet) =>
    findings.push({ file: rel, line, type, severity, target, snippet: snippet.replace(/\s+/g, " ").slice(0, 160) });

  // 1+5. ALTER TABLE <t> ... DROP COLUMN <c>
  for (const m of src.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s+[\s\S]{0,400}?DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi)) {
    const [, tbl, col] = m;
    if (isProtectedTable(tbl)) {
      const isStatusish = /^(status|current_round|progression_decision|placement)$/i.test(col);
      push(lineOf(m.index), isStatusish ? "DROP_STATUS_COLUMN" : "DROP_PROTECTED_COLUMN",
           isStatusish ? "CRITICAL" : "HIGH", `${tbl}.${col}`, m[0]);
    } else if (isProtectedColumn(col)) {
      push(lineOf(m.index), "DROP_PROTECTED_COLUMN", "MEDIUM", `${tbl}.${col}`, m[0]);
    }
  }
  // 2. ALTER COLUMN ... TYPE  on protected col
  for (const m of src.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s+[\s\S]{0,400}?ALTER\s+COLUMN\s+["`]?(\w+)["`]?\s+(?:SET\s+DATA\s+)?TYPE\s+([\w.()\s,]+)/gi)) {
    const [, tbl, col, newType] = m;
    if (isProtectedTable(tbl) && isProtectedColumn(col)) {
      push(lineOf(m.index), "ALTER_PROTECTED_COLUMN_TYPE", "CRITICAL",
           `${tbl}.${col}→${newType.trim()}`, m[0]);
    }
  }
  // 3. RENAME COLUMN on protected table
  for (const m of src.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s+[\s\S]{0,200}?RENAME\s+COLUMN\s+["`]?(\w+)["`]?\s+TO\s+["`]?(\w+)["`]?/gi)) {
    const [, tbl, oldC, newC] = m;
    if (isProtectedTable(tbl)) {
      push(lineOf(m.index), "RENAME_PROTECTED_COLUMN", "HIGH",
           `${tbl}.${oldC}→${newC}`, m[0]);
    }
  }
  // 4. destructive enum mutation
  for (const m of src.matchAll(/ALTER\s+TYPE\s+([\w.]+)\s+(DROP\s+VALUE|RENAME\s+VALUE)\b[^;]*/gi)) {
    push(lineOf(m.index), "DESTRUCTIVE_ENUM_MUTATION", "CRITICAL", m[1], m[0]);
  }
  // 7. DISABLE RLS on protected
  for (const m of src.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) {
    if (isProtectedTable(m[1])) {
      push(lineOf(m.index), "RLS_DISABLED_PROTECTED", "CRITICAL", m[1], m[0]);
    }
  }
  // 8. DROP POLICY on protected
  for (const m of src.matchAll(/DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?["']?([^"' \s]+)["']?\s+ON\s+([\w.]+)/gi)) {
    if (isProtectedTable(m[2])) {
      push(lineOf(m.index), "DROP_POLICY_PROTECTED", "HIGH", `${m[2]}::${m[1]}`, m[0]);
    }
  }
  // DROP TABLE on protected
  for (const m of src.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.,\s]+?)(?:\s+CASCADE)?\s*;/gi)) {
    const tables = m[1].split(",").map((t) => t.trim());
    for (const t of tables) {
      if (isProtectedTable(t)) {
        push(lineOf(m.index), "DROP_PROTECTED_TABLE", "CRITICAL", t, m[0]);
      }
    }
  }
  return findings;
}

// ---- RPC + SECDEF + enum extractors (for baselines) -------------------------
function extractContracts(src, rel) {
  const rpcs = [];
  const secdefs = [];
  const enums = [];

  // CREATE [OR REPLACE] FUNCTION public.x(args) RETURNS ...
  const fnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\(([^)]*)\)([\s\S]*?)(?:AS\s+\$|LANGUAGE\s+sql\s+(?:STABLE|IMMUTABLE|VOLATILE)?\s*AS\s+\$)/gi;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    const name = m[1].toLowerCase();
    const argsRaw = m[2].trim().replace(/\s+/g, " ");
    const header = m[3];
    const isSecdef = /SECURITY\s+DEFINER/i.test(header);
    // normalized signature: name(typesonly)
    const types = argsRaw
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => {
        // "arg type" or "type" — keep last token chunk
        const parts = a.replace(/\bDEFAULT\b[\s\S]*$/i, "").trim().split(/\s+/);
        return (parts.length > 1 ? parts.slice(1).join(" ") : parts[0]).toLowerCase();
      });
    const sig = `${name}(${types.join(",")})`;
    rpcs.push({ file: rel, name, signature: sig, args: argsRaw });
    if (isSecdef) secdefs.push({ file: rel, name, signature: sig });
  }
  // CREATE TYPE x AS ENUM (...)
  for (const e of src.matchAll(/CREATE\s+TYPE\s+([\w.]+)\s+AS\s+ENUM\s*\(([^)]+)\)/gi)) {
    const name = e[1].toLowerCase();
    const values = e[2]
      .split(",")
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    enums.push({ file: rel, name, values });
  }
  return { rpcs, secdefs, enums };
}

// ---- Run ---------------------------------------------------------------------
const allFindings = [];
const allRpcs = [];
const allSecdefs = [];
const allEnums = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  allFindings.push(...detectAll(src, rel));
  const c = extractContracts(src, rel);
  allRpcs.push(...c.rpcs);
  allSecdefs.push(...c.secdefs);
  allEnums.push(...c.enums);
}

// 6 + 9 — SECDEF + RPC drift detection happen against baselines
const args = new Set(process.argv.slice(2));
const findingKey = (f) => `${f.file}:${f.line}:${f.type}:${f.target}`;

if (args.has("--json")) {
  process.stdout.write(JSON.stringify({ findings: allFindings, rpcs: allRpcs, secdefs: allSecdefs, enums: allEnums }, null, 2));
  process.exit(0);
}

if (args.has("--write")) {
  // Schema-contract baseline: protected tables/columns currently observed +
  // frozen enum value sets + frozen SECDEF list + raw destructive findings.
  const schemaBaseline = {
    generated_at: new Date().toISOString(),
    description:
      "Phase 0B-7 frozen schema-contract baseline. PROTECTED_TABLES + PROTECTED_COLUMNS define the policy oracle. Enum value sets and SECDEF function list are frozen — additions allowed via baseline regen, removals/renames fail CI.",
    protected_tables: PROTECTED_TABLES,
    protected_columns: PROTECTED_COLUMNS,
    enums: dedupeBy(allEnums, (e) => e.name).sort((a, b) => a.name.localeCompare(b.name)),
    secdef_functions: dedupeBy(allSecdefs, (s) => s.signature)
      .map(({ name, signature }) => ({ name, signature }))
      .sort((a, b) => a.signature.localeCompare(b.signature)),
    destructive_findings: allFindings
      .map((f) => ({ ...f, key: findingKey(f) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    counts: {
      enums: dedupeBy(allEnums, (e) => e.name).length,
      secdef_functions: dedupeBy(allSecdefs, (s) => s.signature).length,
      destructive_findings: allFindings.length,
    },
  };
  writeFileSync(SCHEMA_BASELINE, JSON.stringify(schemaBaseline, null, 2) + "\n");
  console.log(`[schema-drift-scan] wrote schema baseline → ${relative(ROOT, SCHEMA_BASELINE)} (${schemaBaseline.counts.destructive_findings} destructive, ${schemaBaseline.counts.enums} enums, ${schemaBaseline.counts.secdef_functions} secdef)`);

  // RPC-contract baseline: signature-only, dedup latest
  const latestRpc = new Map();
  for (const r of allRpcs) latestRpc.set(r.name, r); // last wins (later migrations override)
  const rpcBaseline = {
    generated_at: new Date().toISOString(),
    description:
      "Phase 0B-7 frozen RPC contract baseline. Each RPC is keyed by qualified function name; signature lists positional argument types only. Removal of a baseline RPC, or a signature change, fails CI.",
    total: latestRpc.size,
    rpcs: Array.from(latestRpc.values())
      .map(({ name, signature }) => ({ name, signature }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeFileSync(RPC_BASELINE, JSON.stringify(rpcBaseline, null, 2) + "\n");
  console.log(`[schema-drift-scan] wrote RPC baseline    → ${relative(ROOT, RPC_BASELINE)} (${rpcBaseline.total} RPCs)`);
  process.exit(0);
}

function dedupeBy(arr, key) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// ---- Compare vs baselines ---------------------------------------------------
let schemaBaseline, rpcBaseline;
try {
  schemaBaseline = JSON.parse(readFileSync(SCHEMA_BASELINE, "utf8"));
  rpcBaseline = JSON.parse(readFileSync(RPC_BASELINE, "utf8"));
} catch {
  console.error("[schema-drift-scan] FATAL: baselines missing. Run with --write once to seed.");
  process.exit(2);
}

const baselineFindingKeys = new Set((schemaBaseline.destructive_findings || []).map((f) => f.key));
const newDestructive = allFindings.filter((f) => !baselineFindingKeys.has(findingKey(f)));

// SECDEF drift (rule 6): any new SECDEF signature not in baseline
const baselineSecdefSigs = new Set((schemaBaseline.secdef_functions || []).map((s) => s.signature));
const currentSecdefSigs = new Set(allSecdefs.map((s) => s.signature));
const newSecdefs = [...currentSecdefSigs].filter((s) => !baselineSecdefSigs.has(s));

// Enum mutation (rule 4 follow-up): values dropped or renamed
const baselineEnums = new Map((schemaBaseline.enums || []).map((e) => [e.name, new Set(e.values)]));
const currentEnums = new Map();
for (const e of allEnums) {
  if (!currentEnums.has(e.name)) currentEnums.set(e.name, new Set());
  // accumulate union of values across all migrations (ALTER TYPE ... ADD VALUE handled separately)
  for (const v of e.values) currentEnums.get(e.name).add(v);
}
// also pick up ALTER TYPE ... ADD VALUE
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/ALTER\s+TYPE\s+([\w.]+)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?['"]([^'"]+)['"]/gi)) {
    const name = m[1].toLowerCase();
    if (!currentEnums.has(name)) currentEnums.set(name, new Set());
    currentEnums.get(name).add(m[2]);
  }
}
const enumValueDrops = [];
for (const [name, baseSet] of baselineEnums) {
  const curSet = currentEnums.get(name);
  if (!curSet) {
    enumValueDrops.push({ name, dropped: [...baseSet], reason: "ENUM_REMOVED" });
    continue;
  }
  const dropped = [...baseSet].filter((v) => !curSet.has(v));
  if (dropped.length) enumValueDrops.push({ name, dropped, reason: "ENUM_VALUES_REMOVED" });
}

// RPC drift (rule 9): signature change or removal
const baselineRpcs = new Map((rpcBaseline.rpcs || []).map((r) => [r.name, r.signature]));
const currentRpcSigs = new Map();
for (const r of allRpcs) currentRpcSigs.set(r.name, r.signature); // last-wins
const rpcDrift = [];
for (const [name, sig] of baselineRpcs) {
  const cur = currentRpcSigs.get(name);
  if (!cur) rpcDrift.push({ name, type: "RPC_REMOVED", baseline: sig, current: null });
  else if (cur !== sig) rpcDrift.push({ name, type: "RPC_SIGNATURE_CHANGED", baseline: sig, current: cur });
}

const totalNew =
  newDestructive.length + newSecdefs.length + enumValueDrops.length + rpcDrift.length;

if (totalNew === 0) {
  console.log(`[schema-drift-scan] ✅ 0 NEW schema drift events. baseline { destructive=${schemaBaseline.destructive_findings.length}, secdef=${schemaBaseline.secdef_functions.length}, enums=${schemaBaseline.enums.length}, rpcs=${rpcBaseline.total} }`);
  process.exit(0);
}

console.error(`[schema-drift-scan] ❌ ${totalNew} NEW schema drift event(s):\n`);
if (newDestructive.length) {
  console.error(`  ── Destructive migrations (${newDestructive.length}) ──`);
  for (const f of newDestructive) {
    console.error(`    ${f.severity.padEnd(8)} ${f.type.padEnd(28)} ${f.file}:${f.line}  → ${f.target}`);
    console.error(`             ${f.snippet}`);
  }
}
if (newSecdefs.length) {
  console.error(`  ── New SECURITY DEFINER fns (${newSecdefs.length}) ──`);
  for (const s of newSecdefs) console.error(`    HIGH     SECDEF_NEW                 ${s}`);
}
if (enumValueDrops.length) {
  console.error(`  ── Enum value removals (${enumValueDrops.length}) ──`);
  for (const e of enumValueDrops) console.error(`    CRITICAL ${e.reason.padEnd(28)} ${e.name} dropped: ${e.dropped.join(", ")}`);
}
if (rpcDrift.length) {
  console.error(`  ── RPC contract drift (${rpcDrift.length}) ──`);
  for (const r of rpcDrift) console.error(`    HIGH     ${r.type.padEnd(28)} ${r.name}\n             baseline: ${r.baseline}\n             current : ${r.current}`);
}
console.error(`\nIf intentional + reviewed, regenerate baselines with:`);
console.error(`  node scripts/audits/schema-drift-scan.mjs --write`);
console.error(`Otherwise, fix the migration before merge. See docs/fix-sprints/sprint-0-phase-0b-7-schema-drift-guardrail.md`);
process.exit(1);
