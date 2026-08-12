/**
 * MENTIONS IN POST CAPTIONS — 1053 headline item, pinned.
 *
 * Owner: "typing @name in a post caption tags a member, like comments do."
 *
 * The rules under test:
 *  1. Only names the author actually PICKED from the dropdown convert to
 *     `@[Name](id)` markup — a hand-typed "@Someone" stays plain text,
 *     because tagging the wrong member is worse than tagging nobody.
 *  2. The stored markup is byte-identical in format to what comments store,
 *     so RichContentRenderer / Caption.tsx render it with zero changes.
 *  3. The composer keeps its plain <Textarea> (the over-limit highlight and
 *     auto-grow are owner-approved) — mentions layer on top via the hook.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { activeMentionQuery, applyCaptionMentions } from "@/lib/captionMentions";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";

describe("applyCaptionMentions — picked names become comment-style markup", () => {
  it("converts a picked @Name to @[Name](id)", () => {
    expect(
      applyCaptionMentions("Sunset with @Partha Dalal today", [
        { display: "Partha Dalal", id: ID_A },
      ]),
    ).toBe(`Sunset with @[Partha Dalal](${ID_A}) today`);
  });

  it("a hand-typed name that was never picked stays plain text", () => {
    expect(applyCaptionMentions("Sunset with @Partha Dalal today", [])).toBe(
      "Sunset with @Partha Dalal today",
    );
  });

  it("converts every picked mention, and longest names first so a longer name is never half-eaten", () => {
    const out = applyCaptionMentions("@Partha Dalal Roy and @Partha Dalal met", [
      { display: "Partha Dalal", id: ID_A },
      { display: "Partha Dalal Roy", id: ID_B },
    ]);
    expect(out).toBe(`@[Partha Dalal Roy](${ID_B}) and @[Partha Dalal](${ID_A}) met`);
  });

  it("a picked name immediately followed by a letter is a different word — untouched", () => {
    expect(
      applyCaptionMentions("@Parthasarathi is not @Partha", [{ display: "Partha", id: ID_A }]),
    ).toBe(`@Parthasarathi is not @[Partha](${ID_A})`);
  });

  it("an edited pick no longer matches and degrades to plain text, never a wrong tag", () => {
    expect(
      applyCaptionMentions("with @Partha Dal", [{ display: "Partha Dalal", id: ID_A }]),
    ).toBe("with @Partha Dal");
  });

  it("existing markup is not converted twice", () => {
    const already = `hi @[Partha Dalal](${ID_A})`;
    expect(
      applyCaptionMentions(already, [{ display: "Partha Dalal", id: ID_A }]),
    ).toBe(already);
  });

  it("markup format is exactly what RichContentRenderer parses", () => {
    const rendererSrc = readFileSync(
      join(__dirname, "..", "..", "components", "RichContentRenderer.tsx"),
      "utf8",
    );
    // The renderer's token regex parses @[Name](id) — the exact shape we emit.
    expect(rendererSrc).toContain("@\\[([^\\]]+)\\]\\(([^)]+)\\)");
    const out = applyCaptionMentions("@Ana B", [{ display: "Ana B", id: ID_A }]);
    expect(out).toMatch(/@\[([^\]]+)\]\(([^)]+)\)/);
  });
});

describe("activeMentionQuery — when the dropdown may open", () => {
  it("finds the query being typed at the end", () => {
    expect(activeMentionQuery("hello @par", 10)).toEqual({ query: "par", start: 6 });
  });

  it("allows one internal space (first + last name)", () => {
    expect(activeMentionQuery("@partha da", 10)).toEqual({ query: "partha da", start: 0 });
  });

  it("stops at a second space — that is a sentence, not a name", () => {
    expect(activeMentionQuery("@a b c", 6)).toBeNull();
  });

  it("an email-style @ (preceded by a word character) never opens the dropdown", () => {
    expect(activeMentionQuery("mail me x@y", 11)).toBeNull();
  });

  it("a newline ends the mention", () => {
    expect(activeMentionQuery("@par\ntha", 8)).toBeNull();
  });

  it("finished markup is not a query", () => {
    expect(activeMentionQuery("@[Ana](id)", 10)).toBeNull();
  });

  it("no @ before the caret → null", () => {
    expect(activeMentionQuery("plain text", 5)).toBeNull();
  });
});

describe("the composer is wired, the textarea is kept", () => {
  const wall = readFileSync(
    join(__dirname, "..", "..", "components", "WallPosts.tsx"),
    "utf8",
  );

  it("WallPosts converts at EVERY submit site (post + schedule + save draft)", () => {
    // Was two — post and schedule. Stage C added a third: saving a draft must
    // store the SAME @[Name](id) markup, or a mention typed before saving would
    // come back as plain text on resume and publish without its link.
    expect(wall).toContain("useCaptionMentions");
    const conversions = wall.match(/captionMentions\.convert\(newContent\.trim\(\)\)/g) || [];
    expect(conversions.length).toBe(3);
  });

  it("the plain Textarea (with its over-limit overlay) survives — mentions did not replace it", () => {
    expect(wall).toContain("<Textarea");
    expect(wall).toContain("delete the highlighted text");
  });

  it("picks are forgotten when the caption is cleared after posting", () => {
    const resets = wall.match(/captionMentions\.reset\(\)/g) || [];
    expect(resets.length).toBeGreaterThanOrEqual(2);
  });

  it("the dropdown taps use onPointerDown (Android WebView rule)", () => {
    expect(wall).toContain("captionMentions.pick(s)");
    expect(wall.slice(wall.indexOf("captionMentions.open"))).toContain("onPointerDown");
  });
});
