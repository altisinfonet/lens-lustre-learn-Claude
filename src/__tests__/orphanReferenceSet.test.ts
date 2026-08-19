/**
 * THE ORPHAN REFERENCE SET IS A DELETION SAFETY LIST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `detect-orphan-files` reports every stored file NOT named by its reference
 * set, and `purge-s3-orphans` deletes on that verdict. A column missing from
 * the list is a file deleted out of a live post. There is no undo.
 *
 * This test exists because on 2026-08-14 that file contained THREE compounding
 * defects, and the most dangerous one was invisible to code review:
 *
 *   1. THE LIST THAT LOOKED AUTHORITATIVE WAS DEAD CODE. `IMAGE_QUERIES` and
 *      `ARRAY_QUERIES` sat at the top of the file, full of correct-looking SQL,
 *      read by nothing. The list that actually ran was a second, divergent set
 *      of `addUrls(...)` calls 250 lines below. Editing the obvious one — which
 *      is what I did first — changed nothing at all. Trap #11.
 *
 *   2. `posts.thumbnail_urls` was in neither list, so every `-thumb.webp` was
 *      unreferenced by construction: 249 urls across 201 posts, measured.
 *
 *   3. A FAILED reference query was treated as an empty one, so a transient
 *      error on `posts` would have condemned every post image in that run.
 *
 * Defect 2 was survivable only because the scan enumerates Supabase Storage
 * while live uploads go to R2 — it is blind to the real store. The scheduled
 * next cycle is to make it R2-aware, which would have armed it.
 *
 * So the assertions below are not stylistic. Each one is a file that would
 * otherwise be deleted.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FN = "supabase/functions/detect-orphan-files/index.ts";
const raw = readFileSync(join(process.cwd(), FN), "utf8");

/** Comments must not be able to satisfy an assertion — the bug was IN a comment-shaped list. */
const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The block of the source that declares the live reference set. */
const referenceBlock =
  code.slice(
    code.indexOf("const REFERENCE_COLUMNS"),
    code.indexOf("const SNAPSHOT_COLUMNS"),
  ) || "";

/**
 * Every (table, column) that holds a path into the object store.
 *
 * Derived from production's information_schema on 2026-08-14, not from memory:
 *   select c.table_name, c.column_name from information_schema.columns c
 *     join information_schema.tables t using (table_schema, table_name)
 *    where c.table_schema='public' and t.table_type='BASE TABLE'
 *      and c.column_name ~ '(url|urls|photo|photos|image|images|avatar|cover|attachment|file|thumb)'
 *      and c.data_type in ('text','ARRAY','character varying');
 * ...minus columns holding EXTERNAL links, which never name a stored file.
 */
const MUST_BE_REFERENCED: [string, string[]][] = [
  ["ad_creatives", ["image_url", "advertiser_logo_url"]],
  ["album_photos", ["image_url"]],
  ["certificate_testimonials", ["photo_url"]],
  ["certificates", ["file_url"]],
  ["competitions", ["cover_image_url"]],
  ["competition_entries", ["photos", "photo_thumbnails"]],
  ["courses", ["cover_image_url"]],
  ["featured_artists", ["artist_avatar_url", "cover_image_url", "photo_gallery"]],
  ["featured_photos", ["image_url", "thumbnail_url"]],
  ["hero_banners", ["image_url", "thumbnail_url"]],
  ["highlight_items", ["image_url"]],
  ["highlights", ["cover_url"]],
  ["journal_articles", ["cover_image_url", "photo_gallery"]],
  ["judging_tags", ["image_url"]],
  ["lessons", ["image_url"]],
  ["office_staff", ["photo_url"]],
  ["photo_albums", ["cover_url"]],
  ["photo_of_the_day", ["image_url", "thumbnail_url"]],
  ["portfolio_images", ["image_url", "thumbnail_url"]],
  ["post_drafts", ["image_url", "image_urls", "thumbnail_urls"]],
  ["posts", ["image_url", "image_urls", "thumbnail_url", "thumbnail_urls"]],
  ["profiles", ["avatar_url", "national_id_url"]],
  ["scheduled_posts", ["image_url", "image_urls"]],
  ["stories", ["image_url"]],
  ["ticket_replies", ["attachment_url"]],
];

/** Pull `{ table: "x", columns: [...] }` entries out of the live block. */
function declared(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of referenceBlock.matchAll(
    /\{\s*table:\s*"([a-z0-9_]+)"\s*,\s*columns:\s*\[([^\]]*)\]/gi,
  )) {
    const cols = [...m[2].matchAll(/"([a-z0-9_]+)"/gi)].map((c) => c[1]);
    out.set(m[1], new Set(cols));
  }
  return out;
}

