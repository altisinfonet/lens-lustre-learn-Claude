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
    /**
     * ⚠ RETARGETED 2026-08-20 (WS2), AND MADE STRICTER, NOT WEAKER.
     *
     * This used to look for `thumbnail_urls: p.thumbnail_urls` inside
     * `duplicate.mutateAsync({…})`. The RED-2 fix moved the copy out of that
     * inline literal into `duplicateScheduledPostInput`, because the literal is
     * the shape that dropped four other fields. The old assertion would now
     * fail against a CORRECT implementation — a stale target, the same class of
     * bug as the retargeted mutations in tools/mutate-write-path.mjs.
     *
     * The invariant is unchanged: a duplicate must carry the source row's
     * thumbnails. It is now checked where the copy actually happens, and the
     * component is additionally required to delegate rather than rebuild — so
     * this is a stronger assertion than the one it replaces, not a looser one.
     */
    const hook = read("src/hooks/feed/useScheduledPosts.ts");
    const builder = hook.slice(
      hook.indexOf("export function duplicateScheduledPostInput"),
      hook.indexOf("export function assertCarriesMemberChoices"),
    );
    expect(builder.length, "duplicateScheduledPostInput not found").toBeGreaterThan(0);
    expect(
      /thumbnail_urls:\s*source\.thumbnail_urls\s*\?\?\s*\[\]/.test(builder),
      "Duplicate reuses the same image objects but drops their thumbnails — " +
        "the copy publishes heavy.",
    ).toBe(true);

    const list = read("src/components/post/ScheduledPostsList.tsx");
    const call = list.slice(list.indexOf("duplicate.mutateAsync"), list.indexOf("duplicate.mutateAsync") + 600);
    expect(
      /duplicate\.mutateAsync\(duplicateScheduledPostInput\(/.test(call),
      "the component builds the copy itself again — that literal is what dropped " +
        "media_ids, privacy, indexing_disabled and categories (RED-2).",
    ).toBe(true);
  });

  it("storage: the insert hook writes thumbnail_urls", () => {
    const hook = read("src/hooks/feed/useScheduledPosts.ts");
    /**
     * ⚠ RETARGETED 2026-08-20 (WS2). The `?? []` was REMOVED on purpose: a
     * default at the insert is indistinguishable from a member's choice, which
     * is exactly how RED-2 turned a private post public one field over. The
     * column must still be written — that is the invariant — and the caller is
     * now required by the type to supply it.
     */
    expect(
      /thumbnail_urls:\s*input\.thumbnail_urls,/.test(hook),
      "useCreateScheduledPost does not write thumbnail_urls — the column exists " +
        "and nobody writes it.",
    ).toBe(true);
    // Scoped to the WRITE type. On the READ type `thumbnail_urls?: string[] | null`
    // is correct and deliberate — the column is NULL on rows scheduled before
    // 2026-08-14 and the generated types lag the migration.
    const writeType = hook.slice(
      hook.indexOf("export interface CreateScheduledPostInput {"),
      hook.indexOf("export function duplicateScheduledPostInput"),
    );
    expect(
      /thumbnail_urls\?:/.test(writeType),
      "thumbnail_urls is optional again on the WRITE type — omission stops being a compile error.",
    ).toBe(false);
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
