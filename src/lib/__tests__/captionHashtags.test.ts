/**
 * THE HASHTAG TRIGGER RULE, PINNED.
 *
 * These tests exist because the trigger rule is the one part of the hashtag
 * feature that cannot be checked by looking at a screen: a dropdown that
 * appears one character too early or too late looks identical in a screenshot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { activeHashtagQuery, applyHashtagPick, MAX_TAG_LENGTH } from "@/lib/captionHashtags";

describe("activeHashtagQuery — when the list may open", () => {
  it("reads the tag being typed at the caret", () => {
    const text = "morning light #str";
    expect(activeHashtagQuery(text, text.length)).toEqual({ query: "str", start: 14 });
  });

  it("returns null when there is no hash at all", () => {
    expect(activeHashtagQuery("morning light", 13)).toBeNull();
  });

  it("opens with an empty query on a bare '#' — the hook, not this, decides not to ask the server", () => {
    expect(activeHashtagQuery("look #", 6)).toEqual({ query: "", start: 5 });
  });

  it("closes as soon as a space follows the tag", () => {
    const text = "#street ";
    expect(activeHashtagQuery(text, text.length)).toBeNull();
  });

  it("closes on a newline", () => {
    const text = "#street\nnext line";
    expect(activeHashtagQuery(text, text.length)).toBeNull();
  });

  it("closes on punctuation, which cannot be part of a tag", () => {
    expect(activeHashtagQuery("#street,", 8)).toBeNull();
    expect(activeHashtagQuery("#street!", 8)).toBeNull();
  });

  it("accepts digits and underscores, because the database does", () => {
    const text = "#aug_gallerycontest2026";
    expect(activeHashtagQuery(text, text.length)).toEqual({
      query: "aug_gallerycontest2026",
      start: 0,
    });
  });

  it("stops offering past the 60-character ceiling the database enforces", () => {
    const ok = "#" + "a".repeat(MAX_TAG_LENGTH);
    expect(activeHashtagQuery(ok, ok.length)).not.toBeNull();
    const tooLong = "#" + "a".repeat(MAX_TAG_LENGTH + 1);
    expect(activeHashtagQuery(tooLong, tooLong.length)).toBeNull();
  });

  it("measures from the caret, not the end of the text", () => {
    // Caret sits right after "#st", with more text to its right.
    expect(activeHashtagQuery("a #st more words", 5)).toEqual({ query: "st", start: 2 });
  });

  it("reads the LAST hash, so a second tag replaces the first", () => {
    const text = "#street #po";
    expect(activeHashtagQuery(text, text.length)).toEqual({ query: "po", start: 8 });
  });

  /**
   * THE DELIBERATE ONE. Kept as a test rather than a comment because it looks
   * like a bug to anyone reading it cold, and the next person to "fix" it
   * would silently split the platform's definition of a hashtag in three.
   *
   * RichContentRenderer matches #(\w+) anywhere, and the database trigger
   * matches #([A-Za-z0-9_]{1,60}) anywhere. So "C#sharp" ALREADY produces a
   * real, clickable, counted tag "#sharp". The composer follows suit.
   */
  it("follows the renderer exactly: '#' mid-word still starts a tag, because the platform counts it", () => {
    const text = "written in C#sharp";
    expect(activeHashtagQuery(text, text.length)).toEqual({ query: "sharp", start: 12 });
  });

  it("stays shut once the member moves on to an @mention — the two lists cannot both be open", () => {
    const text = "#street @par";
    expect(activeHashtagQuery(text, text.length)).toBeNull();
  });

  it("survives a caret outside the text without throwing", () => {
    expect(activeHashtagQuery("#str", 999)).toEqual({ query: "str", start: 0 });
    expect(activeHashtagQuery("#str", -5)).toBeNull();
  });
});

describe("applyHashtagPick — what lands in the caption", () => {
  it("replaces the typed prefix with the full tag and one trailing space", () => {
    const text = "morning light #str";
    const q = activeHashtagQuery(text, text.length)!;
    const { next, caret } = applyHashtagPick(text, q.start, text.length, "StreetPhotography");
    expect(next).toBe("morning light #StreetPhotography ");
    expect(caret).toBe(next.length);
  });

  it("keeps whatever sat to the right of the caret", () => {
    const text = "a #st more words";
    const q = activeHashtagQuery(text, 5)!;
    const { next, caret } = applyHashtagPick(text, q.start, 5, "street");
    expect(next).toBe("a #street  more words");
    // Caret lands after the inserted space, not at the end of the line.
    expect(next.slice(0, caret)).toBe("a #street ");
  });

  it("never doubles the hash", () => {
    const { next } = applyHashtagPick("#s", 0, 2, "street");
    expect(next).toBe("#street ");
    expect(next.startsWith("##")).toBe(false);
  });
});

/**
 * SCOPE, PINNED — the owner said it twice, in these words:
 *   "tHIS SYSTEM I WANT ONLY OST SECTION ITSELF. not in other areas"
 *   "Post Section Only"
 *
 * A dropdown is easy to add to one more box in passing. This test makes doing
 * so a CI failure, so the scope survives people who never read the thread.
 */
describe("scope: the hashtag list appears in the post section and nowhere else", () => {
  const ROOT = join(__dirname, "..", "..");

  const ALLOWED = [
    "components/WallPosts.tsx", // web composer AND the app's caption screen
    "components/post/PostCard.tsx", // inline caption edit
    "components/post/EditScheduledPostDialog.tsx", // scheduled-post caption edit
  ];

  it("is imported by exactly the four caption surfaces and no others", () => {
    const users = ALLOWED.filter((f) =>
      readFileSync(join(ROOT, f), "utf8").includes("HashtagSuggestions"),
    );
    expect(users.sort()).toEqual([...ALLOWED].sort());
  });

  it("is rendered twice in WallPosts — the web composer and the app caption screen are different boxes", () => {
    const src = readFileSync(join(ROOT, "components/WallPosts.tsx"), "utf8");
    const rendered = src.match(/<HashtagSuggestions/g) ?? [];
    expect(rendered).toHaveLength(2);
  });

  it("does not reach comments, search, bios or messages", () => {
    for (const f of [
      "components/PostCommentsSection.tsx",
      "components/CommentsSection.tsx",
      "components/GlobalSearch.tsx",
      "components/MentionInput.tsx",
    ]) {
      expect(readFileSync(join(ROOT, f), "utf8")).not.toContain("HashtagSuggestions");
    }
  });
});
