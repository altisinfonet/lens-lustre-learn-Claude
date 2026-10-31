/**
 * THE RETURN KEY IS LABELLED WITH WHAT IT ACTUALLY DOES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ ENTER DOES NOT POST ON A TOUCH DEVICE, AND THAT IS THE WHOLE REASON THIS
 * FILE EXISTS.
 *
 * `handleKeyDown` returns early when `(pointer: coarse)` matches, so Enter
 * inserts a new line there — an owner decision from 2026-08-03, because a phone
 * keyboard has no Shift and a member would otherwise never be able to write a
 * second line. The 44px round button is the send route on a phone.
 *
 * So `enterKeyHint="send"` — asked for on 2026-08-28 on the assumption that
 * Enter posts on mobile — would put the word "Send" on a key that inserts a
 * line break. The attribute is therefore derived from the SAME media query the
 * key handler reads, and both branches are pinned below so the label and the
 * behaviour cannot drift apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VISIBLE HINT IS GONE, ON PURPOSE (2026-08-29).
 *
 * A one-line hint under the composer shipped with the key label on 2026-08-28
 * — "Enter to post · Shift + Enter for a new line" on a desktop, "Enter starts
 * a new line · tap the arrow to post" on touch. The owner had it removed the
 * next day with NO replacement text. Only the visible line went; the
 * conditional Enter handling and the key label stayed exactly as they were.
 *
 * That removal is pinned below rather than merely done, because a hint is the
 * kind of thing a later reader re-adds "helpfully" without knowing it was
 * considered and rejected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * react-mentions needs layout to position its overlay; the sentence under the
 * box and the attribute on the field are what is under test, so the library is
 * replaced by a plain textarea that forwards the props this file asserts on.
 */
vi.mock("react-mentions", () => ({
  MentionsInput: ({ children: _children, ...props }: Record<string, unknown>) => (
    <textarea
      data-testid="field"
      placeholder={props.placeholder as string}
      enterKeyHint={props.enterKeyHint as never}
      autoCapitalize={props.autoCapitalize as string}
      value={props.value as string}
      onChange={() => {}}
    />
  ),
  Mention: () => null,
}));
vi.mock("@/lib/profilesPublic", () => ({ profilesPublic: () => ({ select: () => ({ ilike: () => ({ limit: async () => ({ data: [] }) }) }) }) }));

import MentionInput from "@/components/MentionInput";

/** Point the media query at a finger or at a mouse, the way the code asks it. */
const setPointer = (coarse: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

const draw = (props: Record<string, unknown> = {}) =>
  render(<MentionInput value="" onChange={() => {}} onSubmit={() => {}} {...props} />);

afterEach(() => setPointer(false));
beforeEach(() => setPointer(false));

describe("on a desktop, where Enter really does post", () => {
  it("labels the key 'send' — inert on a desktop, but true", () => {
    draw();
    expect(screen.getByTestId("field")).toHaveAttribute("enterkeyhint", "send");
  });
});

describe("on a touch device, where Enter inserts a line", () => {
  it("labels the key 'enter', because 'send' would lie about what it does", () => {
    setPointer(true);
    draw();
    expect(screen.getByTestId("field")).toHaveAttribute("enterkeyhint", "enter");
  });
});

describe("no visible hint under the box, on any device", () => {
  /**
   * Removed by the owner on 2026-08-29, the day after it shipped, with nothing
   * put in its place. Both sentences are named here so that re-adding either
   * one is a decision somebody has to take on purpose rather than a tidy-up.
   */
  const GONE = [
    /Enter to post/i,
    /Shift \+ Enter for a new line/i,
    /Enter starts a new line/i,
    /tap the arrow to post/i,
  ];

  for (const coarse of [false, true]) {
    it(`renders none of the removed hint text (${coarse ? "touch" : "desktop"})`, () => {
      setPointer(coarse);
      draw({ value: "typing something" });
      for (const gone of GONE) {
        expect(screen.queryByText(gone), `the removed hint is back: ${gone}`).toBeNull();
      }
    });
  }

  it("still shows the over-limit line, which was never the hint", () => {
    // The one line under the box that DOES remain. It is not a running counter
    // — the owner's 2026-08-04 ban — it appears only past the limit, where a
    // disabled send button would otherwise be a silent dead control.
    draw({ value: "x".repeat(12), maxLength: 10 });
    expect(screen.getByText(/over the 10 limit/i)).toBeInTheDocument();
  });
});

/**
 * One string, not two. The post cards said "Write a comment..." and the ad card
 * "Add a comment…" — different words and a different ellipsis (one U+2026
 * character against three full stops), a leftover of the two threads having
 * once been two implementations.
 */
describe("one placeholder across every comment surface", () => {
  it("the shared thread owns it and the ad card no longer overrides it", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

    expect(read("src/components/comments/CommentThread.tsx"))
      .toContain('export const COMMENT_PLACEHOLDER = "Write a comment..."');
    for (const f of ["src/components/ads/AdComments.tsx", "src/components/PostCommentsSection.tsx"]) {
      expect(read(f), `${f} must not carry a placeholder of its own`).not.toContain("composerPlaceholder=");
    }
  });
});
