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
 *     the chooser and the disclosure ship together, or neither ships.
 *
 * Restoring the control and quietly dropping the notice would land exactly
 * where the withholding started — a control promising more than the platform
 * can keep — while looking, in a diff, like a tidy-up.
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

  it("the notice states the one fact a member needs", () => {
    expect(/direct link/i.test(notice)).toBe(true);
    expect(/photo file/i.test(notice)).toBe(true);
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
