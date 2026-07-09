#!/usr/bin/env node
/**
 * scripts/audits/rpc_contract_parity.mjs — Phase 6 / F7 live audit.
 *
 * Hits the LIVE Lovable Cloud DB, lists every distinct `status` value
 * emitted by `get_per_photo_consensus` and `get_per_photo_placement`,
 * and fails (exit 1) if any value is outside the allowed RPC vocabulary
 * (mirrors src/test/rpc-consensus-vocabulary.spec.ts).
 *
 * Allowed = PARTICIPANT_LABELS keys (16 Frozen Contract v3 stage_keys)
 *         ∪ { pending_consensus, r1_needs_review }            // sentinels
 *
 * Phase 6 closure (2026-05-02) — strict 16+2 contract: legacy R4 aliases
 * 'winner' / 'finalist' were removed from get_per_photo_consensus.
 * R4 awards are sourced exclusively from get_per_photo_placement.
 *
 * Required env (any one combination):
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY    (preferred; bypasses RLS)
 *   - VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY  (anon; sees only
 *     declared comps + own entries)
 *
 * Exit codes:
 *   0 — all RPC status values are in the allowed set
 *   1 — drift detected (unknown status emitted) OR config error
 *   2 — RPC call failed
 */

import { createClient } from "@supabase/supabase-js";

// ─── Allowed vocabulary (kept in sync with the spec) ────────────────────────
const PARTICIPANT_LABEL_KEYS = [
  // R1
  "r1_accepted",
  "r1_shortlisted_r2",
  "r1_needs_verification",
  "r1_rejected",
  // R2
  "r2_accepted",
  "r2_qualified_r3",
  // R3
  "r3_accepted",
  "r3_qualified_final",
  // R4
  "r4_winner",
  "r4_runner_up_1",
  "r4_runner_up_2",
  "r4_honorary_mention",
  "r4_special_jury",
  "r4_top_50",
  "r4_top_100",
  "r4_finalist",
];

const ALLOWED_EXTRAS = [
  "pending_consensus",
  "r1_needs_review",
];

const ALLOWED = new Set([...PARTICIPANT_LABEL_KEYS, ...ALLOWED_EXTRAS]);

// ─── Client bootstrap ───────────────────────────────────────────────────────
const url =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error(
    "[rpc-parity] FAIL: SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_PUBLISHABLE_KEY) required",
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// ─── Fetch entry ID sample ──────────────────────────────────────────────────
async function sampleEntryIds(limit = 1000) {
  const { data, error } = await supabase
    .from("competition_entries")
    .select("id")
    .limit(limit);
  if (error) {
    console.error("[rpc-parity] FAIL fetching entries:", error.message);
    process.exit(2);
  }
  return (data ?? []).map((r) => r.id);
}

// ─── Run RPC + collect distinct statuses ────────────────────────────────────
async function distinctStatusFromRpc(rpc, ids) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc(rpc, { p_entry_ids: ids });
  if (error) {
    console.error(`[rpc-parity] FAIL calling ${rpc}:`, error.message);
    process.exit(2);
  }
  const set = new Set();
  for (const row of data ?? []) {
    if (row?.status) set.add(row.status);
  }
  return [...set].sort();
}

// ─── Main ───────────────────────────────────────────────────────────────────
const ids = await sampleEntryIds(1000);
console.log(`[rpc-parity] Sampling ${ids.length} entries`);

const consensus = await distinctStatusFromRpc("get_per_photo_consensus", ids);
const placement = await distinctStatusFromRpc("get_per_photo_placement", ids);

console.log("\n[rpc-parity] consensus distinct status:", consensus);
console.log("[rpc-parity] placement distinct status:", placement);

const all = new Set([...consensus, ...placement]);
const unknown = [...all].filter((s) => !ALLOWED.has(s));

if (unknown.length === 0) {
  console.log(
    `\n[rpc-parity] ✅ PASS — ${all.size} distinct status values, all in ALLOWED set (${ALLOWED.size}).`,
  );
  process.exit(0);
}

console.error(
  `\n[rpc-parity] ❌ FAIL — ${unknown.length} unknown status value(s) emitted by RPC:`,
);
for (const k of unknown) console.error(`  - "${k}"`);
console.error(
  "\nFix: add to PARTICIPANT_LABELS + STAGE_CATALOG, or to ALLOWED_EXTRAS in this script + the spec.",
);
process.exit(1);