describe("the orphan reference set names every column that points at a stored file", () => {
  it("the live reference table exists and is non-trivial (guards a vacuous pass)", () => {
    const d = declared();
    expect(
      d.size,
      "REFERENCE_COLUMNS could not be parsed. Every assertion below would " +
        "silently pass against an empty map.",
    ).toBeGreaterThanOrEqual(MUST_BE_REFERENCED.length);
  });

  /**
   * THE TRAP THAT CAUGHT ME. A second list that looks authoritative and is read
   * by nothing is worse than no list: it absorbs the fix and reports success.
   */
  it("there is exactly ONE reference list, and no dead lookalike", () => {
    for (const dead of ["IMAGE_QUERIES", "ARRAY_QUERIES"]) {
      expect(
        code.includes(dead),
        `${dead} is back. That constant was a hand-maintained list of ` +
          `correct-looking SQL that nothing read, while the real reference set ` +
          `lived elsewhere and diverged. Editing it changes nothing and looks ` +
          `like a fix.`,
      ).toBe(false);
    }
  });

  it("the declared reference table is actually consumed by the scan", () => {
    expect(
      /for\s*\(\s*const\s*\{\s*table,\s*columns\s*\}\s+of\s+REFERENCE_COLUMNS\s*\)/.test(code),
      "REFERENCE_COLUMNS is declared but never iterated — it is decoration, " +
        "not a safety list.",
    ).toBe(true);
    expect(
      /addUrls\(\s*table\s*,\s*columns\s*\)/.test(code),
      "The loop does not pass its entries to addUrls, so nothing is collected.",
    ).toBe(true);
  });

  for (const [table, columns] of MUST_BE_REFERENCED) {
    for (const column of columns) {
      it(`${table}.${column} is referenced`, () => {
        const d = declared();
        expect(
          d.get(table)?.has(column),
          `${table}.${column} holds a path into the object store and is NOT in ` +
            `the reference set. Every file it names will be reported as an ` +
            `orphan and deleted by purge-s3-orphans.`,
        ).toBe(true);
      });
    }
  }

  /**
   * A partial reference set is more dangerous than no answer, because it looks
   * like an answer.
   */
  it("a failed reference query aborts the run instead of meaning 'no references'", () => {
    // ⚠ TIGHT ON PURPOSE. The loose `{ … 400 chars … throw` form is satisfied
    // by `if (error) { break; } if (false) { throw new Error(` — the exact
    // swallow this assertion forbids. Found 2026-08-19 by
    // tools/mutate-orphan-media.mjs, which slipped that shape past the loose
    // regex on the media read. The throw must be FIRST in the error branch.
    expect(
      /if\s*\(\s*error\s*\)\s*\{\s*throw new Error\(/.test(code),
      "A reference-scan error does not throw immediately. If `posts` fails " +
        "transiently, the run reports every post image as an orphan.",
    ).toBe(true);
    expect(
      /if\s*\(\s*error\s*\)\s*\{\s*(break|return|continue)\b/.test(code),
      "A reference-scan error breaks out of the page loop, which is the old " +
        "`error means empty table` bug wearing different punctuation.",
    ).toBe(false);
    expect(
      /if\s*\(\s*error\s*\|\|\s*!data/.test(code),
      "The old `if (error || !data || ...) break;` is back: an error is once " +
        "again indistinguishable from an empty table.",
    ).toBe(false);
  });

  /**
   * Recovery snapshots are references on purpose — a file that survives only
   * because a backup points at it is exactly the file a recovery needs.
   */
  it("recovery snapshots are treated as references", () => {
    expect(code).toMatch(/SNAPSHOT_COLUMNS/);
    expect(code).toMatch(/posts_dead_host_backup_20260812/);
  });

  /**
   * B3b made the scan R2-aware. The premise shifts, the discipline does not:
   * the report must state its scope truthfully PER RUN, and a failed R2 scan
   * must be impossible to mistake for a clean one.
   */
  it("the report states its scope truthfully, including when the R2 scan fails", () => {
    expect(
      /scope_warning/.test(code),
      "The response no longer states its own scope.",
    ).toBe(true);
    expect(
      /r2Scanned/.test(code) && /scan_error/.test(code),
      "The R2 section does not distinguish 'scanned and clean' from 'scan " +
        "failed'. A reader will infer clean from a section that simply did " +
        "not run — the exact confusion the B3a scope_warning existed to stop.",
    ).toBe(true);
  });

  it("an unknown R2 prefix is surfaced, never treated as an orphan", () => {
    expect(
      /r2UnknownPrefix\+\+/.test(code),
      "Objects under unrecognised prefixes must be counted and surfaced. " +
        "Deleting from ignorance is how the 263-file near-miss happened.",
    ).toBe(true);
  });

  it("the R2 orphan list is report-only in this function", () => {
    expect(
      /deleteS3Objects|deleteS3Keys|\?delete=/.test(code),
      "detect-orphan-files has acquired deletion capability. Detection and " +
        "deletion are separated on purpose: deletion runs only through " +
        "purge-s3-orphans under the Deletion Protocol.",
    ).toBe(false);
  });
});
