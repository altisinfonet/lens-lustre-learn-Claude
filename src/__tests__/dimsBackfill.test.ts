/**
 * THE DIMS BACKFILL REWRITES MEMBER DATA — SO IT KEEPS THE SAME CEREMONY AS
 * DELETION, AND ITS ORDERING IS THE SAFETY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * copy → verify → update: a member's post must never, at any instant, point at
 * a name that does not answer. A crash mid-run leaves extra copies (harmless,
 * collectable at 30 days) — never a broken row. These assertions lock that
 * ordering, the protocol gates, and the two naming agreements the job depends
 * on (dims shape ↔ DIMS_RE; skip-don't-guess ↔ the parsers' refusal default).
 * insertDimsInName is additionally tested on VALUES, because the renamed files
 * are only useful if the renderer's regex actually parses the result.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { insertDimsInName } from "../../supabase/functions/_shared/imageDims";

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const fn = strip(
  readFileSync(join(process.cwd(), "supabase/functions/backfill-image-dims/index.ts"), "utf8"),
);

describe("insertDimsInName produces exactly what the renderer parses", () => {
  // The renderer's contract, copied from imageFrame.ts DIMS_RE.
  const DIMS_RE = /-w(\d{1,6})h(\d{1,6})(?:-l3)?(?:-thumb)?\.[a-z0-9]+$/i;

  it("key form", () => {
    const out = insertDimsInName("post-images/u/posts/169-abc.webp", 1620, 1080);
    expect(out).toBe("post-images/u/posts/169-abc-w1620h1080.webp");
    expect(DIMS_RE.test(out)).toBe(true);
  });
  it("URL form with query string", () => {
    const out = insertDimsInName("https://cdn.x/post-images/u/p/a.webp?v=1", 900, 1600);
    expect(out).toBe("https://cdn.x/post-images/u/p/a-w900h1600.webp?v=1");
  });
  it("key and URL transforms agree — the two can never disagree", () => {
    const key = "post-images/u/p/a.webp";
    const url = `https://cdn.x/${key}`;
    expect(insertDimsInName(url, 10, 20)).toBe(`https://cdn.x/${insertDimsInName(key, 10, 20)}`);
  });
});

describe("protocol gates (rewriting 153 slides deserves deletion's ceremony)", () => {
  it("dry-run is the default", () => {
    expect(/let dryRun = true;/.test(fn)).toBe(true);
  });
  it("execution requires expected_count from a prior dry run, and aborts on drift", () => {
    // ⚠ Mutation D2 ESCAPED a message-based version: `if (false)` dead-branched
    // the gate while its abort STRING survived and satisfied the regex. Assert
    // the live CONDITIONS, not the prose they guard.
    expect(
      /if \(expectedCount === null\) \{/.test(fn),
      "the null-check gate condition is gone — execution proceeds without a dry-run count",
    ).toBe(true);
    expect(
      /if \(expectedCount !== plan\.length\) \{/.test(fn),
      "the drift gate condition is gone — stale dry-run counts execute anyway",
    ).toBe(true);
  });
  it("batch cap with a hard ceiling the request body cannot exceed", () => {
    expect(/HARD_MAX_POSTS/.test(fn)).toBe(true);
    expect(/Math\.min\(body\.max_posts, HARD_MAX_POSTS\)/.test(fn)).toBe(true);
  });
  it("the candidate scan is fail-loud and paginated — an error is not 'done'", () => {
    expect(/throw new Error\(`candidate scan failed/.test(fn)).toBe(true);
    expect(/\.range\(from, from \+ PAGE - 1\)/.test(fn)).toBe(true);
  });
});

describe("ordering is the safety: copy → verify → update", () => {
  it("the copy is verified before any row is touched", () => {
    const copyAt = fn.indexOf("copyS3Object(s3,");
    const verifyAt = fn.indexOf("copy verification failed");
    const updateAt = fn.indexOf('.update({ image_urls: newUrls');
    expect(copyAt, "no copy call").toBeGreaterThan(-1);
    expect(verifyAt, "no copy verification — a row could point at a name that does not answer").toBeGreaterThan(copyAt);
    expect(updateAt, "no row update").toBeGreaterThan(verifyAt);
  });
  it("the row update is itself verified by reading back", () => {
    expect(/post-update verification failed/.test(fn)).toBe(true);
  });
  it("old objects are left for the Deletion Protocol — this job deletes nothing", () => {
    expect(/deleteS3Objects|deleteS3Keys|\?delete=/.test(fn)).toBe(false);
    expect(/Old objects were NOT deleted/.test(fn)).toBe(true);
  });
  it("a failed post is reported, not half-written", () => {
    expect(/failures\.push\(\{ post_id: postId/.test(fn)).toBe(true);
  });
});

describe("skip, never guess", () => {
  it("supabase-hosted, unmanaged, missing and unparseable slides are skipped WITH reasons", () => {
    for (const reason of [
      "supabase_storage_host",
      "unmanaged_url_shape",
      "object_not_found_in_r2",
      "header_unparseable",
    ]) {
      expect(fn.includes(reason), `skip reason '${reason}' missing — that class would be guessed or silently dropped`).toBe(true);
    }
  });
  it("re-runs are idempotent: an existing copy is reused, not duplicated", () => {
    expect(/already_copied/.test(fn)).toBe(true);
    expect(/if \(!sl\.already_copied\) \{/.test(fn)).toBe(true);
  });
  it("candidate detection mirrors the renderer's dims pattern", () => {
    expect(/-w\\d\{1,6\}h\\d\{1,6\}\(\?:-l3\)\?\(\?:-thumb\)\?/.test(fn)).toBe(true);
  });
});
