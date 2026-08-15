/**
 * THE CONTENT HASH MUST NOT BECOME AN ADDRESS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `20260814084711_media_objects.sql` separates three identities on purpose:
 *
 *   content identity    media_objects.sha256   server-side ONLY
 *   object identity     media_objects.id       a random uuid — the public address
 *   reference identity  post_media rows        the basis for "may this viewer see it"
 *
 * The reason is not tidiness. Post media is served from a PUBLIC CDN. If the
 * address is derived from the content, anyone holding candidate bytes computes
 * the URL and issues ONE GET to learn whether that photograph exists on the
 * platform — no upload, no account, nothing to rate-limit meaningfully. Put the
 * owner in the path as well and it becomes a confirmation oracle for "did this
 * specific person post this specific image", because `user_id` is public.
 *
 * That is also why dedup is `UNIQUE (owner_id, sha256)` and not global: two
 * members with identical bytes get two rows and two unguessable addresses, so
 * there is nothing to observe.
 *
 * The migration's own comment says this invariant is "enforced by
 * src/__tests__/mediaIdentityContainment.test.ts". This is that file. A comment
 * claiming enforcement that does not exist is trap #11 with extra confidence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAN AND CANNOT CATCH — stated plainly, because a reader who
 * overestimates it will stop looking.
 *
 * CAN:  a migration adding `sha256` to a RETURNS TABLE, an OUT parameter or a
 *       view — the three ways a column leaves the database through PostgREST.
 *       A storage path or CDN URL built from a hash rather than the object id.
 * CANNOT: a hash exfiltrated by an edge function, or one embedded in a jsonb
 *       payload under a different key name. Those need review, not a regex.
 *
 * Note the asymmetry that is DELIBERATE: the client may SEND a sha256 (it
 * computes the hash it claims, which the server then re-derives from the stored
 * bytes before promoting the row past `pending`). What it must never do is
 * RECEIVE one back, or address anything by one. So this test targets returns
 * and addresses, not payloads in general.
 *
 * Migrations are resolved at run time, never by a hardcoded filename — trap #8:
 * a test pinned to a superseded file passes forever while production drifts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const SRC = join(process.cwd(), "src");

/** Same mandate window as securityDefinerGrants.test.ts, for the same reason. */
const MANDATE_FROM = "20260813000000";

const migrationFiles = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (f.match(/^(\d{14})/)?.[1] ?? "0") >= MANDATE_FROM)
  .sort();

const migration = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");

