/**
 * THE AUDIENCE CHOOSER MAY BE OFFERED — BUT NEVER WITHOUT SAYING WHAT IT DOES
 * NOT COVER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This file REPLACES `PrivacyChooserWithheld.test.ts`, which pinned the opposite
 * rule. That test was right for its day: on 2026-08-16 the chooser was withheld
 * because the database honours a post's privacy and THE DIRECT IMAGE URL DOES
 * NOT — the `post-images` bucket is public and its `storage.objects` SELECT
 * policy is `(bucket_id = 'post-images')`, with no privacy condition at all.
 * Offering a control that does not do what it says is worse than not offering
 * it. (docs/DECISIONS.md, D-001.)
 *
 * THE GAP HAS NOT CLOSED. It is still exactly as described: authorized media
 * delivery is built but unused, and a "Friends" or "Only me" post keeps a
 * publicly fetchable photo URL.
 *
 * WHAT CHANGED IS THE DECISION, AND IT IS THE OWNER'S TO MAKE. Told plainly
 * that hiding the link inside the app fixes nothing — the file is served with
 * no server-side check, so a URL obtained at any point keeps working for ever —
 * he chose to restore the chooser with the gap DISCLOSED rather than keep
 * members waiting on it. (D-002.)
 *
 * So the rule this file pins is the condition of that decision:
 *
 *     the chooser and the notice ship together, or neither ships.
 *
 * Restoring the control and quietly dropping the notice would land exactly
 * where the withholding started — a control promising more than the platform
 * can keep — while looking, in a diff, like a tidy-up.
 *
 * ⚠ IT SAID "the disclosure" UNTIL 2026-08-29. On that day the owner shortened
 * the notice to "{who} will see this post on 50mm Retina World." and dropped
 * the sentence about the photo file being reachable by direct link. The notice
 * therefore no longer DISCLOSES the gap; it states the audience. The gap is
 * unchanged, D-002 stays ACTIVE, and the change is recorded in
 * docs/DECISIONS.md. This file was narrowed to match — deliberately, and with
 * the reasoning below the assertion that changed.
 *
 * ⚠ WHEN THIS FAILS, DO NOT DELETE IT TO GET GREEN. Deleting it removes the
 * only thing keeping the promise honest. It becomes correct to remove this file
 * ONLY once authorized media delivery is live and the Media-URL cell is green —
 * at which point the notice is deleted too, because there is no longer a gap to
 * disclose, and D-002 is closed in the same commit.
 *
 * @decision D-002
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const ROOT = process.cwd();
const WALL = join(ROOT, "src/components/WallPosts.tsx");
const CHOOSER = join(ROOT, "src/components/post/PostAudienceChooser.tsx");
const NOTICE = join(ROOT, "src/components/post/PrivacyGapNotice.tsx");

const wall = stripComments(readFileSync(WALL, "utf8"));
const chooser = existsSync(CHOOSER) ? readFileSync(CHOOSER, "utf8") : "";
const notice = existsSync(NOTICE) ? readFileSync(NOTICE, "utf8") : "";
/**
 * ⚠ THE COPY IS PINNED AGAINST THE CODE, NOT AGAINST THE FILE.
 *
 * The old assertions matched /direct link/ and /photo file/ against the raw
 * file — and this component's own header quotes both phrases, so those checks
 * could have passed on the documentation alone while the rendered sentence said
 * something else entirely. That trap has been paid for twice in this repository
 * already; see src/test-utils/sourceText.ts.
 */
const noticeCode = existsSync(NOTICE) ? stripComments(notice) : "";

