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
import { migrationsInSequence } from "@/test-utils/migrations";

const ROOT = path.resolve(__dirname, "../..");
const FROM = "20261028";

/**
 * Top-level statements. ONE pass over the text, so a `--` inside a string is
 * not a comment and a `;` inside a comment, string, quoted identifier or
 * $tag$ body (tags may contain digits) does not split. E'…' strings honour
 * backslash escapes.
 */
export function topStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  const s = sql;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "-" && s[i + 1] === "-") { const nl = s.indexOf("\n", i); i = nl < 0 ? s.length : nl; buf += " "; continue; }
    if (c === "/" && s[i + 1] === "*") { const end = s.indexOf("*/", i + 2); if (end < 0) throw new Error("unterminated comment"); i = end + 1; buf += " "; continue; }
    const tag = c === "$" ? /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(s.slice(i)) : null;
    if (tag) {
      const end = s.indexOf(tag[0], i + tag[0].length);
      if (end < 0) throw new Error("unterminated dollar quote");
      buf += " $BODY$ ";
      i = end + tag[0].length - 1;
      continue;
    }
    if (c === "'" ) {
      const escaped = /[Ee]$/.test(buf) && !/[A-Za-z0-9_][Ee]$/.test(buf);
      let j = i + 1;
      for (; j < s.length; j++) {
        if (escaped && s[j] === "\\") { j++; continue; }
        if (s[j] === "'") { if (s[j + 1] === "'") { j++; continue; } break; }
      }
      if (j >= s.length) throw new Error("unterminated string");
      buf += " 'S' ";
      i = j;
      continue;
    }
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0) throw new Error("unterminated identifier");
      buf += ' "I" ';
      i = end;
      continue;
    }
    if (c === ";") { if (buf.trim()) out.push(buf.trim()); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
/**
 * Escape route for a file that MUST run outside a transaction (CREATE INDEX
 * CONCURRENTLY, ALTER TYPE … ADD VALUE used at once, VACUUM): its first line is
 * `-- NO-TRANSACTION: <reason>`. Such a file is listed, not silently skipped.
 */
const NO_TX = /^-- NO-TRANSACTION: \S/;
const head = (st: string) => st.split(/\s+/)[0].toUpperCase();

// The shared helpers (src/test-utils/migrations.ts): never a hand-rolled filter,
// so UNAPPLIED_/PROBE_ files can never be mistaken for applied migrations.
const files = [
  ...migrationsInSequence().filter((f) => f.slice(0, 8) >= FROM).map((f) => `supabase/migrations/${f}`),
  ...migrationsInSequence(path.join(ROOT, "supabase/rollback")).filter((f) => f.slice(0, 8) >= FROM).map((f) => `supabase/rollback/${f}`),
];

describe("every migration and rollback since 20261028 is one transaction", () => {
  it("finds the files (not vacuous)", () => {
    expect(files.filter((f) => f.includes("/migrations/")).length).toBeGreaterThanOrEqual(10);
    expect(files.filter((f) => f.includes("/rollback/")).length).toBeGreaterThanOrEqual(10);
  });
  it.each(files)("%s: first statement BEGIN, last COMMIT, no other top-level COMMIT/ROLLBACK", (f) => {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (NO_TX.test(src)) return; // declared, reviewed exception (see NO_TX)
    const st = topStatements(src);
    expect(head(st[0])).toMatch(/^(BEGIN|START)$/);
    expect(head(st[st.length - 1])).toMatch(/^(COMMIT|END)$/);
    const tx = st.map(head).filter((h) => ["COMMIT", "END", "ROLLBACK", "BEGIN", "START"].includes(h));
    expect(tx).toEqual([head(st[0]), head(st[st.length - 1])]);
  });
  it("the parser sees through function bodies and strings (a COMMIT inside $$ or '…' is not top-level)", () => {
    const st = topStatements("BEGIN; CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN COMMIT; END $fn$; SELECT 'a;COMMIT;'; COMMIT;");
    expect(st.map(head)).toEqual(["BEGIN", "CREATE", "SELECT", "COMMIT"]);
  });
  it("review #616 edge cases: '--' in a string, E'' escapes, quoted ';', digit tags hide nothing", () => {
    expect(topStatements("BEGIN; SELECT '--'; COMMIT; ROLLBACK; COMMIT;").map(head)).toEqual(["BEGIN", "SELECT", "COMMIT", "ROLLBACK", "COMMIT"]);
    expect(topStatements("BEGIN; SELECT E'it\\'s'; COMMIT; SELECT 1; COMMIT;").map(head)).toEqual(["BEGIN", "SELECT", "COMMIT", "SELECT", "COMMIT"]);
    expect(topStatements('BEGIN; SELECT 1 AS "a;b"; COMMIT;').map(head)).toEqual(["BEGIN", "SELECT", "COMMIT"]);
    expect(topStatements("BEGIN; DO $fn1$ BEGIN COMMIT; END $fn1$; COMMIT;").map(head)).toEqual(["BEGIN", "DO", "COMMIT"]);
  });
  it("the NO-TRANSACTION escape needs a stated reason on the first line", () => {
    expect(NO_TX.test("-- NO-TRANSACTION: CREATE INDEX CONCURRENTLY\nCREATE INDEX CONCURRENTLY …")).toBe(true);
    expect(NO_TX.test("-- NO-TRANSACTION:\n")).toBe(false);
    expect(NO_TX.test("SELECT 1;\n-- NO-TRANSACTION: x")).toBe(false);
  });
});
