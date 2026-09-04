/**
 * A SECURITY DEFINER FUNCTION IS ANON-CALLABLE THE MOMENT IT IS CREATED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED ON PRODUCTION, 2026-08-14:
 *
 *   select array_to_string(defaclacl,' | ') from pg_default_acl d
 *     join pg_namespace n on n.oid = d.defaclnamespace
 *    where n.nspname='public' and d.defaclobjtype='f';
 *   -> anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
 *
 * `ALTER DEFAULT PRIVILEGES` grants EXECUTE on EVERY function created in
 * `public` to `anon` and `authenticated`. Nobody chose that per function; it is
 * one line of cluster configuration, and it applies to the next migration
 * anyone writes.
 *
 * THIS HAS ALREADY BITTEN TWICE, AND ONE OF THEM WAS THE FIX ITSELF:
 *
 *   1. `20260322151646_email_infra.sql:193-199` revoked `enqueue_email` and
 *      `read_email_batch` with the correct reasoning written above it. It did
 *      not hold — `REVOKE ... FROM PUBLIC` does not remove a grant held by a
 *      NAMED role. Both were still anon-executable on 2026-08-14, and
 *      `read_email_batch` returns the whole pgmq payload, which for
 *      `q_auth_emails` is the body of authentication mail.
 *
 *   2. The first draft of `feed_candidates` was SECURITY DEFINER and took
 *      `_viewer uuid`. It would have been callable by anyone with any member's
 *      uuid, returning the ids of that member's friends-only and private posts.
 *      Caught in pre-flight, before it was applied.
 *
 * SO: a migration that creates a SECURITY DEFINER function and neither revokes
 * it from `anon`/`authenticated` by name, nor gates the caller internally, is a
 * defect — and this test is what says so on the day it is written rather than
 * months later.
 *
 * F-76 — AND THERE IS A THIRD LEGITIMATE CASE, WHICH THIS GUARD USED TO HAVE NO
 * WAY TO EXPRESS. `get_top_contributors_v3` is the Home page Top Contributors
 * card: SECURITY DEFINER, granted to anon on purpose, and it MUST work for a
 * logged-out visitor. It is neither revoked nor internally gated, and it is not
 * a defect. With only two categories this guard was permanently red on a
 * correct function — and a guard that is permanently red is one someone
 * eventually deletes. That is the same disease as F-72 and F-73.
 *
 * So a third category exists, and it is deliberately expensive to claim: the
 * claim lives in the MIGRATION, not in an allow-list here (an allow-list is
 * invisible from the file it excuses, and it rots), and it requires ALL of a
 * named marker with real prose, the F-62-safe REVOKE-before-GRANT shape, and a
 * non-VOLATILE function. See `support/publicByDesign.ts`, whose own refusals are
 * proven in `publicByDesignMarker.test.ts`.
 *
 * Migrations are resolved at RUN TIME, never by a hardcoded path (trap #8): a
 * test pinned to a superseded file passes forever while production drifts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { publicByDesignVerdict } from "./support/publicByDesign";

const MIGRATIONS = "supabase/migrations";
const dir = join(process.cwd(), MIGRATIONS);

/**
 * Only migrations from the mandate date forward. The ~598 older files predate
 * the rule and are a separate, deliberate backlog — a check that always fails is
 * a check nobody reads, which is how this project ended up with three green
 * gates that were looking at the wrong thing.
 */
const MANDATE_FROM = "20260813000000";

const inScope = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (f.match(/^(\d{14})/)?.[1] ?? "0") >= MANDATE_FROM)
  .sort();

const body = (f: string) => readFileSync(join(dir, f), "utf8");

/** `CREATE [OR REPLACE] FUNCTION public.name(` … up to the AS $$ body marker. */
function definedFunctions(sql: string): { name: string; header: string }[] {
  const out: { name: string; header: string }[] = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const start = m.index;
    const bodyAt = sql.indexOf("$", start);
    out.push({ name: m[1], header: sql.slice(start, bodyAt > -1 ? bodyAt : start + 600) });
  }
  return out;
}

