/**
 * A COMMENT WRITTEN AS TWO PARAGRAPHS IS DRAWN AS TWO PARAGRAPHS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT, AND WHY IT WAS SO HARD TO SEE
 *
 * Reported against the live staging bundle, 2026-08-28: multi-line comments
 * rendered on one line. Every step of the chain was correct except the last:
 *
 *   the database   post_comments 95c6f07c holds 'para one' + chr(10) +
 *                  'para two' — newline at position 9, length 17
 *   React          the DOM text node really did read "para one\npara two"
 *   the browser    the <p>, and the <span> RichContentRenderer puts inside it,
 *                  both computed `white-space: normal` — under which a newline
 *                  is just whitespace and collapses to a single space
 *
 * Rendered height 18px against a 20px line-height: one line. Nothing had eaten
 * the data; one CSS declaration was missing on the element that draws it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TEST ASSERTS THE COMPUTED STYLE
 *
 * `textContent` was never the problem — it contained the newline throughout,
 * so an assertion on the text passes just as happily against the broken build.
 * It has to be the property that decides whether the newline survives, on the
 * element that actually renders the text.
 *
 * jsdom does not lay text out, so it cannot be asked for a rendered height and
 * cannot count visual lines. What it does resolve is the cascade, including
 * INHERITANCE — which is the half that matters here, because the fix is applied
 * to the <p> and has to reach the <span> inside it.
 *
 * ⚠ THE TAILWIND UTILITY IS DECLARED IN THE TEST, and that is deliberate rather
 * than a cheat. No stylesheet is built for a unit test, so a class name on its
 * own computes to nothing. The one line injected below is Tailwind's own
 * definition of the utility, verbatim, so what is actually being asserted is:
 * the component puts that class on the element that draws the text, and the
 * declaration REACHES the inner span through inheritance. Take the class off
 * the component and the injected rule matches nothing — which is exactly how
 * this was proved.
 *
 * PRE-WRAP AND NOT PRE is asserted too. `pre` would also keep the newlines and
 * would stop long lines wrapping, so a pasted URL would run off the card — the
 * same failure `break-words` sits beside this property to prevent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVED BY REMOVING THE CLASS
 *
 * On 2026-08-28 `whitespace-pre-wrap` was taken back off the comment body and
 * this file was run against it: the computed value fell back to "" — the
 * injected rule matching nothing — and the three assertions that depend on it
 * failed. It was then put back.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const AUTHOR_ID = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
/** The owner's own test row on staging, character for character. */
const TWO_PARAGRAPHS = "para one\npara two";

vi.mock("@/components/UserIdentityBlock", () => ({
  default: ({ name }: { name: string | null }) => <span>{name}</span>,
}));
vi.mock("@/components/MentionInput", () => ({
  default: ({ placeholder }: { placeholder?: string }) => <input placeholder={placeholder} readOnly />,
}));

import CommentThread, { type ThreadComment } from "@/components/comments/CommentThread";

const comment = (over: Partial<ThreadComment> = {}): ThreadComment => ({
  id: "c1",
  user_id: AUTHOR_ID,
  content: TWO_PARAGRAPHS,
  created_at: "2026-08-20T10:00:00.000Z",
  updated_at: "2026-08-20T10:00:00.000Z",
  parent_id: null,
  is_pinned: false,
  author_name: "A Member",
  author_avatar: null,
  author_badges: [],
  author_last_active: null,
  like_count: 0,
  is_liked: false,
  replies: [],
  ...over,
});

/** Tailwind's own definition of the utility under test — nothing else. */
beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = ".whitespace-pre-wrap { white-space: pre-wrap; } .whitespace-pre { white-space: pre; }";
  document.head.appendChild(style);
});

const draw = (comments: ThreadComment[]) =>
  render(
    <MemoryRouter>
      <CommentThread
        comments={comments}
        loading={false}
        currentUserId="viewer-1"
        isAdmin={false}
        onAdd={() => {}}
        onEdit={async () => true}
        onDelete={() => {}}
      />
    </MemoryRouter>,
  );

