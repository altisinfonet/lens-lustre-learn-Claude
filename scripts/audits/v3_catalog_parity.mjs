#!/usr/bin/env node
/**
 * v3 Stage Catalog Parity Audit — Judging v3 Phase Plan v2 · Step 5.2.
 *
 * Compares the live `v3_stage_catalog` rows in the database against the
 * client-side mirror in `src/lib/judging/stageCatalog.ts`.
 *
 * The DB and TS lists MUST be byte-identical for every active row across
 * the 9 fields below. Any drift = exit code 1 + JSON dump of the deltas,
 * suitable for failing CI on the very next push.
 *
 * Fields compared (per stage_key):
 *   - round_number, family, decision_token
 *   - tag_label_canonical
 *   - advances_to_round, blocks_from_round
 *   - cert_eligible, is_active
 *
 * Run:
 *   node scripts/audits/v3_catalog_parity.mjs
 *
 * Exit codes:
 *   0 → parity OK (counts equal AND every row matches)
 *   1 → drift detected (delta JSON printed to stdout)
 *   2 → infra error (missing env, missing TS file, RPC unreachable)
 *
 * NOTE: Anonymous Supabase access is sufficient — `v3_stage_catalog` is
 * public-read (admin-managed lookup table, no PII).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const TS_PATH = resolve(ROOT, "src/lib/judging/stageCatalog.ts");
const ENV_PATH = resolve(ROOT, ".env");

// ─── 0. Frozen 16-key contract (Phase 8 hard-assert) ───────────────────
// MUST stay in sync with src/lib/judging/stageCatalog.ts AND v3_stage_catalog.
// Editing this map is a contract break — bump the snapshot date in the doc
// and update both mem://judging/participant-wording-master-plan and
// mem://judging/r2-r3-no-needs-review in the same PR.
const EXPECTED_ACTIVE = {
  // Round 1 (4)
  r1_accepted:           "Accepted",
  r1_shortlisted_r2:     "Qualified for Round 2",
  r1_needs_verification: "Verification Required",
  r1_rejected:           "Rejected",
  // Round 2 (2)
  r2_accepted:           "Accepted in Round 2",
  r2_qualified_r3:       "Qualified for Round 3",
  // Round 3 (2)
  r3_accepted:           "Accepted in Round 3",
  r3_qualified_final:    "Qualified for Final Round",
  // Round 4 (8)
  r4_winner:             "Winner",
  r4_runner_up_1:        "1st Runner-Up",
  r4_runner_up_2:        "2nd Runner-Up",
  r4_honorary_mention:   "Honorary Mention",
  r4_special_jury:       "Special Jury Award",
  r4_top_50:             "Top 50 Global Photographer",
  r4_top_100:            "Top 100 Global Photographer",
  r4_finalist:           "Finalist (no placement)",
};
const EXPECTED_ACTIVE_COUNT = Object.keys(EXPECTED_ACTIVE).length; // = 16

// ─── 1. Load env (optional — DB diff skipped if absent) ────────────────
const env = existsSync(ENV_PATH)
  ? Object.fromEntries(
      readFileSync(ENV_PATH, "utf8")
        .split("\n")
        .filter((l) => l.trim() && !l.trim().startsWith("#"))
        .map((l) => {
          const idx = l.indexOf("=");
          if (idx < 0) return [l, ""];
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^"|"$/g, "")];
        }),
    )
  : {};
const url = env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY;
const usingServiceRole = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
const dbDiffEnabled = !!(url && key);
if (!dbDiffEnabled) {
  console.warn(
    "[v3_catalog_parity] WARN: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — " +
      "DB diff will be SKIPPED. TS-only contract assertions still run (16 rows + exact labels).",
  );
}

// ─── 2. Load TS mirror ──────────────────────────────────────────────────
if (!existsSync(TS_PATH)) {
  console.error(`[v3_catalog_parity] FATAL: TS catalog not found at ${TS_PATH}`);
  process.exit(2);
}
const tsSource = readFileSync(TS_PATH, "utf8");

/**
 * Crude but deterministic parser: extract every `{ stage_key: "...", ... }`
 * object literal between `STAGE_CATALOG = [` and the closing `]`. We avoid
 * pulling in a TS compiler — the TS file is hand-edited and uses a stable
 * `key: value,` shape proven by the parity test (Step 4.1).
 */
