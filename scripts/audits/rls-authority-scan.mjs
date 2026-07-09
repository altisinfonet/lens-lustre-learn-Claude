#!/usr/bin/env node
/**
 * Phase 0B-6 — RLS / SECURITY DEFINER Authority Guardrail
 * ----------------------------------------------------------------
 * Forensic, READ-ONLY scanner. Walks supabase/migrations/**.sql plus
 * any *.sql under supabase/functions/** and reports new occurrences
 * of the 8 forbidden RLS authority patterns documented in
 * docs/fix-sprints/sprint-0-phase-0b-6-rls-authority-guardrail.md
 * against a frozen baseline.
 *
 * Mandate: zero runtime change, zero policy change, detection only.
 *
 *   Usage:
 *     node scripts/audits/rls-authority-scan.mjs           # check vs baseline
 *     node scripts/audits/rls-authority-scan.mjs --write   # regenerate baseline
 *     node scripts/audits/rls-authority-scan.mjs --json    # emit findings JSON
 *
 *   Exit:
 *     0 = no NEW violations beyond baseline
 *     1 = NEW violations detected (CI fails)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = join(
  ROOT,
  "scripts/audits/baselines/rls-authority-baseline.json",
);

// Sensitive subsystem table fragments. A table name matching any of these
// substrings is considered "sensitive" for patterns 3, 4, 8.
const SENSITIVE_TABLE_FRAGMENTS = [
  // judging
  "judge", "judging", "decision", "score", "round", "consensus", "verification",
  "placement", "stage", "criteria",
  // wallet / payments / finance
  "wallet", "ledger", "transaction", "payment", "payout", "deposit",
  "withdrawal", "gift", "referral", "earning", "invoice",
  // admin / moderation / roles
  "admin", "moderation", "role", "audit", "user_roles", "device_session",
  // notifications + email queue
  "notification", "email_queue", "emit_log",
  // certificates + competition privacy + entries
  "certificate", "competition_entries", "entry_", "photo_meta", "submission",
  // storage buckets considered sensitive (string match on bucket id)
  "verification-originals", "wallet-receipts", "judge-",
];

const isSensitive = (name) => {
  if (!name) return false;
  const n = name.toLowerCase();
  return SENSITIVE_TABLE_FRAGMENTS.some((f) => n.includes(f));
};

// ---- Walk SQL files ----------------------------------------------------------
const SQL_DIRS = ["supabase/migrations", "supabase/functions"];
function walkSql(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walkSql(p));
    else if (p.endsWith(".sql")) out.push(p);
  }
  return out;
}

const files = SQL_DIRS.flatMap((d) => walkSql(join(ROOT, d)));

// ---- Pattern detectors -------------------------------------------------------
// Each returns array of { line, type, severity, table, name, snippet, mitigation }

function detectSecurityDefiner(src) {
  const findings = [];
  // Match CREATE [OR REPLACE] FUNCTION ... blocks; capture body until next AS $$ ... $$
  const fnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\(([^)]*)\)[\s\S]*?AS\s+\$([\w]*)\$([\s\S]*?)\$\3\$/gi;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    const fnHeader = m[0].slice(0, m[0].indexOf(`AS $${m[3]}$`));
    if (!/SECURITY\s+DEFINER/i.test(fnHeader)) continue;
    const body = m[4];
    const name = m[1];
    const offset = m.index;
    const line = src.slice(0, offset).split("\n").length;
    const hasAuthGuard = /(auth\.uid\s*\(\s*\)|has_role\s*\(|current_setting\s*\(\s*'request\.jwt|current_user\b|session_user\b|app\.current_admin)/i.test(body);
    const hasAuditPath = /(insert\s+into\s+(public\.)?(db_audit_logs|activity_logs|notification_emit_log|wallet_reconciliation_log)|emit_notification\s*\()/i.test(body);
    if (!hasAuthGuard) {
      findings.push({
        line,
        type: "SECDEF_NO_AUTH_GUARD",
        severity: "HIGH",
        name,
        snippet: fnHeader.replace(/\s+/g, " ").slice(0, 140),
        mitigation: hasAuditPath ? "audit-only" : "none",
      });
    } else if (!hasAuditPath && /\b(insert|update|delete)\b/i.test(body)) {
      findings.push({
        line,
        type: "SECDEF_NO_AUDIT_PATH",
        severity: "MEDIUM",
        name,
        snippet: fnHeader.replace(/\s+/g, " ").slice(0, 140),
        mitigation: "auth-guard-present",
      });
    }
  }
  return findings;
}

function detectPermissivePolicy(src) {
  const findings = [];
  // CREATE POLICY ... ON <table> ... USING (true)  or  WITH CHECK (true)
  const polRe = /CREATE\s+POLICY\s+"?([^"\s]+)"?\s+ON\s+([\w.]+)([\s\S]*?);/gi;
  let m;
  while ((m = polRe.exec(src)) !== null) {
    const polName = m[1];
    const table = m[2];
    const body = m[3];
    const offset = m.index;
    const line = src.slice(0, offset).split("\n").length;
    const usingTrue = /USING\s*\(\s*true\s*\)/i.test(body);
    const checkTrue = /WITH\s+CHECK\s*\(\s*true\s*\)/i.test(body);
    if ((usingTrue || checkTrue) && isSensitive(table)) {
      const isWriteCmd = /\bFOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(body);
      findings.push({
        line,
        type: checkTrue && isWriteCmd ? "PERMISSIVE_WRITE_TRUE" : "PERMISSIVE_USING_TRUE",
        severity: checkTrue && isWriteCmd ? "CRITICAL" : "HIGH",
        table,
        name: polName,
        snippet: `${polName} ON ${table}`,
        mitigation: "none",
      });
    }
  }
  return findings;
}

function detectDisableRls(src) {
  const findings = [];
  const re = /ALTER\s+TABLE\s+([\w.]+)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const table = m[1];
    const line = src.slice(0, m.index).split("\n").length;
    findings.push({
      line,
      type: "RLS_DISABLED",
      severity: isSensitive(table) ? "CRITICAL" : "HIGH",
      table,
      name: null,
      snippet: m[0],
      mitigation: "none",
    });
  }
  return findings;
}

function detectAnonGrants(src) {
  const findings = [];
  // GRANT INSERT/UPDATE/DELETE/ALL ON <obj> TO anon|public
  const re = /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL[^O]*)\s+ON\s+(?:TABLE\s+)?([\w.]+)\s+TO\s+(anon|public)\b/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const verb = m[1].trim().toUpperCase();
    const obj = m[2];
    const grantee = m[3];
    const line = src.slice(0, m.index).split("\n").length;
    const isWrite = /INSERT|UPDATE|DELETE|ALL/.test(verb);
    if (isWrite && isSensitive(obj)) {
      findings.push({
        line,
        type: "ANON_WRITE_GRANT",
        severity: "CRITICAL",
        table: obj,
        name: `GRANT ${verb} TO ${grantee}`,
        snippet: m[0],
        mitigation: "none",
      });
    } else if (isSensitive(obj) && grantee === "anon") {
      findings.push({
        line,
        type: "ANON_READ_GRANT_SENSITIVE",
        severity: "MEDIUM",
        table: obj,
        name: `GRANT ${verb} TO ${grantee}`,
        snippet: m[0],
        mitigation: "none",
      });
    }
  }
  return findings;
}

function detectDangerousRoleCast(src) {
  const findings = [];
  // ::app_role applied to user-controllable input (raw_user_meta, request.jwt claims)
  const re = /(raw_user_meta_data|jwt[^,)]*claims?|request\.jwt|user_metadata)[^;]{0,160}::\s*app_role/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    findings.push({
      line,
      type: "DANGEROUS_ROLE_CAST",
      severity: "CRITICAL",
      name: null,
      snippet: m[0].replace(/\s+/g, " ").slice(0, 140),
      mitigation: "none",
    });
  }
  return findings;
}

function detectPublicBucket(src) {
  const findings = [];
  // INSERT INTO storage.buckets (...) VALUES (..., true)  -- public flag
  const re = /storage\.buckets[\s\S]{0,200}VALUES\s*\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*true/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const bucket = m[1];
    const line = src.slice(0, m.index).split("\n").length;
    if (isSensitive(bucket)) {
      findings.push({
        line,
        type: "PUBLIC_SENSITIVE_BUCKET",
        severity: "CRITICAL",
        table: `storage.buckets:${bucket}`,
        name: bucket,
        snippet: m[0].replace(/\s+/g, " ").slice(0, 140),
        mitigation: "none",
      });
    }
  }
  return findings;
}

// ---- Run ---------------------------------------------------------------------
function subsystemFor(table) {
  if (!table) return "unknown";
  const t = table.toLowerCase();
  if (/judge|judging|decision|score|round|consensus|verification|placement|stage|criteria/.test(t)) return "judging";
  if (/wallet|ledger|transaction|payment|payout|deposit|withdrawal|gift|referral|earning|invoice/.test(t)) return "wallet";
  if (/notification|email_queue|emit_log/.test(t)) return "notifications";
  if (/role|admin|audit|moderation/.test(t)) return "admin";
  if (/certificate/.test(t)) return "certificates";
  if (/competition|entry|photo_meta|submission/.test(t)) return "competition";
  if (/storage\.buckets/.test(t)) return "storage";
  return "other";
}

const findings = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  const all = [
    ...detectSecurityDefiner(src),
    ...detectPermissivePolicy(src),
    ...detectDisableRls(src),
    ...detectAnonGrants(src),
    ...detectDangerousRoleCast(src),
    ...detectPublicBucket(src),
  ];
  for (const f of all) {
    findings.push({
      file: rel,
      line: f.line,
      type: f.type,
      severity: f.severity,
      subsystem: subsystemFor(f.table || f.name || ""),
      table: f.table || null,
      name: f.name,
      snippet: f.snippet,
      mitigation: f.mitigation,
    });
  }
}

const args = new Set(process.argv.slice(2));

if (args.has("--json")) {
  process.stdout.write(JSON.stringify(findings, null, 2));
  process.exit(0);
}

// Stable key: file + line + type + name (snippet/mitigation may drift over time)
const keyOf = (f) => `${f.file}:${f.line}:${f.type}:${f.name ?? ""}`;

if (args.has("--write")) {
  const baseline = {
    generated_at: new Date().toISOString(),
    description:
      "Phase 0B-6 frozen baseline of pre-existing RLS / SECURITY DEFINER findings. New entries beyond this set fail CI. See docs/fix-sprints/sprint-0-phase-0b-6-rls-authority-guardrail.md.",
    total: findings.length,
    by_type: findings.reduce((acc, f) => ((acc[f.type] = (acc[f.type] || 0) + 1), acc), {}),
    by_severity: findings.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc), {}),
    by_subsystem: findings.reduce((acc, f) => ((acc[f.subsystem] = (acc[f.subsystem] || 0) + 1), acc), {}),
    findings: findings
      .map((f) => ({ ...f, key: keyOf(f) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`[rls-authority-scan] wrote ${findings.length} baseline findings → ${relative(ROOT, BASELINE_PATH)}`);
  process.exit(0);
}

// Compare vs baseline
let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error(`[rls-authority-scan] FATAL: baseline missing at ${BASELINE_PATH}. Run with --write once to seed.`);
  process.exit(2);
}
const baselineKeys = new Set((baseline.findings || []).map((f) => f.key));
const newViolations = findings.filter((f) => !baselineKeys.has(keyOf(f)));

if (newViolations.length > 0) {
  console.error(`[rls-authority-scan] ❌ ${newViolations.length} NEW RLS authority violation(s) beyond baseline:\n`);
  for (const v of newViolations) {
    console.error(`  ${v.severity.padEnd(8)} ${v.type.padEnd(28)} ${v.file}:${v.line}  (${v.subsystem})`);
    console.error(`           ${v.snippet}`);
  }
  console.error(`\nIf these are intentional + reviewed, regenerate baseline with:`);
  console.error(`  node scripts/audits/rls-authority-scan.mjs --write`);
  console.error(`Otherwise, fix the migration before merge. See docs/fix-sprints/sprint-0-phase-0b-6-rls-authority-guardrail.md`);
  process.exit(1);
}

console.log(`[rls-authority-scan] ✅ 0 NEW RLS authority violations (baseline=${baseline.total}, current=${findings.length})`);
process.exit(0);