describe("a member is never offered a privacy without being told its limit", () => {
  it("the chooser and the notice both exist (guards against a vacuous pass)", () => {
    expect(existsSync(CHOOSER), "PostAudienceChooser.tsx is gone").toBe(true);
    expect(
      existsSync(NOTICE),
      "PrivacyGapNotice.tsx is gone — the chooser now promises privacy the CDN cannot keep",
    ).toBe(true);
  });

  it("BOTH composers render the chooser — the web's and the app's", () => {
    /**
     * The composer has TWO audience controls: one on the web's first screen and
     * one on screen 2, which is the ONLY one an Android member ever reaches.
     * When these were withheld, the web one was removed first and believed
     * done; the test failed and named the other. That asymmetry cuts the same
     * way now they are back — restore one and the app and the website disagree
     * about what a member may choose.
     */
    const uses = wall.match(/<PostAudienceChooser\b/g) ?? [];
    expect(
      uses.length,
      "expected the audience chooser at BOTH composers (web screen 1, app screen 2)",
    ).toBe(2);
    expect(/variant="inline"/.test(wall), "the web composer's chooser is missing").toBe(true);
    expect(/variant="row"/.test(wall), "the APP composer's chooser is missing").toBe(true);
  });

  it("all three audiences are offered, not a narrowed set", () => {
    for (const value of ["public", "friends", "private"]) {
      expect(
        new RegExp(`value:\\s*"${value}"`).test(chooser),
        `the "${value}" audience is gone from PRIVACY_OPTIONS`,
      ).toBe(true);
    }
    expect(/PRIVACY_OPTIONS\.map\(/.test(chooser), "the options are no longer rendered").toBe(true);
  });

  it("the notice is rendered BY the chooser, so it cannot be dropped separately", () => {
    /**
     * This is the structural half of the rule. The notice lives inside the same
     * component as the control, so there is no arrangement of WallPosts.tsx
     * that offers the choice silently — you would have to edit the chooser
     * itself, which this assertion covers.
     */
    expect(
      /<PrivacyGapNotice\s+privacy=\{value\}\s*\/>/.test(chooser),
      "the chooser no longer renders the gap notice — the control and its disclosure " +
        "have been separated, which is how one of them goes missing",
    ).toBe(true);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * ⚠ THE COPY WAS SHORTENED ON 2026-08-29, AND D-002 DID NOT CLOSE.
   *
   * Until that day the notice read:
   *
   *     "{who} will see this post on 50mm Retina World. The photo file itself
   *      can still be opened by anyone who has its direct link — we are still
   *      building that protection."
   *
   * and this test pinned the second sentence, because the second sentence WAS
   * the disclosure. The owner has since chosen the first sentence alone. It is
   * a deliberate UI-copy decision, confirmed with him, and it is recorded in
   * docs/DECISIONS.md under D-002 so that a later reader does not take it for
   * an accidental deletion.
   *
   * BE HONEST ABOUT WHAT THAT LEAVES. The gap is untouched: `post-images` is
   * still a public bucket with no privacy condition on its SELECT policy, and
   * the photograph behind an "Only me" post is still fetchable by anyone
   * holding its URL. What the member is now told is who can see the POST. They
   * are no longer told about the file.
   *
   * So this file no longer pins a disclosure — it pins the exact copy the owner
   * approved, and the structural rule that the notice ships with the chooser.
   * The pin was narrowed on purpose; it was not weakened by accident, and it
   * was not deleted.
   * ─────────────────────────────────────────────────────────────────────────
   */
  it("the notice carries the exact copy the owner approved", () => {
    expect(noticeCode).toContain("{who} will see this post on 50mm Retina World.");
    expect(/const who = privacy === "private" \? "Only you" : "Only your friends";/.test(noticeCode))
      .toBe(true);
  });

  it("the sentence dropped on 2026-08-29 has not drifted back unannounced", () => {
    /**
     * Not a bar on ever disclosing the file gap again — it is a bar on doing it
     * SILENTLY. Restoring that sentence is the owner's call, the same way
     * removing it was, and it comes with an update to D-002 and to this test.
     */
    expect(noticeCode, "the file-gap sentence is back without a decision record")
      .not.toMatch(/direct link/i);
    expect(noticeCode).not.toMatch(/photo file/i);
  });

  it("the notice appears for restricted audiences and NOT for public", () => {
    // A public post has no gap to disclose; showing the notice there would
    // train people to ignore it, which is how a true warning stops working.
    expect(/privacy === "friends" \|\| privacy === "private"/.test(notice)).toBe(true);
    expect(/if \(!privacyHasFileGap\(privacy\)\) return null;/.test(notice)).toBe(true);
  });

  it("privacy is still carried end to end, and still defaults to public", () => {
    expect(wall).toContain("privacy: newPrivacy");
    expect(wall).toMatch(/useState<Privacy>\(\s*["']public["']\s*\)/);
  });
});
