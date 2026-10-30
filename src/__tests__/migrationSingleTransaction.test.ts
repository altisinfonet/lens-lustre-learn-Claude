// @vitest-environment node
/**
 * S11 drill D7 / D8 · a migration or rollback that fails half-way must leave
 * NOTHING behind. apply-migration.yml runs `psql -v ON_ERROR_STOP=1 -f <file>`
 * with no --single-transaction, so the guarantee lives in each file: exactly
 * one top-level BEGIN … COMMIT around everything. Drill evidence (local
 * Postgres, both lane shapes): an injected failure just before COMMIT left the
 * schema byte-identical, for the apply and for the rollback
 * (docs/evidence/cloud/S11/drills.md). This keeps every file from 20261028 on
 * in that shape. PROBE files are exempt — they end in ROLLBACK on purpose.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const FROM = "20261028";

/** Top-level statements, with comments, strings and $tag$ bodies blanked out. */
export function topStatements(sql: string): string[] {
  const s = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const tag = /^\$[A-Za-z_]*\$/.exec(s.slice(i));
    if (tag) {
      const end = s.indexOf(tag[0], i + tag[0].length);
      if (end < 0) throw new Error("unterminated dollar quote");
      buf += " $BODY$ ";
      i = end + tag[0].length - 1;
      continue;
    }
    if (s[i] === "'") {
      let j = i + 1;
      while (j < s.length && !(s[j] === "'" && s[j + 1] !== "'")) j += s[j] === "'" ? 2 : 1;
      buf += " 'S' ";
      i = j;
      continue;
    }
    if (s[i] === ";") { if (buf.trim()) out.push(buf.trim()); buf = ""; continue; }
    buf += s[i];
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
const head = (st: string) => st.split(/\s+/)[0].toUpperCase();

const files = [
  ...fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => /^\d{8}_/.test(f) && f.slice(0, 8) >= FROM).map((f) => `supabase/migrations/${f}`),
  ...fs.readdirSync(path.join(ROOT, "supabase/rollback")).filter((f) => /^\d{8}_/.test(f) && f.slice(0, 8) >= FROM).map((f) => `supabase/rollback/${f}`),
].filter((f) => f.endsWith(".sql"));

describe("every migration and rollback since 20261028 is one transaction", () => {
  it("finds the files (not vacuous)", () => {
    expect(files.filter((f) => f.includes("/migrations/")).length).toBeGreaterThanOrEqual(10);
    expect(files.filter((f) => f.includes("/rollback/")).length).toBeGreaterThanOrEqual(10);
  });
  it.each(files)("%s: first statement BEGIN, last COMMIT, no other top-level COMMIT/ROLLBACK", (f) => {
    const st = topStatements(fs.readFileSync(path.join(ROOT, f), "utf8"));
    expect(head(st[0])).toMatch(/^(BEGIN|START)$/);
    expect(head(st[st.length - 1])).toMatch(/^(COMMIT|END)$/);
    const tx = st.map(head).filter((h) => ["COMMIT", "END", "ROLLBACK", "BEGIN", "START"].includes(h));
    expect(tx).toEqual([head(st[0]), head(st[st.length - 1])]);
  });
  it("the parser sees through function bodies and strings (a COMMIT inside $$ or '…' is not top-level)", () => {
    const st = topStatements("BEGIN; CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN COMMIT; END $fn$; SELECT 'a;COMMIT;'; COMMIT;");
    expect(st.map(head)).toEqual(["BEGIN", "CREATE", "SELECT", "COMMIT"]);
  });
});