function parseTsCatalog(src) {
  const start = src.indexOf("STAGE_CATALOG");
  if (start < 0) throw new Error("STAGE_CATALOG marker not found in TS file");
  const arrStart = src.indexOf("[", start);
  if (arrStart < 0) throw new Error("STAGE_CATALOG array opener not found");
  // Find matching ']' by tracking bracket depth, skipping strings.
  let depth = 0, i = arrStart, inStr = null, end = -1;
  while (i < src.length) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
      else if (ch === "[") depth++;
      else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
    }
    i++;
  }
  if (end < 0) throw new Error("STAGE_CATALOG array closer not found");
  const body = src.slice(arrStart + 1, end);

  // Split into top-level object literals
  const objects = [];
  depth = 0; inStr = null;
  let buf = "";
  for (let j = 0; j < body.length; j++) {
    const ch = body[j];
    if (inStr) {
      buf += ch;
      if (ch === "\\") { buf += body[j + 1]; j++; continue; }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; buf += ch; }
      else if (ch === "{") { depth++; buf += ch; }
      else if (ch === "}") {
        depth--; buf += ch;
        if (depth === 0) { objects.push(buf); buf = ""; }
      } else if (depth > 0) buf += ch;
      else if (depth === 0 && ch !== "," && !/\s/.test(ch)) buf += ch;
    }
  }

  return objects.map((raw) => {
    const get = (k) => {
      const re = new RegExp(`${k}\\s*:\\s*(null|true|false|"[^"]*"|-?\\d+)`);
      const m = raw.match(re);
      if (!m) return undefined;
      const v = m[1];
      if (v === "null") return null;
      if (v === "true") return true;
      if (v === "false") return false;
      if (v.startsWith('"')) return v.slice(1, -1);
      return Number(v);
    };
    return {
      stage_key: get("stage_key"),
      round_number: get("round_number"),
      family: get("family"),
      decision_token: get("decision_token"),
      tag_label_canonical: get("tag_label_canonical"),
      advances_to_round: get("advances_to_round"),
      blocks_from_round: get("blocks_from_round"),
      cert_eligible: get("cert_eligible"),
      is_active: get("is_active"),
    };
  });
}

let tsRows;
try {
  tsRows = parseTsCatalog(tsSource).filter((r) => r.is_active === true);
} catch (e) {
  console.error(`[v3_catalog_parity] FATAL: failed to parse TS catalog — ${e.message}`);
  process.exit(2);
}

// ─── 2.5. TS-only HARD assertion (Phase 8 — runs even when DB unreachable) ─
//
// Asserts EXACTLY 16 active rows AND every (stage_key → tag_label_canonical)
// matches the frozen contract above. This is the gate that proves the CI
// catches a forbidden-label PR before any DB round-trip.
const tsContractDrift = [];
const tsByKeyAll = new Map(tsRows.map((r) => [r.stage_key, r]));
for (const [k, expectedLabel] of Object.entries(EXPECTED_ACTIVE)) {
  const r = tsByKeyAll.get(k);
  if (!r) {
    tsContractDrift.push({ stage_key: k, error: "missing in TS catalog (or is_active=false)" });
    continue;
  }
  if (r.tag_label_canonical !== expectedLabel) {
    tsContractDrift.push({
      stage_key: k,
      error: "label_drift",
      expected: expectedLabel,
      actual: r.tag_label_canonical,
    });
  }
}
const tsExtras = [...tsByKeyAll.keys()].filter((k) => !(k in EXPECTED_ACTIVE));
const tsCountOk = tsRows.length === EXPECTED_ACTIVE_COUNT;

if (!tsCountOk || tsContractDrift.length > 0 || tsExtras.length > 0) {
  console.error(
    `\n[v3_catalog_parity] TS CONTRACT BROKEN — expected ${EXPECTED_ACTIVE_COUNT} active rows, got ${tsRows.length}.`,
  );
  console.error(
    JSON.stringify({ ts_count: tsRows.length, drift: tsContractDrift, ts_extras: tsExtras }, null, 2),
  );
  console.error(
    "\nFix: align src/lib/judging/stageCatalog.ts with the EXPECTED_ACTIVE map at the top of this script,",
  );
  console.error(
    "or update EXPECTED_ACTIVE here AND in mem://judging/participant-wording-master-plan in the same PR.",
  );
  process.exit(1);
}
console.log(`[v3_catalog_parity] TS CONTRACT OK — ${tsRows.length}/${EXPECTED_ACTIVE_COUNT} active rows, all labels match.`);

// ─── 3. Fetch DB rows (skipped when no env / no key) ───────────────────
if (!dbDiffEnabled) {
  console.log("[v3_catalog_parity] DB diff skipped (no env). TS contract gate passed — exiting 0.");
  process.exit(0);
}

