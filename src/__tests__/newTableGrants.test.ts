/**
 * A NEW TABLE IS FULLY WRITABLE BY `anon` THE MOMENT IT IS CREATED, AND RLS
 * DOES NOT COVER ALL OF IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED ON PRODUCTION, 2026-08-14 (pre-flight for 20260814084711):
 *
 *   select d.defaclobjtype, array_to_string(d.defaclacl,' | ')
 *     from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
 *    where n.nspname = 'public';
 *   -> 'f'  anon=X/postgres        | authenticated=X/postgres        | service_role=…
 *   -> 'r'  anon=arwdDxtm/postgres | authenticated=arwdDxtm/postgres | service_role=…
 *
 * `arwdDxtm` is SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
 * and MAINTAIN. Every table any migration creates in `public` starts with all
 * of that granted to the two roles reachable with the PUBLIC anon key.
 *
 * The sibling test `securityDefinerGrants.test.ts` locks the function half of
 * this. This file locks the table half, and the reason it is a SEPARATE risk is
 * that the usual mitigation does not fully apply:
 *
 *   RLS covers SELECT, INSERT, UPDATE, DELETE.
 *   RLS DOES NOT COVER TRUNCATE, REFERENCES or TRIGGER — those are checked
 *   against the grant alone, and no policy can refuse them.
 *
 * So "I enabled RLS" is a necessary answer and not a sufficient one.
 *
 * WHAT THIS TEST ASKS FOR is deliberately modest: a migration that creates a
 * table must (a) enable RLS on it, and (b) say something explicit about the
 * default grant — either revoking it or granting deliberately. Silence is the
 * failure mode, because silence looks identical to a decision.
 *
 * This caught the first draft of 20260814084711, which revoked the trigger
 * FUNCTION correctly and said nothing at all about the two tables.
 *
 * Migrations are resolved at run time, never by a hardcoded filename — trap #8.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** Same mandate window as the sibling gates, for the same reason. */
const MANDATE_FROM = "20260813000000";

const inScope = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (f.match(/^(\d{14})/)?.[1] ?? "0") >= MANDATE_FROM)
  .sort();

/** Prose must not be able to satisfy an assertion. */
const stripSql = (sql: string) =>
  readFileSync(join(MIGRATIONS, sql), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");

/** `CREATE TABLE [IF NOT EXISTS] public.<name>` — the tables in scope. */
function createdTables(sql: string): string[] {
  return [
    ...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z0-9_]+)/gi),
  ].map((m) => m[1]);
}

describe("a migration that creates a table decides its grants out loud", () => {
  it("has migrations in scope (guards against a vacuous pass)", () => {
    expect(inScope.length).toBeGreaterThan(0);
  });

  const withTables = inScope
    .map((f) => ({ file: f, sql: stripSql(f) }))
    .map((x) => ({ ...x, tables: createdTables(x.sql) }))
    .filter((x) => x.tables.length > 0);

  it("at least one in-scope migration creates a table (guards against a vacuous pass)", () => {
    // If this ever fails, every assertion below is iterating an empty list and
    // the suite is green for the wrong reason.
    expect(withTables.length).toBeGreaterThan(0);
  });

  for (const { file, sql, tables } of withTables) {
    for (const table of tables) {
      it(`${file}: public.${table} enables RLS`, () => {
        expect(
          new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i").test(sql),
          `public.${table} is created without ENABLE ROW LEVEL SECURITY. ` +
            `ALTER DEFAULT PRIVILEGES has already granted anon SELECT/INSERT/` +
            `UPDATE/DELETE on it.`,
        ).toBe(true);
      });

      it(`${file}: public.${table} revokes or deliberately grants the default table privileges`, () => {
        const revoked = new RegExp(
          `REVOKE[^;]*\\bON\\s+(?:TABLE\\s+)?public\\.${table}\\b[^;]*FROM[^;]*\\banon\\b`,
          "i",
        ).test(sql);

        const grantedDeliberately = new RegExp(
          `GRANT\\s+[^;]*\\bON\\s+(?:TABLE\\s+)?public\\.${table}\\b`,
          "i",
        ).test(sql);

        expect(
          revoked || grantedDeliberately,
          `public.${table} says nothing about its grants. It was therefore created ` +
            `with anon=arwdDxtm — including TRUNCATE, REFERENCES and TRIGGER, none ` +
            `of which RLS can refuse. Either REVOKE from anon/authenticated, or ` +
            `GRANT the exact verbs the feature needs so the decision is visible in ` +
            `the diff.`,
        ).toBe(true);
      });
    }
  }
});
