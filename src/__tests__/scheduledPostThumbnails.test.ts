/**
 * A SCHEDULED POST PUBLISHES WITH ITS THUMBNAILS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The B3 pre-audit measured the cost of the gap this locks: 9 of 210
 * production posts have images and NO thumbnails, so they serve a full-size
 * original wherever a thumbnail belongs. At least one arrived through the
 * scheduled-post path, which had the defect end to end:
 *
 *   compose  — WallPosts GENERATED thumbnails (`uploadedThumbs`) and then
 *              threw them away, because…
 *   storage  — `scheduled_posts` had no thumbnail_urls column, so…
 *   publish  — publish-scheduled-posts inserted posts with no thumbnails,
 *              and could not have done otherwise.
 *
 * Three files, one chain. This test asserts every link, because restoring any
 * ONE of them silently reopens the gap: a column nobody writes is dead schema,
 * a write the publisher drops is lost data, and a publisher line without the
 * compose-time write publishes empty arrays forever.
 *
 * Source assertions, comments stripped first so prose cannot satisfy them.
 * Migrations are resolved at run time, never by hardcoded filename (trap #8).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (p: string) => strip(readFileSync(join(process.cwd(), p), "utf8"));

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const MANDATE_FROM = "20260813000000";
const allMigrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && (f.match(/^(\d{14})/)?.[1] ?? "0") >= MANDATE_FROM)
  .map((f) => strip(readFileSync(join(MIGRATIONS, f), "utf8")))
  .join("\n");

describe("scheduled posts carry thumbnails end to end", () => {
  it("schema: an in-scope migration adds scheduled_posts.thumbnail_urls", () => {
    expect(
      /ALTER\s+TABLE\s+public\.scheduled_posts\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+thumbnail_urls\s+text\[\]/i.test(
        allMigrations,
      ),
      "No migration adds scheduled_posts.thumbnail_urls — the column the whole " +
        "chain writes into does not exist.",
    ).toBe(true);
  });

  it("compose: the schedule branch passes the thumbnails it already generated", () => {
    const wall = read("src/components/WallPosts.tsx");
    // The schedule payload must carry uploadedThumbs. Anchor on the mutateAsync
    // call so a thumbnail reference elsewhere in this large file cannot satisfy it.
    const call = wall.slice(wall.indexOf("createScheduled.mutateAsync"), wall.indexOf("createScheduled.mutateAsync") + 900);
    expect(
      /thumbnail_urls:\s*uploadedThumbs/.test(call),
      "WallPosts generates thumbnails (uploadedThumbs) and does not pass them " +
        "when scheduling — they are generated and thrown away, the original defect.",
    ).toBe(true);
  });

  it("compose: duplicating a scheduled post keeps its thumbnails", () => {
    const list = read("src/components/post/ScheduledPostsList.tsx");
    const call = list.slice(list.indexOf("duplicate.mutateAsync"), list.indexOf("duplicate.mutateAsync") + 600);
    expect(
      /thumbnail_urls:\s*p\.thumbnail_urls/.test(call),
      "Duplicate reuses the same image objects but drops their thumbnails — " +
        "the copy publishes heavy.",
    ).toBe(true);
  });

  it("storage: the insert hook writes thumbnail_urls", () => {
    const hook = read("src/hooks/feed/useScheduledPosts.ts");
    expect(
      /thumbnail_urls:\s*input\.thumbnail_urls\s*\?\?\s*\[\]/.test(hook),
      "useCreateScheduledPost does not write thumbnail_urls — the column exists " +
        "and nobody writes it.",
    ).toBe(true);
  });

  it("publish: the publisher carries thumbnails into posts", () => {
    const pub = read("supabase/functions/publish-scheduled-posts/index.ts");
    // Anchor on the actual INSERT payload (identified by `user_id: row.user_id`)
    // — the first `.from("posts")` in this file is a duplicate-check QUERY, and
    // anchoring there made this assertion inspect the wrong block. Caught when
    // this test failed against a correct publisher.
    const at = pub.indexOf("user_id: row.user_id");
    expect(at, "publisher insert payload not found").toBeGreaterThan(-1);
    const insertBlock = pub.slice(at, at + 700);
    expect(
      /thumbnail_urls:\s*row\.thumbnail_urls\s*\?\?\s*\[\]/.test(insertBlock),
      "publish-scheduled-posts inserts posts without thumbnail_urls — every " +
        "scheduled post publishes serving full-size originals as thumbnails.",
    ).toBe(true);
  });

  it("safety: the rollback refuses to discard carried thumbnails", () => {
    const rollbackDir = join(process.cwd(), "supabase/rollback");
    const files = readdirSync(rollbackDir).filter((f) => /scheduled_post_thumbnails/i.test(f));
    expect(files.length, "no rollback file for the thumbnails migration").toBeGreaterThan(0);
    const rb = strip(readFileSync(join(rollbackDir, files[0]), "utf8"));
    expect(
      /RAISE EXCEPTION 'ROLLBACK ABORTED/.test(rb),
      "The rollback drops the column unconditionally — pending posts carrying " +
        "thumbnails would silently publish without them.",
    ).toBe(true);
  });
});
