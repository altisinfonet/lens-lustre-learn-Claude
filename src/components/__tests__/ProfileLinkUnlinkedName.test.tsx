/**
 * P23 S10a-3 (A), review #736: an avatar link carries aria-label "<name> — profile".
 * When the member has no handle, ProfileLink renders a plain <span> instead of a
 * link, and aria-label on a span with no role is prohibited (axe
 * aria-prohibited-attr) — the label must not travel onto the span.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/profile/useProfileData", () => ({ usePrefetchProfile: () => () => {} }));

import ProfileLink from "@/components/ProfileLink";

describe("ProfileLink aria-label", () => {
  it("is kept on the link when the member has a handle", () => {
    const { container } = render(
      <MemoryRouter><ProfileLink userId="u1" handle="hana" aria-label="Hana — profile"><img alt="" src="x" /></ProfileLink></MemoryRouter>,
    );
    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("Hana — profile");
  });

  it("is not put on the plain span when the member has no handle", () => {
    for (const handle of [null, undefined]) {
      const { container } = render(
        <MemoryRouter><ProfileLink userId="u1" handle={handle} aria-label="Hana — profile"><img alt="" src="x" /></ProfileLink></MemoryRouter>,
      );
      const span = container.querySelector("span[data-unlinked]");
      expect(span).not.toBeNull();
      expect(span?.hasAttribute("aria-label")).toBe(false);
    }
  });
});
