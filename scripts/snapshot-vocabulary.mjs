#!/usr/bin/env node
/**
 * R6 — Refresh docs/judging/vocabulary.source.json from the live database.
 *
 * Run only by .github/workflows/vocabulary-snapshot.yml (nightly), which
 * provides SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY as job secrets and opens
 * a PR if the snapshot changed. Per Mandate Rule 2, this script never runs
 * in PR CI — drift detection (vs. JSON) is handled by generate-vocabulary.mjs
 * `--check`. This script handles drift detection (JSON vs. DB).
 *
 * Required env:
 *   SUPABASE_URL                e.g. https://xxxxxxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   service-role JWT (RLS bypass)
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUT = resolve(ROOT, "docs/judging/vocabulary.source.json");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[snapshot] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(2);
}

const ROUND_NAMES = {
  1: "Round 1 — Initial Screening",
  2: "Round 2 — Quality Evaluation",
  3: "Round 3 — Penultimate Selection",
  4: "Round 4 — Final Round",
};

const DECISION_GLOSSARY = {
  accept: "Photo is accepted in the current round and advances to the next round.",
  shortlist:
    "Photo qualifies and advances to the next round (used for explicit progression labels in Rounds 1–3).",
  needs_verification:
    "Photo is placed on hold; participant must upload the original/RAW source file before judging continues.",
  reject:
    "Photo is removed from contention. In Round 1 this exits the competition entirely. In Rounds 2–3 it keeps current-round qualification but is OUT for the next round.",
};

async function rest(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`REST ${table} failed [${res.status}]: ${await res.text()}`);
  }
  return res.json();
}

const map = await rest("system_tag_decision_map", "select=tag_id,round_number,decision");
const tagIds = [...new Set(map.map((r) => r.tag_id))];
const tags = await rest(
  "judging_tags",
  `id=in.(${tagIds.join(",")})&select=id,label,color,icon,is_system,is_active,visible_in_round`,
);
const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));

const grouped = new Map();
for (const row of map) {
  const r = row.round_number;
  if (!grouped.has(r)) grouped.set(r, new Map());
  const decMap = grouped.get(r);
  if (!decMap.has(row.decision)) decMap.set(row.decision, []);
  const t = tagById[row.tag_id];
  decMap.get(row.decision).push({
    tag_id: row.tag_id,
    label: t?.label ?? "(missing tag)",
    color: t?.color ?? "#888888",
    icon: t?.icon ?? null,
    is_system: !!t?.is_system,
    is_active: !!t?.is_active,
    visible_in_round: t?.visible_in_round ?? [],
  });
}

const rounds = [...grouped.entries()]
  .sort(([a], [b]) => a - b)
  .map(([round_number, decMap]) => ({
    round_number,
    name: ROUND_NAMES[round_number] ?? `Round ${round_number}`,
    decisions: [...decMap.entries()]
      .map(([decision, tags]) => ({
        decision,
        tags: tags.sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.decision.localeCompare(b.decision)),
  }));

const snapshot = {
  $schema: "vocabulary.source.schema.v1",
  generated_from: "system_tag_decision_map ⋈ judging_tags",
  snapshot_taken_at_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  row_count: map.length,
  rounds,
  decision_glossary: DECISION_GLOSSARY,
};

writeFileSync(OUTPUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
console.log(`[snapshot] Wrote ${OUTPUT} — ${map.length} mapping rows, ${tags.length} tags.`);