describe("every SECURITY DEFINER function a migration creates is closed to anon", () => {
  it("has migrations in scope to check (guards against a vacuous pass)", () => {
    // Without this, deleting every migration would make the suite green.
    expect(inScope.length).toBeGreaterThan(0);
  });

  for (const file of inScope) {
    const sql = body(file);
    const secdef = definedFunctions(sql).filter((f) => /SECURITY\s+DEFINER/i.test(f.header));
    if (secdef.length === 0) continue;

    for (const fn of secdef) {
      it(`${file}: ${fn.name}() is revoked from anon and authenticated, gates internally, or is a proven PUBLIC-BY-DESIGN function`, () => {
        // A trigger function cannot be invoked through PostgREST, so the grant
        // is irrelevant for it.
        const isTrigger = /RETURNS\s+trigger/i.test(fn.header);
        if (isTrigger) return;

        const revoked = new RegExp(
          `REVOKE[^;]*ON\\s+FUNCTION\\s+public\\.${fn.name}\\s*\\([^;]*FROM[^;]*\\banon\\b`,
          "i",
        ).test(sql);

        // The alternative to a revoke is an internal gate: the function decides
        // for itself who the caller is, so a forged argument buys nothing.
        const fnBodyStart = sql.indexOf(fn.header);
        const fnBody = sql.slice(fnBodyStart, fnBodyStart + 8000);
        const gatesItself =
          /auth\.uid\(\)/.test(fnBody) ||
          /has_role\s*\(/i.test(fnBody) ||
          /app_has_role\s*\(/i.test(fnBody);

        /**
         * A thin overload that only delegates inherits the callee's gate.
         * `get_broadcast_feed(uuid[],int)` is exactly this: its whole body is
         * `SELECT * FROM public.get_broadcast_feed(_exclude_ids,_limit,0,NULL)`,
         * and the 4-argument form resolves the viewer from auth.uid(). Both
         * overloads are deliberately reachable by anon — a logged-out visitor
         * sees the public feed — and the visibility filter is inside.
         *
         * Only a delegation to a function defined in THIS migration counts, so
         * the callee's gate is checked here too rather than assumed.
         */
        const delegatesTo = fnBody.match(
          /(?:SELECT|RETURN QUERY SELECT)[^;]*\bFROM\s+public\.([a-z0-9_]+)\s*\(/i,
        )?.[1];
        const calleeGated =
          !!delegatesTo &&
          definedFunctions(sql).some(
            (f) =>
              f.name === delegatesTo &&
              /auth\.uid\(\)|has_role\s*\(/i.test(
                sql.slice(sql.indexOf(f.header), sql.indexOf(f.header) + 8000),
              ),
          );

        const gated = gatesItself || calleeGated;

        // F-76 · the third category. Only consulted when the first two do not
        // already clear the function, so an ordinary revoked/gated function is
        // judged exactly as before.
        const pbd = publicByDesignVerdict(sql, fn.name, fn.header);

        const why = pbd.claimed
          ? `${fn.name}() claims the ${"PUBLIC-BY-DESIGN"} category but does not meet it:\n` +
            pbd.failures.map((f) => `  - ${f}`).join("\n") +
            `\nThe marker is not a waiver: conditions (2) and (3) exist precisely ` +
            `because no reason justifies a PUBLIC-granted or VOLATILE anon-callable ` +
            `SECURITY DEFINER function.`
          : `${fn.name}() is SECURITY DEFINER and is neither REVOKEd from anon by name ` +
            `nor gated on auth.uid()/has_role. ALTER DEFAULT PRIVILEGES grants EXECUTE ` +
            `on every new public function to anon, so this is reachable at ` +
            `/rest/v1/rpc/${fn.name} by anyone with the public key.\n` +
            `If it is deliberately public, say so IN THE MIGRATION and meet all three ` +
            `conditions:\n` +
            pbd.failures.map((f) => `  - ${f}`).join("\n");

        expect(revoked || gated || pbd.ok, why).toBe(true);
      });
    }
  }
});

describe("the email queue RPCs stay closed", () => {
  /** Newest migration that defines either, found at run time — never a fixed path. */
  const latest = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => /FUNCTION\s+public\.(enqueue_email|read_email_batch)\s*\(/i.test(body(f)))
    .pop();

  it("a migration defining them exists", () => {
    expect(latest, "no migration defines enqueue_email/read_email_batch").toBeTruthy();
  });

  it("revokes both from anon and authenticated BY NAME, not just FROM PUBLIC", () => {
    const sql = body(latest!);
    for (const fn of ["enqueue_email", "read_email_batch"]) {
      const re = new RegExp(
        `REVOKE[^;]*ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^;]*FROM[^;]*\\banon\\b[^;]*\\bauthenticated\\b`,
        "i",
      );
      expect(
        re.test(sql),
        `${fn} must be revoked from anon AND authenticated by name. ` +
          `REVOKE ... FROM PUBLIC does not remove a grant held by a named role — ` +
          `that is exactly why the 2026-03-22 fix did not hold.`,
      ).toBe(true);
    }
  });

  it("allow-lists the queue name, so a restored grant is not immediately fatal", () => {
    const sql = body(latest!);
    expect(sql).toMatch(/transactional_emails/);
    expect(sql).toMatch(/auth_emails/);
    expect(
      /NOT\s+IN\s*\(\s*'transactional_emails'\s*,\s*'auth_emails'\s*\)/i.test(sql),
      "the queue name must be allow-listed inside the function; the grant alone " +
        "has already failed once, so it cannot be the only control",
    ).toBe(true);
  });
});
