/**
 * THE BLUE TICK AND THE AWARD PILLS CAN BE DRAWN SEPARATELY.
 *
 * Owner question, 2026-08-04: "For verified badge blue icon, that will be
 * showing on next line or same line with the name?"
 *
 * Same line — so a narrow layout has to be able to ask for the tick alone and
 * the pills alone. `UserBadgeInline` is where that split actually happens;
 * `UserIdentityBlock`'s tests mock this component away, so without these the
 * split would be proven only against a mock of itself.
 */

import { describe, it, expect, vi } from "vitest";
import { render, within } from "@testing-library/react";

vi.mock("@/components/VerifiedBadge", () => ({
  default: () => <span data-testid="tick" />,
}));
vi.mock("@/hooks/profile/useBadgeDefinitions", () => ({
  useBadgeDefinitions: () =>
    new Map([["top_rated", { label: "TOP RATED", icon: "★", badge_class: "bg-amber-500/15" }]]),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: () => null,
}));

import UserBadgeInline from "../UserBadgeInline";

/**
 * Queries are scoped to THIS render's container. Testing Library's bound
 * queries search the whole document by default, so two renders in one test
 * would find each other's nodes and the assertions would mean nothing.
 */
const draw = (badges: string[], only?: "all" | "verified" | "pills") => {
  const r = render(<UserBadgeInline badges={badges} only={only} />);
  return { container: r.container, ...within(r.container) };
};

const BOTH = ["verified", "top_rated"];

describe("only=all — today's behaviour, unchanged", () => {
  it("draws the tick and the pill together", () => {
    const { queryByTestId, queryByText } = draw(BOTH);
    expect(queryByTestId("tick")).toBeTruthy();
    expect(queryByText("TOP RATED")).toBeTruthy();
  });

  it("is what you get when `only` is not passed at all", () => {
    // Every existing call site omits it. If the default ever changed, badges
    // would silently disappear across the app.
    expect(draw(BOTH).container.innerHTML).toBe(draw(BOTH, "all").container.innerHTML);
  });
});

describe("only=verified — the tick alone", () => {
  it("draws the tick", () => {
    expect(draw(BOTH, "verified").queryByTestId("tick")).toBeTruthy();
  });

  it("draws no pill", () => {
    expect(draw(BOTH, "verified").queryByText("TOP RATED")).toBeNull();
  });

  it("renders nothing at all when the member is not verified", () => {
    // Otherwise an empty inline box would still take the row's gap next to the
    // name of every unverified member.
    expect(draw(["top_rated"], "verified").container.innerHTML).toBe("");
  });
});

describe("only=pills — the awards alone", () => {
  it("draws the pill", () => {
    expect(draw(BOTH, "pills").queryByText("TOP RATED")).toBeTruthy();
  });

  it("draws no tick", () => {
    expect(draw(BOTH, "pills").queryByTestId("tick")).toBeNull();
  });

  it("renders nothing when verified is the member's only badge", () => {
    expect(draw(["verified"], "pills").container.innerHTML).toBe("");
  });
});

describe("no badge is lost by splitting", () => {
  it("verified + pills together cover exactly what all covers", () => {
    const all = draw(BOTH, "all");
    expect(all.queryByTestId("tick")).toBeTruthy();
    expect(all.queryByText("TOP RATED")).toBeTruthy();

    const v = draw(BOTH, "verified");
    const p = draw(BOTH, "pills");
    expect(v.queryByTestId("tick")).toBeTruthy();
    expect(p.queryByText("TOP RATED")).toBeTruthy();
    // and neither half duplicates the other's content
    expect(v.queryByText("TOP RATED")).toBeNull();
    expect(p.queryByTestId("tick")).toBeNull();
  });

  it("an empty badge list still renders nothing, whatever `only` says", () => {
    for (const only of ["all", "verified", "pills"] as const) {
      expect(draw([], only).container.innerHTML).toBe("");
    }
  });
});
