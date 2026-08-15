/**
 * A POST NEVER EXISTS WITHOUT ALL OF ITS PHOTOGRAPHS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The B4 matrix left one row open (R15): a post could be created with a gap in
 * its photo list, because nothing checked completeness. The original design
 * proposed a `status` column moving pending_media → published — but `posts`
 * has only ever held published rows (drafts live in `post_drafts`, scheduled
 * ones in `scheduled_posts`), so that column would have imposed a filter
 * obligation on every reader to represent a state no row would occupy.
 *
 * The property is obtained instead by never creating the incomplete state:
 * one transaction inserts the post AND every reference, verifies the count,
 * and only then commits. Harness-proven (harness/b5/publish_transcript.txt):
 * 3 photos → ords {0,1,2}; a pending photo, a stolen photo, a repeated photo,
 * an empty list, an anonymous caller and a ghost id are each refused with the
 * post rolled back; the same idempotency key twice returns ONE post.
 *
 * Assertions resolve the LAST definition across migrations — CREATE OR REPLACE
 * means a later file silently wins, so a corpus-wide grep would keep passing
 * against a superseded version.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const ROLLBACKS = join(process.cwd(), "supabase/rollback");
const MANDATE_FROM = "20260813000000";

const inScope = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (f.match(/^(\d{14})/)?.[1] ?? "0") >= MANDATE_FROM)
  .sort();

const strip = (f: string) =>
  readFileSync(join(MIGRATIONS, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");

const bodies = inScope.map(strip);
const all = bodies.join("\n");

function lastDefinitionOf(fn: string): string {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\$function\\$[\\s\\S]*?\\$function\\$`,
    "gi",
  );
  let latest = "";
  for (const body of bodies) {
    const hits = [...body.matchAll(re)];
    if (hits.length) latest = hits[hits.length - 1][0];
  }
  return latest;
}

describe("atomic publish (closes B4 matrix row R15)", () => {
  const fn = lastDefinitionOf("post_publish_with_media");

  it("an in-scope migration defines the publish path (vacuity guard)", () => {
    expect(
      fn.length > 0,
      "No in-scope migration defines post_publish_with_media — every assertion " +
        "below would pass against an empty string.",
    ).toBe(true);
  });

  it("references are generated from the array's own ordinality — a gap is not expressible", () => {
    // This is the whole R15 fix: ords come from WITH ORDINALITY, so there is
    // no code path that can skip one. Hand-built ord arithmetic would reopen it.
    expect(
      /FROM unnest\(_media_ids\) WITH ORDINALITY AS t\(mid, ord\)/.test(fn),
      "references are no longer generated from the array ordinality — ords " +
        "can drift or gap, which is exactly what R15 measured.",
    ).toBe(true);
    expect(/SELECT _post_id, ord - 1, mid/.test(fn), "ords no longer start at 0").toBe(true);
  });

  it("the completeness gate runs AFTER the references are inserted", () => {
    const insertAt = fn.indexOf("INSERT INTO public.post_media");
    const gateAt = fn.indexOf("publish aborted:");
    expect(insertAt, "no reference insert").toBeGreaterThan(-1);
    expect(
      gateAt > insertAt,
      "the completeness check no longer follows the insert — it would be " +
        "counting rows that have not been written yet and always pass.",
    ).toBe(true);
  });

  it("ownership AND readiness are both required of every photograph", () => {
    expect(
      /mo\.id IS NULL OR mo\.owner_id <> _uid OR mo\.state <> 'ready'/.test(fn),
      "the ownership/readiness predicate changed — a member could attach " +
        "someone else's photograph, or bytes that were never verified.",
    ).toBe(true);
  });

  it("a repeated photograph is refused before anything is written", () => {
    const dupAt = fn.indexOf("appears more than once");
    const insertAt = fn.indexOf("INSERT INTO public.posts");
    expect(dupAt, "the duplicate-photo check is gone").toBeGreaterThan(-1);
    expect(dupAt < insertAt, "the duplicate check now runs after the post is created").toBe(true);
  });

  it("a retry with the same key returns the first post instead of making a second", () => {
    expect(/WHERE user_id = _uid AND idempotency_key = _idempotency_key/.test(fn)).toBe(true);
    expect(
      /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+posts_user_idempotency_key[\s\S]*?WHERE idempotency_key IS NOT NULL/i.test(all),
      "the idempotency index is gone or is no longer partial — a partial " +
        "index is what keeps the 210 legacy posts (all NULL) out of it.",
    ).toBe(true);
  });

  it("the publish path is closed to anonymous callers", () => {
    expect(
      /REVOKE ALL ON FUNCTION public\.post_publish_with_media\([^)]*\) FROM PUBLIC, anon;/.test(all),
      "post_publish_with_media is no longer revoked from anon — ALTER DEFAULT " +
        "PRIVILEGES grants EXECUTE to anon on every new function.",
    ).toBe(true);
  });

  it("it ships with the rollback the protocol requires", () => {
    const m = inScope.find((f) => /atomic_publish_with_media/.test(f));
    expect(m, "the atomic-publish migration is missing").toBeTruthy();
    expect(
      existsSync(join(ROLLBACKS, m!.replace(/\.sql$/, "_ROLLBACK.sql"))),
      "no rollback at supabase/rollback/ for the atomic-publish migration",
    ).toBe(true);
  });
});
