/**
 * THE BADGE SHOWS WHEREVER THE NAME SHOWS — INCLUDING IN NARROW CARDS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner rule, standing and restated 2026-08-04 with a screenshot:
 * "Tanmay De and many others Badge is not showing. Master formula was on each
 *  and every place Name with Badge will show, here you missed."
 *
 * WHY IT WENT MISSING, and why "just use UserIdentityBlock" was not enough:
 *
 * The universal layout is Name + Badge on ONE line. Since the name-overlap fix,
 * the badge row carries `shrink-[9999]` — it yields essentially all available
 * width to the NAME, by design, because the owner ruled "Name 1st visible then
 * Badge". In a wide row that is right. In the 132px friend-suggestion card there
 * is no spare width at all, so the badge is squeezed to zero and the member sees
 * a name and nothing else. Two correct rules, combined, produced a wrong result.
 *
 * `stack` resolves it: the badge moves to its own line under the name, so both
 * rules hold — the name is never truncated by the badge, and the badge is never
 * squeezed away.
 *
 * These tests render the REAL component in jsdom (AutoBadge/AutoRole mocked to
 * fixed markup) and assert the DOM STRUCTURE, not the class strings.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The mock mirrors the real split: `only="verified"` draws just the blue tick,
 * `only="pills"` draws just the award pills, `only="all"` draws both. A mock
 * that ignored `only` would render the same node twice in the stacked layout
 * and quietly pass tests that mean nothing.
 */
vi.mock("@/components/AutoBadge", () => ({
  default: ({ userId, only = "all" }: { userId: string; only?: string }) => (
    <>
      {only !== "pills" && <span data-testid="tick">TICK:{userId}</span>}
      {only !== "verified" && <span data-testid="badge">BADGE:{userId}</span>}
    </>
  ),
}));
vi.mock("@/components/AutoRole", () => ({ default: () => null }));

import UserIdentityBlock from "../UserIdentityBlock";

const draw = (props: Record<string, unknown>) =>
  render(
    <MemoryRouter>
      <UserIdentityBlock userId="u1" name="Tanmay De" {...props} />
    </MemoryRouter>,
  );

describe("nothing is dropped in either layout", () => {
  it("inline renders both the tick and the pills", () => {
    const { getByTestId } = draw({});
    expect(getByTestId("tick")).toBeTruthy();
    expect(getByTestId("badge")).toBeTruthy();
  });

  it("stacked renders both the tick and the pills", () => {
    const { getByTestId } = draw({ stack: true, align: "center" });
    expect(getByTestId("tick")).toBeTruthy();
    expect(getByTestId("badge")).toBeTruthy();
  });

  it("stacked draws each exactly once — no double render", () => {
    const { queryAllByTestId } = draw({ stack: true });
    expect(queryAllByTestId("tick")).toHaveLength(1);
    expect(queryAllByTestId("badge")).toHaveLength(1);
  });
});

describe("stack moves the PILLS off the name's line — but not the blue tick", () => {
  /**
   * Owner question, 2026-08-04: "For verified badge blue icon, that will be
   * showing on next line or same line with the name?"
   *
   * Same line. The tick is a fixed 14px glyph that always fits, and its meaning
   * is "this name is the real person" — a tick sitting a line below the name it
   * verifies reads as decoration. Only the award pills, which are words and
   * need room, move down.
   */
  it("inline: name and pills share one parent element", () => {
    const { getByTestId, getByText } = draw({});
    expect(getByTestId("badge").parentElement?.contains(getByText("Tanmay De"))).toBe(true);
  });

  it("stacked: the pills' row does NOT contain the name", () => {
    // This is the whole point — on its own line the pill cannot be out-competed
    // for width by the name.
    const { getByTestId, getByText } = draw({ stack: true });
    expect(getByTestId("badge").parentElement?.contains(getByText("Tanmay De"))).toBe(false);
  });

  it("stacked: the blue tick DOES stay on the name's line", () => {
    const { getByTestId, getByText } = draw({ stack: true });
    expect(getByTestId("tick").parentElement?.contains(getByText("Tanmay De"))).toBe(true);
  });

  it("stacked: order is name, then tick, then pills", () => {
    // Owner rule: "Name 1st visible then Badge."
    const { getByTestId, getByText } = draw({ stack: true });
    const name = getByText("Tanmay De");
    const after = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(name.compareDocumentPosition(getByTestId("tick")) & after).toBeTruthy();
    expect(getByTestId("tick").compareDocumentPosition(getByTestId("badge")) & after).toBeTruthy();
  });

  it("stacked: the name can shrink so the tick is never pushed out of the card", () => {
    // `w-full` on the name would leave no room for the tick beside it.
    const { getByText } = draw({ stack: true, align: "center" });
    expect(getByText("Tanmay De").className).not.toMatch(/\bw-full\b/);
    expect(getByText("Tanmay De").className).toMatch(/\bmin-w-0\b/);
  });
});

describe("nothing else moves", () => {
  it("the default is the inline layout that every existing surface uses", () => {
    // If `stack` ever defaults to true, every profile row in the app changes
    // shape. This is the guard.
    const a = draw({}).container.innerHTML;
    const b = draw({ stack: false }).container.innerHTML;
    expect(a).toBe(b);
  });

  it("align defaults to start — centring is opt-in for card layouts only", () => {
    const a = draw({}).container.innerHTML;
    const b = draw({ align: "start" }).container.innerHTML;
    expect(a).toBe(b);
    expect(a).not.toMatch(/text-center/);
  });

  it("centring reaches the name, so a short name is not left-hugging in a card", () => {
    const { getByText } = draw({ stack: true, align: "center" });
    expect(getByText("Tanmay De").className).toMatch(/text-center/);
  });

  it("the name is a link to the member's NAME url when a handle is given", () => {
    const { getByText } = draw({ stack: true, handle: "tanmay.de" });
    const el = getByText("Tanmay De");
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/tanmay.de");
  });

  it("F-95 — with NO handle the name is PLAIN TEXT, never an id address", () => {
    // The prop used to be a finished path and every caller passed
    // `/profile/${id}`, which is the one address the Owner's rule forbids: an
    // in-app click never reaches the edge redirect, so the id would sit in the
    // address bar and stay there. Plain text is the answer - the member is
    // still named and still readable, and nothing offers that address.
    const { getByText } = draw({ stack: true, handle: null });
    const el = getByText("Tanmay De");
    expect(el.tagName).toBe("SPAN");
    expect(el.closest("a")).toBeNull();
  });
});
