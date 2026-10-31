/**
 * S10 P27 (20261031_0623, Owner decision 16 "archive and drop"): the three old
 * tables wallet_ledger_v2_diff_log, v3_mirror_log and wallet_ledger_v2_rows are
 * archived to p27_archive and dropped. Nothing the app or an edge function runs
 * may still name them, or it would fail on both lanes after the apply (the
 * Admin → Health wallet card read wallet_ledger_v2_diff_log directly).
 * Migrations, PROBEs, rollbacks and docs are history and are not scanned.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DROPPED = /\b(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe("S10 P27 — dropped tables are not referenced by running code", () => {
  it("src/ and supabase/functions/ never name the three dropped tables", () => {
    const hits = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase", "functions"))]
      .filter((f) => DROPPED.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(ROOT.length + 1));
    expect(hits).toEqual([]);
  });
});
