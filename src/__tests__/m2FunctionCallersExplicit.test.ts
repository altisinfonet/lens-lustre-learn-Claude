/**
 * S11 · M2 — the client RPC allow-list.
 *
 * After 20261031_0400 a function a migration creates in `public` is born
 * executable by nobody but its owner and service_role (anon/PUBLIC were
 * closed by 20260910_0043). So every new migration or rollback file must say,
 * for each non-trigger function it creates in `public`, who may call it: a
 * GRANT EXECUTE … TO authenticated/anon for an RPC the app calls (or a policy
 * uses), or a REVOKE that records it is server-only. Without this, a new RPC
 * would ship callable by no member and the app would fail on it at run time.
 *
 * Trigger functions are exempt (they run as the table owner). Files listed in
 * fixtures/m2-sql-baseline.json predate 0400 and are not re-judged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsInSequence } from "@/test-utils/migrations";

const ROOT = process.cwd();
const baseline = new Set<string>(
  (JSON.parse(readFileSync(join(ROOT, "src/__tests__/fixtures/m2-sql-baseline.json"), "utf8")) as { files: string[] }).files,
);

const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

/** Text of the balanced parenthesis group opening at `open` (s[open] === "("), normalised. */
const argList = (s: string, open: number): string => {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return s.slice(open, i + 1).replace(/\s+/g, "").toLowerCase();
  }
  return s.slice(open).replace(/\s+/g, "").toLowerCase();
};

/** Non-trigger functions created in `public` (or unqualified) that no GRANT/REVOKE in the file names. */
export function functionsWithoutCallerDecision(sql: string): string[] {
  const s = stripComments(sql);
  const named = new Set<string>();
  for (const st of s.matchAll(/\b(?:grant|revoke)\s+(?:execute|all)\b[^;]*?\bon\s+function\s+([^;]*?)\b(?:to|from)\b/gis)) {
    for (const n of st[1].matchAll(/(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi)) {
      const schema = (n[1] ?? "public").toLowerCase();
      if (schema === "public") named.add(n[2].toLowerCase());
    }
  }
  if (/\b(?:grant|revoke)\s+(?:execute|all)\b[^;]*?\bon\s+all\s+functions\s+in\s+schema\s+public\b/is.test(s)) return [];
  const missing: string[] = [];
  for (const m of s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:"?\w+"?\.)?)"?(\w+)"?\s*\(/gi)) {
    const schema = m[1].replace(/[".]/g, "").toLowerCase();
    if (schema && schema !== "public") continue;
    const name = m[2].toLowerCase();
    const open = m.index! + m[0].length - 1;
    const args = argList(s, open);
    // Only this function's own header (up to its body) can say RETURNS trigger.
    const rest = s.slice(open + args.length);
    const bodyAt = rest.search(/\bas\s*(?:\$\w*\$|')/i);
    if (/\breturns\s+trigger\b/i.test(bodyAt >= 0 ? rest.slice(0, bodyAt) : rest.slice(0, 400))) continue;
    // A throwaway the same file drops again with the SAME argument list (a postcondition fixture) is not shipped.
    const after = s.slice(open);
    let dropped = false;
    for (const d of after.matchAll(new RegExp(`\\bdrop\\s+function\\s+(?:if\\s+exists\\s+)?(?:"?public"?\\.)?"?${name}"?\\s*\\(`, "gi"))) {
      if (argList(after, d.index! + d[0].length - 1) === args) dropped = true;
    }
    if (dropped) continue;
    if (!named.has(name)) missing.push(name);
  }
  return [...new Set(missing)];
}

// In-sequence files only (no PROBE_ / UNAPPLIED_): those are what an apply runs.
const sqlFiles = (dir: "migrations" | "rollback") =>
  migrationsInSequence(join(ROOT, "supabase", dir)).map((f) => `${dir}/${f}`);

describe("S11 M2 — every new SQL file states who may execute the functions it creates", () => {
  it("new migration and rollback files (not in the pre-0400 baseline) name every function in a GRANT or REVOKE", () => {
    const offenders: string[] = [];
    for (const rel of [...sqlFiles("migrations"), ...sqlFiles("rollback")]) {
      if (baseline.has(rel)) continue;
      const missing = functionsWithoutCallerDecision(readFileSync(join(ROOT, "supabase", rel), "utf8"));
      if (missing.length) offenders.push(`${rel}: ${missing.join(", ")} — add GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated (or anon), or REVOKE … FROM authenticated if it is server-only`);
    }
    expect(offenders).toEqual([]);
  });

  it("catches the real pattern 0400 closes: a historical file that relied on the old default", () => {
    // 20261012_0002 created video_begin_upload / video_mark_uploaded and never
    // granted them — they worked only because new functions were born
    // executable by authenticated. Written today, this file would be refused.
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261012_0002_vid1_converter_sources.sql"), "utf8");
    expect(functionsWithoutCallerDecision(sql)).toEqual(expect.arrayContaining(["video_begin_upload", "video_mark_uploaded"]));
  });

  it("accepts trigger functions, other schemas, multi-function GRANT lists and an explicit REVOKE", () => {
    const sql = `
      CREATE FUNCTION public.t_touch() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
      CREATE FUNCTION private.helper() RETURNS int LANGUAGE sql AS 'select 1';
      CREATE OR REPLACE FUNCTION public.a(x int) RETURNS int LANGUAGE sql AS 'select 1';
      CREATE FUNCTION b() RETURNS int LANGUAGE sql AS 'select 1';
      CREATE FUNCTION public.c() RETURNS int LANGUAGE sql AS 'select 1';
      GRANT EXECUTE ON FUNCTION public.a(int), public.b() TO authenticated;
      REVOKE ALL ON FUNCTION public.c() FROM PUBLIC, anon, authenticated;
    `;
    expect(functionsWithoutCallerDecision(sql)).toEqual([]);
    expect(functionsWithoutCallerDecision("CREATE FUNCTION public.tmp() RETURNS int LANGUAGE sql AS 'select 1'; DROP FUNCTION public.tmp();")).toEqual([]);
    // Review gaps closed: a trigger right after a plain function does not exempt it;
    // dropping an OLD signature does not exempt the new one; a grant in another schema does not count.
    expect(functionsWithoutCallerDecision("CREATE FUNCTION public.e() RETURNS int LANGUAGE sql AS 'select 1'; CREATE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;")).toEqual(["e"]);
    expect(functionsWithoutCallerDecision("CREATE FUNCTION public.g(a int, b int) RETURNS int LANGUAGE sql AS 'select 1'; DROP FUNCTION public.g(int);")).toEqual(["g"]);
    expect(functionsWithoutCallerDecision("CREATE FUNCTION public.q() RETURNS int LANGUAGE sql AS 'select 1'; GRANT EXECUTE ON FUNCTION private.q() TO authenticated;")).toEqual(["q"]);
    expect(functionsWithoutCallerDecision("CREATE FUNCTION public.d() RETURNS int LANGUAGE sql AS 'select 1'; -- GRANT EXECUTE ON FUNCTION public.d() TO authenticated;")).toEqual(["d"]);
  });
});