/** Strip `--` line comments and `/* *​/` blocks so prose cannot satisfy or trip a check. */
const stripSql = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const srcFiles = walk(SRC);
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the media content hash never becomes a public address", () => {
  /**
   * VACUITY GUARDS.
   *
   * Every assertion below is of the form "X does not appear". Delete the column
   * and they all pass. These two make that failure loud instead of silent.
   */
  it("the migration defining media_objects.sha256 is present and in scope", () => {
    const defining = migrationFiles.filter((f) =>
      /CREATE\s+TABLE[^;]*public\.media_objects[\s\S]*?sha256\s+bytea/i.test(stripSql(migration(f))),
    );
    expect(
      defining.length,
      "No in-scope migration defines media_objects.sha256. Either the mandate " +
        "window moved past it or the column was renamed — in both cases every " +
        "other assertion in this file is now checking nothing.",
    ).toBeGreaterThan(0);
  });

  it("dedup is scoped to the owner, not global", () => {
    const all = migrationFiles.map(migration).map(stripSql).join("\n");
    expect(
      /CREATE\s+UNIQUE\s+INDEX[^;]*ON\s+public\.media_objects\s*\(\s*owner_id\s*,\s*sha256\s*\)/i.test(
        all,
      ),
      "media_objects must be UNIQUE (owner_id, sha256). A global UNIQUE (sha256) " +
        "makes an upload response leak whether ANOTHER member already holds those " +
        "exact bytes, and makes deletion and DMCA takedown affect a stranger's post.",
    ).toBe(true);
    expect(
      /CREATE\s+UNIQUE\s+INDEX[^;]*ON\s+public\.media_objects\s*\(\s*sha256\s*\)/i.test(all),
      "media_objects has a UNIQUE index on sha256 ALONE — that is the global " +
        "content-addressed design the owner condition rejected.",
    ).toBe(false);
  });

  /**
   * RETURNS TABLE / OUT parameters are how a column leaves the database through
   * PostgREST. Checked per migration so the failure names the file.
   */
  for (const file of migrationFiles) {
    const sql = stripSql(migration(file));
    if (!/sha256/i.test(sql)) continue;

    it(`${file}: no function returns sha256 to a caller`, () => {
      const returnsTables = [...sql.matchAll(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*(?:LANGUAGE|AS|SET|SECURITY|STABLE|VOLATILE|IMMUTABLE)/gi)];
      for (const [, cols] of returnsTables) {
        expect(
          /\bsha256\b/i.test(cols),
          `A RETURNS TABLE in ${file} declares sha256. The content hash must not ` +
            `leave the database: any caller who can obtain it can then confirm, ` +
            `for arbitrary candidate bytes, whether that image is on the platform.`,
        ).toBe(false);
      }

      // OUT parameters are the same exposure with different syntax.
      const outParams = [...sql.matchAll(/\bOUT\s+([a-z0-9_]+)\s/gi)].map((m) => m[1]);
      expect(outParams.map((s) => s.toLowerCase())).not.toContain("sha256");
    });

    it(`${file}: no view selects sha256`, () => {
      const views = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+[\s\S]*?;/gi)].map(
        (m) => m[0],
      );
      for (const v of views) {
        expect(
          /\bsha256\b/i.test(v),
          `A view in ${file} exposes sha256. Views are readable through PostgREST ` +
            `exactly like tables.`,
        ).toBe(false);
      }
    });
  }

  /**
   * The storage layout is `media/<object_id>/<size>.webp`. The object id is a
   * random uuid precisely so the path carries no information. This catches the
   * shape of the mistake — a path template interpolating something hash-shaped.
   */
  it("no storage path or URL is built from a hash", () => {
    const offenders: string[] = [];
    for (const p of srcFiles) {
      const code = stripTs(readFileSync(p, "utf8"));
      // `media/${sha}`, `/media/${hash}/`, "media/" + digest, …
      if (/["'`][^"'`]*media\/[^"'`]*\$\{[^}]*(?:sha|hash|digest)[^}]*\}/i.test(code)) {
        offenders.push(p.replace(process.cwd() + "/", ""));
      }
    }
    expect(
      offenders,
      "A media path is interpolated from a hash. The address must be " +
        "media_objects.id — a random uuid — so that holding the bytes does not " +
        "reveal the URL.",
    ).toEqual([]);
  });

  /**
   * A client that reads the column back has already lost the property, whether
   * or not it renders it. `.select("… sha256 …")` against media_objects is the
   * concrete shape.
   */
  it("no client query selects sha256 off media_objects", () => {
    const offenders: string[] = [];
    for (const p of srcFiles) {
      const code = stripTs(readFileSync(p, "utf8"));
      if (!/media_objects/.test(code)) continue;
      // .from("media_objects").select("…sha256…") in either order, same statement.
      if (/from\(\s*["'`]media_objects["'`]\s*\)[\s\S]{0,400}?select\(\s*["'`][^"'`]*sha256/i.test(code)) {
        offenders.push(p.replace(process.cwd() + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The whole design rests on `state`: only `ready` may be referenced by a post,
   * and that is enforced by a trigger rather than by every future writer
   * remembering. If the trigger goes, the gate goes.
   */
  it("post_media is gated on media state by a trigger, not by convention", () => {
    const all = migrationFiles.map(migration).map(stripSql).join("\n");
    expect(
      /CREATE\s+TRIGGER\s+trg_post_media_requires_ready[\s\S]{0,200}?ON\s+public\.post_media/i.test(
        all,
      ),
      "trg_post_media_requires_ready is missing. Without it a post can reference " +
        "media whose bytes were never verified against the hash the client claimed.",
    ).toBe(true);
    expect(
      /BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.post_media/i.test(all),
      "The gate must fire on UPDATE as well as INSERT — otherwise a row is " +
        "inserted pointing at ready media and then repointed at unverified media.",
    ).toBe(true);
  });
});
