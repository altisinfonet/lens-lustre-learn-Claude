/**
 * THE MEDIA READ PATH IS ONE FUNCTION, AND ITS ACCESS CONTROL IS ONE LINE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `post_media_for` is SECURITY DEFINER, which means Postgres row-level security
 * DOES NOT APPLY to the tables it reads. The `can_view_post(...)` predicate in
 * its WHERE clause is not one control among several — it is the only thing
 * between a member's private photograph and the open internet.
 *
 * That is not a theory. Item C deleted the line in a rolled-back transaction and
 * measured the result on 2026-08-19:
 *
 *     anon reading a PRIVATE post's media          1 row   (should be 0)
 *     a stranger reading a FRIENDS-ONLY post        1 row   (should be 0)
 *     a friend reading the owner's PRIVATE post     1 row   (should be 0)
 *
 * Restoring the line returned all three to 0. `tools/mutate-post-media-rpc.mjs`
 * performs exactly those mutations against this file and requires this suite to
 * go RED for each one.
 *
 * WHY THIS READS THE MIGRATION AND NOT THE DATABASE. vitest has no production
 * connection, and a test that needs one does not run in CI. What CI can prove is
 * that the SHIPPED ARTIFACT still says what it said when it was reviewed — the
 * same discipline `manifestMigrator.test.ts` applies to the migration engine.
 * The behavioural matrix (owner / friend / stranger / anon × public / friends /
 * private) was proven against the live function at deployment and is recorded in
 * claude/PHASE2_ITEM_C_RPC_PROVEN_2026-08-19.md.
 *
 * ⚠ WHEN THIS FAILS, DO NOT DELETE IT TO GET GREEN. Every assertion here is a
 * property somebody argued for. If one is genuinely wrong, change the migration
 * and the assertion together, in one commit, with the reason written down.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const FILE = "20260819170132_post_media_read_rpc.sql";
const PATH = resolve(MIGRATIONS, FILE);

const sql = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";

/** Comments explain intent; code is what actually runs. Assertions about what
 *  the function CANNOT do must look at code only, or a prose mention of
 *  "sha256" in a comment would fail a test about exposing sha256. */
const code = sql.replace(/^\s*--.*$/gm, "");
/** Executable DDL only: the `comment on … ;` statement is documentation, and its
 *  string literal legitimately contains phrases like "Grants nothing on
 *  media_objects". An assertion about grants that reads prose is an assertion
 *  that fails for the wrong reason. */
const executable = code.replace(/comment on function[\s\S]*?;\s*$/im, "");

/** The CREATE FUNCTION statement, without the trailing REVOKE/GRANT/COMMENT. */
const fn = (code.match(/create or replace function[\s\S]*?\$\$;/i) ?? [""])[0];
/** The dollar-quoted body. */
const body = (fn.match(/as \$\$([\s\S]*)\$\$;/) ?? ["", ""])[1];
/** The RETURNS TABLE (...) column list. */
const returnType = (fn.match(/returns table \(([\s\S]*?)\)\s*\nlanguage/i) ?? ["", ""])[1];

describe("post_media_for — the migration still exists and is the reviewed one", () => {
  it("the migration file is present under its applied version", () => {
    expect(existsSync(PATH), `${FILE} is missing`).toBe(true);
    expect(sql.length).toBeGreaterThan(1000);
  });

  it("its filename matches the version production recorded", () => {
    /**
     * Supabase's apply_migration stamps its OWN version from application time
     * and ignores the artifact's filename. When those two drift, a fresh
     * `db push` against a new environment re-runs a migration that has already
     * been applied. Cycle 20260818011014 was exactly that repair; this keeps it
     * from happening again for this migration.
     */
    expect(readdirSync(MIGRATIONS)).toContain(FILE);
    expect(FILE.startsWith("20260819170132_")).toBe(true);
  });
});

