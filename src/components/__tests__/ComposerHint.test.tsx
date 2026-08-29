/**
 * THE COMPOSER SAYS HOW TO POST, AND SAYS THE TRUE THING FOR THE DEVICE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * Owner, 2026-08-28, after testing the live box: *"Shift+Enter does insert a
 * newline and plain Enter submits ... but nothing tells anyone — there is no
 * hint under the box and enterkeyhint is not set"*. Both behaviours had worked
 * for months and neither was written anywhere, so Shift+Enter could only be
 * found by guessing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THE HINT IS NOT THE SAME SENTENCE ON EVERY DEVICE, AND THAT IS THE POINT.
 *
 * Enter does NOT post on a touch device. `handleKeyDown` returns early when
 * `(pointer: coarse)` matches, so Enter inserts a new line there — an owner
 * decision from 2026-08-03, because a phone keyboard has no Shift and a member
 * would otherwise never be able to write a second line. The 44px round button
 * is the send route on a phone.
 *
 * So a single hardcoded "Enter to post" would be wrong on every phone, and
 * `enterKeyHint="send"` — asked for on the assumption that Enter posts on
 * mobile — would put the word "Send" on a key that inserts a line break. Both
 * the sentence and the key label are therefore derived from the SAME media
 * query the key handler reads, and these tests pin both branches so the three
 * can never drift apart.
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
  render(
    <MentionInput value="" onChange={() => {}} onSubmit={() => {}} showHint {...props} />,
  );

afterEach(() => setPointer(false));
beforeEach(() => setPointer(false));

describe("on a desktop, where Enter really does post", () => {
  it("says so, and names Shift+Enter for the new line", () => {
    draw();
    expect(screen.getByText(/Enter to post/i)).toBeInTheDocument();
    expect(screen.getByText(/Shift \+ Enter for a new line/i)).toBeInTheDocument();
  });

  it("labels the key 'send' — inert on a desktop, but true", () => {
    draw();
    expect(screen.getByTestId("field")).toHaveAttribute("enterkeyhint", "send");
  });
});

describe("on a touch device, where Enter inserts a line", () => {
  it("does NOT claim Enter posts — it points at the button", () => {
    setPointer(true);
    draw();
    expect(screen.getByText(/Enter starts a new line/i)).toBeInTheDocument();
    expect(screen.queryByText(/Enter to post/i), "this would be a lie on a phone").toBeNull();
  });

  it("labels the key 'enter', because 'send' would lie about what it does", () => {
    setPointer(true);
    draw();
    expect(screen.getByTestId("field")).toHaveAttribute("enterkeyhint", "enter");
  });
});

describe("the hint stays out of the way", () => {
  it("is off unless asked for, so replies and edit boxes do not repeat it", () => {
    render(<MentionInput value="" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByText(/Enter to post/i)).toBeNull();
  });

  it("yields to the over-limit line, which is the more urgent thing to read", () => {
    draw({ value: "x".repeat(12), maxLength: 10 });
    expect(screen.getByText(/over the 10 limit/i)).toBeInTheDocument();
    expect(screen.queryByText(/Enter to post/i)).toBeNull();
  });

  it("is a fixed sentence, not the running counter the owner banned", () => {
    draw({ value: "still typing" });
    const hint = screen.getByText(/Enter to post/i);
    expect(hint.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
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