/** The <p> that draws a comment body, found from the text it contains. */
const bodyOf = (text: string) => {
  const node = screen.getByText((_content, el) => {
    if (!el || el.tagName !== "P") return false;
    return (el.textContent ?? "") === text;
  });
  return node as HTMLElement;
};

describe("the newline in a comment survives to the screen", () => {
  it("keeps the newline in the text, as it always did", () => {
    draw([comment()]);
    // This passed against the BROKEN build too. It is here so that a future
    // regression that drops the newline earlier in the chain is told apart
    // from one that only collapses it in CSS.
    expect(bodyOf(TWO_PARAGRAPHS).textContent).toContain("\n");
  });

  it("renders the body with white-space: pre-wrap, so the newline is a line", () => {
    draw([comment()]);
    const body = bodyOf(TWO_PARAGRAPHS);
    expect(getComputedStyle(body).whiteSpace).toBe("pre-wrap");
  });

  it("PRE-WRAP, not PRE — a long line must still wrap", () => {
    draw([comment()]);
    const body = bodyOf(TWO_PARAGRAPHS);
    expect(getComputedStyle(body).whiteSpace, "`pre` keeps the breaks but runs a pasted URL off the card").not.toBe("pre");
    expect(body.className).not.toContain("whitespace-pre ");
    // The class name as well as the computed value: a Tailwind rename would
    // leave the injected rule matching nothing and this is what would say so.
    expect(body.className).toContain("whitespace-pre-wrap");
    expect(body.className).toContain("break-words");
  });

  /**
   * ⚠ WHAT THIS CAN AND CANNOT CHECK.
   *
   * `white-space` is an INHERITED property, so in a browser the declaration on
   * the <p> reaches RichContentRenderer's <span> on its own — that is why the
   * fix goes on the paragraph and not on both. jsdom does not propagate
   * inherited properties from a stylesheet to descendants, so asking the span
   * for a computed `pre-wrap` here returns "" and would fail against a build
   * that is perfectly correct. Asserting it anyway would be a test that lies.
   *
   * What CAN be checked, and is the real regression risk, is the other half:
   * the span must not declare a white-space of its OWN, because that would
   * override what it inherits. A `whitespace-normal` added to
   * RichContentRenderer, or passed down as `className`, would re-break exactly
   * this bug while the paragraph still looked right.
   */
  it("leaves the inner span free to inherit — it declares no white-space of its own", () => {
    draw([comment()]);
    const span = bodyOf(TWO_PARAGRAPHS).querySelector("span");
    expect(span, "RichContentRenderer's wrapper is gone — update this test").not.toBeNull();
    expect((span as HTMLElement).className, "a white-space class here overrides the inherited one")
      .not.toMatch(/whitespace-/);
    expect((span as HTMLElement).style.whiteSpace).toBe("");
  });

  it("covers REPLIES too, because they are the same row", () => {
    draw([comment({ id: "top", content: "top level", replies: [comment({ id: "r1" })] })]);
    expect(getComputedStyle(bodyOf(TWO_PARAGRAPHS)).whiteSpace).toBe("pre-wrap");
  });
});

/**
 * The post caption already had the pair and must keep it — it is the other
 * place a member's own line breaks are drawn, and it was checked when the
 * comment fault was found rather than assumed to be fine.
 */
describe("the post caption keeps the same pair", () => {
  it("Caption.tsx pairs whitespace-pre-wrap with break-words", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/components/post/Caption.tsx"), "utf8");
    expect(src).toMatch(/whitespace-pre-wrap break-words/);
  });

  it("so does the other comment surface, CommentsSection", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/components/CommentsSection.tsx"), "utf8");
    expect(src).toMatch(/whitespace-pre-wrap break-words/);
  });
});