describe("post_media_for — the access control", () => {
  it("⚠ THE PREDICATE IS PRESENT. Without it, anon reads private media.", () => {
    expect(
      /and\s+public\.can_view_post\(\s*auth\.uid\(\)\s*,\s*p\.user_id\s*,\s*p\.privacy\s*\)/i.test(body),
      "can_view_post(auth.uid(), p.user_id, p.privacy) is not in the WHERE clause — " +
        "this function is SECURITY DEFINER, so RLS will not save you",
    ).toBe(true);
  });

  it("the predicate uses auth.uid(), not a caller-supplied viewer id", () => {
    // A `_viewer_id uuid` parameter would let any caller claim to be anyone.
    expect(/_viewer_id|_user_id|_as_user/i.test(fn)).toBe(false);
    expect(/auth\.uid\(\)/.test(body)).toBe(true);
  });

  it("it is SECURITY DEFINER with a pinned search_path", () => {
    expect(/security definer/i.test(fn)).toBe(true);
    expect(/set search_path to 'public'/i.test(fn)).toBe(true);
  });

  it("it is STABLE, and therefore cannot write", () => {
    expect(/\bstable\b/i.test(fn)).toBe(true);
    expect(/\b(insert into|update\s+public\.|delete from)\b/i.test(body)).toBe(false);
  });
});

describe("post_media_for — what it may return", () => {
  it("exactly the seven approved columns, in order", () => {
    const cols = returnType.split(",").map((c) => c.trim().split(/\s+/)[0]);
    expect(cols).toEqual([
      "post_id", "ord", "object_path", "width", "height", "mime", "bytes",
    ]);
  });

  it.each(["sha256", "verified_at", "quarantine_reason"])(
    "%s can never reach a client — it is not in the return type or the body",
    (forbidden) => {
      /**
       * This is stronger than a column grant: there is no `select *` against a
       * function's return type, so a forbidden column cannot be reached by
       * asking differently. It can only be reached by editing this file.
       */
      expect(returnType.toLowerCase()).not.toContain(forbidden);
      expect(body.toLowerCase()).not.toContain(forbidden);
    },
  );

  it("owner_id is not returned either — the client has no use for it", () => {
    expect(returnType.toLowerCase()).not.toContain("owner_id");
  });
});

describe("post_media_for — it cannot become a bulk exporter", () => {
  it("the input is capped at 50 ids and refuses with MEDIA-1001", () => {
    expect(/array_length\(\s*_post_ids\s*,\s*1\s*\)\s*>\s*50/.test(body)).toBe(true);
    expect(body).toContain("MEDIA-1001");
    expect(/using errcode = '22023'/.test(body)).toBe(true);
  });

  it("no input is an empty answer, not an error", () => {
    // A feed page with no posts asks for nothing; that must not 500.
    expect(/_post_ids is null or array_length\(\s*_post_ids\s*,\s*1\s*\) is null/.test(body)).toBe(true);
  });
});

describe("post_media_for — the privilege surface", () => {
  it("PUBLIC is revoked and only anon + authenticated may execute", () => {
    expect(/revoke all on function public\.post_media_for\(uuid\[\]\) from public/i.test(code)).toBe(true);
    expect(/grant execute on function public\.post_media_for\(uuid\[\]\) to anon, authenticated/i.test(code)).toBe(true);
  });

  it("⚠ IT GRANTS NOTHING ON THE TABLES. A table grant here is a regression.", () => {
    /**
     * The whole point of choosing the RPC over column-scoped grants (Item B) is
     * that anon and authenticated keep ZERO privilege on media_objects and
     * post_media. If a future commit adds a grant, the RPC stops being the only
     * door and this decision quietly reverses itself.
     */
    expect(/\bgrant\b[^;]*\bon\b[^;]*\bmedia_objects\b/i.test(executable), "a GRANT on media_objects appeared").toBe(false);
    expect(/\bgrant\b[^;]*\bon\b[^;]*\bpost_media\b(?!_for)/i.test(executable), "a GRANT on post_media appeared").toBe(false);
  });

  it("it alters no policy, table or column", () => {
    expect(/\b(create|alter|drop)\s+(policy|table)\b/i.test(executable)).toBe(false);
    expect(/alter table/i.test(executable)).toBe(false);
  });
});
