/**
 * THE BACKFILL WRITES MEMBER DATA INTO A NEW SHAPE — SO IT KEEPS DELETION'S
 * CEREMONY, AND ITS REFUSALS ARE THE SAFETY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * B5-2 gives all 210 existing posts a real media_objects row and a post_media
 * reference. Three properties decide whether that is safe to run twice, or
 * halfway, or on a bad day:
 *
 *   1. IT IS ADDITIVE. It must never touch posts.image_urls and never delete.
 *      If the backfill is wrong, the member-visible site is unaffected and the
 *      fix is to remove rows nobody reads yet.
 *   2. IT IS WHOLE-POST OR NOTHING. A post is backfilled only when EVERY slide
 *      is plannable. Writing a partial reference set by hand would create
 *      exactly the half-published state the publish gate (B5-1) refuses at the
 *      front door — the backfill must not be the back door.
 *   3. IT HASHES THE WHOLE FILE. sha256 is the platform's content identity.
 *      A hash over a ranged read is identical for every photograph sharing a
 *      container header, which would silently collapse different photographs
 *      into one row and mis-target a future takedown.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const fn = strip(
  readFileSync(join(process.cwd(), "supabase/functions/backfill-media-objects/index.ts"), "utf8"),
);
const s3 = strip(readFileSync(join(process.cwd(), "supabase/functions/_shared/s3.ts"), "utf8"));

describe("additive only — the live site cannot be harmed by this job", () => {
  it("never writes to posts and never deletes anything", () => {
    expect(
      /from\("posts"\)[\s\S]{0,80}\.(update|delete|upsert)\(/.test(fn),
      "the backfill now writes to the posts table — it is supposed to be " +
        "additive, leaving image_urls exactly as the live site reads them.",
    ).toBe(false);
    expect(
      /\.delete\(\)|deleteS3Objects|\.remove\(/.test(fn),
      "the backfill deletes something. It has no delete budget and no " +
        "Deletion Protocol run; anything it removes is removed unprotected.",
    ).toBe(false);
  });

  it("only ever inserts into media_objects and post_media", () => {
    const writes = [...fn.matchAll(/from\("([a-z_]+)"\)\s*\n?\s*\.insert\(/g)].map((m) => m[1]);
    expect(writes.length, "no inserts found — the job cannot be doing its work").toBeGreaterThan(0);
    for (const t of writes) {
      expect(["media_objects", "post_media"]).toContain(t);
    }
  });
});

describe("whole-post or nothing (the back door must match the front door)", () => {
  it("a post is executed only when every one of its slides is plannable", () => {
    expect(
      /if \(planned === total && total > 0\) wholePosts\.push\(post\.id\);/.test(fn),
      "the whole-post gate is gone — a post with one unreadable slide would " +
        "be given a partial reference set, which is the half-published state " +
        "B5-1 refuses at the front door.",
    ).toBe(true);
    expect(
      /for \(const postId of wholePosts\)/.test(fn),
      "execution no longer iterates the fully-plannable set.",
    ).toBe(true);
  });

  it("partial posts are REPORTED, not silently dropped", () => {
    expect(/posts_skipped_partial: partialPosts/.test(fn)).toBe(true);
  });

  it("references are written with contiguous ords from 0", () => {
    expect(/\.map\(\(m, idx\) => \(\{ post_id: postId, ord: idx, media_id: m\.id \}\)\)/.test(fn)).toBe(true);
  });
});

describe("content identity is computed from the WHOLE file", () => {
  it("the backfill reads whole objects, never a ranged head, for hashing", () => {
    expect(/readS3Object\(s3, prefix \+ sl\.key\)/.test(fn), "no whole-object read").toBe(true);
    expect(
      /readS3ObjectHead/.test(fn),
      "the backfill uses the RANGED reader. Every photograph sharing a " +
        "container header would hash identically and collapse into one row.",
    ).toBe(false);
  });

  it("readS3Object issues an unranged GET", () => {
    const body = s3.slice(s3.indexOf("export async function readS3Object("));
    expect(body.length > 0, "readS3Object is missing from the shared client").toBe(true);
    expect(
      /Range:/.test(body.slice(0, 600)),
      "readS3Object sends a Range header — it is no longer reading the whole object.",
    ).toBe(false);
  });

  it("dimensions are recovered or the slide is refused — never guessed", () => {
    expect(/refused to guess/.test(fn)).toBe(true);
    expect(/dimsFromName\(sl\.key\) \?\? imageDimsFromBytes\(bytes\)/.test(fn)).toBe(true);
  });
});

describe("the same ceremony as deletion", () => {
  it("dry-run is the default", () => {
    expect(/let dryRun = true;/.test(fn)).toBe(true);
  });
  it("execution needs expected_count from a prior dry run and aborts on drift", () => {
    expect(/if \(expectedCount === null\) \{/.test(fn)).toBe(true);
    expect(/if \(expectedCount !== wholePosts\.length\) \{/.test(fn)).toBe(true);
  });
  it("per-run cap with a hard ceiling the request cannot exceed", () => {
    expect(/Math\.min\(body\.max_posts, HARD_MAX_POSTS\)/.test(fn)).toBe(true);
  });
  it("both scans are fail-loud — an error is not 'nothing to do'", () => {
    expect(/throw new Error\(`post_media scan failed/.test(fn)).toBe(true);
    expect(/throw new Error\(`post scan failed/.test(fn)).toBe(true);
  });
  it("admin only", () => {
    expect(/Admin access required/.test(fn)).toBe(true);
  });
});

describe("resumability", () => {
  it("posts that already have references are skipped", () => {
    expect(/!done\.has\(row\.id\)/.test(fn)).toBe(true);
  });
  it("an existing fingerprint is REUSED rather than duplicated", () => {
    expect(/mediaReused\+\+/.test(fn)).toBe(true);
    expect(/\.eq\("owner_id", sl\.user_id\)\.eq\("sha256", sha\)/.test(fn)).toBe(true);
  });
  it("a failed post is reported and left untouched for the next run", () => {
    expect(/failures\.push\(\{ post_id: postId/.test(fn)).toBe(true);
  });
  it("the state machine is walked, not bypassed", () => {
    // Inserting a row straight to 'ready' is possible for the service role and
    // would make the backfill the one writer that never proves it read bytes.
    expect(/media_mark_verified/.test(fn)).toBe(true);
    expect(/media_mark_ready/.test(fn)).toBe(true);
    expect(
      /state:\s*["']ready["']/.test(fn),
      "the backfill inserts media directly as ready, bypassing the state " +
        "machine that exists to make unverified bytes unpublishable.",
    ).toBe(false);
  });
  it("writes are verified by reading back", () => {
    expect(/verification failed: \$\{count\} references present/.test(fn)).toBe(true);
  });
});