const sb = createClient(url, key);
const { data: dbRows, error } = await sb
  .from("v3_stage_catalog")
  .select(
    "stage_key, round_number, family, decision_token, tag_label_canonical, advances_to_round, blocks_from_round, cert_eligible, is_active",
  )
  .eq("is_active", true)
  .order("round_number", { ascending: true })
  .order("stage_key", { ascending: true });

if (error) {
  console.error("[v3_catalog_parity] FATAL: DB query failed:", error.message);
  process.exit(2);
}
if (!dbRows) {
  console.error("[v3_catalog_parity] FATAL: DB returned null (RLS denial?)");
  process.exit(2);
}
if (dbRows.length === 0 && !usingServiceRole) {
  console.warn(
    "[v3_catalog_parity] WARN: DB returned 0 rows using publishable key — v3_stage_catalog has authenticated-read RLS. " +
      "DB diff SKIPPED. Set SUPABASE_SERVICE_ROLE_KEY (CI secret) for full DB↔TS diff. TS contract gate already passed.",
  );
  process.exit(0);
}

// ─── 3.5. DB HARD assertion: exactly 16 rows + label match ─────────────
if (dbRows.length !== EXPECTED_ACTIVE_COUNT) {
  console.error(
    `\n[v3_catalog_parity] DB CONTRACT BROKEN — expected ${EXPECTED_ACTIVE_COUNT} active rows in v3_stage_catalog, got ${dbRows.length}.`,
  );
  process.exit(1);
}
const dbContractDrift = [];
for (const row of dbRows) {
  const expectedLabel = EXPECTED_ACTIVE[row.stage_key];
  if (expectedLabel === undefined) {
    dbContractDrift.push({ stage_key: row.stage_key, error: "unknown stage_key in DB" });
  } else if (row.tag_label_canonical !== expectedLabel) {
    dbContractDrift.push({
      stage_key: row.stage_key,
      error: "label_drift",
      expected: expectedLabel,
      actual: row.tag_label_canonical,
    });
  }
}
if (dbContractDrift.length > 0) {
  console.error(`\n[v3_catalog_parity] DB LABEL DRIFT:\n${JSON.stringify(dbContractDrift, null, 2)}`);
  process.exit(1);
}

// ─── 4. DB↔TS Diff ──────────────────────────────────────────────────────
const FIELDS = [
  "round_number", "family", "decision_token", "tag_label_canonical",
  "advances_to_round", "blocks_from_round", "cert_eligible", "is_active",
];

const tsByKey = new Map(tsRows.map((r) => [r.stage_key, r]));
const dbByKey = new Map(dbRows.map((r) => [r.stage_key, r]));

const onlyInDb = [...dbByKey.keys()].filter((k) => !tsByKey.has(k));
const onlyInTs = [...tsByKey.keys()].filter((k) => !dbByKey.has(k));
const fieldDrift = [];
for (const [k2, db] of dbByKey) {
  const ts = tsByKey.get(k2);
  if (!ts) continue;
  const diffs = {};
  for (const f of FIELDS) {
    if (db[f] !== ts[f]) diffs[f] = { db: db[f], ts: ts[f] };
  }
  if (Object.keys(diffs).length > 0) fieldDrift.push({ stage_key: k2, diffs });
}

const ok =
  dbRows.length === tsRows.length &&
  onlyInDb.length === 0 &&
  onlyInTs.length === 0 &&
  fieldDrift.length === 0;

const report = {
  generated_at: new Date().toISOString(),
  db_active_rows: dbRows.length,
  ts_active_rows: tsRows.length,
  expected_active_rows: EXPECTED_ACTIVE_COUNT,
  only_in_db: onlyInDb,
  only_in_ts: onlyInTs,
  field_drift: fieldDrift,
  ok,
};

console.log(JSON.stringify(report, null, 2));

if (!ok) {
  console.error(
    `\n[v3_catalog_parity] DRIFT DETECTED: ${onlyInDb.length} db-only, ${onlyInTs.length} ts-only, ${fieldDrift.length} field-mismatch.`,
  );
  console.error(
    "Fix by editing src/lib/judging/stageCatalog.ts to match the live DB, then re-run.",
  );
  process.exit(1);
}

console.log(`\n[v3_catalog_parity] PARITY OK — ${dbRows.length}/${EXPECTED_ACTIVE_COUNT} active rows match TS + DB.`);
process.exit(0);
