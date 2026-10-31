#!/usr/bin/env node
/**
 * R6 — Auto-generate docs/judging/vocabulary.md from
 * docs/judging/vocabulary.source.json (snapshot of system_tag_decision_map ⋈ judging_tags).
 *
 * Modes:
 *   node scripts/generate-vocabulary.mjs           → writes docs/judging/vocabulary.md
 *   node scripts/generate-vocabulary.mjs --check   → exits 1 if vocabulary.md is stale
 *
 * Mandate compliance:
 *   - Pure & deterministic: same JSON in → byte-identical markdown out.
 *   - No DB calls. No network. Source of truth is the committed JSON.
 *   - Drift JSON ↔ live DB is handled by scripts/snapshot-vocabulary.mjs
 *     (run by .github/workflows/vocabulary-snapshot.yml on a nightly schedule).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE = resolve(ROOT, "docs/judging/vocabulary.source.json");
const OUTPUT = resolve(ROOT, "docs/judging/vocabulary.md");

const DECISION_ORDER = ["accept", "shortlist", "needs_verification", "reject"];
const DECISION_LABEL = {
  accept: "Accept",
  shortlist: "Shortlist (Progression)",
  needs_verification: "Needs Verification (Hold)",
  reject: "Reject",
};

function loadSource() {
  if (!existsSync(SOURCE)) {
    console.error(`[vocab] FATAL: source missing at ${SOURCE}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(SOURCE, "utf8"));
}

function render(src) {
  const out = [];
  out.push("<!--");
  out.push("  AUTO-GENERATED — DO NOT EDIT BY HAND.");
  out.push("  Source:    docs/judging/vocabulary.source.json");
  out.push("  Generator: scripts/generate-vocabulary.mjs");
  out.push("  To refresh: bun run vocab:generate");
  out.push("  CI fails if this file is stale (audit-forbidden workflow).");
  out.push("-->");
  out.push("");
  out.push("# Judging Vocabulary");
  out.push("");
  out.push("Single, authoritative glossary for every system decision tag in the judging pipeline.");
  out.push("Generated from `system_tag_decision_map` joined to `judging_tags`.");
  out.push("");
  out.push(`- **Snapshot taken (UTC):** \`${src.snapshot_taken_at_utc}\``);
  out.push(`- **Row count:** ${src.row_count}`);
  out.push(`- **Source view:** \`${src.generated_from}\``);
  out.push("");
  out.push("---");
  out.push("");
  out.push("## Decision Families");
  out.push("");
  out.push("| Decision | Meaning |");
  out.push("|----------|---------|");
  for (const key of DECISION_ORDER) {
    const meaning = src.decision_glossary?.[key];
    if (meaning) out.push(`| \`${key}\` | ${meaning} |`);
  }
  out.push("");
  out.push("---");
  out.push("");
  out.push("## Tags by Round");
  out.push("");

  const rounds = [...(src.rounds ?? [])].sort((a, b) => a.round_number - b.round_number);
  for (const round of rounds) {
    out.push(`### ${round.name}`);
    out.push("");
    out.push("| Decision | Tag Label | Color | Icon | System | Active | Visible In | Tag ID |");
    out.push("|----------|-----------|-------|------|--------|--------|------------|--------|");

    const decisions = [...(round.decisions ?? [])].sort(
      (a, b) => DECISION_ORDER.indexOf(a.decision) - DECISION_ORDER.indexOf(b.decision),
    );
    for (const dec of decisions) {
      const tags = [...(dec.tags ?? [])].sort((a, b) => a.label.localeCompare(b.label));
      for (const t of tags) {
        out.push(
          `| \`${dec.decision}\` ` +
            `| ${t.label} ` +
            `| \`${t.color}\` ` +
            `| ${t.icon ?? "—"} ` +
            `| ${t.is_system ? "✅" : "—"} ` +
            `| ${t.is_active ? "✅" : "—"} ` +
            `| ${JSON.stringify(t.visible_in_round ?? [])} ` +
            `| \`${t.tag_id}\` |`,
        );
      }
    }
    out.push("");
  }

  out.push("---");
  out.push("");
  out.push("## Onboarding Notes");
  out.push("");
  out.push("- **Judges** apply tags from this list only — they cannot create new tags.");
  out.push("- **Admins** manage tags via the Judging Tags admin module. New rows in");
  out.push("  `system_tag_decision_map` automatically appear here on the next snapshot.");
  out.push("- **Developers** must regenerate this file after refreshing the snapshot:");
  out.push("  ```bash");
  out.push("  bun run vocab:generate");
  out.push("  ```");
  out.push("- **CI** runs `bun run vocab:check` and blocks PRs where this file does");
  out.push("  not match the JSON snapshot.");
  out.push("");
  return out.join("\n") + "\n";
}

function main() {
  const args = new Set(process.argv.slice(2));
  const src = loadSource();
  const expected = render(src);

  if (args.has("--check")) {
    const actual = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
    if (actual !== expected) {
      console.error(
        "[vocab] STALE — docs/judging/vocabulary.md does not match the JSON snapshot.\n" +
          "        Run `bun run vocab:generate` and commit the result.",
      );
      process.exit(1);
    }
    console.log("[vocab] OK — vocabulary.md is in sync with the JSON snapshot.");
    return;
  }

  writeFileSync(OUTPUT, expected, "utf8");
  console.log(`[vocab] Wrote ${OUTPUT} (${expected.length} bytes).`);
}

main();
